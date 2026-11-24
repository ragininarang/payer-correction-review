import { describe, expect, it } from 'vitest';
import { buildProof } from '../src/domain/proof';
import { baseInput, conflictingScopeInput, scopeCounterexample, withFinalReplacement, withLateReversal } from '../src/fixtures/demo';

describe('revisioned proof of correction', () => {
  it('uses independent inventory and identifies the missing correction', () => {
    const proof = buildProof(baseInput, [], true);
    expect(proof.expectedLineCount).toBe(12);
    expect(proof.excludedLineIds).toEqual(['L13']);
    expect(proof.correctedLineCount).toBe(11);
    expect(proof.unresolvedCents).toBe(10_000);
    expect(proof.status).toBe('incomplete');
    const missing = proof.obligations.find((item) => item.lineId === 'L12');
    expect(missing?.status).toBe('missing');
    expect(missing).toMatchObject({
      claimId: 'CLM-104726',
      serviceLineNumber: 2,
      procedureCode: '80053',
      serviceDate: '2026-10-15',
    });
  });

  it('can become eligible only after the final replacement and completed challenge search', () => {
    const revision = withFinalReplacement();
    expect(buildProof(revision, [], false).status).toBe('incomplete');
    const proof = buildProof(revision, [], true);
    expect(proof.status).toBe('eligible');
    expect(proof.correctedLineCount).toBe(12);
    expect(proof.unresolvedCents).toBe(0);
  });

  it('invalidates a prior line result after a late linked reversal', () => {
    const prior = buildProof(withFinalReplacement(), [], true);
    const next = buildProof(withLateReversal(withFinalReplacement()), [], true);
    expect(prior.status).toBe('eligible');
    expect(next.status).toBe('incomplete');
    expect(next.obligations.find((item) => item.lineId === 'L07')?.status).toBe('amount-mismatch');
    expect(next.unresolvedCents).toBe(10_000);
    expect(next.inputHash).not.toBe(prior.inputHash);
  });

  it('treats repeated identical events as one and conflicting IDs as unsafe', () => {
    const complete = withFinalReplacement();
    const duplicate = { ...complete, events: [...complete.events, complete.events[0]!] };
    expect(buildProof(duplicate, [], true).status).toBe('eligible');
    const conflict = { ...complete, events: [...complete.events, { ...complete.events[0]!, signedAmountCents: 1 }] };
    expect(buildProof(conflict, [], true).status).toBe('incomplete');
    expect(buildProof(conflict, [], true).blockers.some((item) => item.includes('Conflicting event identity'))).toBe(true);
  });

  it('blocks a complete-looking case when the Challenger finds an excluded eligible line', () => {
    const proof = buildProof(conflictingScopeInput, [scopeCounterexample], true);
    expect(proof.correctedLineCount).toBe(12);
    expect(proof.status).toBe('challenged');
    expect(proof.findings[0]?.outcome).toBe('unresolved');
  });

  it('rejects a fabricated counterexample and incomplete inventory coverage', () => {
    const complete = withFinalReplacement();
    const fabricated = { ...scopeCounterexample, sourceId: 'does-not-exist' };
    expect(buildProof(complete, [fabricated], true).findings[0]?.outcome).toBe('refuted');
    expect(buildProof({ ...complete, inventoryCoverage: 'unconfirmed' }, [], true).status).toBe('incomplete');
  });

  it('does not assume an unlinked reversal is financially valid', () => {
    const reversed = withLateReversal(withFinalReplacement());
    const broken = { ...reversed, events: reversed.events.map((event) => event.eventId === 'reversal-L07' ? { ...event, reversesEventId: 'unknown' } : event) };
    const proof = buildProof(broken, [], true);
    expect(proof.obligations.find((item) => item.lineId === 'L07')?.status).toBe('ambiguous');
    expect(proof.status).toBe('incomplete');
  });
});
