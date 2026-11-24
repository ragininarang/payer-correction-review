import { describe, expect, it } from 'vitest';
import { classifyEvidence, contentHash, planEvidenceRecovery, validateFollowUp } from '../src/domain/ledger';
import { buildProof } from '../src/domain/proof';
import { baseInput } from '../src/fixtures/demo';

describe('durable ledger contracts', () => {
  it('hashes equivalent evidence deterministically and distinguishes conflicts', () => {
    const first = contentHash({ source: 'replacement', rows: [{ amount: 100, line: 'L12' }] });
    const reordered = contentHash({ rows: [{ line: 'L12', amount: 100 }], source: 'replacement' });
    const conflict = contentHash({ source: 'replacement', rows: [{ amount: 99, line: 'L12' }] });
    expect(first).toBe(reordered);
    expect(classifyEvidence(null, first)).toBe('new');
    expect(classifyEvidence(first, reordered)).toBe('duplicate');
    expect(classifyEvidence(first, conflict)).toBe('conflict');
  });

  it('accepts current in-scope service lines and removes duplicate selections', () => {
    const proof = buildProof(baseInput, [], true);
    expect(validateFollowUp({
      expectedRevision: proof.revision,
      outcome: 'payer-researching',
      nextReviewDate: '2026-11-30',
      note: '  Payer reference 42  ',
      lineIds: ['L12', 'L12'],
    }, proof)).toEqual({
      expectedRevision: 1,
      outcome: 'payer-researching',
      nextReviewDate: '2026-11-30',
      note: 'Payer reference 42',
      lineIds: ['L12'],
    });
  });

  it('rejects stale, empty and out-of-scope follow-up records', () => {
    const proof = buildProof(baseInput, [], true);
    expect(() => validateFollowUp({ expectedRevision: 0, outcome: 'no-response', nextReviewDate: '2026-11-30', note: '', lineIds: ['L12'] }, proof)).toThrow(/changed/);
    expect(() => validateFollowUp({ expectedRevision: 1, outcome: 'no-response', nextReviewDate: '2026-11-30', note: '', lineIds: [] }, proof)).toThrow(/Select/);
    expect(() => validateFollowUp({ expectedRevision: 1, outcome: 'no-response', nextReviewDate: '2026-11-30', note: '', lineIds: ['L13'] }, proof)).toThrow(/not part/);
  });

  it('recovers a crash after registration but before the case transition', () => {
    expect(planEvidenceRecovery(1, 'missing', 1, 'corrected')).toEqual({
      action: 'advance-case',
      resultingRevision: 2,
    });
  });

  it('finishes a crash after the case transition without advancing twice', () => {
    expect(planEvidenceRecovery(2, 'corrected', 1, 'corrected')).toEqual({
      action: 'complete-registration',
      resultingRevision: 2,
    });
    expect(planEvidenceRecovery(1, 'missing', 1, 'missing')).toEqual({
      action: 'complete-registration',
      resultingRevision: 1,
    });
  });

  it('quarantines a pending event that can no longer apply to the case revision', () => {
    expect(planEvidenceRecovery(3, 'reversed', 1, 'corrected')).toEqual({
      action: 'quarantine-stale',
      resultingRevision: null,
    });
    expect(planEvidenceRecovery(1, 'missing', 1, 'reversed')).toEqual({
      action: 'quarantine-stale',
      resultingRevision: null,
    });
  });
});
