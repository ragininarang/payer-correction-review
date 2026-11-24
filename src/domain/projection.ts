export interface ApprovedProjection {
  schemaVersion: 1;
  revision: number;
  proofHash: string;
  approvalStatus: 'approved' | 'invalidated';
}

export type ProjectionFailureKind = 'transient' | 'permanent';

export function approvedProjection(revision: number, proofHash: string): ApprovedProjection {
  if (!Number.isInteger(revision) || revision < 1 || !proofHash) throw new Error('A valid approved revision and proof hash are required.');
  return { schemaVersion: 1, revision, proofHash, approvalStatus: 'approved' };
}

export function invalidatedProjection(revision: number, proofHash: string): ApprovedProjection {
  if (!Number.isInteger(revision) || revision < 1 || !proofHash) throw new Error('A valid reopened revision and proof hash are required.');
  return { schemaVersion: 1, revision, proofHash, approvalStatus: 'invalidated' };
}

export function isMatchingProjection(value: unknown, expected: ApprovedProjection): boolean {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<ApprovedProjection>;
  return item.schemaVersion === expected.schemaVersion
    && item.revision === expected.revision
    && item.proofHash === expected.proofHash
    && item.approvalStatus === expected.approvalStatus;
}

export function nextProjectionStatus(attempt: number, failure: ProjectionFailureKind): 'pending' | 'failed' {
  if (!Number.isInteger(attempt) || attempt < 0) throw new Error('Projection attempt must be a non-negative integer.');
  return failure === 'transient' && attempt < 3 ? 'pending' : 'failed';
}
