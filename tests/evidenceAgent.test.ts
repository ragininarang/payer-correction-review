import { describe, expect, it, vi } from 'vitest';
import {
  EVIDENCE_AGENT_MAX_TOOL_CALLS,
  runEvidenceAgent,
  type EvidenceAnalysis,
  type EvidenceSourceDescriptor,
} from '../src/agents/evidence';

function source(overrides: Partial<EvidenceSourceDescriptor> & Pick<EvidenceSourceDescriptor, 'sourceId'>): EvidenceSourceDescriptor {
  return {
    sourceVersion: '1', sourceKind: 'payer-notice', title: overrides.sourceId,
    visibility: 'case-team', permitted: true, closureCritical: true,
    supersedesSourceId: null, relevanceHints: [], ...overrides,
  };
}

const emptyAnalysis: EvidenceAnalysis = {
  summary: 'The permitted closure-critical sources were checked.',
  citations: [], contradictions: [], needsHumanReview: false,
};

describe('Evidence agent production contract', () => {
  it('adds omitted closure-critical sources and never reads denied content', async () => {
    const catalog = [
      source({ sourceId: 'notice-v1' }),
      source({ sourceId: 'inventory-v1', sourceKind: 'independent-inventory' }),
      source({ sourceId: 'restricted-rule', sourceKind: 'payment-basis', permitted: false, visibility: 'billing-supervisors' }),
    ];
    const readSource = vi.fn(async (sourceId: string, sourceVersion: string) => ({ sourceId, sourceVersion, content: `Synthetic ${sourceId}` }));
    const pack = await runEvidenceAgent({ caseId: 'CASE-1', revision: 1, catalog, isRevisionCurrent: () => true }, {
      plan: async () => ({ selectedSourceIds: ['notice-v1', 'restricted-rule'], rationale: 'Inspect notice and rule.' }),
      readSource,
      analyze: async () => emptyAnalysis,
    });

    expect(readSource.mock.calls.map(([id]) => id)).toEqual(['notice-v1', 'inventory-v1']);
    expect(pack.observability.controllerAdded).toEqual(['inventory-v1']);
    expect(pack.accessDenials).toEqual([expect.objectContaining({ sourceId: 'restricted-rule', closureCritical: true })]);
    expect(pack.coverage).toEqual({ complete: false, missingClosureCriticalSourceIds: ['restricted-rule'] });
    expect(pack.terminalReason).toBe('access-denied');
    expect(pack.needsHumanReview).toBe(true);
  });

  it('rejects citations to a source version the read tool did not return', async () => {
    const catalog = [source({ sourceId: 'notice-v2', sourceVersion: '2' })];
    await expect(runEvidenceAgent({ caseId: 'CASE-2', revision: 2, catalog, isRevisionCurrent: () => true }, {
      plan: async () => ({ selectedSourceIds: ['notice-v2'], rationale: 'Read the notice.' }),
      readSource: async () => ({ sourceId: 'notice-v2', sourceVersion: '2', content: 'Current notice.' }),
      analyze: async () => ({
        ...emptyAnalysis,
        citations: [{ citationId: 'c1', sourceId: 'notice-v2', sourceVersion: '1', locator: 'paragraph 1', claim: 'Wrong version.' }],
      }),
    })).rejects.toThrow(/source version that was not read/);
  });

  it('reports budget exhaustion instead of silently skipping critical sources', async () => {
    const catalog = Array.from({ length: EVIDENCE_AGENT_MAX_TOOL_CALLS + 1 }, (_, index) => source({ sourceId: `critical-${index + 1}` }));
    const pack = await runEvidenceAgent({ caseId: 'CASE-3', revision: 1, catalog, isRevisionCurrent: () => true }, {
      plan: async () => ({ selectedSourceIds: [], rationale: 'No selection.' }),
      readSource: async (sourceId, sourceVersion) => ({ sourceId, sourceVersion, content: 'Synthetic content.' }),
      analyze: async () => emptyAnalysis,
    });
    expect(pack.observability.toolCalls).toBe(EVIDENCE_AGENT_MAX_TOOL_CALLS);
    expect(pack.unsearchedSources).toContainEqual(expect.objectContaining({ sourceId: 'critical-9', reason: 'tool-budget' }));
    expect(pack.terminalReason).toBe('budget-exhausted');
    expect(pack.coverage.complete).toBe(false);
  });

  it('does not let optional planner choices crowd critical evidence out of the budget', async () => {
    const catalog = [
      ...Array.from({ length: EVIDENCE_AGENT_MAX_TOOL_CALLS }, (_, index) => source({
        sourceId: `optional-${index + 1}`, closureCritical: false, sourceKind: 'local-procedure',
      })),
      source({ sourceId: 'required-inventory', sourceKind: 'independent-inventory' }),
    ];
    const readSource = vi.fn(async (sourceId: string, sourceVersion: string) => ({ sourceId, sourceVersion, content: 'Synthetic content.' }));
    const pack = await runEvidenceAgent({ caseId: 'CASE-3B', revision: 1, catalog, isRevisionCurrent: () => true }, {
      plan: async () => ({ selectedSourceIds: catalog.slice(0, EVIDENCE_AGENT_MAX_TOOL_CALLS).map((item) => item.sourceId), rationale: 'Optional sources.' }),
      readSource,
      analyze: async () => emptyAnalysis,
    });
    expect(readSource.mock.calls[0]?.[0]).toBe('required-inventory');
    expect(pack.coverage.complete).toBe(true);
    expect(pack.unsearchedSources).toContainEqual(expect.objectContaining({ sourceId: 'optional-8', reason: 'tool-budget', closureCritical: false }));
  });

  it('preserves cited contradictions without resolving organizational authority', async () => {
    const catalog = [
      source({ sourceId: 'notice-old', closureCritical: false }),
      source({ sourceId: 'notice-new', supersedesSourceId: 'notice-old' }),
    ];
    const pack = await runEvidenceAgent({ caseId: 'CASE-4', revision: 1, catalog, isRevisionCurrent: () => true }, {
      plan: async () => ({ selectedSourceIds: ['notice-old', 'notice-new'], rationale: 'Compare versions.' }),
      readSource: async (sourceId, sourceVersion) => ({ sourceId, sourceVersion, content: `${sourceId} synthetic date rule.` }),
      analyze: async () => ({
        summary: 'The two notices state different effective dates.', needsHumanReview: true,
        citations: [
          { citationId: 'old-date', sourceId: 'notice-old', sourceVersion: '1', locator: 'date section', claim: 'Starts September 30.' },
          { citationId: 'new-date', sourceId: 'notice-new', sourceVersion: '1', locator: 'date section', claim: 'Starts October 1.' },
        ],
        contradictions: [{ contradictionId: 'date-conflict', topic: 'Effective start date', citationIds: ['old-date', 'new-date'], consequence: 'Scope requires confirmation.' }],
      }),
    });
    expect(pack.contradictions).toHaveLength(1);
    expect(pack.needsHumanReview).toBe(true);
    expect(pack.coverage.complete).toBe(true);
    expect(pack.searchedSources).toContainEqual(expect.objectContaining({ sourceId: 'notice-new', supersedesSourceId: 'notice-old' }));
  });

  it('stops stale work before the analysis model call can publish', async () => {
    const analyze = vi.fn(async () => emptyAnalysis);
    const pack = await runEvidenceAgent({ caseId: 'CASE-5', revision: 7, catalog: [source({ sourceId: 'notice' })], isRevisionCurrent: () => false }, {
      plan: async () => ({ selectedSourceIds: ['notice'], rationale: 'Read notice.' }),
      readSource: async (sourceId, sourceVersion) => ({ sourceId, sourceVersion, content: 'Synthetic content.' }),
      analyze,
    });
    expect(analyze).not.toHaveBeenCalled();
    expect(pack.terminalReason).toBe('stale-revision');
    expect(pack.observability.modelCalls).toBe(1);
  });
});
