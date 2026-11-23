import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type {
  AdjustmentEvent,
  ChallengeFinding,
  CorrectionProof,
  CounterexampleProposal,
  InventoryLine,
  Notice,
  ProofInput,
} from './types';

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value: string): boolean {
  if (!isoDate.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function inRange(date: string, from: string, through: string): boolean {
  return date >= from && date <= through;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function hashInputs(input: ProofInput): string {
  const canonical = {
    ...input,
    inventory: [...input.inventory].sort((a, b) => a.lineId.localeCompare(b.lineId)),
    notices: [...input.notices].sort((a, b) => a.sourceId.localeCompare(b.sourceId)),
    events: [...input.events].sort((a, b) => a.eventId.localeCompare(b.eventId)),
  };
  return bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(canonical))));
}

function verifyChallenge(
  input: ProofInput,
  proposal: CounterexampleProposal,
  excluded: Set<string>,
  inventoryById: Map<string, InventoryLine>,
  noticeById: Map<string, Notice>,
  eventById: Map<string, AdjustmentEvent>,
): ChallengeFinding {
  const base = { ...proposal };
  if (proposal.type === 'ambiguous-adjustment') {
    const event = eventById.get(proposal.sourceId);
    if (!event) return { ...base, outcome: 'refuted', reason: 'Event ID does not exist in frozen input.' };
    if (event.kind === 'reversal' && event.reversesEventId) {
      const target = eventById.get(event.reversesEventId);
      if (!target || target.lineId !== event.lineId || target.kind !== 'replacement') {
        return { ...base, outcome: 'reproduced', reason: 'Reversal has no supported same-line replacement target.' };
      }
    }
    return { ...base, outcome: 'refuted', reason: 'Frozen event chain does not support this ambiguity.' };
  }

  const notice = noticeById.get(proposal.sourceId);
  if (!notice || notice.payerId !== input.rule.payerId) {
    return { ...base, outcome: 'refuted', reason: 'Cited notice is absent or belongs to another payer.' };
  }
  if (proposal.type === 'conflicting-notice') {
    if (notice.effectiveFrom === input.rule.effectiveFrom && notice.effectiveThrough === input.rule.effectiveThrough) {
      return { ...base, outcome: 'refuted', reason: 'Cited effective dates match the approved rule.' };
    }
    return notice.supersedesSourceId === input.rule.noticeSourceId
      ? { ...base, outcome: 'reproduced', reason: 'Cited notice explicitly supersedes the approved notice and has different dates.' }
      : { ...base, outcome: 'unresolved', reason: 'Cited notice has different dates; authority relative to the approved rule needs review.' };
  }

  const line = proposal.lineId ? inventoryById.get(proposal.lineId) : undefined;
  if (!line || !excluded.has(line.lineId)) {
    return { ...base, outcome: 'refuted', reason: 'Line is absent from inventory or already included.' };
  }
  if (!inRange(line.serviceDate, notice.effectiveFrom, notice.effectiveThrough)) {
    return { ...base, outcome: 'refuted', reason: 'Cited notice does not include the excluded line.' };
  }
  return notice.supersedesSourceId === input.rule.noticeSourceId
    ? { ...base, outcome: 'reproduced', reason: 'Excluded inventory line falls within an explicitly superseding notice.' }
    : { ...base, outcome: 'unresolved', reason: 'Excluded line falls within a conflicting notice; source authority needs review.' };
}

/** Financial computation and challenge verification are deterministic; proposals are untrusted. */
export function buildProof(
  input: ProofInput,
  proposals: CounterexampleProposal[] = [],
  challengeCompleted = false,
): CorrectionProof {
  const blockers: string[] = [];
  if (!input.caseId || !Number.isInteger(input.revision) || input.revision < 1) blockers.push('Invalid case identity or revision.');
  if (!input.cutoff || Number.isNaN(Date.parse(input.cutoff))) blockers.push('Invalid evidence cutoff.');
  if (!validDate(input.rule.effectiveFrom) || !validDate(input.rule.effectiveThrough) || input.rule.effectiveFrom > input.rule.effectiveThrough) {
    blockers.push('Invalid scope dates.');
  }
  if (!input.rule.confirmedBy) blockers.push('Population and expected-payment rule not confirmed.');
  if (input.inventoryCoverage !== 'complete') blockers.push('Independent inventory coverage is unconfirmed.');
  if (!challengeCompleted) blockers.push('Counterexample search has not completed.');

  const noticeById = new Map(input.notices.map((notice) => [notice.sourceId, notice]));
  const selectedNotice = noticeById.get(input.rule.noticeSourceId);
  if (!selectedNotice || selectedNotice.payerId !== input.rule.payerId) {
    blockers.push('Approved notice is absent or belongs to another payer.');
  } else if (selectedNotice.effectiveFrom !== input.rule.effectiveFrom || selectedNotice.effectiveThrough !== input.rule.effectiveThrough) {
    blockers.push('Approved rule does not match its cited notice dates.');
  }
  for (const notice of input.notices) {
    if (notice.payerId === input.rule.payerId && notice.supersedesSourceId === input.rule.noticeSourceId) {
      blockers.push(`Notice ${notice.sourceId} supersedes the approved rule source.`);
    }
  }

  const inventoryById = new Map<string, InventoryLine>();
  for (const line of input.inventory) {
    if (inventoryById.has(line.lineId)) blockers.push(`Duplicate inventory identity: ${line.lineId}.`);
    if (!validDate(line.serviceDate)) blockers.push(`Invalid service date: ${line.lineId}.`);
    if (!Number.isSafeInteger(line.expectedNetCents) || line.expectedNetCents < 0) blockers.push(`Invalid expected cents: ${line.lineId}.`);
    if (line.inventorySourceId !== input.inventorySourceId) blockers.push(`Inventory source mismatch: ${line.lineId}.`);
    inventoryById.set(line.lineId, line);
  }
  const expected = [...inventoryById.values()].filter((line) => inRange(line.serviceDate, input.rule.effectiveFrom, input.rule.effectiveThrough));
  const expectedIds = new Set(expected.map((line) => line.lineId));
  const excludedLineIds = uniqueSorted([...inventoryById.keys()].filter((id) => !expectedIds.has(id)));

  const eventById = new Map<string, AdjustmentEvent>();
  const conflictedEventIds = new Set<string>();
  for (const event of input.events) {
    if (!Number.isSafeInteger(event.signedAmountCents)) blockers.push(`Invalid signed cents: ${event.eventId}.`);
    const prior = eventById.get(event.eventId);
    if (prior && JSON.stringify(prior) !== JSON.stringify(event)) {
      conflictedEventIds.add(event.eventId);
      blockers.push(`Conflicting event identity: ${event.eventId}.`);
    } else if (!prior) eventById.set(event.eventId, event);
  }

  const eventsByLine = new Map<string, AdjustmentEvent[]>();
  for (const event of eventById.values()) {
    if (!inventoryById.has(event.lineId)) {
      blockers.push(`Unmatched event line: ${event.eventId}.`);
      continue;
    }
    const bucket = eventsByLine.get(event.lineId) ?? [];
    bucket.push(event);
    eventsByLine.set(event.lineId, bucket);
  }

  const obligations = expected.sort((a, b) => a.lineId.localeCompare(b.lineId)).map((line) => {
    const events = eventsByLine.get(line.lineId) ?? [];
    let ambiguous = events.some((event) => conflictedEventIds.has(event.eventId));
    for (const event of events) {
      if (event.kind !== 'reversal') continue;
      const target = event.reversesEventId ? eventById.get(event.reversesEventId) : undefined;
      if (!target || target.kind !== 'replacement' || target.lineId !== line.lineId || event.signedAmountCents !== -target.signedAmountCents) ambiguous = true;
    }
    const observed = events.reduce((sum, event) => sum + event.signedAmountCents, 0);
    if (!Number.isSafeInteger(observed)) ambiguous = true;
    const status = ambiguous ? 'ambiguous' : events.some((event) => event.kind === 'replacement')
      ? observed === line.expectedNetCents ? 'corrected' : 'amount-mismatch'
      : 'missing';
    const reason = status === 'corrected' ? 'Supported adjustment chain matches approved expectation.'
      : status === 'missing' ? 'No replacement adjustment observed through cutoff.'
      : status === 'ambiguous' ? 'Adjustment identity or reversal chain is unsupported.'
      : 'Observed adjudicated net differs from approved expectation.';
    return {
      lineId: line.lineId,
      status,
      expectedNetCents: line.expectedNetCents,
      observedNetCents: ambiguous ? null : observed,
      eventIds: uniqueSorted(events.map((event) => event.eventId)),
      sourceIds: uniqueSorted([line.inventorySourceId, ...events.map((event) => event.sourceId)]),
      reason,
    } as const;
  });

  const findings = proposals.map((proposal) => verifyChallenge(input, proposal, new Set(excludedLineIds), inventoryById, noticeById, eventById));
  for (const finding of findings) {
    if (finding.outcome !== 'refuted') blockers.push(`Counterexample ${finding.proposalId}: ${finding.reason}`);
  }
  if (expected.length === 0) blockers.push('Zero-line cohort requires explicit review.');
  const correctedLineCount = obligations.filter((item) => item.status === 'corrected').length;
  const unresolvedCents = obligations.reduce((sum, item) => sum + Math.max(0, item.expectedNetCents - (item.observedNetCents ?? 0)), 0);
  const status: CorrectionProof['status'] = findings.some((item) => item.outcome !== 'refuted') ? 'challenged'
    : blockers.length || correctedLineCount !== expected.length ? 'incomplete' : 'eligible';
  return {
    caseId: input.caseId,
    revision: input.revision,
    inputHash: hashInputs(input),
    cutoff: input.cutoff,
    status,
    expectedLineCount: expected.length,
    correctedLineCount,
    unresolvedCents,
    obligations,
    excludedLineIds,
    findings,
    blockers: uniqueSorted(blockers),
  };
}
