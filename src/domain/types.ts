export type IsoDate = string;
export type Cents = number;

export interface InventoryLine {
  lineId: string;
  claimId: string;
  serviceLineNumber: number;
  procedureCode: string;
  serviceDate: IsoDate;
  expectedNetCents: Cents;
  inventorySourceId: string;
}

export interface ScopeRule {
  ruleId: string;
  payerId: string;
  effectiveFrom: IsoDate;
  effectiveThrough: IsoDate;
  confirmedBy: string | null;
  noticeSourceId: string;
}

export interface Notice {
  sourceId: string;
  payerId: string;
  effectiveFrom: IsoDate;
  effectiveThrough: IsoDate;
  version: string;
  /** Human or system supplied relationship; absence does not imply independence. */
  supersedesSourceId: string | null;
}

export interface AdjustmentEvent {
  eventId: string;
  lineId: string;
  kind: 'original' | 'replacement' | 'reversal';
  signedAmountCents: Cents;
  reversesEventId: string | null;
  sourceId: string;
}

export interface ProofInput {
  caseId: string;
  revision: number;
  cutoff: string;
  inventoryCoverage: 'complete' | 'unconfirmed';
  inventorySourceId: string;
  inventory: InventoryLine[];
  rule: ScopeRule;
  notices: Notice[];
  events: AdjustmentEvent[];
}

export type LineStatus = 'corrected' | 'missing' | 'amount-mismatch' | 'ambiguous';

export interface LineObligation {
  lineId: string;
  claimId: string;
  serviceLineNumber: number;
  procedureCode: string;
  serviceDate: IsoDate;
  status: LineStatus;
  expectedNetCents: Cents;
  observedNetCents: Cents | null;
  eventIds: string[];
  sourceIds: string[];
  reason: string;
}

export type ChallengeType = 'excluded-eligible-line' | 'conflicting-notice' | 'ambiguous-adjustment';

export interface CounterexampleProposal {
  proposalId: string;
  type: ChallengeType;
  lineId?: string;
  sourceId: string;
  allegedBrokenObligation: string;
}

export interface ChallengeFinding extends CounterexampleProposal {
  outcome: 'reproduced' | 'unresolved' | 'refuted';
  reason: string;
}

export interface CorrectionProof {
  caseId: string;
  revision: number;
  inputHash: string;
  cutoff: string;
  status: 'eligible' | 'challenged' | 'incomplete';
  expectedLineCount: number;
  correctedLineCount: number;
  unresolvedCents: Cents;
  obligations: LineObligation[];
  excludedLineIds: string[];
  findings: ChallengeFinding[];
  blockers: string[];
}
