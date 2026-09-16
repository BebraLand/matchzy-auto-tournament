import assert from 'node:assert/strict';
import { getTournamentStageLabel } from '../api/src/utils/tournamentHelpers';

assert.deepEqual(
  [1, 2, 3].map((round) => getTournamentStageLabel('single_elimination', 'SE', round, 8)),
  ['Quarter-Finals', 'Semi-Finals', 'Final']
);
assert.deepEqual(
  [1, 2, 3, 4].map((round) => getTournamentStageLabel('single_elimination', 'SE', round, 16)),
  ['Round of 16', 'Quarter-Finals', 'Semi-Finals', 'Final']
);
assert.equal(getTournamentStageLabel('double_elimination', 'WB', 1, 8), 'Upper Bracket Quarter-Finals');
assert.equal(getTournamentStageLabel('double_elimination', 'WB', 2, 8), 'Upper Bracket Semi-Finals');
assert.equal(getTournamentStageLabel('double_elimination', 'WB', 3, 8), 'Upper Bracket Final');
assert.equal(getTournamentStageLabel('double_elimination', 'LB', 3, 8), 'Lower Bracket Semi-Final');
assert.equal(getTournamentStageLabel('double_elimination', 'LB', 4, 8), 'Lower Bracket Final');
assert.equal(getTournamentStageLabel('double_elimination', 'GF', 1, 8), 'Grand Final');
assert.equal(getTournamentStageLabel('double_elimination', 'GF_RESET', 2, 8), 'Grand Final Reset');
assert.equal(getTournamentStageLabel('round_robin', null, 3, 10), 'Round Robin · Round 3');
assert.equal(getTournamentStageLabel('swiss', null, 3, 16), 'Swiss Stage · Round 3');
assert.equal(getTournamentStageLabel('shuffle', null, 2, 0), 'Shuffle · Round 2');
assert.equal(getTournamentStageLabel('double_elimination', null, 2, 8), 'Double Elimination · Round 2');
assert.equal(getTournamentStageLabel('unknown', null, 1, 8), null);
assert.equal(getTournamentStageLabel('single_elimination', 'SE', 4, 8), null);

console.log('HUD tournament stage labels passed');
