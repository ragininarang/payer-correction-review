import type { CorrectionProof } from './types';

export type AppRole = 'viewer' | 'analyst' | 'supervisor' | 'operator';
export type WorkflowCommand =
  | 'read'
  | 'initialize'
  | 'record-evidence'
  | 'record-follow-up'
  | 'challenge'
  | 'approve'
  | 'reset'
  | 'manage-roles'
  | 'test-recovery';

export type ApprovalStatus = 'unapproved' | 'approved' | 'invalidated';
export type ProjectionStatus = 'not-requested' | 'pending' | 'synced' | 'failed' | 'conflicted';

const grants: Record<AppRole, readonly WorkflowCommand[]> = {
  viewer: ['read'],
  analyst: ['read', 'initialize', 'record-evidence', 'record-follow-up', 'challenge'],
  supervisor: ['read', 'initialize', 'record-evidence', 'record-follow-up', 'challenge', 'approve', 'reset', 'test-recovery'],
  operator: ['read', 'initialize', 'record-evidence', 'challenge', 'reset', 'manage-roles', 'test-recovery'],
};

export function can(role: AppRole, command: WorkflowCommand): boolean {
  return grants[role].includes(command);
}

export function requireCommand(role: AppRole, command: WorkflowCommand): void {
  if (!can(role, command)) throw new Error(`The ${role} role cannot perform ${command}.`);
}

export function requireExpectedRevision(actualRevision: number, expectedRevision: unknown): void {
  if (!Number.isInteger(expectedRevision) || expectedRevision !== actualRevision) {
    throw new Error('This case changed after it was displayed. Refresh before continuing.');
  }
}

export function requireExactApproval(
  proof: CorrectionProof,
  expectedRevision: unknown,
  expectedProofHash: unknown,
): void {
  requireExpectedRevision(proof.revision, expectedRevision);
  if (typeof expectedProofHash !== 'string' || expectedProofHash !== proof.inputHash) {
    throw new Error('The displayed proof fingerprint is stale. Refresh before approving.');
  }
  if (proof.status !== 'eligible') throw new Error('This proof is not eligible for approval.');
}

export function invalidatedStates(wasApproved: boolean): {
  approvalStatus: ApprovalStatus;
  projectionStatus: ProjectionStatus;
} {
  return wasApproved
    ? { approvalStatus: 'invalidated', projectionStatus: 'pending' }
    : { approvalStatus: 'unapproved', projectionStatus: 'not-requested' };
}
