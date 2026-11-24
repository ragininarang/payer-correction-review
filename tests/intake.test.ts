import { describe, expect, it } from 'vitest';
import {
  activeSourceManifests,
  evaluateIntakeTransition,
  validateSourceManifest,
  type SourceKind,
  type SourceManifest,
} from '../src/domain/intake';

function manifest(sourceKind: SourceKind, sourceId: string = sourceKind): SourceManifest {
  return validateSourceManifest({
    schemaVersion: '1.0',
    sourceId,
    sourceKind,
    sourceVersion: '1',
    contentHash: 'a'.repeat(64),
    payerId: 'payer-demo',
    effectiveFrom: ['payer-notice', 'payment-basis'].includes(sourceKind) ? '2026-10-01' : null,
    effectiveThrough: ['payer-notice', 'payment-basis'].includes(sourceKind) ? '2026-10-31' : null,
    provenance: 'Synthetic fixture created for the Codegeist judging workflow.',
    visibility: 'case-team',
    itemCount: sourceKind === 'independent-inventory' ? 13 : sourceKind === 'remittance-batch' ? 23 : null,
    coverage: sourceKind === 'independent-inventory' ? 'complete' : sourceKind === 'remittance-batch' ? 'partial' : 'not-applicable',
    supersedesSourceId: null,
  });
}

const completeManifests = [
  manifest('payer-notice', 'notice-v1'),
  manifest('local-procedure'),
  manifest('independent-inventory'),
  manifest('payment-basis'),
  manifest('remittance-batch'),
];

describe('deterministic intake qualification', () => {
  it('ignores ordinary issue activity and non-opted-in projects', () => {
    expect(evaluateIntakeTransition({ projectOptedIn: false, changedField: 'status', fromStatus: 'Open', toStatus: 'Payer reports fixed', noticeReference: 'notice-v1', manifests: completeManifests }))
      .toEqual({ outcome: 'ignored', reason: 'project-not-opted-in' });
    expect(evaluateIntakeTransition({ projectOptedIn: true, changedField: 'description', fromStatus: null, toStatus: null, noticeReference: 'notice-v1', manifests: completeManifests }))
      .toEqual({ outcome: 'ignored', reason: 'not-qualifying-transition' });
  });

  it('names every missing input without starting reasoning work', () => {
    const result = evaluateIntakeTransition({
      projectOptedIn: true,
      changedField: 'status',
      fromStatus: 'Waiting for payer',
      toStatus: 'Payer reports fixed',
      noticeReference: null,
      manifests: [],
    });
    expect(result).toEqual({
      outcome: 'awaiting-inputs',
      missing: ['Payer notice reference', 'payer-notice', 'independent-inventory', 'payment-basis', 'remittance-batch'],
    });
  });

  it('qualifies only an exact status transition with a matching current notice', () => {
    expect(evaluateIntakeTransition({
      projectOptedIn: true,
      changedField: 'status',
      fromStatus: 'Waiting for payer',
      toStatus: 'Payer reports fixed',
      noticeReference: 'notice-v1',
      manifests: completeManifests,
    })).toEqual({
      outcome: 'eligible',
      noticeSourceId: 'notice-v1',
      manifestSourceIds: ['independent-inventory', 'notice-v1', 'payment-basis', 'remittance-batch'],
    });
  });

  it('uses the current source version and rejects an old Jira notice reference', () => {
    const noticeV2 = { ...manifest('payer-notice', 'notice-v2'), supersedesSourceId: 'notice-v1' };
    const versions = [...completeManifests, noticeV2];
    expect(activeSourceManifests(versions).some((item) => item.sourceId === 'notice-v1')).toBe(false);
    expect(evaluateIntakeTransition({ projectOptedIn: true, changedField: 'status', fromStatus: 'Open', toStatus: 'Payer reports fixed', noticeReference: 'notice-v1', manifests: versions }))
      .toMatchObject({ outcome: 'awaiting-inputs' });
  });

  it('requires complete independent inventory and valid source dates', () => {
    expect(() => validateSourceManifest({ ...manifest('independent-inventory'), coverage: 'partial' })).toThrow(/complete coverage/i);
    expect(() => validateSourceManifest({ ...manifest('payer-notice'), effectiveFrom: '2026-11-01', effectiveThrough: '2026-10-01' })).toThrow(/cannot be after/i);
  });
});
