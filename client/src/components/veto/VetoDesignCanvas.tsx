import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { getMapDisplayName, getMapFullImageUrl } from '../../constants/maps';
import type { VetoState } from '../../types/veto.types';
import type { BrandingSettings } from '../../types/api.types';
import { getVetoOrder } from '../../constants/vetoOrders';

export type VetoScreen = 'standby' | 'live' | 'completed';
export type VetoElementKind = 'text' | 'image' | 'shape' | 'line' | 'maps' | 'timeline';
export type VetoBinding = 'none' | 'brand' | 'tournamentName' | 'team1' | 'team2' | 'format' | 'status' | 'turn' | 'step' | 'team1Logo' | 'team2Logo' | 'brandLogo';
export type VetoTeamFallback = { mode: 'initials' | 'first-letter' | 'first-last' | 'full-name' | 'hidden'; maxLetters: number; background: string; color: string; borderColor: string; radius: number };
export type VetoElement = {
  id: string; kind: VetoElementKind; x: number; y: number; w: number; h: number;
  text?: string; imageUrl?: string; binding?: VetoBinding; color?: string;
  background?: string; borderColor?: string; fontSize?: number; radius?: number;
  opacity?: number; columns?: number; gap?: number; align?: 'left' | 'center' | 'right';
  weight?: 400 | 500 | 600 | 700 | 800 | 900; visible?: boolean;
  mapImages?: Record<string, string>;
  fontFamily?: 'Inter' | 'Arial' | 'Impact' | 'Georgia' | 'monospace';
};

export function restoreImageAspectRatio(element: Pick<VetoElement, 'x' | 'y' | 'w' | 'h'>, naturalWidth: number, naturalHeight: number): Pick<VetoElement, 'x' | 'y' | 'w' | 'h'> | null {
  if (!Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight) || naturalWidth <= 0 || naturalHeight <= 0) return null;
  const ratio = naturalWidth / naturalHeight;
  let w = Math.min(1920, Math.max(1, element.w));
  let h = w / ratio;
  if (h > 1080) { h = 1080; w = h * ratio; }
  const x = Math.max(0, Math.min(1920 - w, element.x + element.w / 2 - w / 2));
  const y = Math.max(0, Math.min(1080 - h, element.y + element.h / 2 - h / 2));
  return { x: Math.round(x), y: Math.round(y), w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) };
}

export type VetoSnapGuides = { x?: number; y?: number };
export type VetoSnapPeer = Pick<VetoElement, 'x' | 'y' | 'w' | 'h'>;
export function snapElementPosition(element: Pick<VetoElement, 'w' | 'h'>, desiredX: number, desiredY: number, threshold = 16, peers: VetoSnapPeer[] = [], includeCanvas = true): { x: number; y: number; guides: VetoSnapGuides } {
  const choose = (value: number, max: number, size: number, canvasSize: number, peerEdges: Array<[number, number]>) => {
    const clamped = Math.max(0, Math.min(max, value));
    const guides = [...(includeCanvas ? [0, canvasSize / 2, canvasSize] : []), ...peerEdges.flatMap(([start, end]) => [start, (start + end) / 2, end])];
    const candidates = guides.flatMap((guide) => [guide, guide - size / 2, guide - size]
      .filter((position) => position >= 0 && position <= max)
      .map((position) => ({ position, guide })));
    const nearest = candidates.reduce((best, candidate) => Math.abs(candidate.position - clamped) < Math.abs(best.position - clamped) ? candidate : best, candidates[0] || { position: clamped, guide: undefined as number | undefined });
    return Math.abs(nearest.position - clamped) <= threshold ? nearest : { position: clamped, guide: undefined };
  };
  const x = choose(desiredX, 1920 - element.w, element.w, 1920, peers.map((peer) => [peer.x, peer.x + peer.w]));
  const y = choose(desiredY, 1080 - element.h, element.h, 1080, peers.map((peer) => [peer.y, peer.y + peer.h]));
  const guides: VetoSnapGuides = {};
  if (x.guide !== undefined) guides.x = x.guide;
  if (y.guide !== undefined) guides.y = y.guide;
  return { x: Math.round(x.position), y: Math.round(y.position), guides };
}

export function nudgeElementPosition(element: Pick<VetoElement, 'x' | 'y' | 'w' | 'h'>, dx: number, dy: number): Pick<VetoElement, 'x' | 'y'> {
  return {
    x: Math.max(0, Math.min(1920 - element.w, element.x + dx)),
    y: Math.max(0, Math.min(1080 - element.h, element.y + dy)),
  };
}

export type VetoDistanceMeasurement = {
  axis: 'x' | 'y'; start: number; end: number; offset: number; value: number;
  side: 'left' | 'right' | 'top' | 'bottom'; source: 'canvas' | 'element';
};
export function measureElementGaps(element: VetoSnapPeer, peers: VetoSnapPeer[]): VetoDistanceMeasurement[] {
  const maxVisibleDistance = 640;
  const measurements: VetoDistanceMeasurement[] = [];
  const add = (measurement: Omit<VetoDistanceMeasurement, 'value'>) => {
    const value = measurement.end - measurement.start;
    if (value > 0 && value <= maxVisibleDistance) measurements.push({ ...measurement, value });
  };
  if (element.x > 0 && element.x <= maxVisibleDistance) add({ axis: 'x', start: 0, end: element.x, offset: element.y + element.h / 2, side: 'left', source: 'canvas' });
  if (1920 - element.x - element.w > 0 && 1920 - element.x - element.w <= maxVisibleDistance) add({ axis: 'x', start: element.x + element.w, end: 1920, offset: element.y + element.h / 2, side: 'right', source: 'canvas' });
  if (element.y > 0 && element.y <= maxVisibleDistance) add({ axis: 'y', start: 0, end: element.y, offset: element.x + element.w / 2, side: 'top', source: 'canvas' });
  if (1080 - element.y - element.h > 0 && 1080 - element.y - element.h <= maxVisibleDistance) add({ axis: 'y', start: element.y + element.h, end: 1080, offset: element.x + element.w / 2, side: 'bottom', source: 'canvas' });

  for (const peer of peers) {
    const overlapY = Math.min(element.y + element.h, peer.y + peer.h) - Math.max(element.y, peer.y);
    if (overlapY > 0) {
      if (peer.x + peer.w < element.x) add({ axis: 'x', start: peer.x + peer.w, end: element.x, offset: Math.max(element.y, peer.y) + overlapY / 2, side: 'left', source: 'element' });
      if (peer.x > element.x + element.w) add({ axis: 'x', start: element.x + element.w, end: peer.x, offset: Math.max(element.y, peer.y) + overlapY / 2, side: 'right', source: 'element' });
    }
    const overlapX = Math.min(element.x + element.w, peer.x + peer.w) - Math.max(element.x, peer.x);
    if (overlapX > 0) {
      if (peer.y + peer.h < element.y) add({ axis: 'y', start: peer.y + peer.h, end: element.y, offset: Math.max(element.x, peer.x) + overlapX / 2, side: 'top', source: 'element' });
      if (peer.y > element.y + element.h) add({ axis: 'y', start: element.y + element.h, end: peer.y, offset: Math.max(element.x, peer.x) + overlapX / 2, side: 'bottom', source: 'element' });
    }
  }
  // ponytail: keep one nearest canvas gap and one nearest element gap per side; raise 640 if layouts need longer rulers.
  return (['left', 'right', 'top', 'bottom'] as const).flatMap((side) => (['canvas', 'element'] as const).flatMap((source) => {
    const nearest = measurements.filter((item) => item.side === side && item.source === source).sort((a, b) => a.value - b.value)[0];
    return nearest ? [nearest] : [];
  }));
}

export type VetoLayout = { background: string; backgroundImage?: string; backgroundDim?: number; elements: VetoElement[] };
export type VetoDesign = { version: 1; screens: Record<VetoScreen, VetoLayout>; teamFallback?: VetoTeamFallback; showMapSideBadges?: boolean; showTimelineOwnership?: boolean; showActionOwnership?: boolean };
export type VetoMapMetadata = Map<string, { displayName: string; imageUrl: string | null }>;

export const defaultTeamFallback: VetoTeamFallback = { mode: 'initials', maxLetters: 2, background: '#101A27', color: '#9EB4C8', borderColor: '#64758A', radius: 8 };

const el = (id: string, kind: VetoElementKind, x: number, y: number, w: number, h: number, props: Partial<VetoElement> = {}): VetoElement => ({ id, kind, x, y, w, h, ...props });

export function defaultVetoDesign(): VetoDesign {
  const brand = el('brand', 'text', 100, 56, 1050, 54, { binding: 'brand', fontSize: 28, weight: 800, color: '#89CAFF' });
  const logo = el('logo', 'image', 42, 52, 50, 50, { binding: 'brandLogo' });
  return { version: 1, teamFallback: defaultTeamFallback, showMapSideBadges: false, showTimelineOwnership: false, screens: {
    standby: { background: '#0B1018', elements: [
      logo, brand,
      el('standby-title', 'text', 270, 390, 1380, 140, { text: 'VETO DESK', fontSize: 114, weight: 900, align: 'center' }),
      el('standby-subtitle', 'text', 300, 550, 1320, 50, { text: 'WAITING FOR THE NEXT MATCH', fontSize: 36, weight: 800, align: 'center' }),
      el('standby-caption', 'text', 500, 625, 920, 36, { text: 'LIVE FEED STANDING BY', fontSize: 22, color: '#A5B8CC', align: 'center' }),
    ] },
    live: { background: '#0B1018', elements: [
      logo, brand,
      el('format', 'text', 1410, 54, 340, 48, { binding: 'format', fontSize: 27, weight: 800, align: 'right' }),
      el('team1', 'text', 82, 200, 690, 105, { binding: 'team1', fontSize: 69, weight: 900, background: '#162232', align: 'center', radius: 8 }),
      el('team1-logo', 'image', 93, 204, 97, 97, { binding: 'team1Logo' }),
      el('versus', 'text', 815, 215, 290, 84, { text: 'VS', fontSize: 65, weight: 900, color: '#D6E0EA', align: 'center' }),
      el('team2', 'text', 1148, 200, 690, 105, { binding: 'team2', fontSize: 69, weight: 900, background: '#2B211A', align: 'center', radius: 8 }),
      el('team2-logo', 'image', 1728, 204, 97, 97, { binding: 'team2Logo' }),
      el('turn', 'text', 300, 347, 1320, 56, { binding: 'turn', fontSize: 34, weight: 800, align: 'center' }),
      el('maps', 'maps', 82, 447, 1756, 390, { columns: 7, gap: 12, background: '#0F1B29', borderColor: '#536A83', radius: 16 }),
      el('timeline', 'timeline', 82, 876, 1756, 95, { color: '#A9C4DB', fontSize: 19 }),
    ] },
    completed: { background: '#0B1018', elements: [
      logo, brand,
      el('completed-title', 'text', 300, 110, 1320, 88, { text: 'VETO COMPLETE', fontSize: 72, weight: 900, align: 'center' }),
      el('completed-match', 'text', 200, 228, 1520, 76, { text: '{team1}  VS  {team2}', fontSize: 52, weight: 900, align: 'center' }),
      el('completed-maps', 'maps', 82, 371, 1756, 435, { columns: 7, gap: 12, background: '#0F1B29', borderColor: '#536A83', radius: 16 }),
      el('completed-timeline', 'timeline', 82, 853, 1756, 100, { color: '#A9C4DB', fontSize: 19 }),
    ] },
  } };
}

export function previewVeto(scenario: string, format: VetoState['format']): VetoState | null {
  if (scenario === 'standby') return null;
  const allMaps = ['de_ancient', 'de_anubis', 'de_dust2', 'de_inferno', 'de_mirage', 'de_nuke', 'de_cache'];
  const order = getVetoOrder(format);
  const actionType = scenario === 'side' ? 'side_pick' : scenario;
  const target = scenario === 'pending' ? 0 : scenario === 'completed' ? order.length : scenario === 'ban' ? 1 : Math.max(1, order.findIndex((step) => step.action === actionType) + 1);
  const actions: VetoState['actions'] = [];
  let mapIndex = 0;
  let lastPicked = allMaps[0];
  for (const step of order.slice(0, target)) {
    const mapName = step.action === 'side_pick' ? (format === 'bo1' || format === 'bo3' && step.step === order.length ? allMaps[mapIndex] : lastPicked) : allMaps[mapIndex++];
    if (step.action === 'pick') lastPicked = mapName;
    actions.push({ step: step.step, team: step.team, action: step.action, mapName, side: step.action === 'side_pick' ? 'CT' : undefined, timestamp: 0 });
  }
  const bannedMaps = actions.filter((action) => action.action === 'ban').map((action) => action.mapName);
  const pickedMaps: VetoState['pickedMaps'] = actions.filter((action) => action.action === 'pick').map((action, index) => ({ mapNumber: index + 1, mapName: action.mapName, pickedBy: action.team, sideTeam1: actions.some((side) => side.action === 'side_pick' && side.mapName === action.mapName) ? 'T' : undefined, knifeRound: false }));
  if (scenario === 'completed') {
    const remaining = allMaps.filter((map) => !bannedMaps.includes(map) && !pickedMaps.some((pick) => pick.mapName === map));
    if (remaining[0]) pickedMaps.push({ mapNumber: pickedMaps.length + 1, mapName: remaining[0], pickedBy: 'decider', knifeRound: format === 'bo5' });
  }
  const next = order[Math.min(target, order.length - 1)];
  return { matchSlug: 'preview', format, status: scenario === 'completed' ? 'completed' : scenario === 'pending' ? 'pending' : 'in_progress', currentStep: Math.min(target + 1, order.length), totalSteps: order.length, allMaps, availableMaps: allMaps.filter((map) => !bannedMaps.includes(map) && !pickedMaps.some((pick) => pick.mapName === map)), bannedMaps, pickedMaps, actions, currentTurn: next.team, currentAction: next.action, team1Name: 'TEAM A', team2Name: 'TEAM B' };
}

function boundText(element: VetoElement, branding: BrandingSettings, veto: VetoState | null, tournamentName: string): string {
  const team1 = veto?.team1Name || 'TEAM A';
  const team2 = veto?.team2Name || 'TEAM B';
  const dynamic: Record<VetoBinding, string> = {
    none: element.text || '', brand: branding.displayName, tournamentName, team1, team2,
    format: veto ? `BEST OF ${veto.format.slice(2)}` : '',
    status: veto?.status === 'completed' ? 'VETO COMPLETE' : veto ? 'LIVE VETO' : 'WAITING FOR MATCH',
    turn: veto?.status === 'completed' ? 'MAP POOL LOCKED' : veto?.status === 'pending' ? 'WAITING FOR FIRST ACTION' : veto ? `${veto.currentTurn === 'team1' ? team1 : team2} TO ${veto.currentAction.toUpperCase().replace('_', ' ')}` : 'LIVE FEED STANDING BY',
    step: veto ? `STEP ${veto.currentStep} OF ${veto.totalSteps}` : '',
    team1Logo: '', team2Logo: '', brandLogo: '',
  };
  return (element.binding && element.binding !== 'none' ? dynamic[element.binding] : element.text || '')
    .replace(/\{team1\}/g, team1).replace(/\{team2\}/g, team2).replace(/\{brand\}/g, branding.displayName).replace(/\{tournament\}/g, tournamentName);
}

function imageSource(element: VetoElement, branding: BrandingSettings, logos: { team1: string | null; team2: string | null }): string | null {
  if (element.binding === 'brandLogo') return branding.logoUrl;
  if (element.binding === 'team1Logo') return logos.team1;
  if (element.binding === 'team2Logo') return logos.team2;
  return element.imageUrl || null;
}

function teamFallbackText(name: string, fallback: VetoTeamFallback): string {
  if (fallback.mode === 'hidden') return '';
  const clean = name.trim().replace(/\s+/g, ' ');
  if (!clean) return '';
  if (fallback.mode === 'full-name') return clean;
  const words = clean.split(' ');
  if (fallback.mode === 'first-letter') return words[0][0].toUpperCase();
  if (fallback.mode === 'first-last') return `${words[0][0]}${words.at(-1)?.[0] || ''}`.toUpperCase().slice(0, fallback.maxLetters);
  const initials = words.map((word) => word[0]).join('').toUpperCase();
  return (initials || clean.slice(0, fallback.maxLetters)).slice(0, fallback.maxLetters);
}

function teamName(veto: VetoState, team: 'team1' | 'team2'): string {
  return team === 'team1' ? veto.team1Name || 'TEAM 1' : veto.team2Name || 'TEAM 2';
}

function teamLabel(name: string): string {
  return (name.trim().replace(/\s+team$/i, '').trim() || name.trim() || 'TEAM').slice(0, 12).toUpperCase();
}

function TeamLogoFallback({ name, fallback, map = false }: { name: string; fallback: VetoTeamFallback; map?: boolean }) {
  const text = teamFallbackText(name, fallback);
  if (!text) return null;
  return <span className={map ? 'vdc-map-logo vdc-map-logo-fallback' : 'vdc-empty-image vdc-logo-placeholder'} style={{ background: fallback.background, color: fallback.color, borderColor: fallback.borderColor, borderRadius: fallback.radius }}>{text}</span>;
}

function MapPool({ element, veto, maps, logos, fallback, showMapSideBadges }: { element: VetoElement; veto: VetoState | null; maps: VetoMapMetadata; logos: { team1: string | null; team2: string | null }; fallback: VetoTeamFallback; showMapSideBadges: boolean }) {
  const names = veto?.allMaps?.length ? veto.allMaps : veto ? [...new Set([...veto.availableMaps, ...veto.bannedMaps, ...veto.pickedMaps.map((map) => map.mapName)])] : [];
  return <div className="vdc-maps" style={{ gridTemplateColumns: `repeat(${element.columns || 7}, minmax(0, 1fr))`, gap: element.gap ?? 12 }}>
    {names.map((name) => {
      const picked = veto?.pickedMaps.find((entry) => entry.mapName === name);
      const sideAction = veto?.actions.find((action) => action.mapName === name && action.action === 'side_pick');
      const stage = veto?.bannedMaps.includes(name) ? 'banned' : picked?.pickedBy === 'decider' ? 'decider' : picked ? 'picked' : 'available';
      const pickedTeam = picked?.pickedBy === 'team1' ? 'team1' : picked?.pickedBy === 'team2' ? 'team2' : null;
      const logo = pickedTeam === 'team1' ? logos.team1 : pickedTeam === 'team2' ? logos.team2 : null;
      const pickedTeamName = pickedTeam === 'team1' ? veto?.team1Name || 'TEAM 1' : pickedTeam === 'team2' ? veto?.team2Name || 'TEAM 2' : '';
      const pickedSide = sideAction?.side && pickedTeam ? (sideAction.team === pickedTeam ? sideAction.side : sideAction.side === 'T' ? 'CT' : 'T') : undefined;
      const hasMapTag = showMapSideBadges && Boolean(picked?.mapNumber);
      return <div className={`vdc-map ${stage} ${hasMapTag ? 'vdc-map-with-tag' : ''}`} key={name} data-stage={stage} data-testid={`broadcast-veto-map-${name}`} style={{ background: element.background || '#0F1B29', borderColor: element.borderColor || '#536A83', borderRadius: element.radius ?? 16 }}>
        <img className="vdc-map-photo" src={element.mapImages?.[name] || maps.get(name)?.imageUrl || getMapFullImageUrl(name)} alt="" />
        <div className="vdc-map-shade" />
        <strong className="vdc-map-name">{maps.get(name)?.displayName || getMapDisplayName(name)}</strong>
        {logo ? <img className="vdc-map-logo" src={logo} alt="" /> : pickedTeam && <TeamLogoFallback name={pickedTeamName} fallback={fallback} map />}
        {showMapSideBadges && picked?.mapNumber && <span className="vdc-map-map-tag">MAP {picked.mapNumber}</span>}
        {showMapSideBadges && pickedSide && <span className={`vdc-map-side-tag vdc-side-${pickedSide.toLowerCase()}`}>{pickedSide}</span>}
        <div className="vdc-map-caption"><b>{stage === 'banned' ? 'BAN' : stage === 'picked' ? 'PICK' : stage === 'decider' ? 'DECIDER' : 'AVAILABLE'}</b></div>
      </div>;
    })}
  </div>;
}

function Timeline({ element, veto, showTimelineOwnership }: { element: VetoElement; veto: VetoState | null; showTimelineOwnership: boolean }) {
  return <div className="vdc-timeline" style={{ color: element.color, fontSize: element.fontSize }}>
    {veto && getVetoOrder(veto.format).map((step) => {
      const action = veto.actions.find((item) => item.step === step.step);
      const state = action || veto.status === 'completed' ? 'done' : step.step === veto.currentStep ? 'current' : 'upcoming';
      const owner = action ? teamName(veto, action.team) : teamName(veto, step.team);
      const ownerLabel = action ? `${teamLabel(owner)}${action.action === 'side_pick' && action.side ? ` · ${action.side}` : ''}` : '';
      return <div key={step.step} className={`vdc-step ${state} ${showTimelineOwnership && action ? 'vdc-step-owned' : ''}`}><span>{String(step.step).padStart(2, '0')}</span><b>{step.action.replace('_', ' ').toUpperCase()}</b><small>{action ? getMapDisplayName(action.mapName) : teamLabel(owner)}</small>{showTimelineOwnership && action && <em className={`vdc-owner-${action.team}`}>{ownerLabel}</em>}</div>;
    })}
  </div>;
}

export function VetoDesignCanvas({ design, screen, veto, branding, tournamentName = 'Tournament', maps = new Map(), logos = { team1: null, team2: null }, selectedId, guides, distances, onElementPointerDown }: {
  design: VetoDesign; screen: VetoScreen; veto: VetoState | null; branding: BrandingSettings; tournamentName?: string;
  maps?: VetoMapMetadata; logos?: { team1: string | null; team2: string | null };
  guides?: VetoSnapGuides;
  distances?: VetoDistanceMeasurement[];
  selectedId?: string | null; onElementPointerDown?: (id: string, event: PointerEvent<HTMLDivElement>, mode: 'move' | 'resize') => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const node = container.current;
    if (!node) return;
    const resize = () => setScale(Math.min(node.clientWidth / 1920, node.clientHeight / 1080));
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const layout = design.screens[screen];
  const backgroundDim = Math.max(0, Math.min(0.8, layout.backgroundDim ?? 0));
  const legacyOwnership = design.showActionOwnership === true;
  const showMapSideBadges = design.showMapSideBadges ?? legacyOwnership;
  const showTimelineOwnership = design.showTimelineOwnership ?? legacyOwnership;
  const fallback = { ...defaultTeamFallback, ...design.teamFallback };
  return <div className="vdc-viewport" ref={container}>
    <div className="vdc-canvas" data-vdc-screen={screen} style={{ width: 1920, height: 1080, transform: `translate(-50%, -50%) scale(${scale})`, background: layout.background, backgroundImage: layout.backgroundImage ? `url("${layout.backgroundImage}")` : undefined }}>
      {backgroundDim > 0 && <div className="vdc-background-dim" style={{ opacity: backgroundDim }} />}
      {layout.elements.filter((element) => element.visible !== false).map((element) => {
        const logoId = element.binding === 'team1' ? 'team1-logo' : element.binding === 'team2' ? 'team2-logo' : null;
        const logo = logoId ? layout.elements.find((item) => item.id === logoId && item.visible !== false) : null;
        const logoOverlapsText = Boolean(logo && logo.x < element.x + element.w && logo.x + logo.w > element.x && logo.y < element.y + element.h && logo.y + logo.h > element.y);
        const logoPadding = logoOverlapsText && element.binding === 'team1' ? { paddingLeft: Math.min(160, (logo?.w || 0) + 20) } : logoOverlapsText && element.binding === 'team2' ? { paddingRight: Math.min(160, (logo?.w || 0) + 20) } : {};
        const renderedText = element.kind === 'text' ? boundText(element, branding, veto, tournamentName) : '';
        const renderKey = element.kind === 'text' && element.binding && element.binding !== 'none' ? `${element.id}-${renderedText}` : element.id;
        const activeTeam = element.binding === 'team1' && veto?.status !== 'completed' && veto?.currentTurn === 'team1' || element.binding === 'team2' && veto?.status !== 'completed' && veto?.currentTurn === 'team2';
        const defaultRadius = element.kind === 'text' && (element.binding === 'team1' || element.binding === 'team2') ? 8 : undefined;
        const style: CSSProperties = { left: element.x, top: element.y, width: element.w, height: element.h, color: element.color || '#F4F7FB', background: element.kind === 'text' || element.kind === 'shape' ? element.background : undefined, borderColor: element.borderColor, borderRadius: element.radius ?? defaultRadius, opacity: element.opacity ?? 1, textAlign: element.align || 'left', fontSize: element.fontSize || 32, fontWeight: element.weight || 700, fontFamily: element.fontFamily || 'Inter, Arial, sans-serif', ...logoPadding };
        return <div key={renderKey} data-vdc-id={element.id} data-vdc-binding={element.binding || undefined} className={`vdc-element vdc-${element.kind} ${activeTeam ? 'vdc-team-active' : ''} ${selectedId === element.id ? 'selected' : ''} ${onElementPointerDown ? 'editable' : ''}`} style={style} onPointerDown={onElementPointerDown ? (event) => onElementPointerDown(element.id, event, 'move') : undefined}>
          {element.kind === 'text' && <span>{renderedText}</span>}
          {element.kind === 'image' && (imageSource(element, branding, logos) ? <img src={imageSource(element, branding, logos)!} alt="" /> : element.binding === 'team1Logo' ? <TeamLogoFallback name={veto?.team1Name || 'TEAM 1'} fallback={fallback} /> : element.binding === 'team2Logo' ? <TeamLogoFallback name={veto?.team2Name || 'TEAM 2'} fallback={fallback} /> : <span className="vdc-empty-image">IMAGE</span>)}
          {element.kind === 'maps' && <MapPool element={element} veto={veto} maps={maps} logos={logos} fallback={fallback} showMapSideBadges={showMapSideBadges} />}
          {element.kind === 'timeline' && <Timeline element={element} veto={veto} showTimelineOwnership={showTimelineOwnership} />}
          {onElementPointerDown && selectedId === element.id && <div className="vdc-resize" onPointerDown={(event) => { event.stopPropagation(); onElementPointerDown(element.id, event, 'resize'); }} />}
        </div>;
      })}
      {guides?.x !== undefined && <div className="vdc-guide vdc-guide-x" style={{ left: guides.x }} />}
      {guides?.y !== undefined && <div className="vdc-guide vdc-guide-y" style={{ top: guides.y }} />}
    </div>
    {distances && distances.length > 0 && <svg className="vdc-distance-overlay" style={{ width: 1920 * scale, height: 1080 * scale }} viewBox="0 0 1920 1080" aria-hidden="true">
      {distances.map((measurement) => {
        if (measurement.value <= 0) return null;
        const horizontal = measurement.axis === 'x';
        const middle = (measurement.start + measurement.end) / 2;
        const tick = 5 / scale;
        const fontSize = 13 / scale;
        const label = `${Math.round(measurement.value)} px`;
        const labelWidth = (label.length * 7.5 + 12) / scale;
        const labelHeight = 21 / scale;
        const minLabelX = labelWidth / 2 + 6 / scale;
        const maxLabelX = 1920 - labelWidth / 2 - 6 / scale;
        const minLabelY = labelHeight / 2 + 6 / scale;
        const maxLabelY = 1080 - labelHeight / 2 - 6 / scale;
        const labelX = horizontal
          ? Math.max(minLabelX, Math.min(maxLabelX, middle))
          : Math.max(minLabelX, Math.min(maxLabelX, measurement.offset + (measurement.source === 'canvas' ? 26 : -26) / scale));
        const labelY = horizontal
          ? Math.max(minLabelY, Math.min(maxLabelY, measurement.offset + (measurement.source === 'canvas' ? -24 : 24) / scale))
          : Math.max(minLabelY, Math.min(maxLabelY, middle));
        const lineColor = measurement.source === 'canvas' ? '#76DCE9' : '#D4A7FF';
        return <g key={`${measurement.source}-${measurement.side}`}>
          <line x1={horizontal ? measurement.start : measurement.offset} y1={horizontal ? measurement.offset : measurement.start} x2={horizontal ? measurement.end : measurement.offset} y2={horizontal ? measurement.offset : measurement.end} stroke={lineColor} />
          <line x1={horizontal ? measurement.start : measurement.offset - tick} y1={horizontal ? measurement.offset - tick : measurement.start} x2={horizontal ? measurement.start : measurement.offset + tick} y2={horizontal ? measurement.offset + tick : measurement.start} stroke={lineColor} />
          <line x1={horizontal ? measurement.end : measurement.offset - tick} y1={horizontal ? measurement.offset - tick : measurement.end} x2={horizontal ? measurement.end : measurement.offset + tick} y2={horizontal ? measurement.offset + tick : measurement.end} stroke={lineColor} />
          <rect x={labelX - labelWidth / 2} y={labelY - labelHeight / 2} width={labelWidth} height={labelHeight} rx={4 / scale} fill="#101923" stroke={lineColor} />
          <text x={labelX} y={labelY} fontSize={fontSize} textAnchor="middle" dominantBaseline="central">{label}</text>
        </g>;
      })}
    </svg>}
    <style>{canvasStyles + actionOwnershipStyles}</style>
  </div>;
}

const canvasStyles = `
  .vdc-viewport{width:100%;height:100%;min-height:1px;position:relative;overflow:hidden;background:#080d15}.vdc-canvas{position:absolute;left:50%;top:50%;transform-origin:center;overflow:hidden;background-position:center;background-size:cover;font-family:Inter,Arial,sans-serif;color:#f4f7fb;user-select:none}.vdc-canvas:before,.vdc-canvas:after{content:'';position:absolute;inset:-20%;pointer-events:none;z-index:0}.vdc-canvas:before{background:radial-gradient(circle at 18% 22%,#54c7ff26,transparent 28%),radial-gradient(circle at 82% 78%,#b56cff1d,transparent 30%);animation:vdc-ambient-drift 16s ease-in-out infinite alternate}.vdc-canvas:after{inset:-10% -35%;background:linear-gradient(105deg,transparent 42%,#73e5ff0d 49%,#ffffff10 50%,transparent 58%);transform:translateX(-28%);animation:vdc-scan-sweep 12s ease-in-out infinite}.vdc-background-dim{position:absolute;inset:0;background:#000;pointer-events:none;z-index:0}.vdc-canvas>.vdc-element{z-index:1}.vdc-element{position:absolute;box-sizing:border-box;overflow:hidden}.vdc-element.editable{cursor:move}.vdc-element.selected{outline:3px solid #6dc8ff;outline-offset:2px}.vdc-text{display:flex;align-items:center;white-space:pre-wrap;padding:0 12px}.vdc-text span{width:100%;overflow:hidden;text-overflow:ellipsis}.vdc-image{display:flex;align-items:center;justify-content:center;overflow:hidden;contain:paint}.vdc-image img{display:block;max-width:100%;max-height:100%;width:100%;height:100%;object-fit:contain;object-position:center}.vdc-empty-image{color:#849aaf;border:2px dashed #64758a;padding:20px}.vdc-logo-placeholder{display:grid;place-items:center;width:100%;height:100%;padding:0;border:1px solid #64758a;background:#101a27;color:#9eb4c8;font-size:30px;font-weight:800;letter-spacing:.08em}.vdc-shape{border:1px solid}.vdc-line{background:currentColor}.vdc-resize{position:absolute;right:0;bottom:0;width:28px;height:28px;background:#6dc8ff;border:4px solid #101923;cursor:nwse-resize;z-index:10}.vdc-guide{position:absolute;z-index:20;pointer-events:none;border-color:#6ce3ed;filter:drop-shadow(0 0 5px #6ce3ed)}.vdc-guide-x{top:0;bottom:0;border-left:2px dashed}.vdc-guide-y{left:0;right:0;border-top:2px dashed}.vdc-distance-overlay{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:30;pointer-events:none;overflow:visible}.vdc-distance-overlay line{stroke-width:1.25;vector-effect:non-scaling-stroke}.vdc-distance-overlay rect{stroke-width:1;vector-effect:non-scaling-stroke}.vdc-distance-overlay text{fill:#f2fbff;font-family:Inter,Arial,sans-serif;font-weight:700}.vdc-maps{display:grid;width:100%;height:100%;overflow:visible}.vdc-element.vdc-maps{overflow:visible}.vdc-map{position:relative;min-width:0;min-height:0;overflow:hidden;border:2px solid;box-shadow:0 10px 24px #0008;transition:transform .45s ease,box-shadow .45s ease,filter .45s ease;z-index:1}.vdc-map-photo{position:absolute;width:100%;height:100%;object-fit:cover;opacity:.83;transition:filter .45s ease,transform .7s ease}.vdc-map-shade{position:absolute;inset:0;background:linear-gradient(transparent 35%,#060a10e6)}.vdc-map.banned .vdc-map-photo{filter:grayscale(1)}.vdc-map.banned{border-color:#F46C73!important;animation:vdc-map-ban .72s cubic-bezier(.2,.8,.2,1) both;z-index:2}.vdc-map.picked{border-color:#59C7AB!important;animation:vdc-map-picked .68s cubic-bezier(.2,.8,.2,1) both;z-index:2}.vdc-map.decider{border-color:#F4C773!important;animation:vdc-map-decider .82s cubic-bezier(.2,.8,.2,1) both;z-index:2}.vdc-map-name{position:absolute;top:14px;left:14px;right:14px;text-transform:uppercase;font-size:23px;text-shadow:0 2px 5px #000}.vdc-map-logo{position:absolute;width:44%;height:auto;aspect-ratio:1;left:28%;top:0;bottom:0;margin-block:auto;object-fit:contain;filter:drop-shadow(0 3px 5px #000b);transition:transform .5s ease}.vdc-map.picked .vdc-map-logo,.vdc-map.decider .vdc-map-logo{animation:vdc-logo-arrive .65s .12s both}.vdc-map-logo-fallback{display:grid;place-items:center;box-sizing:border-box;border:2px solid;font-size:clamp(18px,2.3vw,42px);font-weight:900;letter-spacing:.08em;text-shadow:0 2px 8px #000}.vdc-map-caption{position:absolute;bottom:16px;left:14px;right:14px;display:flex;justify-content:space-between;font-size:20px;letter-spacing:.07em}.vdc-timeline{display:flex;width:100%;height:100%;align-items:stretch;gap:0;overflow:hidden}.vdc-step{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:center;border-top:3px solid #557087;position:relative;padding-top:8px}.vdc-step:before{content:'';position:absolute;top:-12px;left:calc(50% - 9px);width:18px;height:18px;border:4px solid currentColor;border-radius:50%;background:#0c1520}.vdc-step.done{color:#efad72;border-top-color:#efad72}.vdc-step.current{color:#6ce3ed;border-top-color:#6ce3ed;text-shadow:0 0 12px #6ce3ed;animation:vdc-step-pulse 1.8s ease-in-out infinite}.vdc-step.done:before{animation:vdc-step-done .45s both}.vdc-step.upcoming{color:#718ca2}.vdc-step span{opacity:.7}.vdc-step small{font-size:.75em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}.vdc-team-active{animation:vdc-team-active 2.1s ease-in-out infinite}.vdc-element[data-vdc-binding="turn"]{animation:vdc-turn-arrive .5s cubic-bezier(.2,.8,.2,1) both}.vdc-canvas[data-vdc-screen="standby"] [data-vdc-id="standby-title"]{animation:vdc-standby-breathe 4.5s ease-in-out infinite}.vdc-canvas[data-vdc-screen="completed"] [data-vdc-id="completed-title"]{animation:vdc-complete-title .8s cubic-bezier(.2,.8,.2,1) both}
  @keyframes vdc-ambient-drift{from{transform:translate3d(-3%,-2%,0) scale(1)}to{transform:translate3d(3%,2%,0) scale(1.08)}}@keyframes vdc-scan-sweep{0%,28%{transform:translateX(-28%);opacity:0}42%{opacity:1}70%,100%{transform:translateX(28%);opacity:0}}@keyframes vdc-map-ban{0%{transform:scale(.96);filter:saturate(.5) brightness(1.4)}55%{transform:scale(1.025);filter:saturate(1.15) brightness(1.08)}100%{transform:scale(1);filter:none}}@keyframes vdc-map-picked{0%{transform:translateY(10px) scale(.97);box-shadow:0 10px 24px #0008}60%{transform:translateY(-3px) scale(1.025);box-shadow:0 0 28px #59c7ab80}100%{transform:translateY(0) scale(1);box-shadow:0 10px 24px #0008}}@keyframes vdc-map-decider{0%{transform:scale(.96);box-shadow:0 0 0 #f4c77300}55%{transform:scale(1.035);box-shadow:0 0 34px #f4c77399}100%{transform:scale(1);box-shadow:0 10px 24px #0008}}@keyframes vdc-logo-arrive{0%{transform:scale(.6) rotate(-8deg);opacity:0}70%{transform:scale(1.08) rotate(2deg);opacity:1}100%{transform:scale(1) rotate(0)}}@keyframes vdc-step-pulse{0%,100%{filter:drop-shadow(0 0 0 #6ce3ed00)}50%{filter:drop-shadow(0 0 9px #6ce3edaa)}}@keyframes vdc-step-done{from{transform:scale(.5);opacity:.2}to{transform:scale(1);opacity:1}}@keyframes vdc-team-active{0%,100%{box-shadow:0 0 0 #6ce3ed00}50%{box-shadow:0 0 24px #6ce3ed66}}@keyframes vdc-turn-arrive{from{opacity:0;transform:translateY(12px);filter:blur(5px)}to{opacity:1;transform:translateY(0);filter:blur(0)}}@keyframes vdc-standby-breathe{0%,100%{transform:scale(1);text-shadow:0 0 0 #6ce3ed00}50%{transform:scale(1.012);text-shadow:0 0 26px #6ce3ed55}}@keyframes vdc-complete-title{from{opacity:0;transform:translateY(-18px) scale(.96);filter:blur(7px)}to{opacity:1;transform:translateY(0) scale(1);filter:blur(0)}}
  @media (prefers-reduced-motion:reduce){.vdc-canvas:before,.vdc-canvas:after,.vdc-map,.vdc-map:after,.vdc-map-logo,.vdc-step.current,.vdc-step.done:before,.vdc-team-active,.vdc-element[data-vdc-binding="turn"],.vdc-canvas[data-vdc-screen="standby"] [data-vdc-id="standby-title"],.vdc-canvas[data-vdc-screen="completed"] [data-vdc-id="completed-title"]{animation:none!important;transition:none!important}}
`;

const actionOwnershipStyles = `
  .vdc-map-with-tag .vdc-map-name{top:50px}.vdc-map-map-tag,.vdc-map-side-tag{position:absolute;top:14px;z-index:2;padding:5px 9px;border:1px solid #ffffff38;border-radius:11px;color:#111827;font-size:12px;font-weight:900;letter-spacing:.06em;line-height:1;text-transform:uppercase;text-shadow:none;box-shadow:0 3px 10px #0005}.vdc-map-map-tag{left:14px;background:#b8e7dae8}.vdc-map-side-tag{right:14px;min-width:24px;text-align:center}.vdc-side-t{background:#f3d1a5f2}.vdc-side-ct{background:#c6dcfff2}.vdc-owner-team1{color:#9bdceb}.vdc-owner-team2{color:#f4c773}.vdc-step.vdc-step-owned{display:grid;grid-template-rows:14px 20px 14px 15px;justify-items:center;align-content:center;gap:2px;padding-top:8px}.vdc-step.vdc-step-owned>span,.vdc-step.vdc-step-owned>b,.vdc-step.vdc-step-owned>small,.vdc-step.vdc-step-owned>em{line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}.vdc-step.vdc-step-owned>small{font-size:.66em}.vdc-step.vdc-step-owned>em{font-size:.66em;font-style:normal;font-weight:800;letter-spacing:.05em}
`;
