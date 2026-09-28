import assert from 'node:assert/strict';
import { getMatchFormat } from '../api/src/utils/matchFormat';

const tournament = {
  format: 'bo3' as const,
  settings: { matchFormats: { r2m1: 'bo5' as const, r1m2: 'bo1' as const } },
};

assert.equal(getMatchFormat(tournament, 'r1m1'), 'bo3');
assert.equal(getMatchFormat(tournament, 'r1m2'), 'bo1');
assert.equal(getMatchFormat(tournament, 'r2m1'), 'bo5');
console.log('Match format overrides: OK');
