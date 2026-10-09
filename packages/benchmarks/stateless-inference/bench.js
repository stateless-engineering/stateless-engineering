#!/usr/bin/env node
'use strict';

// Deterministic operation counts, not noisy wall-clock performance claims.
const state = Object.freeze({
  version: 1,
  input: Object.freeze([3, 5, 8, 13]),
  weights: Object.freeze(Array.from({ length: 4096 }, (_, i) => (i * 17 + 11) % 101)),
  bias: 7,
});

// Pure: the output depends only on the state blob and derived projection.
function infer(blob, projection) {
  return blob.input.reduce((sum, value, i) => sum + value * projection[i], blob.bias);
}

function buildProjection(blob) {
  const projection = new Array(blob.input.length).fill(0);
  let operations = 0;
  for (let i = 0; i < blob.weights.length; i++) {
    projection[i % projection.length] += blob.weights[i];
    operations++;
  }
  return { projection: Object.freeze(projection), operations };
}

// Local to this invocation: no persisted cache or hidden state in the engine.
function createService() {
  const cache = new Map();
  return (blob) => {
    const key = JSON.stringify(blob);
    let entry = cache.get(key);
    const hit = entry !== undefined;
    if (!hit) {
      entry = buildProjection(blob);
      cache.set(key, entry);
    }
    return { output: infer(blob, entry.projection), projectionOperations: hit ? 0 : entry.operations, cacheHit: hit };
  };
}

const service = createService();
const cold = service(state);
const warm = service(state);
if (cold.output !== warm.output || cold.cacheHit || !warm.cacheHit) {
  throw new Error('Cache changed inference output or failed to reuse projection');
}
const delta = cold.projectionOperations - warm.projectionOperations;
console.log('cold projection operations:', cold.projectionOperations);
console.log('warm projection operations:', warm.projectionOperations);
console.log('inference output:', warm.output);
console.log('RESULT_JSON ' + JSON.stringify({
  demo: 'stateless-inference',
  durationMs: 0,
  coldProjectionOperations: cold.projectionOperations,
  warmProjectionOperations: warm.projectionOperations,
  deltaProjectionOperations: delta,
  output: warm.output,
  headline: `cold ${cold.projectionOperations} vs warm ${warm.projectionOperations} projection operations (delta ${delta} avoided; same inference output)`,
}));
