import assert from 'node:assert/strict';
import { isServerReadyForMatch } from '../api/src/utils/matchStatusHelpers';

const ready = { online: true, status: 'warmup', matchSlug: '42', mapReady: true };
assert.equal(isServerReadyForMatch(42, ready), true);
assert.equal(isServerReadyForMatch(42, { ...ready, mapReady: false }), false); // old map still loaded
assert.equal(isServerReadyForMatch(42, { ...ready, matchSlug: '41' }), false); // previous match
assert.equal(isServerReadyForMatch(42, { ...ready, status: 'postgame' }), false);
assert.equal(isServerReadyForMatch(42, { ...ready, online: false }), false);
