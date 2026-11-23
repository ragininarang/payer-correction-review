import { randomUUID } from 'node:crypto';
import api, { route } from '@forge/api';
import Resolver from '@forge/resolver';
import { migrationRunner, sql } from '@forge/sql';
import type { UpdateQueryResponse } from '@forge/sql';
import { buildProof } from '../domain/proof';
import type { CorrectionProof, ProofInput } from '../domain/types';
import {
  invalidatedStates,
  requireCommand,
  requireExactApproval,
  requireExpectedRevision,
  type AppRole,
  type ApprovalStatus,
  type ProjectionStatus,
  type WorkflowCommand,
} from '../domain/workflow';
import { baseInput, conflictingScopeInput, scopeCounterexample, withFinalReplacement, withLateReversal } from '../fixtures/demo';

type Step = 'missing' | 'corrected' | 'reversed' | 'challenged';
type ResolverContext = Record<string, unknown>;

interface CaseRow {
  issue_id: string;
  revision: number;
  step: Step;
  proof_status: CorrectionProof['status'];
  approval_status: ApprovalStatus;
  approved_revision: number | null;
  approved_hash: string | null;
  projection_status: ProjectionStatus;
  proof_hash: string;
  proof_json: string;
}

interface RoleRow { app_role: AppRole }

interface CaseView {
  step: Step;
  proof: CorrectionProof;
  approval: { status: ApprovalStatus; revision: number | null; proofHash: string | null };
  projectionStatus: ProjectionStatus;
  actorRole: AppRole;
  mode: 'forge';
}

const createLegacyCases = `CREATE TABLE IF NOT EXISTS correction_cases (
  issue_id VARCHAR(128) PRIMARY KEY,
  revision INT NOT NULL,
  step VARCHAR(20) NOT NULL,
  approved_revision INT NULL,
  proof_json MEDIUMTEXT NOT NULL
)`;
const createCaseControl = `CREATE TABLE IF NOT EXISTS correction_case_control (
  issue_id VARCHAR(128) PRIMARY KEY,
  revision INT NOT NULL,
  step VARCHAR(20) NOT NULL,
  proof_status VARCHAR(20) NOT NULL,
  approval_status VARCHAR(20) NOT NULL,
  approved_revision INT NULL,
  approved_hash VARCHAR(128) NULL,
  projection_status VARCHAR(20) NOT NULL,
  proof_hash VARCHAR(128) NOT NULL,
  proof_json MEDIUMTEXT NOT NULL
)`;
const createRoles = `CREATE TABLE IF NOT EXISTS correction_actor_roles (
  account_id VARCHAR(128) PRIMARY KEY,
  app_role VARCHAR(20) NOT NULL,
  granted_by VARCHAR(128) NOT NULL,
  granted_at VARCHAR(40) NOT NULL
)`;
const createApprovalHistory = `CREATE TABLE IF NOT EXISTS correction_approval_history (
  approval_event_id VARCHAR(64) PRIMARY KEY,
  issue_id VARCHAR(128) NOT NULL,
  revision INT NOT NULL,
  proof_hash VARCHAR(128) NOT NULL,
  action VARCHAR(20) NOT NULL,
  actor_id VARCHAR(128) NOT NULL,
  reason VARCHAR(255) NOT NULL,
  occurred_at VARCHAR(40) NOT NULL
)`;
const createAuditEvents = `CREATE TABLE IF NOT EXISTS correction_audit_events (
  audit_event_id VARCHAR(64) PRIMARY KEY,
  issue_id VARCHAR(128) NOT NULL,
  revision INT NOT NULL,
  event_type VARCHAR(40) NOT NULL,
  actor_id VARCHAR(128) NOT NULL,
  details_json MEDIUMTEXT NOT NULL,
  occurred_at VARCHAR(40) NOT NULL
)`;

migrationRunner.enqueue('v001_correction_cases', createLegacyCases);
migrationRunner.enqueue('v002_case_control', createCaseControl);
migrationRunner.enqueue('v003_actor_roles', createRoles);
migrationRunner.enqueue('v004_approval_history', createApprovalHistory);
migrationRunner.enqueue('v005_audit_events', createAuditEvents);

export async function runMigration(): Promise<void> {
  await migrationRunner.run();
}

function issueIdFromContext(context: ResolverContext): string {
  const extension = context.extension as { issue?: { id?: unknown } } | undefined;
  const issueId = extension?.issue?.id;
  if (typeof issueId !== 'string' || !/^\d{1,18}$/.test(issueId)) throw new Error('Open this panel on a Jira issue.');
  return issueId;
}

function accountIdFromContext(context: ResolverContext): string {
  const accountId = context.accountId;
  if (typeof accountId !== 'string' || accountId.length < 1 || accountId.length > 128) throw new Error('Your Atlassian identity is unavailable.');
  return accountId;
}

async function authorizeIssue(issueId: string): Promise<void> {
  const response = await api.asUser().requestJira(route`/rest/api/3/issue/${issueId}?fields=key`);
  if (!response.ok) throw new Error('This Jira issue is unavailable to your account.');
}

function isAppRole(value: unknown): value is AppRole {
  return value === 'viewer' || value === 'analyst' || value === 'supervisor' || value === 'operator';
}

async function bootstrapDevelopmentRole(accountId: string): Promise<void> {
  const role = accountId === process.env.PCR_SUPERVISOR_ACCOUNT_ID ? 'supervisor'
    : accountId === process.env.PCR_OPERATOR_ACCOUNT_ID ? 'operator' : null;
  if (!role) return;
  await sql.prepare('INSERT IGNORE INTO correction_actor_roles (account_id, app_role, granted_by, granted_at) VALUES (?, ?, ?, ?)')
    .bindParams(accountId, role, 'development-bootstrap', new Date().toISOString()).execute();
}

async function readRole(accountId: string): Promise<AppRole> {
  await bootstrapDevelopmentRole(accountId);
  const result = await sql.prepare<RoleRow>('SELECT app_role FROM correction_actor_roles WHERE account_id = ?').bindParams(accountId).execute();
  const role = result.rows[0]?.app_role;
  return isAppRole(role) ? role : 'viewer';
}

async function authorize(context: ResolverContext, command: WorkflowCommand): Promise<{ issueId: string; accountId: string; role: AppRole }> {
  await runMigration();
  const issueId = issueIdFromContext(context);
  const accountId = accountIdFromContext(context);
  await authorizeIssue(issueId);
  const role = await readRole(accountId);
  requireCommand(role, command);
  return { issueId, accountId, role };
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
  const result = await sql.prepare<CaseRow>(`SELECT issue_id, revision, step, proof_status, approval_status,
    approved_revision, approved_hash, projection_status, proof_hash, proof_json
    FROM correction_case_control WHERE issue_id = ?`).bindParams(issueId).execute();
  return result.rows[0] ?? null;
}

function view(row: CaseRow, role: AppRole): CaseView {
  const proof = JSON.parse(row.proof_json) as CorrectionProof;
  if (proof.revision !== row.revision || proof.caseId !== `JIRA-${row.issue_id}` || proof.inputHash !== row.proof_hash) {
    throw new Error('Stored proof does not match authoritative case state.');
  }
  return {
    step: row.step,
    proof,
    approval: { status: row.approval_status, revision: row.approved_revision, proofHash: row.approved_hash },
    projectionStatus: row.projection_status,
    actorRole: role,
    mode: 'forge',
  };
}

async function appendAudit(issueId: string, revision: number, eventType: string, actorId: string, details: Record<string, unknown>): Promise<void> {
  await sql.prepare(`INSERT INTO correction_audit_events
    (audit_event_id, issue_id, revision, event_type, actor_id, details_json, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).bindParams(
    randomUUID(), issueId, revision, eventType, actorId, JSON.stringify(details), new Date().toISOString(),
  ).execute();
}

async function appendApprovalHistory(
  issueId: string,
  revision: number,
  proofHash: string,
  action: 'approved' | 'invalidated',
  actorId: string,
  reason: string,
): Promise<void> {
  await sql.prepare(`INSERT INTO correction_approval_history
    (approval_event_id, issue_id, revision, proof_hash, action, actor_id, reason, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bindParams(
    randomUUID(), issueId, revision, proofHash, action, actorId, reason, new Date().toISOString(),
  ).execute();
}

function payloadObject(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
}

async function updateStep(
  issueId: string,
  desired: Step,
  validPrior: Step[],
  expectedRevision: unknown,
  actorId: string,
  role: AppRole,
): Promise<CaseView> {
  const row = await readCase(issueId);
  if (!row) throw new Error('Initialize the synthetic case first.');
  requireExpectedRevision(row.revision, expectedRevision);
  if (row.step === desired) return view(row, role);
  if (!validPrior.includes(row.step)) throw new Error('This evidence step is not available from the current case state.');

  const nextRevision = row.revision + 1;
  const proof = proofFor(desired, issueId, nextRevision);
  const wasApproved = row.approval_status === 'approved';
  const next = invalidatedStates(wasApproved);
  const result = await sql.prepare<UpdateQueryResponse>(`UPDATE correction_case_control SET revision = ?, step = ?,
    proof_status = ?, approval_status = ?, projection_status = ?, proof_hash = ?, proof_json = ?
    WHERE issue_id = ? AND revision = ?`).bindParams(
    nextRevision, desired, proof.status, next.approvalStatus, next.projectionStatus, proof.inputHash,
    JSON.stringify(proof), issueId, row.revision,
  ).execute();
  if (result.rows.affectedRows !== 1) throw new Error('Case changed while this action ran. Refresh and retry.');

  if (wasApproved && row.approved_revision !== null && row.approved_hash) {
    await appendApprovalHistory(issueId, row.approved_revision, row.approved_hash, 'invalidated', actorId, `${desired} evidence created revision ${nextRevision}`);
  }
  await appendAudit(issueId, nextRevision, 'evidence-revision-created', actorId, { priorStep: row.step, step: desired, priorRevision: row.revision });
  const updated = await readCase(issueId);
  if (!updated) throw new Error('Updated case could not be reloaded.');
  return view(updated, role);
}

const resolver = new Resolver();

resolver.define('getCase', async ({ context }) => {
  const actor = await authorize(context as ResolverContext, 'read');
  const row = await readCase(actor.issueId);
  return { case: row ? view(row, actor.role) : null, actorRole: actor.role };
});

resolver.define('initialize', async ({ context }) => {
  const actor = await authorize(context as ResolverContext, 'initialize');
  if (await readCase(actor.issueId)) throw new Error('This case already exists. Reset requires explicit confirmation.');
  const proof = proofFor('missing', actor.issueId, 1);
  await sql.prepare(`INSERT INTO correction_case_control
    (issue_id, revision, step, proof_status, approval_status, approved_revision, approved_hash,
     projection_status, proof_hash, proof_json) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`).bindParams(
    actor.issueId, 1, 'missing', proof.status, 'unapproved', 'not-requested', proof.inputHash, JSON.stringify(proof),
  ).execute();
  await appendAudit(actor.issueId, 1, 'case-initialized', actor.accountId, { synthetic: true });
  const row = await readCase(actor.issueId);
  if (!row) throw new Error('Initialized case could not be reloaded.');
  return view(row, actor.role);
});

resolver.define('addCorrection', async ({ payload, context }) => {
  const actor = await authorize(context as ResolverContext, 'record-evidence');
  return updateStep(actor.issueId, 'corrected', ['missing'], payloadObject(payload).expectedRevision, actor.accountId, actor.role);
});

resolver.define('addReversal', async ({ payload, context }) => {
  const actor = await authorize(context as ResolverContext, 'record-evidence');
  return updateStep(actor.issueId, 'reversed', ['corrected'], payloadObject(payload).expectedRevision, actor.accountId, actor.role);
});

resolver.define('challenge', async ({ payload, context }) => {
  const actor = await authorize(context as ResolverContext, 'challenge');
  return updateStep(actor.issueId, 'challenged', ['missing', 'corrected', 'reversed'], payloadObject(payload).expectedRevision, actor.accountId, actor.role);
});

resolver.define('approve', async ({ payload, context }) => {
  const actor = await authorize(context as ResolverContext, 'approve');
  const row = await readCase(actor.issueId);
  if (!row) throw new Error('Initialize the synthetic case first.');
  const proof = view(row, actor.role).proof;
  const input = payloadObject(payload);
  requireExactApproval(proof, input.expectedRevision, input.proofHash);
  if (row.approval_status === 'approved') return view(row, actor.role);

  const result = await sql.prepare<UpdateQueryResponse>(`UPDATE correction_case_control SET approval_status = ?,
    approved_revision = ?, approved_hash = ?, projection_status = ?
    WHERE issue_id = ? AND revision = ? AND proof_hash = ? AND proof_status = ?`).bindParams(
    'approved', row.revision, proof.inputHash, 'pending', actor.issueId, row.revision, proof.inputHash, 'eligible',
  ).execute();
  if (result.rows.affectedRows !== 1) throw new Error('Approval is stale. Refresh the case before trying again.');
  await appendApprovalHistory(actor.issueId, row.revision, proof.inputHash, 'approved', actor.accountId, 'Supervisor approved exact proof revision and fingerprint.');
  await appendAudit(actor.issueId, row.revision, 'proof-approved', actor.accountId, { proofHash: proof.inputHash });
  const updated = await readCase(actor.issueId);
  if (!updated) throw new Error('Approved case could not be reloaded.');
  return view(updated, actor.role);
});

resolver.define('reset', async ({ payload, context }) => {
  const actor = await authorize(context as ResolverContext, 'reset');
  const row = await readCase(actor.issueId);
  if (!row) throw new Error('There is no case to reset.');
  const input = payloadObject(payload);
  requireExpectedRevision(row.revision, input.expectedRevision);
  if (input.confirmation !== 'RESET CASE') throw new Error('Reset requires the exact confirmation RESET CASE.');

  const nextRevision = row.revision + 1;
  const proof = proofFor('missing', actor.issueId, nextRevision);
  const wasApproved = row.approval_status === 'approved';
  const next = invalidatedStates(wasApproved);
  const result = await sql.prepare<UpdateQueryResponse>(`UPDATE correction_case_control SET revision = ?, step = ?,
    proof_status = ?, approval_status = ?, projection_status = ?, proof_hash = ?, proof_json = ?
    WHERE issue_id = ? AND revision = ?`).bindParams(
    nextRevision, 'missing', proof.status, next.approvalStatus, next.projectionStatus, proof.inputHash,
    JSON.stringify(proof), actor.issueId, row.revision,
  ).execute();
  if (result.rows.affectedRows !== 1) throw new Error('Case changed while reset ran. Refresh and retry.');
  if (wasApproved && row.approved_revision !== null && row.approved_hash) {
    await appendApprovalHistory(actor.issueId, row.approved_revision, row.approved_hash, 'invalidated', actor.accountId, `Authorized reset created revision ${nextRevision}`);
  }
  await appendAudit(actor.issueId, nextRevision, 'case-reset', actor.accountId, { priorRevision: row.revision, confirmation: true });
  const updated = await readCase(actor.issueId);
  if (!updated) throw new Error('Reset case could not be reloaded.');
  return view(updated, actor.role);
});

resolver.define('setRole', async ({ payload, context }) => {
  const actor = await authorize(context as ResolverContext, 'manage-roles');
  const input = payloadObject(payload);
  if (typeof input.accountId !== 'string' || input.accountId.length < 1 || input.accountId.length > 128 || !isAppRole(input.role)) {
    throw new Error('A valid Atlassian account and app role are required.');
  }
  const changedAt = new Date().toISOString();
  await sql.prepare(`INSERT INTO correction_actor_roles (account_id, app_role, granted_by, granted_at) VALUES (?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE app_role = ?, granted_by = ?, granted_at = ?`).bindParams(
    input.accountId, input.role, actor.accountId, changedAt, input.role, actor.accountId, changedAt,
  ).execute();
  const row = await readCase(actor.issueId);
  await appendAudit(actor.issueId, row?.revision ?? 0, 'role-mapped', actor.accountId, { targetAccountId: input.accountId, role: input.role });
  return { accountId: input.accountId, role: input.role };
});

export const handler = resolver.getDefinitions();
