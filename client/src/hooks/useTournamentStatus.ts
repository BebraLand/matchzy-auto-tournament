import { useCallback, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { api } from '../utils/api';
import type { Tournament, TournamentResponse } from '../types';

interface UseTournamentStatusResult {
  tournament: Tournament | null;
  status: Tournament['status'] | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export const useTournamentStatus = (): UseTournamentStatusResult => {
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [status, setStatus] = useState<Tournament['status'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTournament = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await api.get<TournamentResponse & { tournament?: Tournament }>(
        '/api/tournament'
      );

      if (response.success && response.tournament) {
        setTournament(response.tournament);
        setStatus(response.tournament.status);
      } else {
        setTournament(null);
        setStatus(null);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load tournament status';
      setError(message);
      setTournament(null);
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchTournament();
  }, [fetchTournament]);

  useEffect(() => {
    const socket = io();
    const handleTournamentUpdate = () => {
      void fetchTournament();
    };

    socket.on('tournament:update', handleTournamentUpdate);
    return () => {
      socket.off('tournament:update', handleTournamentUpdate);
      socket.close();
    };
  }, [fetchTournament]);

  return {
    tournament,
    status,
    loading,
    error,
    refresh: fetchTournament,
  };
};

