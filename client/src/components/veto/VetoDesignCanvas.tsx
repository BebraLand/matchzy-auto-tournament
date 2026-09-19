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
type VetoSnapPeer = Pick<VetoElement, 'x' | 'y' | 'w' | 'h'>;
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

export type VetoLayout = { background: string; backgroundImage?: string; elements: VetoElement[] };
export type VetoDesign = { version: 1; screens: Record<VetoScreen, VetoLayout>; teamFallback?: VetoTeamFallback };
export type VetoMapMetadata = Map<string, { displayName: string; imageUrl: string | null }>;

export const defaultTeamFallback: VetoTeamFallback = { mode: 'initials', maxLetters: 2, background: '#101A27', color: '#9EB4C8', borderColor: '#64758A', radius: 8 };

const el = (id: string, kind: VetoElementKind, x: number, y: number, w: number, h: number, props: Partial<VetoElement> = {}): VetoElement => ({ id, kind, x, y, w, h, ...props });

export function defaultVetoDesign(): VetoDesign {
  const brand = el('brand', 'text', 100, 56, 1050, 54, { binding: 'brand', fontSize: 28, weight: 800, color: '#89CAFF' });
  const logo = el('logo', 'image', 42, 52, 50, 50, { binding: 'brandLogo' });
  return { version: 1, teamFallback: defaultTeamFallback, screens: {
    standby: { background: '#0B1018', elements: [
      logo, brand,
      el('standby-title', 'text', 270, 390, 1380, 140, { text: 'VETO DESK', fontSize: 114, weight: 900, align: 'center' }),
      el('standby-subtitle', 'text', 300, 550, 1320, 50, { text: 'WAITING FOR THE NEXT MATCH', fontSize: 36, weight: 800, align: 'center' }),
      el('standby-caption', 'text', 500, 625, 920, 36, { text: 'LIVE FEED STANDING BY', fontSize: 22, color: '#A5B8CC', align: 'center' }),
    ] },
    live: { background: '#0B1018', elements: [
      logo, brand,
      el('format', 'text', 1410, 54, 340, 48, { binding: 'format', fontSize: 27, weight: 800, align: 'right' }),
      el('team1', 'text', 82, 200, 690, 105, { binding: 'team1', fontSize: 69, weight: 900, background: '#162232', align: 'center' }),
      el('team1-logo', 'image', 93, 204, 97, 97, { binding: 'team1Logo' }),
      el('versus', 'text', 815, 215, 290, 84, { text: 'VS', fontSize: 65, weight: 900, color: '#D6E0EA', align: 'center' }),
      el('team2', 'text', 1148, 200, 690, 105, { binding: 'team2', fontSize: 69, weight: 900, background: '#2B211A', align: 'center' }),
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

function TeamLogoFallback({ name, fallback, map = false }: { name: string; fallback: VetoTeamFallback; map?: boolean }) {
  const text = teamFallbackText(name, fallback);
  if (!text) return null;
  return <span className={map ? 'vdc-map-logo vdc-map-logo-fallback' : 'vdc-empty-image vdc-logo-placeholder'} style={{ background: fallback.background, color: fallback.color, borderColor: fallback.borderColor, borderRadius: fallback.radius }}>{text}</span>;
}

function MapPool({ element, veto, maps, logos, fallback }: { element: VetoElement; veto: VetoState | null; maps: VetoMapMetadata; logos: { team1: string | null; team2: string | null }; fallback: VetoTeamFallback }) {
  const names = veto?.allMaps?.length ? veto.allMaps : veto ? [...new Set([...veto.availableMaps, ...veto.bannedMaps, ...veto.pickedMaps.map((map) => map.mapName)])] : [];
  return <div className="vdc-maps" style={{ gridTemplateColumns: `repeat(${element.columns || 7}, minmax(0, 1fr))`, gap: element.gap ?? 12 }}>
    {names.map((name) => {
      const picked = veto?.pickedMaps.find((entry) => entry.mapName === name);
      const stage = veto?.bannedMaps.includes(name) ? 'banned' : picked?.pickedBy === 'decider' ? 'decider' : picked ? 'picked' : 'available';
      const pickedTeam = picked?.pickedBy === 'team1' ? 'team1' : picked?.pickedBy === 'team2' ? 'team2' : null;
      const logo = pickedTeam === 'team1' ? logos.team1 : pickedTeam === 'team2' ? logos.team2 : null;
      const pickedTeamName = pickedTeam === 'team1' ? veto?.team1Name || 'TEAM 1' : pickedTeam === 'team2' ? veto?.team2Name || 'TEAM 2' : '';
      return <div className={`vdc-map ${stage}`} key={name} data-testid={`broadcast-veto-map-${name}`} style={{ background: element.background || '#0F1B29', borderColor: element.borderColor || '#536A83', borderRadius: element.radius ?? 16 }}>
        <img className="vdc-map-photo" src={element.mapImages?.[name] || maps.get(name)?.imageUrl || getMapFullImageUrl(name)} alt="" />
        <div className="vdc-map-shade" />
        <strong className="vdc-map-name">{maps.get(name)?.displayName || getMapDisplayName(name)}</strong>
        {logo ? <img className="vdc-map-logo" src={logo} alt="" /> : pickedTeam && <TeamLogoFallback name={pickedTeamName} fallback={fallback} map />}
        <div className="vdc-map-caption"><b>{stage === 'banned' ? 'BAN' : stage === 'picked' ? 'PICK' : stage === 'decider' ? 'DECIDER' : 'AVAILABLE'}</b></div>
      </div>;
    })}
  </div>;
}

function Timeline({ element, veto }: { element: VetoElement; veto: VetoState | null }) {
  return <div className="vdc-timeline" style={{ color: element.color, fontSize: element.fontSize }}>
    {veto && getVetoOrder(veto.format).map((step) => {
      const action = veto.actions.find((item) => item.step === step.step);
      const state = action || veto.status === 'completed' ? 'done' : step.step === veto.currentStep ? 'current' : 'upcoming';
      return <div key={step.step} className={`vdc-step ${state}`}><span>{String(step.step).padStart(2, '0')}</span><b>{step.action.replace('_', ' ').toUpperCase()}</b><small>{action ? getMapDisplayName(action.mapName) : step.team === 'team1' ? veto.team1Name || 'TEAM 1' : veto.team2Name || 'TEAM 2'}</small></div>;
    })}
  </div>;
}

export function VetoDesignCanvas({ design, screen, veto, branding, tournamentName = 'Tournament', maps = new Map(), logos = { team1: null, team2: null }, selectedId, guides, onElementPointerDown }: {
  design: VetoDesign; screen: VetoScreen; veto: VetoState | null; branding: BrandingSettings; tournamentName?: string;
  maps?: VetoMapMetadata; logos?: { team1: string | null; team2: string | null };
  guides?: VetoSnapGuides;
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
  const fallback = { ...defaultTeamFallback, ...design.teamFallback };
  return <div className="vdc-viewport" ref={container}>
    <div className="vdc-canvas" style={{ width: 1920, height: 1080, transform: `translate(-50%, -50%) scale(${scale})`, background: layout.background, backgroundImage: layout.backgroundImage ? `url("${layout.backgroundImage}")` : undefined }}>
      {layout.elements.filter((element) => element.visible !== false).map((element) => {
        const logoId = element.binding === 'team1' ? 'team1-logo' : element.binding === 'team2' ? 'team2-logo' : null;
        const logo = logoId ? layout.elements.find((item) => item.id === logoId && item.visible !== false) : null;
        const logoOverlapsText = Boolean(logo && logo.x < element.x + element.w && logo.x + logo.w > element.x && logo.y < element.y + element.h && logo.y + logo.h > element.y);
        const logoPadding = logoOverlapsText && element.binding === 'team1' ? { paddingLeft: Math.min(160, (logo?.w || 0) + 20) } : logoOverlapsText && element.binding === 'team2' ? { paddingRight: Math.min(160, (logo?.w || 0) + 20) } : {};
        const style: CSSProperties = { left: element.x, top: element.y, width: element.w, height: element.h, color: element.color || '#F4F7FB', background: element.kind === 'text' || element.kind === 'shape' ? element.background : undefined, borderColor: element.borderColor, borderRadius: element.radius, opacity: element.opacity ?? 1, textAlign: element.align || 'left', fontSize: element.fontSize || 32, fontWeight: element.weight || 700, fontFamily: element.fontFamily || 'Inter, Arial, sans-serif', ...logoPadding };
        return <div key={element.id} className={`vdc-element vdc-${element.kind} ${selectedId === element.id ? 'selected' : ''} ${onElementPointerDown ? 'editable' : ''}`} style={style} onPointerDown={onElementPointerDown ? (event) => onElementPointerDown(element.id, event, 'move') : undefined}>
          {element.kind === 'text' && <span>{boundText(element, branding, veto, tournamentName)}</span>}
          {element.kind === 'image' && (imageSource(element, branding, logos) ? <img src={imageSource(element, branding, logos)!} alt="" /> : element.binding === 'team1Logo' ? <TeamLogoFallback name={veto?.team1Name || 'TEAM 1'} fallback={fallback} /> : element.binding === 'team2Logo' ? <TeamLogoFallback name={veto?.team2Name || 'TEAM 2'} fallback={fallback} /> : <span className="vdc-empty-image">IMAGE</span>)}
          {element.kind === 'maps' && <MapPool element={element} veto={veto} maps={maps} logos={logos} fallback={fallback} />}
          {element.kind === 'timeline' && <Timeline element={element} veto={veto} />}
          {onElementPointerDown && selectedId === element.id && <div className="vdc-resize" onPointerDown={(event) => { event.stopPropagation(); onElementPointerDown(element.id, event, 'resize'); }} />}
        </div>;
      })}
      {guides?.x !== undefined && <div className="vdc-guide vdc-guide-x" style={{ left: guides.x }} />}
      {guides?.y !== undefined && <div className="vdc-guide vdc-guide-y" style={{ top: guides.y }} />}
    </div>
    <style>{canvasStyles}</style>
  </div>;
}

const canvasStyles = `
  .vdc-viewport{width:100%;height:100%;min-height:1px;position:relative;overflow:hidden;background:#080d15}.vdc-canvas{position:absolute;left:50%;top:50%;transform-origin:center;overflow:hidden;background-position:center;background-size:cover;font-family:Inter,Arial,sans-serif;color:#f4f7fb;user-select:none}.vdc-element{position:absolute;box-sizing:border-box;overflow:hidden}.vdc-element.editable{cursor:move}.vdc-element.selected{outline:3px solid #6dc8ff;outline-offset:2px}.vdc-text{display:flex;align-items:center;white-space:pre-wrap;padding:0 12px}.vdc-text span{width:100%;overflow:hidden;text-overflow:ellipsis}.vdc-image{display:flex;align-items:center;justify-content:center;overflow:hidden;contain:paint}.vdc-image img{display:block;max-width:100%;max-height:100%;width:100%;height:100%;object-fit:contain;object-position:center}.vdc-empty-image{color:#849aaf;border:2px dashed #64758a;padding:20px}.vdc-logo-placeholder{display:grid;place-items:center;width:100%;height:100%;padding:0;border:1px solid #64758a;background:#101a27;color:#9eb4c8;font-size:30px;font-weight:800;letter-spacing:.08em}.vdc-shape{border:1px solid}.vdc-line{background:currentColor}.vdc-resize{position:absolute;right:0;bottom:0;width:28px;height:28px;background:#6dc8ff;border:4px solid #101923;cursor:nwse-resize;z-index:10}.vdc-guide{position:absolute;z-index:20;pointer-events:none;border-color:#6ce3ed;filter:drop-shadow(0 0 5px #6ce3ed)}.vdc-guide-x{top:0;bottom:0;border-left:2px dashed}.vdc-guide-y{left:0;right:0;border-top:2px dashed}.vdc-maps{display:grid;width:100%;height:100%;}.vdc-map{position:relative;min-width:0;min-height:0;overflow:hidden;border:2px solid;box-shadow:0 10px 24px #0008}.vdc-map-photo{position:absolute;width:100%;height:100%;object-fit:cover;opacity:.83}.vdc-map-shade{position:absolute;inset:0;background:linear-gradient(transparent 35%,#060a10e6)}.vdc-map.banned .vdc-map-photo{filter:grayscale(1)}.vdc-map.banned{border-color:#F46C73!important}.vdc-map.picked{border-color:#59C7AB!important}.vdc-map.decider{border-color:#F4C773!important}.vdc-map-name{position:absolute;top:14px;left:14px;right:14px;text-transform:uppercase;font-size:23px;text-shadow:0 2px 5px #000}.vdc-map-logo{position:absolute;width:44%;height:44%;left:28%;top:26%;object-fit:contain;filter:drop-shadow(0 6px 10px #000)}.vdc-map-logo-fallback{display:grid;place-items:center;box-sizing:border-box;border:2px solid;font-size:clamp(18px,2.3vw,42px);font-weight:900;letter-spacing:.08em;text-shadow:0 2px 8px #000}.vdc-map-caption{position:absolute;bottom:16px;left:14px;right:14px;display:flex;justify-content:space-between;font-size:20px;letter-spacing:.07em}.vdc-timeline{display:flex;width:100%;height:100%;align-items:stretch;gap:0;overflow:hidden}.vdc-step{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:center;border-top:3px solid #557087;position:relative;padding-top:8px}.vdc-step:before{content:'';position:absolute;top:-12px;left:calc(50% - 9px);width:18px;height:18px;border:4px solid currentColor;border-radius:50%;background:#0c1520}.vdc-step.done{color:#efad72;border-top-color:#efad72}.vdc-step.current{color:#6ce3ed;border-top-color:#6ce3ed;text-shadow:0 0 12px #6ce3ed}.vdc-step.upcoming{color:#718ca2}.vdc-step span{opacity:.7}.vdc-step small{font-size:.75em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
`;
