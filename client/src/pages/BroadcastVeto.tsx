import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import type { VetoState } from '../types/veto.types';
import { useBranding } from '../contexts/BrandingContext';
import { VetoDesignCanvas, defaultVetoDesign, type VetoDesign } from '../components/veto/VetoDesignCanvas';

type VetoApiResponse = {
  success: boolean;
  veto?: VetoState;
  maps?: Array<{ id: string; displayName: string; imageUrl: string | null }>;
  teamLogos?: { team1?: string | null; team2?: string | null };
  error?: string;
};

type MapMetadata = { displayName: string; imageUrl: string | null };

function normalizeVetoState(raw: Partial<VetoState>): VetoState {
  return {
    matchSlug: raw.matchSlug || '',
    format: raw.format || 'bo1',
    status: raw.status || 'pending',
    currentStep: typeof raw.currentStep === 'number' ? raw.currentStep : 1,
    totalSteps: typeof raw.totalSteps === 'number' ? raw.totalSteps : 0,
    availableMaps: Array.isArray(raw.availableMaps) ? raw.availableMaps : [],
    bannedMaps: Array.isArray(raw.bannedMaps) ? raw.bannedMaps : [],
    pickedMaps: Array.isArray(raw.pickedMaps) ? raw.pickedMaps : [],
    allMaps: Array.isArray(raw.allMaps) ? raw.allMaps : undefined,
    actions: Array.isArray(raw.actions) ? raw.actions : [],
    currentTurn: raw.currentTurn || 'team1',
    currentAction: raw.currentAction || 'ban',
    team1Id: raw.team1Id,
    team2Id: raw.team2Id,
    team1Name: raw.team1Name,
    team2Name: raw.team2Name,
    completedAt: raw.completedAt,
  };
}

export default function BroadcastVeto() {
  const { branding, refreshBranding } = useBranding();
  const { matchSlug } = useParams<{ matchSlug: string }>();
  const [veto, setVeto] = useState<VetoState | null>(null);
  const [maps, setMaps] = useState<Map<string, MapMetadata>>(new Map());
  const [teamLogos, setTeamLogos] = useState({ team1: null as string | null, team2: null as string | null });
  const [tournamentName, setTournamentName] = useState('');
  // The published design is optional. A fresh installation must still use the
  // exact same renderer and layout as the designer instead of the legacy view.
  const [design, setDesign] = useState<VetoDesign>(defaultVetoDesign);
  const generationRef = useRef(0);
  const hasLoadedRef = useRef(false);

  const loadVeto = useCallback(
    async () => {
      const generation = ++generationRef.current;

      try {
        const endpoint = matchSlug
          ? `/api/veto/${matchSlug}?broadcast=1`
          : '/api/integrations/jts-hud/broadcast-veto';
        const response = await fetch(endpoint, { cache: 'no-store' });
        const data = (await response.json()) as VetoApiResponse;
        if (generation !== generationRef.current) return;

        if (response.status === 404 || response.status === 423) {
          setVeto(null);
          return;
        }
        if (!data.success || !data.veto) {
          return;
        }

        hasLoadedRef.current = true;
        setVeto(normalizeVetoState(data.veto));
        setTeamLogos({ team1: data.teamLogos?.team1 || null, team2: data.teamLogos?.team2 || null });
        const nextMaps = new Map<string, MapMetadata>();
        for (const map of data.maps || []) {
          nextMaps.set(map.id, { displayName: map.displayName, imageUrl: map.imageUrl });
        }
        setMaps(nextMaps);
      } catch { /* Keep the same canvas during a brief disconnect. */ }
    },
    [matchSlug],
  );

  useEffect(() => {
    let active = true;
    const loadDesign = async () => {
      try {
        const response = await fetch('/api/broadcast-veto-design/published', { cache: 'no-store' });
        if (!response.ok) return;
        const data = await response.json() as { design: VetoDesign | null; tournamentName?: string };
        if (active) { if (data.design) setDesign(data.design); setTournamentName(data.tournamentName || ''); }
      } catch { /* Keep the last published design during a brief disconnect. */ }
    };
    void loadDesign();
    const timer = window.setInterval(() => {
      void loadDesign();
      void loadVeto();
      void refreshBranding();
    }, 3000);
    return () => { active = false; window.clearInterval(timer); };
  }, [loadVeto, refreshBranding]);

  useEffect(() => {
    void loadVeto();

    const socket = io();
    const refresh = () => void loadVeto();

    socket.on('connect', refresh);
    socket.on('tournament:update', refresh);
    socket.on(matchSlug ? `match:update:${matchSlug}` : 'match:update', refresh);
    socket.on(matchSlug ? `veto:update:${matchSlug}` : 'veto:update', (nextVeto: VetoState | null) => {
      // The stable /broadcast/veto URL follows whichever match MAT has selected.
      // Global events can belong to the previous selection, so resolve the
      // current projection again instead of rendering an event blindly.
      if (!matchSlug) {
        refresh();
        return;
      }
      if (!nextVeto) {
        refresh();
        return;
      }

      generationRef.current += 1;
      setVeto(normalizeVetoState(nextVeto));
      if (!hasLoadedRef.current) refresh();
    });

    return () => {
      socket.close();
    };
  }, [loadVeto, matchSlug]);

  return <div style={{ width: '100vw', height: '100vh', background: '#080d15' }} data-testid={veto ? 'broadcast-veto-show' : 'broadcast-veto-standby'}><VetoDesignCanvas design={design} screen={!veto ? 'standby' : veto.status === 'completed' ? 'completed' : 'live'} veto={veto} branding={branding} tournamentName={tournamentName} maps={maps} logos={teamLogos} /></div>;
}
