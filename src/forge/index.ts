import { randomUUID } from 'node:crypto';
import api, { route } from '@forge/api';
import { Queue, type AsyncEvent } from '@forge/events';
import Resolver from '@forge/resolver';
import { migrationRunner, sql } from '@forge/sql';
import type { UpdateQueryResponse } from '@forge/sql';
import {
  PLATFORM_SPIKE_MODEL,
  PLATFORM_SPIKE_PROMPT_VERSION,
  PlatformSpikeFindingSchema,
  classifyPlatformSpikeFailure,
  executePlatformSpike,
  type PlatformSpikeGraphResult,
} from '../agents/platformSpike';
import { buildProof } from '../domain/proof';
import { approvedProjection, invalidatedProjection, isMatchingProjection, nextProjectionStatus } from '../domain/projection';
import type { CorrectionProof, ProofInput } from '../domain/types';
import {
  classifyEvidence,
  contentHash,
  planEvidenceRecovery,
  validateFollowUp,
  type EvidenceStep,
  type FollowUpOutcome,
} from '../domain/ledger';
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

type Step = EvidenceStep;
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
interface EvidenceRow {
  event_key: string;
  event_id: string;
  content_hash: string;
  status: 'pending' | 'applied' | 'quarantined';
  prior_revision: number;
  resulting_revision: number | null;
  desired_step: Step;
}
interface PendingEvidenceRow extends EvidenceRow { issue_id: string; registered_by: string }
interface FollowUpRow {
  followup_id: string;
  revision: number;
  outcome: FollowUpOutcome;
  next_review_date: string;
  note: string;
  line_ids_json: string;
  actor_id: string;
  occurred_at: string;
}
interface AuditRow {
  audit_event_id: string;
  revision: number;
  event_type: string;
  actor_id: string;
  details_json: string;
  occurred_at: string;
}
interface JiraEffectRow {
  effect_id: string;
  issue_id: string;
  revision: number;
  effect_type: string;
  status: 'pending' | 'synced' | 'failed' | 'conflicted';
  attempt: number;
  details_json: string;
}
interface StageRunRow {
  stage_run_id: string;
  issue_id: string;
  revision: number;
  stage: string;
  status: 'queued' | 'running' | 'model-complete' | 'completed' | 'failed' | 'superseded';
  attempt: number;
  terminal_reason: string | null;
  telemetry_json: string;
  result_json: string | null;
  updated_at: string;
}

interface PlatformSpikeView {
  runId: string;
  revision: number;
  status: StageRunRow['status'];
  attempt: number;
  terminalReason: string | null;
  model: string | null;
  promptVersion: string;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostMicrousd: number | null;
  durationMs: number | null;
  toolCalls: number | null;
  graphSteps: number | null;
  finding: PlatformSpikeGraphResult['finding'] | null;
  updatedAt: string;
}

interface PlatformSpikeEventBody extends Record<string, unknown> {
  stageRunId: string;
  issueId: string;
  revision: number;
  phase: 'execute' | 'resume';
}

const platformSpikeQueue = new Queue<PlatformSpikeEventBody>({ key: 'platform-spike-queue' });

interface CaseView {
  step: Step;
  proof: CorrectionProof;
  approval: { status: ApprovalStatus; revision: number | null; proofHash: string | null };
  projectionStatus: ProjectionStatus;
  actorRole: AppRole;
  mode: 'forge';
}

interface FollowUpView {
  followUpId: string;
  revision: number;
  outcome: FollowUpOutcome;
  nextReviewDate: string;
  note: string;
  lineIds: string[];
  actorId: string;
  occurredAt: string;
}

interface HistoryView {
  eventId: string;
  revision: number;
  eventType: string;
  actorId: string;
  details: Record<string, unknown>;
  occurredAt: string;
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
const createSourceEvents = `CREATE TABLE IF NOT EXISTS correction_source_events (
  event_key VARCHAR(128) PRIMARY KEY,
  issue_id VARCHAR(128) NOT NULL,
  event_id VARCHAR(128) NOT NULL,
  content_hash VARCHAR(64) NOT NULL,
  source_type VARCHAR(40) NOT NULL,
  source_name VARCHAR(255) NOT NULL,
  desired_step VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL,
  prior_revision INT NOT NULL,
  resulting_revision INT NULL,
  registered_by VARCHAR(128) NOT NULL,
  payload_json MEDIUMTEXT NOT NULL,
  registered_at VARCHAR(40) NOT NULL,
  UNIQUE KEY correction_source_event_identity (issue_id, event_id)
)`;
const createProofRevisions = `CREATE TABLE IF NOT EXISTS correction_proof_revisions (
  proof_revision_id VARCHAR(180) PRIMARY KEY,
  issue_id VARCHAR(128) NOT NULL,
  revision INT NOT NULL,
  proof_hash VARCHAR(128) NOT NULL,
  proof_status VARCHAR(20) NOT NULL,
  proof_json MEDIUMTEXT NOT NULL,
  created_at VARCHAR(40) NOT NULL,
  UNIQUE KEY correction_proof_identity (issue_id, revision)
)`;
const createLineResults = `CREATE TABLE IF NOT EXISTS correction_line_results (
  result_id VARCHAR(220) PRIMARY KEY,
  issue_id VARCHAR(128) NOT NULL,
  revision INT NOT NULL,
  line_id VARCHAR(128) NOT NULL,
  claim_id VARCHAR(128) NOT NULL,
  service_line_number INT NOT NULL,
  status VARCHAR(30) NOT NULL,
  expected_net_cents BIGINT NOT NULL,
  observed_net_cents BIGINT NULL,
  result_json MEDIUMTEXT NOT NULL
)`;
const createPayerFollowups = `CREATE TABLE IF NOT EXISTS correction_payer_followups (
  followup_id VARCHAR(64) PRIMARY KEY,
  issue_id VARCHAR(128) NOT NULL,
  revision INT NOT NULL,
  outcome VARCHAR(50) NOT NULL,
  next_review_date VARCHAR(10) NOT NULL,
  note MEDIUMTEXT NOT NULL,
  line_ids_json MEDIUMTEXT NOT NULL,
  actor_id VARCHAR(128) NOT NULL,
  occurred_at VARCHAR(40) NOT NULL
)`;
const createStageRuns = `CREATE TABLE IF NOT EXISTS correction_stage_runs (
  stage_run_id VARCHAR(220) PRIMARY KEY,
  issue_id VARCHAR(128) NOT NULL,
  revision INT NOT NULL,
  stage VARCHAR(40) NOT NULL,
  status VARCHAR(30) NOT NULL,
  attempt INT NOT NULL,
  terminal_reason VARCHAR(50) NULL,
  telemetry_json MEDIUMTEXT NOT NULL,
  updated_at VARCHAR(40) NOT NULL
)`;
const createJiraEffects = `CREATE TABLE IF NOT EXISTS correction_jira_effects (
  effect_id VARCHAR(220) PRIMARY KEY,
  issue_id VARCHAR(128) NOT NULL,
  revision INT NOT NULL,
  effect_type VARCHAR(40) NOT NULL,
  status VARCHAR(30) NOT NULL,
  attempt INT NOT NULL,
  details_json MEDIUMTEXT NOT NULL,
  updated_at VARCHAR(40) NOT NULL
)`;

migrationRunner.enqueue('v001_correction_cases', createLegacyCases);
migrationRunner.enqueue('v002_case_control', createCaseControl);
migrationRunner.enqueue('v003_actor_roles', createRoles);
migrationRunner.enqueue('v004_approval_history', createApprovalHistory);
migrationRunner.enqueue('v005_audit_events', createAuditEvents);
migrationRunner.enqueue('v006_source_events', createSourceEvents);
migrationRunner.enqueue('v007_proof_revisions', createProofRevisions);
migrationRunner.enqueue('v008_line_results', createLineResults);
migrationRunner.enqueue('v009_payer_followups', createPayerFollowups);
migrationRunner.enqueue('v010_stage_runs', createStageRuns);
migrationRunner.enqueue('v011_jira_effects', createJiraEffects);
migrationRunner.enqueue('v012_stage_run_results', 'ALTER TABLE correction_stage_runs ADD COLUMN result_json MEDIUMTEXT NULL');

export async function runMigration(): Promise<void> {
  await migrationRunner.run();
}

export async function runRecovery(): Promise<void> {
  await runMigration();
  const pending = await sql.prepare<PendingEvidenceRow>(`SELECT event_key, issue_id, event_id, content_hash,
    status, prior_revision, resulting_revision, desired_step, registered_by FROM correction_source_events
    WHERE status = ? ORDER BY registered_at ASC LIMIT 50`).bindParams('pending').execute();
  for (const event of pending.rows) {
    let row = await readCase(event.issue_id);
    if (!row) {
      await sql.prepare('UPDATE correction_source_events SET status = ? WHERE event_key = ? AND status = ?')
        .bindParams('quarantined', event.event_key, 'pending').execute();
      continue;
    }
    const plan = planEvidenceRecovery(row.revision, row.step, event.prior_revision, event.desired_step);
    if (plan.action === 'quarantine-stale') {
      await sql.prepare('UPDATE correction_source_events SET status = ? WHERE event_key = ? AND status = ?')
        .bindParams('quarantined', event.event_key, 'pending').execute();
      await appendAudit(event.issue_id, row.revision, 'stale-evidence-quarantined', 'system-recovery', {
        sourceEventId: event.event_id,
        eventPriorRevision: event.prior_revision,
        currentRevision: row.revision,
      }, `stale-evidence:${event.event_key}`);
      continue;
    }
    if (plan.action === 'advance-case') {
      const nextRevision = plan.resultingRevision!;
      const proof = proofFor(event.desired_step, event.issue_id, nextRevision);
      const wasApproved = row.approval_status === 'approved';
      const next = invalidatedStates(wasApproved);
      const result = await sql.prepare<UpdateQueryResponse>(`UPDATE correction_case_control SET revision = ?, step = ?,
        proof_status = ?, approval_status = ?, projection_status = ?, proof_hash = ?, proof_json = ?
        WHERE issue_id = ? AND revision = ?`).bindParams(
        nextRevision, event.desired_step, proof.status, next.approvalStatus, next.projectionStatus,
        proof.inputHash, JSON.stringify(proof), event.issue_id, row.revision,
      ).execute();
      if (result.rows.affectedRows !== 1) continue;
      if (wasApproved && row.approved_revision !== null) {
        await queueReopenEffect(event.issue_id, nextRevision, proof.inputHash, row.approved_revision);
      }
      row = await readCase(event.issue_id);
      if (!row) continue;
    }
    if (row.approval_status === 'invalidated' && row.approved_revision !== null && row.approved_hash) {
      await appendApprovalHistory(
        event.issue_id,
        row.approved_revision,
        row.approved_hash,
        'invalidated',
        event.registered_by,
        `${event.desired_step} evidence created revision ${row.revision}`,
      );
    }
    await appendAudit(event.issue_id, row.revision, 'evidence-revision-created', event.registered_by, {
      step: event.desired_step,
      priorRevision: event.prior_revision,
      sourceEventId: event.event_id,
      recovered: true,
    }, `evidence:${event.event_key}`);
    const proof = JSON.parse(row.proof_json) as CorrectionProof;
    await persistProofRevision(event.issue_id, proof);
    await sql.prepare('UPDATE correction_source_events SET status = ?, resulting_revision = ? WHERE event_key = ? AND status = ?')
      .bindParams('applied', row.revision, event.event_key, 'pending').execute();
  }
  await recoverPlatformSpikeDispatch();
  await recoverMissingJiraEffects();
  await recoverJiraEffects();
}

async function readJiraProjection(issueId: string): Promise<unknown | null> {
  const response = await api.asApp().requestJira(route`/rest/api/3/issue/${issueId}/properties/payer-correction-proof`);
  if (response.status === 404) return null;
  if (!response.ok) throw Object.assign(new Error(`Jira projection read failed with ${response.status}.`), { status: response.status });
  const body = await response.json() as { value?: unknown };
  return body.value ?? null;
}

async function recoverMissingJiraEffects(): Promise<void> {
  const result = await sql.prepare<CaseRow>(`SELECT issue_id, revision, step, proof_status, approval_status,
    approved_revision, approved_hash, projection_status, proof_hash, proof_json
    FROM correction_case_control WHERE projection_status = ? AND approval_status IN (?, ?) LIMIT 50`)
    .bindParams('pending', 'approved', 'invalidated').execute();
  for (const row of result.rows) {
    if (row.approval_status === 'approved' && row.approved_revision === row.revision && row.approved_hash) {
      await sql.prepare(`INSERT IGNORE INTO correction_jira_effects
        (effect_id, issue_id, revision, effect_type, status, attempt, details_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bindParams(
        `${row.issue_id}:${row.revision}:approved`, row.issue_id, row.revision, 'project-approved-closure',
        'pending', 0, JSON.stringify({ proofHash: row.approved_hash }), new Date().toISOString(),
      ).execute();
    } else if (row.approval_status === 'invalidated' && row.approved_revision !== null) {
      await queueReopenEffect(row.issue_id, row.revision, row.proof_hash, row.approved_revision);
    }
  }
}

async function recoverJiraEffects(): Promise<void> {
  const pending = await sql.prepare<JiraEffectRow>(`SELECT effect_id, issue_id, revision, effect_type,
    status, attempt, details_json FROM correction_jira_effects
    WHERE status = ? ORDER BY updated_at ASC LIMIT 25`).bindParams('pending').execute();
  for (const effect of pending.rows) {
    const row = await readCase(effect.issue_id);
    const details = parseObject(effect.details_json);
    const proofHash = typeof details.proofHash === 'string' ? details.proofHash : '';
    const isApproval = effect.effect_type === 'project-approved-closure'
      && row?.approval_status === 'approved'
      && row.approved_revision === effect.revision
      && row.approved_hash === proofHash;
    const isReopen = effect.effect_type === 'project-reopened'
      && row?.approval_status === 'invalidated'
      && row.proof_hash === proofHash;
    if (!row || row.revision !== effect.revision || (!isApproval && !isReopen)) {
      await sql.prepare('UPDATE correction_jira_effects SET status = ?, updated_at = ? WHERE effect_id = ? AND status = ?')
        .bindParams('conflicted', new Date().toISOString(), effect.effect_id, 'pending').execute();
      continue;
    }
    const expected = isApproval
      ? approvedProjection(effect.revision, proofHash)
      : invalidatedProjection(effect.revision, proofHash);
    try {
      let current = await readJiraProjection(effect.issue_id);
      if (!isMatchingProjection(current, expected)) {
        const response = await api.asApp().requestJira(
          route`/rest/api/3/issue/${effect.issue_id}/properties/payer-correction-proof`,
          { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(expected) },
        );
        if (!response.ok) throw Object.assign(new Error(`Jira projection write failed with ${response.status}.`), { status: response.status });
        current = await readJiraProjection(effect.issue_id);
      }
      if (!isMatchingProjection(current, expected)) throw Object.assign(new Error('Jira projection read-back did not match.'), { status: 409 });
      if (isApproval) {
        await sql.prepare(`UPDATE correction_case_control SET projection_status = ?
          WHERE issue_id = ? AND revision = ? AND approval_status = ? AND approved_hash = ?`).bindParams(
          'synced', effect.issue_id, effect.revision, 'approved', proofHash,
        ).execute();
      } else {
        await sql.prepare(`UPDATE correction_case_control SET projection_status = ?
          WHERE issue_id = ? AND revision = ? AND approval_status = ? AND proof_hash = ?`).bindParams(
          'synced', effect.issue_id, effect.revision, 'invalidated', proofHash,
        ).execute();
      }
      await appendAudit(effect.issue_id, effect.revision, 'jira-update-synced', 'system-recovery', {
        effectId: effect.effect_id,
        proofHash,
      }, `jira-effect:${effect.effect_id}:synced`);
      await sql.prepare('UPDATE correction_jira_effects SET status = ?, attempt = ?, details_json = ?, updated_at = ? WHERE effect_id = ? AND status = ?')
        .bindParams('synced', effect.attempt + 1, JSON.stringify({ ...details, receipt: expected }), new Date().toISOString(), effect.effect_id, 'pending').execute();
    } catch (error: unknown) {
      const statusCode = typeof error === 'object' && error !== null && 'status' in error ? Number((error as { status: unknown }).status) : 0;
      const failure = statusCode === 429 || statusCode >= 500 || statusCode === 0 ? 'transient' : 'permanent';
      const attempt = effect.attempt + 1;
      const status = nextProjectionStatus(attempt, failure);
      await sql.prepare('UPDATE correction_jira_effects SET status = ?, attempt = ?, details_json = ?, updated_at = ? WHERE effect_id = ? AND status = ?')
        .bindParams(status, attempt, JSON.stringify({ ...details, lastError: error instanceof Error ? error.message : 'Unknown Jira projection error' }), new Date().toISOString(), effect.effect_id, 'pending').execute();
      if (status === 'failed') {
        await sql.prepare(`UPDATE correction_case_control SET projection_status = ?
          WHERE issue_id = ? AND revision = ? AND approval_status = ?`).bindParams(
          'failed', effect.issue_id, effect.revision, isApproval ? 'approved' : 'invalidated',
        ).execute();
      }
    }
  }
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

function parseObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parsePlatformSpikeResult(value: string | null): PlatformSpikeGraphResult | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const finding = PlatformSpikeFindingSchema.parse(parsed.finding);
    const usage = parseObject(JSON.stringify(parsed.usage ?? {}));
    if (typeof parsed.model !== 'string' || typeof parsed.responseId !== 'string'
      || !Number.isInteger(parsed.toolCalls) || !Number.isInteger(parsed.graphSteps)
      || !Array.isArray(parsed.sourceIds) || !parsed.sourceIds.every((item) => typeof item === 'string')) return null;
    const inputTokens = finiteNumber(usage.inputTokens);
    const outputTokens = finiteNumber(usage.outputTokens);
    const totalTokens = finiteNumber(usage.totalTokens);
    if (inputTokens === null || outputTokens === null || totalTokens === null) return null;
    const estimatedCostMicrousd = usage.estimatedCostMicrousd === null ? null : finiteNumber(usage.estimatedCostMicrousd);
    return {
      finding,
      model: parsed.model,
      responseId: parsed.responseId,
      usage: { inputTokens, outputTokens, totalTokens, estimatedCostMicrousd },
      toolCalls: parsed.toolCalls as number,
      graphSteps: parsed.graphSteps as number,
      sourceIds: parsed.sourceIds as string[],
    };
  } catch { return null; }
}

async function readStageRun(stageRunId: string): Promise<StageRunRow | null> {
  const result = await sql.prepare<StageRunRow>(`SELECT stage_run_id, issue_id, revision, stage, status,
    attempt, terminal_reason, telemetry_json, result_json, updated_at
    FROM correction_stage_runs WHERE stage_run_id = ?`).bindParams(stageRunId).execute();
  return result.rows[0] ?? null;
}

async function readLatestPlatformSpike(issueId: string): Promise<StageRunRow | null> {
  const result = await sql.prepare<StageRunRow>(`SELECT stage_run_id, issue_id, revision, stage, status,
    attempt, terminal_reason, telemetry_json, result_json, updated_at
    FROM correction_stage_runs WHERE issue_id = ? AND stage = ? ORDER BY updated_at DESC LIMIT 1`)
    .bindParams(issueId, 'platform-spike').execute();
  return result.rows[0] ?? null;
}

function platformSpikeView(row: StageRunRow | null): PlatformSpikeView | null {
  if (!row) return null;
  const telemetry = parseObject(row.telemetry_json);
  const usage = telemetry.usage && typeof telemetry.usage === 'object' ? telemetry.usage as Record<string, unknown> : {};
  const result = parsePlatformSpikeResult(row.result_json);
  return {
    runId: row.stage_run_id,
    revision: row.revision,
    status: row.status,
    attempt: row.attempt,
    terminalReason: row.terminal_reason,
    model: typeof telemetry.model === 'string' ? telemetry.model : null,
    promptVersion: typeof telemetry.promptVersion === 'string' ? telemetry.promptVersion : PLATFORM_SPIKE_PROMPT_VERSION,
    inputTokens: finiteNumber(usage.inputTokens),
    outputTokens: finiteNumber(usage.outputTokens),
    estimatedCostMicrousd: usage.estimatedCostMicrousd === null ? null : finiteNumber(usage.estimatedCostMicrousd),
    durationMs: finiteNumber(telemetry.durationMs),
    toolCalls: finiteNumber(telemetry.toolCalls),
    graphSteps: finiteNumber(telemetry.graphSteps),
    finding: result?.finding ?? null,
    updatedAt: row.updated_at,
  };
}

async function enqueuePlatformSpike(row: Pick<StageRunRow, 'stage_run_id' | 'issue_id' | 'revision'>, phase: 'execute' | 'resume'): Promise<string> {
  const { jobId } = await platformSpikeQueue.push({
    body: { stageRunId: row.stage_run_id, issueId: row.issue_id, revision: row.revision, phase },
    concurrency: { key: `platform-spike:${row.issue_id}`, limit: 1 },
  });
  return jobId;
}

async function recoverPlatformSpikeDispatch(): Promise<void> {
  const result = await sql.prepare<StageRunRow>(`SELECT stage_run_id, issue_id, revision, stage, status,
    attempt, terminal_reason, telemetry_json, result_json, updated_at FROM correction_stage_runs
    WHERE stage = ? AND status IN (?, ?) ORDER BY updated_at ASC LIMIT 25`)
    .bindParams('platform-spike', 'queued', 'model-complete').execute();
  for (const row of result.rows) await enqueuePlatformSpike(row, row.status === 'model-complete' ? 'resume' : 'execute');
}

async function readEvidenceEvent(issueId: string, eventId: string): Promise<EvidenceRow | null> {
  const result = await sql.prepare<EvidenceRow>(`SELECT event_key, event_id, content_hash, status,
    prior_revision, resulting_revision, desired_step
    FROM correction_source_events WHERE issue_id = ? AND event_id = ?`).bindParams(issueId, eventId).execute();
  return result.rows[0] ?? null;
}

async function registerEvidenceEvent(
  issueId: string,
  eventId: string,
  sourceType: string,
  sourceName: string,
  desiredStep: Step,
  priorRevision: number,
  actorId: string,
  payload: Record<string, unknown>,
): Promise<{ row: EvidenceRow; registration: 'new' | 'duplicate' }> {
  const hash = contentHash(payload);
  const existing = await readEvidenceEvent(issueId, eventId);
  const classification = classifyEvidence(existing?.content_hash ?? null, hash);
  if (classification === 'conflict') {
    if (existing) await sql.prepare('UPDATE correction_source_events SET status = ? WHERE event_key = ?')
      .bindParams('quarantined', existing.event_key).execute();
    throw new Error('This evidence identity was already used for different content. The new file was quarantined for operator review.');
  }
  if (existing?.status === 'quarantined') {
    throw new Error('This evidence identity is quarantined and cannot be used until an operator resolves the conflict.');
  }
  if (existing) return { row: existing, registration: 'duplicate' };

  const eventKey = contentHash({ issueId, eventId });
  await sql.prepare(`INSERT IGNORE INTO correction_source_events
    (event_key, issue_id, event_id, content_hash, source_type, source_name, desired_step, status,
     prior_revision, resulting_revision, registered_by, payload_json, registered_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`).bindParams(
    eventKey, issueId, eventId, hash, sourceType, sourceName, desiredStep, 'pending', priorRevision,
    actorId, JSON.stringify(payload), new Date().toISOString(),
  ).execute();
  const row = await readEvidenceEvent(issueId, eventId);
  if (!row) throw new Error('Evidence registration could not be verified. No case result was changed.');
  if (row.content_hash !== hash) {
    await sql.prepare('UPDATE correction_source_events SET status = ? WHERE event_key = ?').bindParams('quarantined', row.event_key).execute();
    throw new Error('This evidence identity was registered concurrently with different content. It was quarantined.');
  }
  return { row, registration: 'new' };
}

async function persistProofRevision(issueId: string, proof: CorrectionProof): Promise<void> {
  const now = new Date().toISOString();
  await sql.prepare(`INSERT IGNORE INTO correction_proof_revisions
    (proof_revision_id, issue_id, revision, proof_hash, proof_status, proof_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).bindParams(
    `${issueId}:${proof.revision}`, issueId, proof.revision, proof.inputHash, proof.status, JSON.stringify(proof), now,
  ).execute();
  for (const item of proof.obligations) {
    await sql.prepare(`INSERT IGNORE INTO correction_line_results
      (result_id, issue_id, revision, line_id, claim_id, service_line_number, status,
       expected_net_cents, observed_net_cents, result_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bindParams(
      `${issueId}:${proof.revision}:${item.lineId}`, issueId, proof.revision, item.lineId, item.claimId,
      item.serviceLineNumber, item.status, item.expectedNetCents, item.observedNetCents, JSON.stringify(item),
    ).execute();
  }
}

async function readFollowUps(issueId: string): Promise<FollowUpView[]> {
  const result = await sql.prepare<FollowUpRow>(`SELECT followup_id, revision, outcome, next_review_date,
    note, line_ids_json, actor_id, occurred_at FROM correction_payer_followups
    WHERE issue_id = ? ORDER BY occurred_at DESC LIMIT 50`).bindParams(issueId).execute();
  return result.rows.map((row) => ({
    followUpId: row.followup_id,
    revision: row.revision,
    outcome: row.outcome,
    nextReviewDate: row.next_review_date,
    note: row.note,
    lineIds: JSON.parse(row.line_ids_json) as string[],
    actorId: row.actor_id,
    occurredAt: row.occurred_at,
  }));
}

async function readHistory(issueId: string): Promise<HistoryView[]> {
  const result = await sql.prepare<AuditRow>(`SELECT audit_event_id, revision, event_type, actor_id,
    details_json, occurred_at FROM correction_audit_events
    WHERE issue_id = ? ORDER BY occurred_at ASC LIMIT 200`).bindParams(issueId).execute();
  return result.rows.map((row) => ({
    eventId: row.audit_event_id,
    revision: row.revision,
    eventType: row.event_type,
    actorId: row.actor_id,
    details: parseObject(row.details_json),
    occurredAt: row.occurred_at,
  }));
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

async function appendAudit(
  issueId: string,
  revision: number,
  eventType: string,
  actorId: string,
  details: Record<string, unknown>,
  stableId?: string,
): Promise<void> {
  await sql.prepare(`INSERT IGNORE INTO correction_audit_events
    (audit_event_id, issue_id, revision, event_type, actor_id, details_json, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).bindParams(
    stableId ? contentHash({ issueId, stableId }) : randomUUID(),
    issueId, revision, eventType, actorId, JSON.stringify(details), new Date().toISOString(),
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
  await sql.prepare(`INSERT IGNORE INTO correction_approval_history
    (approval_event_id, issue_id, revision, proof_hash, action, actor_id, reason, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bindParams(
    contentHash({ issueId, revision, proofHash, action, reason }),
    issueId, revision, proofHash, action, actorId, reason, new Date().toISOString(),
  ).execute();
}

async function queueReopenEffect(
  issueId: string,
  revision: number,
  proofHash: string,
  invalidatedApprovedRevision: number,
): Promise<void> {
  await sql.prepare(`INSERT IGNORE INTO correction_jira_effects
    (effect_id, issue_id, revision, effect_type, status, attempt, details_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bindParams(
    `${issueId}:${revision}:reopened`, issueId, revision, 'project-reopened', 'pending', 0,
    JSON.stringify({ proofHash, invalidatedApprovedRevision }), new Date().toISOString(),
  ).execute();
}

function payloadObject(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
}

function requireRecoveryTestEnabled(): void {
  if (process.env.PCR_ENABLE_RECOVERY_TEST !== 'true') {
    throw new Error('The controlled recovery test is disabled in this environment.');
  }
}

async function updateStep(
  issueId: string,
  desired: Step,
  validPrior: Step[],
  expectedRevision: unknown,
  actorId: string,
  role: AppRole,
  evidence: { eventId: string; sourceType: string; sourceName: string; payload: Record<string, unknown> },
): Promise<CaseView> {
  const row = await readCase(issueId);
  if (!row) throw new Error('Initialize the synthetic case first.');
  requireExpectedRevision(row.revision, expectedRevision);
  const registered = await registerEvidenceEvent(
    issueId, evidence.eventId, evidence.sourceType, evidence.sourceName, desired, row.revision, actorId, evidence.payload,
  );
  if (row.step === desired) {
    await sql.prepare('UPDATE correction_source_events SET status = ?, resulting_revision = ? WHERE event_key = ? AND status = ?')
      .bindParams('applied', row.revision, registered.row.event_key, 'pending').execute();
    return view(row, role);
  }
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

  await persistProofRevision(issueId, proof);
  if (wasApproved && row.approved_revision !== null && row.approved_hash) {
    await appendApprovalHistory(issueId, row.approved_revision, row.approved_hash, 'invalidated', actorId, `${desired} evidence created revision ${nextRevision}`);
    await queueReopenEffect(issueId, nextRevision, proof.inputHash, row.approved_revision);
  }
  await appendAudit(issueId, nextRevision, 'evidence-revision-created', actorId, {
    priorStep: row.step,
    step: desired,
    priorRevision: row.revision,
    sourceEventId: evidence.eventId,
    duplicate: registered.registration === 'duplicate',
  }, `evidence:${registered.row.event_key}`);
  await sql.prepare('UPDATE correction_source_events SET status = ?, resulting_revision = ? WHERE event_key = ? AND status = ?')
    .bindParams('applied', nextRevision, registered.row.event_key, 'pending').execute();
  const updated = await readCase(issueId);
  if (!updated) throw new Error('Updated case could not be reloaded.');
  return view(updated, role);
}

export async function runPlatformSpikeWorker(event: AsyncEvent<PlatformSpikeEventBody>): Promise<void> {
  await runMigration();
  const body = event.body;
  if (!body || typeof body.stageRunId !== 'string' || typeof body.issueId !== 'string'
    || !Number.isInteger(body.revision) || (body.phase !== 'execute' && body.phase !== 'resume')) return;
  let row = await readStageRun(body.stageRunId);
  if (!row || row.issue_id !== body.issueId || row.revision !== body.revision || row.stage !== 'platform-spike') return;
  if (row.status === 'completed' || row.status === 'failed' || row.status === 'superseded') return;

  const currentCase = await readCase(row.issue_id);
  if (!currentCase || currentCase.revision !== row.revision) {
    await sql.prepare(`UPDATE correction_stage_runs SET status = ?, terminal_reason = ?, updated_at = ?
      WHERE stage_run_id = ? AND status NOT IN (?, ?, ?)`).bindParams(
      'superseded', 'stale-revision', new Date().toISOString(), row.stage_run_id, 'completed', 'failed', 'superseded',
    ).execute();
    return;
  }

  if (body.phase === 'resume') {
    if (row.status !== 'model-complete') return;
    const persisted = parsePlatformSpikeResult(row.result_json);
    if (!persisted) {
      await sql.prepare(`UPDATE correction_stage_runs SET status = ?, terminal_reason = ?, updated_at = ?
        WHERE stage_run_id = ? AND status = ?`).bindParams(
        'failed', 'invalid-persisted-result', new Date().toISOString(), row.stage_run_id, 'model-complete',
      ).execute();
      return;
    }
    const completedAt = new Date().toISOString();
    const completed = await sql.prepare<UpdateQueryResponse>(`UPDATE correction_stage_runs SET status = ?, terminal_reason = ?, updated_at = ?
      WHERE stage_run_id = ? AND status = ? AND revision = ?`).bindParams(
      'completed', 'completed', completedAt, row.stage_run_id, 'model-complete', row.revision,
    ).execute();
    if (completed.rows.affectedRows === 1) {
      await appendAudit(row.issue_id, row.revision, 'platform-spike-completed', 'system-worker', {
        stageRunId: row.stage_run_id,
        model: persisted.model,
        promptVersion: PLATFORM_SPIKE_PROMPT_VERSION,
        toolCalls: persisted.toolCalls,
        inputTokens: persisted.usage.inputTokens,
        outputTokens: persisted.usage.outputTokens,
        estimatedCostMicrousd: persisted.usage.estimatedCostMicrousd,
      }, `platform-spike:${row.stage_run_id}:completed`);
    }
    return;
  }

  if (row.status === 'model-complete') {
    await enqueuePlatformSpike(row, 'resume');
    return;
  }
  if (row.attempt >= 3) {
    await sql.prepare('UPDATE correction_stage_runs SET status = ?, terminal_reason = ?, updated_at = ? WHERE stage_run_id = ?')
      .bindParams('failed', 'attempt-budget-exhausted', new Date().toISOString(), row.stage_run_id).execute();
    return;
  }

  const attempt = row.attempt + 1;
  const startedAt = Date.now();
  const claimed = await sql.prepare<UpdateQueryResponse>(`UPDATE correction_stage_runs SET status = ?, attempt = ?, updated_at = ?
    WHERE stage_run_id = ? AND status IN (?, ?)`).bindParams(
    'running', attempt, new Date(startedAt).toISOString(), row.stage_run_id, 'queued', 'running',
  ).execute();
  if (claimed.rows.affectedRows !== 1) return;

  const model = process.env.PCR_OPENAI_MODEL || PLATFORM_SPIKE_MODEL;
  try {
    const result = await executePlatformSpike(process.env.OPENAI_API_KEY || '', row.stage_run_id, model);
    const telemetry = {
      promptVersion: PLATFORM_SPIKE_PROMPT_VERSION,
      model: result.model,
      usage: result.usage,
      durationMs: Date.now() - startedAt,
      toolCalls: result.toolCalls,
      graphSteps: result.graphSteps,
      sourceIds: result.sourceIds,
      responseStored: true,
    };
    await sql.prepare(`UPDATE correction_stage_runs SET status = ?, terminal_reason = NULL,
      telemetry_json = ?, result_json = ?, updated_at = ? WHERE stage_run_id = ? AND status = ? AND revision = ?`).bindParams(
      'model-complete', JSON.stringify(telemetry), JSON.stringify(result), new Date().toISOString(),
      row.stage_run_id, 'running', row.revision,
    ).execute();
    row = await readStageRun(row.stage_run_id);
    if (row?.status === 'model-complete') await enqueuePlatformSpike(row, 'resume');
  } catch (error: unknown) {
    const failure = classifyPlatformSpikeFailure(error);
    const retryable = failure === 'rate-limit' || failure === 'timeout' || failure === 'provider' || failure === 'unknown';
    const nextStatus: StageRunRow['status'] = retryable && attempt < 3 ? 'queued' : 'failed';
    const telemetry = {
      promptVersion: PLATFORM_SPIKE_PROMPT_VERSION,
      model,
      durationMs: Date.now() - startedAt,
      failure,
      retryable,
    };
    await sql.prepare(`UPDATE correction_stage_runs SET status = ?, terminal_reason = ?, telemetry_json = ?, updated_at = ?
      WHERE stage_run_id = ? AND status = ?`).bindParams(
      nextStatus, failure, JSON.stringify(telemetry), new Date().toISOString(), body.stageRunId, 'running',
    ).execute();
    if (nextStatus === 'queued') throw new Error(`Platform spike requested a safe retry after ${failure}.`);
  }
}

const resolver = new Resolver();

resolver.define('startPlatformSpike', async ({ context }) => {
  const actor = await authorize(context as ResolverContext, 'run-platform-spike');
  if (process.env.PCR_ENABLE_PLATFORM_SPIKE !== 'true') throw new Error('The platform spike is disabled in this environment.');
  if (!process.env.OPENAI_API_KEY) throw new Error('The encrypted OpenAI API key is not configured in Forge.');
  const row = await readCase(actor.issueId);
  if (!row) throw new Error('Initialize the synthetic case before starting the platform spike.');
  const model = process.env.PCR_OPENAI_MODEL || PLATFORM_SPIKE_MODEL;
  const stageRunId = contentHash({
    issueId: actor.issueId,
    revision: row.revision,
    stage: 'platform-spike',
    promptVersion: PLATFORM_SPIKE_PROMPT_VERSION,
    model,
  });
  const now = new Date().toISOString();
  const initialTelemetry = JSON.stringify({
    promptVersion: PLATFORM_SPIKE_PROMPT_VERSION,
    model,
    queuedBy: actor.accountId,
    queuedAt: now,
    limits: { calls: 1, toolCalls: 1, maxOutputTokens: 300, timeoutMs: 20_000 },
  });
  await sql.prepare(`INSERT IGNORE INTO correction_stage_runs
    (stage_run_id, issue_id, revision, stage, status, attempt, terminal_reason, telemetry_json, result_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?)`).bindParams(
    stageRunId, actor.issueId, row.revision, 'platform-spike', 'queued', 0, initialTelemetry, now,
  ).execute();
  let stageRun = await readStageRun(stageRunId);
  if (!stageRun) throw new Error('The platform spike could not be registered.');
  if (stageRun.status === 'failed') {
    await sql.prepare(`UPDATE correction_stage_runs SET status = ?, attempt = 0, terminal_reason = NULL,
      telemetry_json = ?, result_json = NULL, updated_at = ? WHERE stage_run_id = ? AND status = ?`).bindParams(
      'queued', initialTelemetry, now, stageRunId, 'failed',
    ).execute();
    stageRun = await readStageRun(stageRunId);
    if (!stageRun) throw new Error('The platform spike retry could not be registered.');
  }
  if (stageRun.status === 'queued') await enqueuePlatformSpike(stageRun, 'execute');
  else if (stageRun.status === 'model-complete') await enqueuePlatformSpike(stageRun, 'resume');
  return platformSpikeView(stageRun);
});

resolver.define('getCase', async ({ context }) => {
  const actor = await authorize(context as ResolverContext, 'read');
  const row = await readCase(actor.issueId);
  return {
    case: row ? view(row, actor.role) : null,
    actorRole: actor.role,
    followUps: await readFollowUps(actor.issueId),
    history: await readHistory(actor.issueId),
    platformSpike: platformSpikeView(await readLatestPlatformSpike(actor.issueId)),
    development: {
      recoveryTestEnabled: process.env.PCR_ENABLE_RECOVERY_TEST === 'true',
      platformSpikeEnabled: process.env.PCR_ENABLE_PLATFORM_SPIKE === 'true',
      openAiConfigured: Boolean(process.env.OPENAI_API_KEY),
    },
  };
});

resolver.define('injectPendingCorrection', async ({ payload, context }) => {
  const actor = await authorize(context as ResolverContext, 'test-recovery');
  requireRecoveryTestEnabled();
  const row = await readCase(actor.issueId);
  if (!row) throw new Error('Initialize the synthetic case first.');
  requireExpectedRevision(row.revision, payloadObject(payload).expectedRevision);
  if (row.step !== 'missing') throw new Error('Reset the synthetic case before running the interrupted-recovery test.');
  const eventId = `recovery-probe-correction-r${row.revision}`;
  const registered = await registerEvidenceEvent(
    actor.issueId,
    eventId,
    'development-recovery-probe',
    'Controlled interrupted correction',
    'corrected',
    row.revision,
    actor.accountId,
    { fixture: 'final-replacement', lineId: 'L12', signedAmountCents: 10_000, recoveryProbe: true },
  );
  return {
    eventId,
    status: registered.row.status,
    priorRevision: registered.row.prior_revision,
    caseRevision: row.revision,
  };
});

resolver.define('runRecoveryTest', async ({ context }) => {
  const actor = await authorize(context as ResolverContext, 'test-recovery');
  requireRecoveryTestEnabled();
  await runRecovery();
  const row = await readCase(actor.issueId);
  if (!row) throw new Error('The recovery test case could not be reloaded.');
  return view(row, actor.role);
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
  await persistProofRevision(actor.issueId, proof);
  const baseline = await registerEvidenceEvent(
    actor.issueId,
    'synthetic-baseline-v1',
    'synthetic-case',
    'Submitted claims, payer notice, and initial payment activity',
    'missing',
    0,
    actor.accountId,
    { fixture: 'baseInput', inventoryLines: 13, replacementAdjustments: 11 },
  );
  await sql.prepare('UPDATE correction_source_events SET status = ?, resulting_revision = ? WHERE event_key = ?')
    .bindParams('applied', 1, baseline.row.event_key).execute();
  await appendAudit(actor.issueId, 1, 'case-initialized', actor.accountId, { synthetic: true });
  const row = await readCase(actor.issueId);
  if (!row) throw new Error('Initialized case could not be reloaded.');
  return view(row, actor.role);
});

resolver.define('addCorrection', async ({ payload, context }) => {
  const actor = await authorize(context as ResolverContext, 'record-evidence');
  return updateStep(actor.issueId, 'corrected', ['missing'], payloadObject(payload).expectedRevision, actor.accountId, actor.role, {
    eventId: 'synthetic-final-correction-v1',
    sourceType: 'payment-activity',
    sourceName: 'Final replacement payment activity',
    payload: { fixture: 'final-replacement', lineId: 'L12', signedAmountCents: 10_000 },
  });
});

resolver.define('addReversal', async ({ payload, context }) => {
  const actor = await authorize(context as ResolverContext, 'record-evidence');
  return updateStep(actor.issueId, 'reversed', ['corrected'], payloadObject(payload).expectedRevision, actor.accountId, actor.role, {
    eventId: 'synthetic-late-reversal-v1',
    sourceType: 'payment-activity',
    sourceName: 'Late reversal payment activity',
    payload: { fixture: 'late-reversal', lineId: 'L07', signedAmountCents: -10_000, reverses: 'replacement-L07' },
  });
});

resolver.define('challenge', async ({ payload, context }) => {
  const actor = await authorize(context as ResolverContext, 'challenge');
  return updateStep(actor.issueId, 'challenged', ['missing', 'corrected', 'reversed'], payloadObject(payload).expectedRevision, actor.accountId, actor.role, {
    eventId: 'synthetic-payer-clarification-v1',
    sourceType: 'payer-notice',
    sourceName: 'Payer clarification notice',
    payload: { fixture: 'conflicting-scope', effectiveFrom: '2026-09-30', effectiveThrough: '2026-10-31' },
  });
});

resolver.define('recordFollowUp', async ({ payload, context }) => {
  const actor = await authorize(context as ResolverContext, 'record-follow-up');
  const row = await readCase(actor.issueId);
  if (!row) throw new Error('Initialize the synthetic case first.');
  const proof = view(row, actor.role).proof;
  const raw = payloadObject(payload);
  const input = validateFollowUp({
    expectedRevision: raw.expectedRevision,
    outcome: raw.outcome,
    nextReviewDate: raw.nextReviewDate,
    note: raw.note,
    lineIds: raw.lineIds,
  }, proof);
  const followUpId = randomUUID();
  const occurredAt = new Date().toISOString();
  await sql.prepare(`INSERT INTO correction_payer_followups
    (followup_id, issue_id, revision, outcome, next_review_date, note, line_ids_json, actor_id, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bindParams(
    followUpId, actor.issueId, input.expectedRevision, input.outcome, input.nextReviewDate, input.note,
    JSON.stringify(input.lineIds), actor.accountId, occurredAt,
  ).execute();
  await appendAudit(actor.issueId, input.expectedRevision, 'payer-follow-up-recorded', actor.accountId, {
    followUpId,
    outcome: input.outcome,
    nextReviewDate: input.nextReviewDate,
    lineIds: input.lineIds,
    financialResultChanged: false,
  });
  return {
    followUpId,
    revision: input.expectedRevision,
    outcome: input.outcome,
    nextReviewDate: input.nextReviewDate,
    note: input.note,
    lineIds: input.lineIds,
    actorId: actor.accountId,
    occurredAt,
  } satisfies FollowUpView;
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
  await sql.prepare(`INSERT IGNORE INTO correction_jira_effects
    (effect_id, issue_id, revision, effect_type, status, attempt, details_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bindParams(
    `${actor.issueId}:${row.revision}:approved`, actor.issueId, row.revision, 'project-approved-closure',
    'pending', 0, JSON.stringify({ proofHash: proof.inputHash }), new Date().toISOString(),
  ).execute();
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
  await persistProofRevision(actor.issueId, proof);
  if (wasApproved && row.approved_revision !== null && row.approved_hash) {
    await appendApprovalHistory(actor.issueId, row.approved_revision, row.approved_hash, 'invalidated', actor.accountId, `Authorized reset created revision ${nextRevision}`);
    await queueReopenEffect(actor.issueId, nextRevision, proof.inputHash, row.approved_revision);
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
