/**
 * Tests for the schema push.
 *
 * A deployment or a migration must never overwrite records that already
 * exist in the database — in particular the pre-existing
 * `/Sensoura/aiPredictions` history.
 */
import { describe, expect, it } from 'vitest';
import { planSchemaPush } from '../scripts/push-schema.js';

const SEED = {
  sensorData: { temperature: 28.4 },
  system: { status: 'online' },
  commands: {},
  commandResults: {},
  aiSuggestions: {},
};

describe('schema push plan', () => {
  it('writes only the nodes that do not exist yet', () => {
    const plan = planSchemaPush(SEED, { system: { status: 'offline' } });
    expect(plan.write).toEqual(['sensorData', 'commands', 'commandResults', 'aiSuggestions']);
    expect(plan.keep).toEqual(['system']);
  });

  it('never overwrites an existing node', () => {
    const existing = {
      sensorData: { temperature: 99 },
      system: { status: 'offline' },
      commands: { a: { id: 'a' } },
    };
    const plan = planSchemaPush(SEED, existing);
    expect(plan.write).toEqual(['commandResults', 'aiSuggestions']);
    expect(plan.keep).toEqual(['sensorData', 'system', 'commands']);
  });

  it('overwrites the seeded keys only when it is forced', () => {
    const plan = planSchemaPush(SEED, { sensorData: { temperature: 99 } }, true);
    expect(plan.write).toEqual(Object.keys(SEED));
    expect(plan.keep).toEqual([]);
  });

  it('never writes the prediction nodes, not even when forced', () => {
    const seed = { ...SEED, aiPredictions: { '3001': { type: 'rainfall' } } };
    const plan = planSchemaPush(seed, {}, true);
    expect(plan.write).not.toContain('aiPredictions');
    expect(plan.refuse).toContain('aiPredictions');

    const withPipelineNodes = { ...SEED, AI_Predictions: {}, AI_Data: {}, AI_Suggestions: {} };
    const plan2 = planSchemaPush(withPipelineNodes, {}, true);
    expect(plan2.write).toEqual(Object.keys(SEED));
    expect([...plan2.refuse].sort()).toEqual(['AI_Data', 'AI_Predictions', 'AI_Suggestions']);
  });

  it('leaves the existing prediction history untouched when it is not part of the seed', () => {
    // The real seed file has no prediction key, so the whole history node is
    // simply never addressed by the push.
    const plan = planSchemaPush(SEED, { aiPredictions: { '3001': { type: 'rainfall' } } });
    expect(plan.write).not.toContain('aiPredictions');
    expect(plan.keep).not.toContain('aiPredictions');
  });
});
