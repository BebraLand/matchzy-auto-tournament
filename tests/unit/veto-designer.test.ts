import assert from 'node:assert/strict';
import { defaultTeamFallback, defaultVetoDesign, previewVeto } from '../../client/src/components/veto/VetoDesignCanvas';
import { validDesign } from '../../api/src/routes/broadcastVetoDesign';

const design = defaultVetoDesign();
assert.equal(validDesign(design), true);
assert.equal(validDesign({ ...design, teamFallback: { ...defaultTeamFallback, mode: 'initials' } }), true);
assert.equal(validDesign({ ...design, teamFallback: { ...defaultTeamFallback, background: 'transparent' } }), false);
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
