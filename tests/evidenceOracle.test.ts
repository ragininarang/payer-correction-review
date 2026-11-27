import { describe, expect, it } from 'vitest';
import { EvidencePackSchema, EVIDENCE_AGENT_PROMPT_VERSION } from '../src/agents/evidence';
import { evidenceEnablementGate, evidenceOracleCases, scoreEvidencePack } from '../src/evaluation/evidenceOracle';

function packFor(oracleId: (typeof evidenceOracleCases)[number]['oracleId']) {
  const oracle = evidenceOracleCases.find((item) => item.oracleId === oracleId)!;
  const searchedSources = oracle.catalog.filter((source) => oracle.expectedCriticalSourceIds.includes(source.sourceId)).map((source) => ({
    sourceId: source.sourceId, sourceVersion: source.sourceVersion, sourceKind: source.sourceKind, supersedesSourceId: source.supersedesSourceId,
  }));
  const citations = oracle.expectedCitationVersions.map((source, index) => ({
    citationId: `c${index + 1}`, ...source, locator: 'labeled fixture', claim: 'Gold-labeled synthetic claim.',
  }));
  const contradictions = oracle.expectedContradictionTopics.map((topic, index) => ({
    contradictionId: `x${index + 1}`, topic,
    citationIds: citations.length >= 2 ? citations.slice(0, 2).map((citation) => citation.citationId) : ['fixture-a', 'fixture-b'],
    consequence: 'Requires resolution.',
  }));
  return EvidencePackSchema.parse({
    schemaVersion: '1.0', caseId: oracle.oracleId, revision: 1, promptVersion: EVIDENCE_AGENT_PROMPT_VERSION,
    searchedSources, unsearchedSources: [],
    accessDenials: oracle.catalog.filter((source) => !source.permitted).map((source) => ({
      sourceId: source.sourceId, sourceVersion: source.sourceVersion, closureCritical: source.closureCritical, visibility: source.visibility,
    })),
    citations, contradictions,
    coverage: { complete: oracle.expectedCompleteCoverage, missingClosureCriticalSourceIds: oracle.expectedCompleteCoverage ? [] : oracle.deniedSourceIds },
    summary: 'Synthetic gold pack.', needsHumanReview: !oracle.expectedCompleteCoverage || contradictions.length > 0,
    terminalReason: oracle.expectedCompleteCoverage ? 'completed' : 'access-denied',
    observability: { modelCalls: 2, toolCalls: searchedSources.length, selectedByPlanner: searchedSources.map((source) => source.sourceId), controllerAdded: [] },
  });
}

describe('Evidence evaluation oracle', () => {
  it('contains the full declared Evidence-role safety subset', () => {
    expect(evidenceOracleCases.map((item) => item.oracleId)).toEqual(['O1', 'O5', 'O6', 'O7', 'O8', 'O12', 'O13', 'O14']);
    expect(evidenceOracleCases.every((item) => item.rationale.length > 20)).toBe(true);
  });

  it('passes only when every labeled case satisfies the Evidence gate', () => {
    const scores = evidenceOracleCases.map((oracle) => scoreEvidencePack(oracle, packFor(oracle.oracleId)));
    expect(scores.every((score) => score.passed)).toBe(true);
    expect(evidenceEnablementGate(scores)).toBe(true);
    expect(evidenceEnablementGate(scores.slice(1))).toBe(false);
  });

  it('fails source recall, denied leakage and incomplete-coverage errors explicitly', () => {
    const oracle = evidenceOracleCases.find((item) => item.oracleId === 'O12')!;
    const unsafe = packFor('O12');
    unsafe.citations.push({ citationId: 'leak', sourceId: 'payment-rule-restricted', sourceVersion: '1', locator: 'restricted', claim: 'Leaked.' });
    unsafe.coverage.complete = true;
    unsafe.needsHumanReview = false;
    const score = scoreEvidencePack(oracle, unsafe);
    expect(score.deniedCitationCount).toBe(1);
    expect(score.coverageDisclosureCorrect).toBe(false);
    expect(score.passed).toBe(false);
  });
});
