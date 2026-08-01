import { expect, test } from '@playwright/test';

test.describe('Tournament match rulings', () => {
  test('records a technical win through bracket progression and removes a voided no-show from execution', async ({
    request,
  }) => {
    const stamp = Date.now();
    const teamIds = Array.from({ length: 4 }, (_, index) => `ruling-${stamp}-${index + 1}`);

    const login = await request.post('/api/test/login-admin', {
      data: { steamId: '76561198000000001' },
    });
    expect(login.ok(), await login.text()).toBeTruthy();

    await request.delete('/api/tournament');

    try {
      for (const [index, id] of teamIds.entries()) {
        const createTeam = await request.post('/api/teams', {
          data: {
            id,
            name: `Ruling Team ${index + 1}`,
            players: Array.from({ length: 5 }, (_, playerIndex) => ({
              steamId: `7656119${String(stamp + index * 10 + playerIndex).slice(-10).padStart(10, '0')}`,
              name: `Ruling ${index + 1}-${playerIndex + 1}`,
            })),
          },
        });
        expect(createTeam.ok(), await createTeam.text()).toBeTruthy();
      }

      const createTournament = await request.post('/api/tournament', {
        data: {
          name: `Match rulings ${stamp}`,
          type: 'single_elimination',
          format: 'bo1',
          maps: ['de_cache'],
          teamIds,
          settings: { controlMode: 'assisted', seedingMethod: 'random' },
        },
      });
      expect(createTournament.ok(), await createTournament.text()).toBeTruthy();
      const startTournament = await request.post('/api/tournament/start');
      expect(startTournament.ok(), await startTournament.text()).toBeTruthy();

      const matchesResponse = await request.get('/api/matches');
      expect(matchesResponse.ok(), await matchesResponse.text()).toBeTruthy();
      const firstRound = (await matchesResponse.json()).matches.filter(
        (match: { round: number }) => match.round === 1
      ) as Array<{ slug: string; team1: { id: string }; team2: { id: string } }>;
      expect(firstRound).toHaveLength(2);

      const technicalWin = await request.post(`/api/matches/${firstRound[0].slug}/ruling`, {
        data: { kind: 'technical_win', winnerSide: 'team1', reason: 'Opponent did not appear' },
      });
      expect(technicalWin.ok(), await technicalWin.text()).toBeTruthy();

      const technicalWinner = await request.get(`/api/matches/${firstRound[0].slug}`);
      expect(technicalWinner.ok(), await technicalWinner.text()).toBeTruthy();
      const technicalWinnerBody = await technicalWinner.json();
      expect(technicalWinnerBody.match.status).toBe('completed');
      expect(technicalWinnerBody.match.winner.id).toBe(firstRound[0].team1.id);

      const voidNoShow = await request.post(`/api/matches/${firstRound[1].slug}/ruling`, {
        data: { kind: 'void', reason: 'Both teams did not appear' },
      });
      expect(voidNoShow.ok(), await voidNoShow.text()).toBeTruthy();

      const voidedMatch = await request.get(`/api/matches/${firstRound[1].slug}`);
      expect(voidedMatch.ok(), await voidedMatch.text()).toBeTruthy();
      const voidedMatchBody = await voidedMatch.json();
      expect(voidedMatchBody.match.status).toBe('cancelled');
      expect(voidedMatchBody.match.queuePosition).toBeNull();

      const afterRulings = await request.get('/api/matches');
      expect(afterRulings.ok(), await afterRulings.text()).toBeTruthy();
      const afterRulingsBody = await afterRulings.json();
      expect(
        afterRulingsBody.matches.some(
          (match: { slug: string; queuePosition?: number | null }) =>
            match.slug === firstRound[1].slug && match.queuePosition != null
        )
      ).toBe(false);
    } finally {
      await request.delete('/api/tournament');
      for (const id of teamIds) {
        await request.delete(`/api/teams/${id}`);
      }
    }
  });
});
