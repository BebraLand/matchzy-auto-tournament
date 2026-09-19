import assert from 'node:assert/strict';
import { defaultTeamFallback, defaultVetoDesign, measureElementGaps, nudgeElementPosition, previewVeto, restoreImageAspectRatio, snapElementPosition } from '../../client/src/components/veto/VetoDesignCanvas';
import { validDesign } from '../../api/src/routes/broadcastVetoDesign';

const design = defaultVetoDesign();
assert.equal(validDesign(design), true);
assert.equal(design.showActionOwnership, false);
assert.equal(validDesign({ ...design, showActionOwnership: true }), true);
assert.equal(validDesign({ ...design, showActionOwnership: 'true' }), false);
assert.equal(validDesign({ ...design, teamFallback: { ...defaultTeamFallback, mode: 'initials' } }), true);
assert.equal(validDesign({ ...design, teamFallback: { ...defaultTeamFallback, background: 'transparent' } }), false);
assert.deepEqual(restoreImageAspectRatio({ x: 700, y: 400, w: 480, h: 110 }, 1000, 1000), { x: 700, y: 215, w: 480, h: 480 });
assert.deepEqual(restoreImageAspectRatio({ x: 700, y: 400, w: 480, h: 110 }, 1600, 900), { x: 700, y: 320, w: 480, h: 270 });
assert.deepEqual(snapElementPosition({ w: 480, h: 270 }, 715, 398), { x: 720, y: 405, guides: { x: 960, y: 540 } });
assert.deepEqual(snapElementPosition({ w: 480, h: 270 }, 300, 100), { x: 300, y: 100, guides: {} });
assert.deepEqual(snapElementPosition({ w: 480, h: 270 }, 8, 810), { x: 0, y: 810, guides: { x: 0, y: 1080 } });
assert.deepEqual(snapElementPosition({ w: 200, h: 100 }, 294, 196, 16, [{ x: 500, y: 300, w: 200, h: 100 }]), { x: 300, y: 200, guides: { x: 500, y: 300 } });
assert.deepEqual(snapElementPosition({ w: 480, h: 270 }, 715, 398, 16, [], false), { x: 715, y: 398, guides: {} });
assert.deepEqual(nudgeElementPosition({ x: 300, y: 200, w: 200, h: 100 }, -1, 1), { x: 299, y: 201 });
assert.deepEqual(nudgeElementPosition({ x: 0, y: 0, w: 200, h: 100 }, -10, -10), { x: 0, y: 0 });
assert.deepEqual(nudgeElementPosition({ x: 1800, y: 1000, w: 120, h: 80 }, 10, 10), { x: 1800, y: 1000 });
assert.deepEqual(measureElementGaps({ x: 300, y: 200, w: 200, h: 100 }, [
  { x: 100, y: 210, w: 100, h: 80 }, { x: 600, y: 220, w: 100, h: 60 },
  { x: 340, y: 50, w: 100, h: 100 }, { x: 350, y: 400, w: 100, h: 100 },
]).map(({ side, source, value }) => [side, source, value]), [
  ['left', 'canvas', 300], ['left', 'element', 100], ['right', 'element', 100],
  ['top', 'canvas', 200], ['top', 'element', 50], ['bottom', 'element', 100],
]);
assert.deepEqual(measureElementGaps({ x: 300, y: 200, w: 200, h: 100 }, [
  { x: 100, y: 210, w: 200, h: 80 }, // touching: snapping already shows alignment
  { x: 350, y: 300, w: 100, h: 100 }, // touching below
  { x: 100, y: 400, w: 100, h: 100 }, // no overlap on either axis
]).filter(({ source }) => source === 'element'), []);
assert.equal(validDesign({ ...design, screens: { ...design.screens, live: { ...design.screens.live, backgroundImage: 'javascript:alert(1)' } } }), false);
assert.deepEqual(Object.keys(design.screens).sort(), ['completed', 'live', 'standby']);
for (const screen of Object.values(design.screens)) {
  assert.equal(new Set(screen.elements.map((element) => element.id)).size, screen.elements.length);
}

for (const format of ['bo1', 'bo3', 'bo5'] as const) {
  const pending = previewVeto('pending', format)!;
  const ban = previewVeto('ban', format)!;
  const pick = previewVeto('pick', format)!;
  const side = previewVeto('side', format)!;
  const complete = previewVeto('completed', format)!;
  assert.equal(pending.actions.length, 0);
  assert.equal(ban.actions[0].action, 'ban');
  assert.equal(side.actions.at(-1)?.action, 'side_pick');
  assert.equal(complete.status, 'completed');
  assert.equal(complete.availableMaps.length, 0);
  assert.equal(complete.pickedMaps.length, Number(format.slice(2)));
  if (format !== 'bo1') assert.equal(pick.actions.at(-1)?.action, 'pick');
}

console.log('Veto designer fixtures OK');
