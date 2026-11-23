import type { CounterexampleProposal, ProofInput } from '../domain/types.js';

const inventory = Array.from({ length: 13 }, (_, index) => ({
  lineId: `L${String(index + 1).padStart(2, '0')}`,
  serviceDate: index === 12 ? '2026-09-30' : '2026-10-15',
  expectedNetCents: 10_000,
  inventorySourceId: 'submitted-claims-v1',
}));

const originalEvents = inventory.slice(0, 12).map((line) => ({
  eventId: `original-${line.lineId}`,
  lineId: line.lineId,
  kind: 'original' as const,
  signedAmountCents: 0,
  reversesEventId: null,
  sourceId: 'original-era-v1',
}));

const replacements = inventory.slice(0, 12).map((line) => ({
  eventId: `replacement-${line.lineId}`,
  lineId: line.lineId,
  kind: 'replacement' as const,
  signedAmountCents: 10_000,
  reversesEventId: null,
  sourceId: 'replacement-era-v1',
}));

export const baseInput: ProofInput = {
  caseId: 'DEMO-1',
  revision: 1,
  cutoff: '2026-11-22T12:00:00.000Z',
  inventoryCoverage: 'complete',
  inventorySourceId: 'submitted-claims-v1',
  inventory,
  rule: {
    ruleId: 'approved-rule-v1',
    payerId: 'payer-demo',
    effectiveFrom: '2026-10-01',
    effectiveThrough: '2026-10-31',
    confirmedBy: 'supervisor-demo',
    noticeSourceId: 'payer-notice-v1',
  },
  notices: [{
    sourceId: 'payer-notice-v1',
    payerId: 'payer-demo',
    effectiveFrom: '2026-10-01',
    effectiveThrough: '2026-10-31',
    version: '1',
    supersedesSourceId: null,
  }],
  events: [...originalEvents, ...replacements.slice(0, 11)],
};

export function withFinalReplacement(input: ProofInput = baseInput): ProofInput {
  return { ...input, revision: input.revision + 1, events: [...input.events, replacements[11]!] };
}

export function withLateReversal(input: ProofInput): ProofInput {
  return {
    ...input,
    revision: input.revision + 1,
    events: [...input.events, {
      eventId: 'reversal-L07',
      lineId: 'L07',
      kind: 'reversal',
      signedAmountCents: -10_000,
      reversesEventId: 'replacement-L07',
      sourceId: 'late-reversal-era-v1',
    }],
  };
}

export const conflictingScopeInput: ProofInput = {
  ...withFinalReplacement(baseInput),
  caseId: 'DEMO-2',
  notices: [...baseInput.notices, {
    sourceId: 'payer-clarification-v1',
    payerId: 'payer-demo',
    effectiveFrom: '2026-09-30',
    effectiveThrough: '2026-10-31',
    version: '1',
    supersedesSourceId: null,
  }],
};

export const scopeCounterexample: CounterexampleProposal = {
  proposalId: 'challenge-excluded-L13',
  type: 'excluded-eligible-line',
  lineId: 'L13',
  sourceId: 'payer-clarification-v1',
  allegedBrokenObligation: 'cohort-completeness',
};
