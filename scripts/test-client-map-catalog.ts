import assert from 'node:assert/strict';
import {
  getMapData,
  getMapDisplayName,
  getMapFullImageUrl,
  getMapThumbnailUrl,
} from '../client/src/constants/maps';

const cache = getMapData('de_cache');
assert.ok(cache, 'Cache must be present in the shared client map catalog');
assert.equal(cache.displayName, 'Cache');
assert.equal(getMapDisplayName('de_cache'), 'Cache');
assert.equal(
  getMapFullImageUrl('de_cache'),
  'https://raw.githubusercontent.com/auuruum/matchzy-auto-tournament/main/map_thumbnails/de_cache.webp'
);
assert.equal(getMapThumbnailUrl('de_cache'), getMapFullImageUrl('de_cache'));

assert.equal(getMapDisplayName('de_dust2'), 'Dust II');
assert.equal(getMapDisplayName('cs_office'), 'Office');
assert.equal(getMapDisplayName('de_custom_training_ground'), 'Custom Training Ground');
assert.match(getMapFullImageUrl('de_nuke'), /cs2-server-manager\/master\/map_thumbnails\/de_nuke\.webp$/);

console.log('Client map catalog regression checks passed.');
