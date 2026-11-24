import { describe, expect, it } from 'vitest';
import {
  PLATFORM_SPIKE_MODEL,
  PLATFORM_SPIKE_SOURCE_ID,
  classifyPlatformSpikeFailure,
  estimateCostMicrousd,
  runBoundedPlatformGraph,
} from '../src/agents/platformSpike';

describe('platform feasibility spike contracts', () => {
  it('runs one allowlisted read through a bounded LangGraph path', async () => {
    const result = await runBoundedPlatformGraph(async (sourceText) => {
      expect(sourceText).toContain('Synthetic payer correction notice');
      return {
        finding: {
          sourceId: PLATFORM_SPIKE_SOURCE_ID,
          payer: 'Payer Demo',
          claimType: 'professional',
          serviceDateStart: '2026-10-01',
          serviceDateEnd: '2026-10-31',
          inventoryRequired: true,
          needsHumanReview: false,
          summary: 'Professional claims in the stated October service-date interval require the independent inventory.',
        },
        model: PLATFORM_SPIKE_MODEL,
        responseId: 'test-response',
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, estimatedCostMicrousd: 35 },
      };
    });

    expect(result.toolCalls).toBe(1);
    expect(result.graphSteps).toBe(2);
    expect(result.sourceIds).toEqual([PLATFORM_SPIKE_SOURCE_ID]);
    expect(result.finding.inventoryRequired).toBe(true);
  });

  it('estimates only the pinned model using integer microdollars', () => {
    expect(estimateCostMicrousd(PLATFORM_SPIKE_MODEL, 100, 50)).toBe(35);
    expect(estimateCostMicrousd('unpriced-model', 100, 50)).toBeNull();
    expect(() => estimateCostMicrousd(PLATFORM_SPIKE_MODEL, -1, 0)).toThrow(/non-negative/);
  });

  it('classifies missing configuration without exposing a secret', () => {
    expect(classifyPlatformSpikeFailure(new Error('OpenAI API key configuration is missing.'))).toBe('configuration');
    expect(classifyPlatformSpikeFailure(new Error('unexpected'))).toBe('unknown');
  });
});
