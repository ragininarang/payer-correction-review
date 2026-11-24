export const sourceKinds = [
  'payer-notice',
  'local-procedure',
  'independent-inventory',
  'payment-basis',
  'remittance-batch',
] as const;

export type SourceKind = typeof sourceKinds[number];
export type SourceCoverage = 'complete' | 'partial' | 'not-applicable';
export type SourceVisibility = 'case-team' | 'billing-supervisors' | 'operators';

export interface SourceManifest {
  schemaVersion: '1.0';
  sourceId: string;
  sourceKind: SourceKind;
  sourceVersion: string;
  contentHash: string;
  payerId: string;
  effectiveFrom: string | null;
  effectiveThrough: string | null;
  provenance: string;
  visibility: SourceVisibility;
  itemCount: number | null;
  coverage: SourceCoverage;
  supersedesSourceId: string | null;
}

export interface IntakeTransition {
  projectOptedIn: boolean;
  changedField: string;
  fromStatus: string | null;
  toStatus: string | null;
  noticeReference: string | null;
  manifests: readonly SourceManifest[];
}

export type IntakeDecision =
  | { outcome: 'ignored'; reason: 'project-not-opted-in' | 'not-qualifying-transition' }
  | { outcome: 'awaiting-inputs'; missing: string[] }
  | { outcome: 'eligible'; noticeSourceId: string; manifestSourceIds: string[] };

const requiredKinds: readonly SourceKind[] = [
  'payer-notice',
  'independent-inventory',
  'payment-basis',
  'remittance-batch',
];

function isDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`));
}

function requiredString(value: unknown, field: string, max = 255): string {
  if (typeof value !== 'string' || value.trim().length < 1 || value.length > max) {
    throw new Error(`${field} is required and must be ${max} characters or fewer.`);
  }
  return value.trim();
}

export function validateSourceManifest(value: unknown): SourceManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Source manifest must be an object.');
  const input = value as Record<string, unknown>;
  if (input.schemaVersion !== '1.0') throw new Error('Source manifest schemaVersion must be 1.0.');
  if (typeof input.sourceKind !== 'string' || !sourceKinds.includes(input.sourceKind as SourceKind)) {
    throw new Error('Source manifest has an unsupported sourceKind.');
  }
  const sourceKind = input.sourceKind as SourceKind;
  const sourceId = requiredString(input.sourceId, 'sourceId', 128);
  const sourceVersion = requiredString(input.sourceVersion, 'sourceVersion', 64);
  const payerId = requiredString(input.payerId, 'payerId', 128);
  const provenance = requiredString(input.provenance, 'provenance', 500);
  if (typeof input.contentHash !== 'string' || !/^[a-f0-9]{64}$/i.test(input.contentHash)) {
    throw new Error('contentHash must be a 64-character SHA-256 hex digest.');
  }
  if (!['case-team', 'billing-supervisors', 'operators'].includes(String(input.visibility))) {
    throw new Error('Source manifest has an unsupported visibility.');
  }
  if (!['complete', 'partial', 'not-applicable'].includes(String(input.coverage))) {
    throw new Error('Source manifest has an unsupported coverage declaration.');
  }
  const effectiveFrom = input.effectiveFrom === null ? null : isDate(input.effectiveFrom) ? input.effectiveFrom : undefined;
  const effectiveThrough = input.effectiveThrough === null ? null : isDate(input.effectiveThrough) ? input.effectiveThrough : undefined;
  if (effectiveFrom === undefined || effectiveThrough === undefined) throw new Error('Effective dates must be valid dates or null.');
  if (effectiveFrom && effectiveThrough && effectiveFrom > effectiveThrough) {
    throw new Error('effectiveFrom cannot be after effectiveThrough.');
  }
  if (['payer-notice', 'payment-basis'].includes(sourceKind) && (!effectiveFrom || !effectiveThrough)) {
    throw new Error(`${sourceKind} requires an effective date range.`);
  }
  const itemCount = input.itemCount === null ? null : input.itemCount;
  if (itemCount !== null && (!Number.isInteger(itemCount) || Number(itemCount) < 0 || Number(itemCount) > 1_000_000)) {
    throw new Error('itemCount must be a non-negative integer no greater than 1,000,000, or null.');
  }
  if (sourceKind === 'independent-inventory' && (input.coverage !== 'complete' || Number(itemCount) < 1)) {
    throw new Error('Independent inventory must declare complete coverage and contain at least one item.');
  }
  const supersedesSourceId = input.supersedesSourceId === null
    ? null
    : requiredString(input.supersedesSourceId, 'supersedesSourceId', 128);
  if (supersedesSourceId === sourceId) throw new Error('A source cannot supersede itself.');
  return {
    schemaVersion: '1.0',
    sourceId,
    sourceKind,
    sourceVersion,
    contentHash: input.contentHash.toLowerCase(),
    payerId,
    effectiveFrom,
    effectiveThrough,
    provenance,
    visibility: input.visibility as SourceVisibility,
    itemCount: itemCount as number | null,
    coverage: input.coverage as SourceCoverage,
    supersedesSourceId,
  };
}

export function activeSourceManifests(manifests: readonly SourceManifest[]): SourceManifest[] {
  const superseded = new Set(manifests.map((item) => item.supersedesSourceId).filter((item): item is string => Boolean(item)));
  return manifests.filter((item) => !superseded.has(item.sourceId));
}

export function evaluateIntakeTransition(input: IntakeTransition): IntakeDecision {
  if (!input.projectOptedIn) return { outcome: 'ignored', reason: 'project-not-opted-in' };
  const isQualifying = input.changedField.toLowerCase() === 'status'
    && input.toStatus?.trim().toLowerCase() === 'payer reports fixed'
    && input.fromStatus?.trim().toLowerCase() !== 'payer reports fixed';
  if (!isQualifying) return { outcome: 'ignored', reason: 'not-qualifying-transition' };

  const active = activeSourceManifests(input.manifests);
  const missing: string[] = [];
  if (!input.noticeReference) missing.push('Payer notice reference');
  for (const kind of requiredKinds) {
    if (!active.some((item) => item.sourceKind === kind)) missing.push(kind);
  }
  const notice = active.find((item) => item.sourceKind === 'payer-notice' && item.sourceId === input.noticeReference);
  if (input.noticeReference && !notice) missing.push('Current payer notice matching the Jira reference');
  const payerIds = new Set(active.filter((item) => requiredKinds.includes(item.sourceKind)).map((item) => item.payerId));
  if (payerIds.size > 1) missing.push('Consistent payer identity across required sources');
  if (missing.length > 0) return { outcome: 'awaiting-inputs', missing: [...new Set(missing)] };
  return {
    outcome: 'eligible',
    noticeSourceId: notice!.sourceId,
    manifestSourceIds: active.filter((item) => requiredKinds.includes(item.sourceKind)).map((item) => item.sourceId).sort(),
  };
}
