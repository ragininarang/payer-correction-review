import { describe, expect, it } from 'vitest';
import { buildProof } from '../src/domain/proof';
import { can, invalidatedStates, requireExactApproval, requireExpectedRevision } from '../src/domain/workflow';
import { baseInput, withFinalReplacement } from '../src/fixtures/demo';

describe('workflow safety policy', () => {
  it('keeps financial approval exclusive to supervisors', () => {
    expect(can('viewer', 'approve')).toBe(false);
    expect(can('analyst', 'approve')).toBe(false);
    expect(can('operator', 'approve')).toBe(false);
    expect(can('supervisor', 'approve')).toBe(true);
  });

  it('restricts reset and role management', () => {
    expect(can('analyst', 'reset')).toBe(false);
    expect(can('supervisor', 'reset')).toBe(true);
    expect(can('operator', 'reset')).toBe(true);
    expect(can('supervisor', 'manage-roles')).toBe(false);
    expect(can('operator', 'manage-roles')).toBe(true);
    expect(can('viewer', 'test-recovery')).toBe(false);
    expect(can('analyst', 'test-recovery')).toBe(false);
    expect(can('supervisor', 'test-recovery')).toBe(true);
    expect(can('operator', 'test-recovery')).toBe(true);
  });

  it('allows payer follow-up only for workflow participants', () => {
    expect(can('viewer', 'record-follow-up')).toBe(false);
    expect(can('operator', 'record-follow-up')).toBe(false);
    expect(can('analyst', 'record-follow-up')).toBe(true);
    expect(can('supervisor', 'record-follow-up')).toBe(true);
  });

  it('rejects a stale displayed revision', () => {
    expect(() => requireExpectedRevision(2, 1)).toThrow(/changed after it was displayed/i);
    expect(() => requireExpectedRevision(2, 2)).not.toThrow();
  });

  it('binds approval to both the exact revision and proof hash', () => {
    const proof = buildProof(withFinalReplacement(), [], true);
    expect(() => requireExactApproval(proof, proof.revision, proof.inputHash)).not.toThrow();
    expect(() => requireExactApproval(proof, proof.revision + 1, proof.inputHash)).toThrow(/changed/i);
    expect(() => requireExactApproval(proof, proof.revision, `${proof.inputHash}-changed`)).toThrow(/fingerprint/i);
  });

  it('rejects approval for an incomplete proof', () => {
    const proof = buildProof(baseInput, [], true);
    expect(() => requireExactApproval(proof, proof.revision, proof.inputHash)).toThrow(/not eligible/i);
  });

  it('separates approval invalidation from Jira projection work', () => {
    expect(invalidatedStates(true)).toEqual({ approvalStatus: 'invalidated', projectionStatus: 'pending' });
    expect(invalidatedStates(false)).toEqual({ approvalStatus: 'unapproved', projectionStatus: 'not-requested' });
  });
});
