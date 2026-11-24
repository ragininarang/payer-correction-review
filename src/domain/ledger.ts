import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { CorrectionProof } from './types';

export type EvidenceRegistration = 'new' | 'duplicate' | 'conflict';
export type EvidenceStep = 'missing' | 'corrected' | 'reversed' | 'challenged';
export type EvidenceRecoveryAction = 'advance-case' | 'complete-registration' | 'quarantine-stale';

export interface EvidenceRecoveryPlan {
  action: EvidenceRecoveryAction;
  resultingRevision: number | null;
}

const validPriorSteps: Record<EvidenceStep, readonly EvidenceStep[]> = {
  missing: [],
  corrected: ['missing'],
  reversed: ['corrected'],
  challenged: ['missing', 'corrected', 'reversed'],
};

export const followUpOutcomes = [
  'payer-researching',
  'additional-information-requested',
  'correction-promised',
  'payer-disputes-correction',
  'no-response',
  'closed-without-pursuit',
] as const;

export type FollowUpOutcome = typeof followUpOutcomes[number];

export interface FollowUpInput {
  expectedRevision: unknown;
  outcome: unknown;
  nextReviewDate: unknown;
  note: unknown;
  lineIds: unknown;
}

export interface ValidatedFollowUp {
  expectedRevision: number;
  outcome: FollowUpOutcome;
  nextReviewDate: string;
  note: string;
  lineIds: string[];
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}

export function contentHash(value: unknown): string {
  const encoded = new TextEncoder().encode(JSON.stringify(canonicalize(value)));
  return bytesToHex(sha256(encoded));
}

export function classifyEvidence(existingHash: string | null, incomingHash: string): EvidenceRegistration {
  if (existingHash === null) return 'new';
  return existingHash === incomingHash ? 'duplicate' : 'conflict';
}

/**
 * Reconciles a pending source-event row with the authoritative case row.
 * This is deliberately pure so the same crash-recovery rules are testable
 * without Forge SQL and cannot drift between request and scheduled workers.
 */
export function planEvidenceRecovery(
  caseRevision: number,
  caseStep: EvidenceStep,
  eventPriorRevision: number,
  desiredStep: EvidenceStep,
): EvidenceRecoveryPlan {
  if (caseRevision === eventPriorRevision && caseStep === desiredStep) {
    return { action: 'complete-registration', resultingRevision: caseRevision };
  }
  if (caseRevision === eventPriorRevision && validPriorSteps[desiredStep].includes(caseStep)) {
    return { action: 'advance-case', resultingRevision: caseRevision + 1 };
  }
  if (caseRevision === eventPriorRevision + 1 && caseStep === desiredStep) {
    return { action: 'complete-registration', resultingRevision: caseRevision };
  }
  return { action: 'quarantine-stale', resultingRevision: null };
}

export function validateFollowUp(input: FollowUpInput, proof: CorrectionProof): ValidatedFollowUp {
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision !== proof.revision) {
    throw new Error('This correction review changed after it was displayed. Refresh before saving payer follow-up.');
  }
  if (typeof input.outcome !== 'string' || !followUpOutcomes.includes(input.outcome as FollowUpOutcome)) {
    throw new Error('Choose a valid payer follow-up outcome.');
  }
  if (typeof input.nextReviewDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.nextReviewDate)
    || Number.isNaN(Date.parse(`${input.nextReviewDate}T00:00:00.000Z`))) {
    throw new Error('Choose a valid next review date.');
  }
  if (typeof input.note !== 'string' || input.note.length > 2_000) {
    throw new Error('The internal note must be 2,000 characters or fewer.');
  }
  if (!Array.isArray(input.lineIds) || input.lineIds.length < 1 || input.lineIds.length > 300
    || input.lineIds.some((lineId) => typeof lineId !== 'string')) {
    throw new Error('Select between 1 and 300 service lines for payer follow-up.');
  }
  const allowed = new Set(proof.obligations.map((item) => item.lineId));
  const lineIds = [...new Set(input.lineIds as string[])].sort();
  if (lineIds.some((lineId) => !allowed.has(lineId))) {
    throw new Error('One or more selected service lines are not part of the current evidence version.');
  }
  return {
    expectedRevision: proof.revision,
    outcome: input.outcome as FollowUpOutcome,
    nextReviewDate: input.nextReviewDate,
    note: input.note.trim(),
    lineIds,
  };
}

