import { describe, expect, it } from 'vitest';
import { approvedProjection, isMatchingProjection, nextProjectionStatus } from '../src/domain/projection';

describe('Jira projection policy', () => {
  it('matches only the exact approved revision and proof hash', () => {
    const expected = approvedProjection(2, 'proof-abc');
    expect(isMatchingProjection({ ...expected }, expected)).toBe(true);
    expect(isMatchingProjection({ ...expected, revision: 3 }, expected)).toBe(false);
    expect(isMatchingProjection({ ...expected, proofHash: 'other' }, expected)).toBe(false);
    expect(isMatchingProjection(null, expected)).toBe(false);
  });

  it('retries transient failures with a finite limit', () => {
    expect(nextProjectionStatus(1, 'transient')).toBe('pending');
    expect(nextProjectionStatus(2, 'transient')).toBe('pending');
    expect(nextProjectionStatus(3, 'transient')).toBe('failed');
    expect(nextProjectionStatus(1, 'permanent')).toBe('failed');
  });
});
