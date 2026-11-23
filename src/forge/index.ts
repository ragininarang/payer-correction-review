import api, { route } from '@forge/api';
import Resolver from '@forge/resolver';
import { migrationRunner, sql } from '@forge/sql';
import type { UpdateQueryResponse } from '@forge/sql';
import { buildProof } from '../domain/proof.js';
import type { CorrectionProof, ProofInput } from '../domain/types.js';
import { baseInput, conflictingScopeInput, scopeCounterexample, withFinalReplacement, withLateReversal } from '../fixtures/demo.js';

type Step = 'missing' | 'corrected' | 'reversed' | 'challenged';
interface CaseRow {
  issue_id: string;
  revision: number;
  step: Step;
  approved_revision: number | null;
  proof_json: string;
}
interface CaseView {
  step: Step;
  proof: CorrectionProof;
  approvedRevision: number | null;
  mode: 'forge';
}

const createCases = `CREATE TABLE IF NOT EXISTS correction_cases (
  issue_id VARCHAR(128) PRIMARY KEY,
  revision INT NOT NULL,
  step VARCHAR(20) NOT NULL,
  approved_revision INT NULL,
  proof_json MEDIUMTEXT NOT NULL
)`;
const migrations = migrationRunner.enqueue('v001_correction_cases', createCases);

export async function runMigration(): Promise<void> {
  await migrations.run();
}

function issueIdFromContext(context: Record<string, unknown>): string {
  const extension = context.extension as { issue?: { id?: unknown } } | undefined;
  const issueId = extension?.issue?.id;
  if (typeof issueId !== 'string' || !/^\d{1,18}$/.test(issueId)) throw new Error('Open this panel on a Jira issue.');
  return issueId;
}

async function authorizeIssue(issueId: string): Promise<void> {
  const response = await api.asUser().requestJira(route`/rest/api/3/issue/${issueId}?fields=key`);
  if (!response.ok) throw new Error('This Jira issue is unavailable to your account.');
}

function inputFor(step: Step, issueId: string, revision: number): ProofInput {
  const source = step === 'missing' ? baseInput : step === 'corrected' ? withFinalReplacement()
    : step === 'reversed' ? withLateReversal(withFinalReplacement()) : conflictingScopeInput;
  return { ...source, caseId: `JIRA-${issueId}`, revision };
}

function proofFor(step: Step, issueId: string, revision: number): CorrectionProof {
  return buildProof(inputFor(step, issueId, revision), step === 'challenged' ? [scopeCounterexample] : [], true);
}

async function readCase(issueId: string): Promise<CaseRow | null> {
  const result = await sql.prepare<CaseRow>('SELECT issue_id, revision, step, approved_revision, proof_json FROM correction_cases WHERE issue_id = ?').bindParams(issueId).execute();
  return result.rows[0] ?? null;
}

function view(row: CaseRow): CaseView {
  const proof = JSON.parse(row.proof_json) as CorrectionProof;
  if (proof.revision !== row.revision || proof.caseId !== `JIRA-${row.issue_id}`) throw new Error('Stored proof revision does not match case state.');
  return { step: row.step, proof, approvedRevision: row.approved_revision, mode: 'forge' };
}

async function updateStep(issueId: string, desired: Step, validPrior: Step[]): Promise<CaseView> {
  const row = await readCase(issueId);
  if (!row) throw new Error('Initialize the synthetic case first.');
  if (row.step === desired) return view(row);
  if (!validPrior.includes(row.step)) throw new Error('This evidence step is not available from the current case state.');
  const nextRevision = row.revision + 1;
  const proof = proofFor(desired, issueId, nextRevision);
  const result = await sql.prepare<UpdateQueryResponse>('UPDATE correction_cases SET revision = ?, step = ?, proof_json = ? WHERE issue_id = ? AND revision = ?')
    .bindParams(nextRevision, desired, JSON.stringify(proof), issueId, row.revision).execute();
  if (result.rows.affectedRows !== 1) throw new Error('Case changed while this action ran. Refresh and retry.');
  return { step: desired, proof, approvedRevision: row.approved_revision, mode: 'forge' };
}

const resolver = new Resolver();

resolver.define('getCase', async ({ context }) => {
  const issueId = issueIdFromContext(context);
  await authorizeIssue(issueId);
  const row = await readCase(issueId);
  return row ? view(row) : null;
});

resolver.define('initialize', async ({ context }) => {
  const issueId = issueIdFromContext(context);
  await authorizeIssue(issueId);
  await runMigration();
  const existing = await readCase(issueId);
  const revision = existing ? existing.revision + 1 : 1;
  const proof = proofFor('missing', issueId, revision);
  if (existing) {
    const result = await sql.prepare<UpdateQueryResponse>('UPDATE correction_cases SET revision = ?, step = ?, approved_revision = NULL, proof_json = ? WHERE issue_id = ? AND revision = ?')
      .bindParams(revision, 'missing', JSON.stringify(proof), issueId, existing.revision).execute();
    if (result.rows.affectedRows !== 1) throw new Error('Case changed while resetting. Refresh and retry.');
  } else {
    await sql.prepare('INSERT INTO correction_cases (issue_id, revision, step, approved_revision, proof_json) VALUES (?, ?, ?, NULL, ?)')
      .bindParams(issueId, revision, 'missing', JSON.stringify(proof)).execute();
  }
  return { step: 'missing', proof, approvedRevision: null, mode: 'forge' } satisfies CaseView;
});

resolver.define('addCorrection', async ({ context }) => {
  const issueId = issueIdFromContext(context);
  await authorizeIssue(issueId);
  return updateStep(issueId, 'corrected', ['missing']);
});

resolver.define('addReversal', async ({ context }) => {
  const issueId = issueIdFromContext(context);
  await authorizeIssue(issueId);
  return updateStep(issueId, 'reversed', ['corrected']);
});

resolver.define('challenge', async ({ context }) => {
  const issueId = issueIdFromContext(context);
  await authorizeIssue(issueId);
  return updateStep(issueId, 'challenged', ['missing', 'corrected', 'reversed']);
});

resolver.define('approve', async ({ context }) => {
  const issueId = issueIdFromContext(context);
  await authorizeIssue(issueId);
  const accountId = typeof context.accountId === 'string' ? context.accountId : '';
  const supervisorId = process.env.PCR_SUPERVISOR_ACCOUNT_ID;
  if (!supervisorId || accountId !== supervisorId) throw new Error('Only the configured supervisor can approve this proof.');
  const row = await readCase(issueId);
  if (!row) throw new Error('Initialize the synthetic case first.');
  const proof = view(row).proof;
  if (proof.status !== 'eligible') throw new Error('This proof is not eligible for approval.');
  const result = await sql.prepare<UpdateQueryResponse>('UPDATE correction_cases SET approved_revision = ? WHERE issue_id = ? AND revision = ? AND approved_revision IS NULL')
    .bindParams(row.revision, issueId, row.revision).execute();
  if (result.rows.affectedRows !== 1) throw new Error('Approval is stale or already recorded. Refresh the case.');
  return { step: row.step, proof, approvedRevision: row.revision, mode: 'forge' } satisfies CaseView;
});

export const handler = resolver.getDefinitions();
