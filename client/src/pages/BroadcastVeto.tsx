import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import { getMapDisplayName, getMapFullImageUrl } from '../constants/maps';
import type { VetoAction, VetoMapResult, VetoState } from '../types/veto.types';
import { DEFAULT_BRANDING, useBranding } from '../contexts/BrandingContext';

type VetoApiResponse = {
  success: boolean;
  veto?: VetoState;
  maps?: Array<{ id: string; displayName: string; imageUrl: string | null }>;
  teamLogos?: { team1?: string | null; team2?: string | null };
  error?: string;
};

type MapMetadata = { displayName: string; imageUrl: string | null };

type MapStage = 'available' | 'banned' | 'picked' | 'decider';

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

const actionLabel = (action: VetoAction['action']) => {
  if (action === 'side_pick') return 'SIDE PICK';
  return action.toUpperCase();
};

const formatLabel = (format: VetoState['format']) => format.toUpperCase().replace('BO', 'BEST OF ');

export default function BroadcastVeto() {
  const { branding } = useBranding();
  const { matchSlug } = useParams<{ matchSlug: string }>();
  const [veto, setVeto] = useState<VetoState | null>(null);
  const [maps, setMaps] = useState<Map<string, MapMetadata>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [waiting, setWaiting] = useState(false);
  const [teamLogos, setTeamLogos] = useState({ team1: null as string | null, team2: null as string | null });
  const generationRef = useRef(0);
  const hasLoadedRef = useRef(false);

  const loadVeto = useCallback(
    async (showLoading = true) => {
      const generation = ++generationRef.current;
      if (showLoading) setLoading(true);
      setError('');

      try {
        const endpoint = matchSlug
          ? `/api/veto/${matchSlug}?broadcast=1`
          : '/api/integrations/jts-hud/broadcast-veto';
        const response = await fetch(endpoint);
        const data = (await response.json()) as VetoApiResponse;
        if (generation !== generationRef.current) return;

        if (response.status === 404 || response.status === 423) {
          setWaiting(true);
          setVeto(null);
          return;
        }
        if (!data.success || !data.veto) {
          setError(data.error || 'Veto is not available yet');
          return;
        }

        hasLoadedRef.current = true;
        setWaiting(false);
        setVeto(normalizeVetoState(data.veto));
        setTeamLogos({ team1: data.teamLogos?.team1 || null, team2: data.teamLogos?.team2 || null });
        const nextMaps = new Map<string, MapMetadata>();
        for (const map of data.maps || []) {
          nextMaps.set(map.id, { displayName: map.displayName, imageUrl: map.imageUrl });
        }
        setMaps(nextMaps);
      } catch {
        if (generation !== generationRef.current) return;
        setError('Could not load the broadcast veto state');
      } finally {
        if (generation === generationRef.current) setLoading(false);
      }
    },
    [matchSlug],
  );

  useEffect(() => {
    void loadVeto();

    const socket = io();
    const refresh = () => void loadVeto(false);

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
      setError('');
      setLoading(false);
      if (!hasLoadedRef.current) refresh();
    });

    return () => {
      socket.close();
    };
  }, [loadVeto, matchSlug]);

  const mapOrder = useMemo(() => {
    if (!veto) return [];
    const names = veto.allMaps?.length
      ? veto.allMaps
      : [
          ...veto.availableMaps,
          ...veto.bannedMaps,
          ...veto.pickedMaps.map((map) => map.mapName),
        ];
    return [...new Set(names.length > 0 ? names : maps.keys())];
  }, [maps, veto]);

  const latestAction = veto?.actions.at(-1);
  const pickedByMap = useMemo(
    () => new Map(veto?.pickedMaps.map((map) => [map.mapName, map]) || []),
    [veto?.pickedMaps],
  );

  const getMapStage = (mapName: string): MapStage => {
    if (veto?.bannedMaps.includes(mapName)) return 'banned';
    const picked = pickedByMap.get(mapName);
    if (picked) return picked.pickedBy === 'decider' ? 'decider' : 'picked';
    return 'available';
  };

  const getMapCaption = (mapName: string, stage: MapStage) => {
    if (stage === 'banned') {
      const action = veto?.actions.find((entry) => entry.action === 'ban' && entry.mapName === mapName);
      return action ? `BAN · ${teamName(action.team)}` : 'BAN';
    }
    const picked = pickedByMap.get(mapName);
    if (stage === 'decider') {
      if (picked?.knifeRound) return 'KNIFE ROUND';
      return picked?.sideTeam1
        ? `${veto?.team1Name || 'TEAM 1'} · STARTS ${picked.sideTeam1}`
        : 'DECIDER';
    }
    if (picked) {
      const side = picked.sideTeam1 ? ` · ${veto?.team1Name || 'TEAM 1'} STARTS ${picked.sideTeam1}` : '';
      return `${teamName(picked.pickedBy)}${side}`;
    }
    return veto?.status === 'completed' ? 'NOT PLAYED' : 'IN THE POOL';
  };

  const teamName = (team: VetoAction['team'] | VetoMapResult['pickedBy']) => {
    if (team === 'team1') return veto?.team1Name || 'TEAM 1';
    if (team === 'team2') return veto?.team2Name || 'TEAM 2';
    return 'DECIDER';
  };

  if (loading && !veto) {
    return <BroadcastShell><div className="veto-loading">CONNECTING TO VETO FEED</div></BroadcastShell>;
  }

  if (error && !veto) {
    return <BroadcastShell><div className="veto-error">{error.toUpperCase()}</div></BroadcastShell>;
  }

  if (waiting && !veto) {
    return <BroadcastShell><StandbyScreen /></BroadcastShell>;
  }

  if (!veto) {
    return <BroadcastShell><div className="veto-error">VETO FEED UNAVAILABLE</div></BroadcastShell>;
  }

  const activeTeam = veto.currentTurn;
  const isComplete = veto.status === 'completed';
  const hasLiveTurn = veto.availableMaps.length > 0 || veto.actions.length > 0;

  return (
    <BroadcastShell>
      <main className="veto-show" data-testid="broadcast-veto-show">
        <header className="veto-header">
          <div className="veto-brand">
            <img src={branding.logoUrl} alt="" />
            <b>{branding.displayName}</b> <span>LIVE VETO</span>
          </div>
          <div className="veto-format">{formatLabel(veto.format)}</div>
          <div className={`veto-status ${isComplete ? 'complete' : ''}`}>
            <i /> {isComplete ? 'VETO COMPLETE' : 'LIVE'}
          </div>
        </header>

        <section className="matchup">
          <TeamBanner team="team1" name={veto.team1Name || 'TEAM 1'} logoUrl={teamLogos.team1} active={!isComplete && hasLiveTurn && activeTeam === 'team1'} />
          <div className="versus"><span>VS</span><small>MAP VETO</small></div>
          <TeamBanner team="team2" name={veto.team2Name || 'TEAM 2'} logoUrl={teamLogos.team2} active={!isComplete && hasLiveTurn && activeTeam === 'team2'} />
        </section>

        <section className="veto-turn" aria-live="polite">
          {isComplete ? (
            <><strong>MAP POOL LOCKED</strong><span>THE SERIES IS READY</span></>
          ) : hasLiveTurn ? (
            <><strong>{teamName(activeTeam)} TO {actionLabel(veto.currentAction)}</strong><span>STEP {veto.currentStep} OF {veto.totalSteps}</span></>
          ) : (
            <><strong>WAITING FOR FIRST ACTION</strong><span>LIVE FEED CONNECTED</span></>
          )}
        </section>

        <section className="map-grid" aria-label="Veto map pool">
          {mapOrder.map((mapName) => {
            const stage = getMapStage(mapName);
            const isLatest = latestAction?.mapName === mapName;
            const metadata = maps.get(mapName);
            const image = metadata?.imageUrl || getMapFullImageUrl(mapName);
            const picked = pickedByMap.get(mapName);
            const pickedLogo = picked?.pickedBy === 'team1'
              ? teamLogos.team1
              : picked?.pickedBy === 'team2'
                ? teamLogos.team2
                : null;
            return (
              <article
                className={`map-card ${stage} ${isLatest ? 'latest' : ''}`}
                key={`${mapName}-${stage}-${isLatest ? latestAction?.step : 'stable'}`}
                data-testid={`broadcast-veto-map-${mapName}`}
              >
                <img src={image} alt="" />
                <div className="map-shade" />
                <div className="map-stage">
                  <span>{metadata?.displayName || getMapDisplayName(mapName)}</span>
                  {isLatest && <b>LIVE</b>}
                </div>
                {pickedLogo && (
                  <div className="map-team-mark">
                    <img src={pickedLogo} alt="" />
                  </div>
                )}
                <div className="map-info">
                  <strong>{stage === 'available' ? 'AVAILABLE' : stage === 'banned' ? 'BAN' : stage === 'picked' ? 'PICK' : 'DECIDER'}</strong>
                  <p>{getMapCaption(mapName, stage)}</p>
                </div>
              </article>
            );
          })}
        </section>

        <section className="veto-timeline" aria-label="Veto action timeline">
          {(veto.actions || []).map((action) => (
            <div className={`timeline-action ${action.team}`} key={`${action.step}-${action.action}-${action.mapName}`}>
              <span>{String(action.step).padStart(2, '0')}</span>
              <strong>{teamName(action.team)}</strong>
              <em>{actionLabel(action.action)}</em>
              <b>{action.mapName ? getMapDisplayName(action.mapName) : action.side || ''}</b>
            </div>
          ))}
        </section>
      </main>
    </BroadcastShell>
  );
}

function TeamBanner({ team, name, logoUrl, active }: { team: 'team1' | 'team2'; name: string; logoUrl: string | null; active: boolean }) {
  const monogram = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  return (
    <div className={`team-banner ${team} ${active ? 'active' : ''}`}>
      <div className="team-indicator" />
      <div className="team-crest"><b>{monogram || 'TM'}</b>{logoUrl && <img src={logoUrl} alt="" onError={(event) => { event.currentTarget.style.display = 'none'; }} />}</div>
      <span>{name}</span>
      {active && <small>ON THE CLOCK</small>}
    </div>
  );
}

function StandbyScreen() {
  const { branding } = useBranding();
  return <main className="veto-standby" data-testid="broadcast-veto-standby"><div className="standby-kicker">{branding.displayName} BROADCAST</div><div className="standby-mark"><i /><i /><i /></div><h1>VETO DESK</h1><h2>WAITING FOR THE NEXT MATCH</h2><p>LIVE FEED STANDING BY</p><div className="standby-line"><span>{branding.displayName} CONNECTED</span><b>•</b><span>OPEN VETO TO BEGIN</span></div></main>;
}

function BroadcastShell({ children }: { children: ReactNode }) {
  const { branding } = useBranding();
  const isDefaultBranding =
    branding.primaryColor === DEFAULT_BRANDING.primaryColor &&
    branding.secondaryColor === DEFAULT_BRANDING.secondaryColor;
  return (
    <div
      className="broadcast-veto-root"
      style={{
        // Keep the existing broadcast palette until an operator chooses custom colors.
        '--brand-primary': isDefaultBranding ? '#47B5FF' : branding.primaryColor,
        '--brand-secondary': isDefaultBranding ? '#FFB44A' : branding.secondaryColor,
      } as CSSProperties}
    >
      <style>{broadcastStyles}</style>
      {children}
    </div>
  );
}

const broadcastStyles = `
  .broadcast-veto-root { min-height: 100vh; color: #f4f7fb; background: radial-gradient(circle at 50% -20%, #263956 0%, #111827 38%, #070b12 100%); font-family: Inter, Roboto, Arial, sans-serif; overflow: hidden; }
  .veto-show { min-height: 100vh; box-sizing: border-box; padding: 3.25vh 4.2vw 2.6vh; background-image: linear-gradient(rgba(93, 143, 188, .05) 1px, transparent 1px), linear-gradient(90deg, rgba(93, 143, 188, .05) 1px, transparent 1px); background-size: 52px 52px; }
  .veto-header { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; border-bottom: 1px solid rgba(151, 184, 222, .25); padding-bottom: 2.1vh; text-transform: uppercase; letter-spacing: .13em; font-weight: 800; }
  .veto-brand { font-size: clamp(13px, 1.1vw, 22px); color: #f1f4f8; }.veto-brand span { color: #76c8ff; margin-left: .55em; }.veto-format { font-size: clamp(16px, 1.35vw, 27px); padding: .45em 1.2em; border: 1px solid rgba(126, 197, 255, .55); color: #a9dbff; }.veto-status { justify-self: end; color: #70e8a7; font-size: clamp(11px, .85vw, 17px); }.veto-status i { display: inline-block; height: .68em; width: .68em; border-radius: 50%; margin-right: .4em; background: currentColor; box-shadow: 0 0 16px currentColor; animation: vetoLivePulse 1.8s infinite; }.veto-status.complete { color: #ffd16b; }
  .matchup { display: grid; grid-template-columns: 1fr 150px 1fr; align-items: center; gap: 2vw; max-width: 1580px; margin: 3.3vh auto 2vh; }.team-banner { display: flex; align-items: center; gap: 1.1vw; min-width: 0; padding: 1.8vh 1.7vw; border: 1px solid rgba(255,255,255,.12); background: linear-gradient(110deg, rgba(255,255,255,.06), transparent); position: relative; }.team-banner.team2 { flex-direction: row-reverse; text-align: right; }.team-banner span { font-size: clamp(23px, 2.55vw, 52px); font-weight: 950; letter-spacing: -.045em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }.team-indicator { width: 8px; min-height: 3.1em; background: #47b5ff; box-shadow: 0 0 25px #47b5ff; }.team2 .team-indicator { background: #ffb44a; box-shadow: 0 0 25px #ffb44a; }.team-banner small { position: absolute; right: 1.25vw; bottom: -.9em; padding: .3em .6em; color: #07111c; background: #bde8ff; font-size: 10px; font-weight: 900; letter-spacing: .13em; }.team2 small { right: auto; left: 1.25vw; background: #ffdb9f; }.team-banner.active { border-color: rgba(255,255,255,.75); box-shadow: inset 0 0 35px rgba(255,255,255,.08), 0 0 30px rgba(255,255,255,.07); animation: teamOnClock 1.7s infinite; }.versus { text-align: center; }.versus span { display: block; color: #dae4ef; font-size: clamp(25px, 2.3vw, 47px); font-weight: 950; font-style: italic; }.versus small { color: #7f98b3; font-size: 10px; letter-spacing: .18em; }
  .veto-turn { display: flex; align-items: baseline; justify-content: center; gap: 1.2em; margin: 1vh 0 3vh; text-transform: uppercase; }.veto-turn strong { font-size: clamp(17px, 1.5vw, 30px); letter-spacing: .08em; }.veto-turn span { color: #83a0bc; font-size: clamp(10px, .8vw, 16px); letter-spacing: .12em; }
  .map-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 1.15vw; max-width: 1800px; margin: 0 auto; }.map-card { min-height: clamp(145px, 20vh, 295px); position: relative; overflow: hidden; isolation: isolate; border: 1px solid rgba(180, 211, 240, .25); background: #0d1724; transform: translateZ(0); }.map-card img, .map-shade { position: absolute; inset: 0; height: 100%; width: 100%; object-fit: cover; }.map-card img { opacity: .82; transition: transform .6s ease, filter .6s ease; }.map-shade { background: linear-gradient(0deg, rgba(5,8,14,.93), rgba(5,8,14,.05) 78%); }.map-info, .map-stage { position: absolute; z-index: 1; left: 1.15vw; right: 1.15vw; }.map-info { bottom: 1.45vh; }.map-info h2 { margin: 0; font-size: clamp(20px, 1.65vw, 34px); font-weight: 950; letter-spacing: -.035em; }.map-info p { margin: .35em 0 0; color: #afc0d2; font-size: clamp(9px, .72vw, 14px); font-weight: 800; letter-spacing: .08em; }.map-stage { top: 1.1vh; color: #dcebf8; font-size: 11px; letter-spacing: .15em; font-weight: 950; }.map-card.banned { border-color: rgba(255, 88, 96, .65); }.map-card.banned img { filter: grayscale(1) contrast(1.25); transform: scale(1.08); }.map-card.banned .map-shade { background: linear-gradient(0deg, rgba(57, 5, 11, .95), rgba(84, 10, 17, .46)); }.map-card.banned .map-stage { color: #ff8188; }.map-card.picked { border-color: rgba(71, 181, 255, .9); box-shadow: 0 0 26px rgba(71,181,255,.22); }.map-card.picked .map-shade { background: linear-gradient(0deg, rgba(4, 24, 43, .94), rgba(14, 84, 132, .17)); }.map-card.picked .map-stage { color: #8cdaff; }.map-card.decider { border-color: rgba(255, 207, 92, .9); box-shadow: 0 0 27px rgba(255,207,92,.19); }.map-card.decider .map-shade { background: linear-gradient(0deg, rgba(51, 35, 4, .94), rgba(133, 93, 9, .12)); }.map-card.decider .map-stage { color: #ffe08e; }.map-card.latest { animation: mapActionReveal .85s cubic-bezier(.16,1,.3,1) both; }
  .veto-timeline { display: flex; justify-content: center; flex-wrap: wrap; gap: .55vw; max-width: 1800px; margin: 2.7vh auto 0; }.timeline-action { display: flex; align-items: center; gap: .55em; padding: .45em .75em; border: 1px solid rgba(255,255,255,.12); background: rgba(5,10,17,.58); font-size: clamp(9px, .7vw, 14px); letter-spacing: .045em; }.timeline-action > span { color: #85a3bf; }.timeline-action strong { color: #a9dbff; }.timeline-action.team2 strong { color: #ffcf8b; }.timeline-action em { font-style: normal; color: #fff; font-weight: 900; }.timeline-action b { color: #b8c7d7; }
  .team-crest { width: clamp(58px,5vw,96px); height: clamp(58px,5vw,96px); flex: 0 0 auto; display:grid; place-items:center; background:linear-gradient(145deg,rgba(255,255,255,.12),rgba(255,255,255,.025)); border:1px solid rgba(255,255,255,.22); clip-path:polygon(10% 0,100% 0,90% 100%,0 100%); filter:drop-shadow(0 12px 22px rgba(0,0,0,.42)); }.team-crest img { width:78%;height:78%;object-fit:contain; }.team-crest b { font-size:clamp(20px,2vw,38px);font-style:italic;color:#d9efff; }.team2 .team-crest b { color:#ffe0a6; }
  .veto-standby { min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;position:relative;background:linear-gradient(115deg,transparent 0 43%,rgba(73,174,255,.06) 43% 50%,transparent 50% 57%,rgba(255,180,74,.045) 57% 64%,transparent 64%),repeating-linear-gradient(90deg,rgba(255,255,255,.025) 0 1px,transparent 1px 86px); }.veto-standby:before,.veto-standby:after{content:'';position:absolute;width:28vw;height:2px;top:50%;background:linear-gradient(90deg,transparent,#56bfff);}.veto-standby:before{right:63%;}.veto-standby:after{left:63%;transform:scaleX(-1);}.standby-kicker{font-size:clamp(11px,.8vw,16px);letter-spacing:.34em;color:#77c9ff;font-weight:800;margin-bottom:2.8vh}.standby-mark{display:flex;gap:8px;margin-bottom:1.8vh}.standby-mark i{display:block;width:9px;height:42px;background:#63c2ff;transform:skew(-18deg);box-shadow:0 0 20px rgba(99,194,255,.55)}.standby-mark i:nth-child(2){height:58px;background:#f4f7fb}.standby-mark i:nth-child(3){background:#ffb44a;box-shadow:0 0 20px rgba(255,180,74,.45)}.veto-standby h1{margin:0;font-size:clamp(54px,6vw,118px);font-style:italic;letter-spacing:-.055em;line-height:.85}.veto-standby h2{margin:3vh 0 .8vh;font-size:clamp(15px,1.25vw,25px);letter-spacing:.18em}.veto-standby p{margin:0;color:#859db5;font-size:clamp(10px,.72vw,14px);letter-spacing:.3em}.standby-line{position:absolute;bottom:6vh;display:flex;gap:1.1em;align-items:center;color:#88a5bf;font-size:11px;letter-spacing:.18em}.standby-line b{color:#66e2a1;text-shadow:0 0 12px #66e2a1}
  /* Broadcast refinement: restrained scoreboard geometry, no decorative skew. */
  .broadcast-veto-root { background:#080d15; }
  .veto-show { background:radial-gradient(circle at 50% 0,rgba(40,65,96,.42),transparent 42%),linear-gradient(180deg,#0d1522 0,#080d15 100%); }
  .veto-header { max-width:1760px;margin:0 auto;border-bottom-color:rgba(150,176,205,.2); }
  .veto-brand { letter-spacing:.08em; }.veto-format { background:rgba(34,58,86,.55);border-color:#527699;letter-spacing:.06em; }.veto-status i { box-shadow:none; }
  .matchup { grid-template-columns:minmax(0,1fr) 112px minmax(0,1fr);gap:22px;max-width:1540px;margin-top:34px; }
  .team-banner { min-height:126px;box-sizing:border-box;padding:18px 28px;gap:24px;background:rgba(13,22,34,.92);border:0;border-bottom:4px solid #47b5ff;box-shadow:0 15px 35px rgba(0,0,0,.24); }
  .team-banner.team2 { border-bottom-color:#ffb44a; }.team-banner.active { border-color:#47b5ff;box-shadow:0 15px 35px rgba(0,0,0,.24),inset 0 -10px 30px rgba(71,181,255,.08);animation:none; }.team-banner.team2.active { border-color:#ffb44a;box-shadow:0 15px 35px rgba(0,0,0,.24),inset 0 -10px 30px rgba(255,180,74,.08); }
  .team-indicator { display:none; }.team-banner span { font-size:clamp(24px,2.15vw,43px);font-weight:850;letter-spacing:-.025em; }.team-banner small { right:18px;bottom:0;transform:translateY(50%);font-size:9px;box-shadow:0 5px 14px rgba(0,0,0,.35); }.team2 small { left:18px;right:auto; }
  .team-crest { position:relative;width:96px;height:96px;clip-path:none;filter:none;border:0;background:transparent;overflow:hidden; }.team-crest b { position:absolute;inset:0;display:grid;place-items:center;border:1px solid rgba(120,181,224,.45);background:#101e2c;font-size:30px;font-style:normal;letter-spacing:.04em; }.team2 .team-crest b { border-color:rgba(255,180,74,.45);background:#251d13; }.team-crest img { position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#101722; }
  .versus span { font-size:34px;font-style:normal;letter-spacing:-.04em; }.versus small { font-size:9px; }
  .veto-turn { margin:18px 0 28px; }.veto-turn strong { font-size:clamp(18px,1.35vw,27px);letter-spacing:.045em; }
  .map-grid { grid-template-columns:repeat(7,minmax(0,1fr));gap:10px; }.map-card { border-color:rgba(136,163,191,.28);box-shadow:0 12px 28px rgba(0,0,0,.22);background:radial-gradient(circle at 70% 20%,#16283a,#0b1420 65%); }.map-card img { opacity:.76; }.map-info h2 { font-weight:850; }.map-stage { letter-spacing:.09em; }
  .map-grid { grid-template-columns:repeat(7,minmax(0,1fr)); max-width:1500px; gap:12px; padding:0; background:transparent; }
  .map-card { min-height:clamp(190px,24vh,250px); border-radius:20px; border:1px solid rgba(255,255,255,.3); box-shadow:0 15px 35px rgba(0,0,0,.42); }
  .map-card img { opacity:.78; transition:transform .7s ease, opacity .7s ease, filter .7s ease; }
  .map-card:hover img { transform:scale(1.06); opacity:.9; }
  .map-card.banned { border-color:rgba(255,132,142,.8); }.map-card.banned .map-shade { background:linear-gradient(180deg,rgba(42,12,18,.25),rgba(67,10,18,.82)); }
  .map-card.picked { border-color:rgba(68,207,168,.9); box-shadow:0 0 0 1px rgba(68,207,168,.18),0 15px 35px rgba(0,0,0,.42); }.map-card.picked .map-shade { background:linear-gradient(180deg,rgba(7,27,28,.15),rgba(4,45,37,.72)); }
  .map-card.decider { border-color:rgba(255,207,92,.9); }.map-card.decider .map-shade { background:linear-gradient(180deg,rgba(40,30,8,.2),rgba(76,52,7,.8)); }
  .map-stage { top:14px; left:14px; right:14px; display:flex; align-items:center; justify-content:space-between; gap:8px; font-size:11px; letter-spacing:.13em; }
  .map-stage span { padding:6px 9px; border-radius:7px; background:rgba(7,11,15,.72); color:#f0f5f8; box-shadow:0 5px 14px rgba(0,0,0,.24); }
  .map-stage b { padding:6px 9px; border-radius:999px; background:rgba(82,212,166,.8); color:#071713; font-size:10px; letter-spacing:.12em; box-shadow:0 0 16px rgba(82,212,166,.45); }
  .map-team-mark { position:absolute; z-index:1; inset:26% 20% 24%; display:grid; place-items:center; pointer-events:none; }
  .map-team-mark img { position:static; width:min(58%,110px); height:min(58%,110px); object-fit:contain; opacity:1; filter:drop-shadow(0 8px 12px rgba(0,0,0,.7)); }
  .map-info { left:14px; right:14px; bottom:15px; display:flex; flex-direction:column; align-items:flex-start; gap:5px; }
  .map-info strong { padding:6px 10px; border:1px solid currentColor; border-radius:7px; background:rgba(7,11,15,.62); color:#f3f7fa; font-size:10px; letter-spacing:.14em; }
  .map-card.banned .map-info strong { color:#ffb3bb; }.map-card.picked .map-info strong { color:#9bf1d2; }.map-card.decider .map-info strong { color:#ffe59a; }
  .map-info p { max-width:100%; margin:0; color:#f4f7fb; font-size:clamp(9px,.66vw,13px); letter-spacing:.08em; font-weight:850; line-height:1.25; text-shadow:0 2px 7px rgba(0,0,0,.8); }
  .timeline-action { border:0;border-left:2px solid #47789e;background:rgba(15,25,38,.86); }.timeline-action.team2 { border-left-color:#b67a2e; }
  .veto-standby { background:radial-gradient(circle at 50% 42%,rgba(40,69,101,.32),transparent 34%),#080d15; }.veto-standby:before,.veto-standby:after { width:22vw;background:linear-gradient(90deg,transparent,rgba(89,151,197,.48)); }.standby-mark { display:none; }.veto-standby h1 { font-size:clamp(50px,5vw,96px);font-style:normal;font-weight:850;letter-spacing:-.035em;line-height:1; }.veto-standby h2 { margin-top:24px;font-size:clamp(14px,1vw,20px);letter-spacing:.12em;font-weight:700; }.standby-kicker { margin-bottom:18px;letter-spacing:.2em;color:#77b8e5; }
  .veto-loading, .veto-error { display: grid; place-items: center; min-height: 100vh; color: #b8dbf7; letter-spacing: .18em; font-weight: 900; }.veto-error { color: #ff9ca2; }
  @keyframes vetoLivePulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: .3; transform: scale(.65); } } @keyframes teamOnClock { 0%,100% { box-shadow: inset 0 0 35px rgba(255,255,255,.08), 0 0 10px rgba(255,255,255,.06); } 50% { box-shadow: inset 0 0 35px rgba(255,255,255,.16), 0 0 36px rgba(255,255,255,.18); } } @keyframes mapActionReveal { 0% { transform: scale(1.13); opacity: .15; filter: brightness(2); } 100% { transform: scale(1); opacity: 1; filter: brightness(1); } }
  @media (max-width: 800px) { .veto-show { padding: 22px 16px; }.veto-header { grid-template-columns: 1fr auto; gap: 12px; }.veto-format { grid-row: 2; }.veto-status { grid-row: 2; }.matchup { grid-template-columns: 1fr; gap: 12px; }.team-banner.team2 { flex-direction: row; text-align: left; }.team2 small { left: auto; right: 1.25vw; }.versus { order: 1; }.team-banner.team2 { order: 2; }.map-grid { grid-template-columns: repeat(2, 1fr); gap: 10px; }.map-card { min-height: 135px; }.map-info, .map-stage { left: 12px; right: 12px; } }
  .veto-brand { display:flex; align-items:center; gap:.6em; }.veto-brand img { width:1.7em; height:1.7em; object-fit:contain; }.veto-brand span { color:var(--brand-primary); }.team-indicator { background:var(--brand-primary); box-shadow:0 0 25px var(--brand-primary); }.team2 .team-indicator { background:var(--brand-secondary); box-shadow:0 0 25px var(--brand-secondary); }.team-banner small { background:var(--brand-primary); }.team2 small { background:var(--brand-secondary); }.standby-kicker { color:var(--brand-primary); }.standby-mark i:first-child { background:var(--brand-primary); }.standby-mark i:nth-child(3) { background:var(--brand-secondary); }
`;
