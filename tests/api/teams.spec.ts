import { test, expect } from '@playwright/test';
import { setupTestContext } from '../helpers/setup';
import { getAuthHeader } from '../helpers/auth';
import { createTeam, createTestTeams, updateTeam, deleteTeam, type Team } from '../helpers/teams';

/**
 * Teams API tests
 * Tests team CRUD operations via API
 * 
 * @tag api
 * @tag teams
 * @tag crud
 */

test.describe.serial('Teams API', () => {
  let context: Awaited<ReturnType<typeof setupTestContext>>;
  let createdTeam: Team | null = null;

  test.beforeEach(async ({ page, request }) => {
    context = await setupTestContext(page, request);
  });

  test('should create, verify, update, and delete a team', {
    tag: ['@api', '@teams', '@crud'],
  }, async ({ request }) => {
    const timestamp = Date.now();
    const players = [
      { steamId: '76561198000000001', name: 'Player 1' },
      { steamId: '76561198000000002', name: 'Player 2' },
    ];

    // Step 1: Create team
    const team = await createTeam(request, {
      id: `api-test-team-${timestamp}`,
      name: `API Test Team ${timestamp}`,
      players,
    });
    expect(team).toBeTruthy();
    expect(team?.id).toBeTruthy();
    expect(team?.name).toBeTruthy();
    createdTeam = team;

    // Step 2: Verify team exists via API
    const getResponse = await request.get(`/api/teams/${team!.id}`, {
      headers: { Authorization: `Bearer ${context.apiToken}` },
    });
    expect(getResponse.ok()).toBeTruthy();
    const teamData = await getResponse.json();
    expect(teamData.team.id).toBe(team!.id);
    expect(teamData.team.name).toBe(team!.name);

    // Step 3: Update team using helper
    const updatedName = `${team!.name} Updated`;
    const updatedTeam = await updateTeam(request, team!.id, {
      name: updatedName,
    });
    expect(updatedTeam).toBeTruthy();
    expect(updatedTeam?.name).toBe(updatedName);

    // Step 4: Delete team
    const deleteResult = await deleteTeam(request, team!.id);
    expect(deleteResult).toBe(true);

    // Step 5: Verify team is deleted (with auth header)
    const getDeletedResponse = await request.get(`/api/teams/${team!.id}`, {
      headers: getAuthHeader(),
    });
    expect(getDeletedResponse.status()).toBe(404);
  });

  test('should create two test teams using helper', {
    tag: ['@api', '@teams'],
  }, async ({ request }) => {
    const [team1, team2] = await createTestTeams(request, 'api-helper-test');
    expect(team1).toBeTruthy();
    expect(team2).toBeTruthy();
    expect(team1.id).toBeTruthy();
    expect(team2.id).toBeTruthy();

    // Cleanup
    await deleteTeam(request, team1.id);
    await deleteTeam(request, team2.id);
  });

  test('should clear an uploaded team logo', {
    tag: ['@api', '@teams', '@assets'],
  }, async ({ request }) => {
    const timestamp = Date.now();
    const team = await createTeam(request, {
      id: `api-logo-team-${timestamp}`,
      name: `API Logo Team ${timestamp}`,
      players: [{ steamId: `7656119800000${timestamp % 100000}`, name: 'Logo Player' }],
    });
    expect(team).toBeTruthy();

    const tinyPng =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=';
    const uploadResponse = await request.post(`/api/teams/${team!.id}/logo`, {
      headers: getAuthHeader(),
      data: { imageData: tinyPng },
    });
    expect(uploadResponse.ok(), await uploadResponse.text()).toBeTruthy();
    const uploaded = await uploadResponse.json();

    const clearResponse = await request.put(`/api/teams/${team!.id}`, {
      headers: getAuthHeader(),
      data: { logoUrl: null },
    });
    expect(clearResponse.ok(), await clearResponse.text()).toBeTruthy();
    expect((await clearResponse.json()).team.logoUrl).toBeNull();

    expect((await request.get(uploaded.logoUrl)).status()).toBe(404);
    await deleteTeam(request, team!.id);
  });
});

