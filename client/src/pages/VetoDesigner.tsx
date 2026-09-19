import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type PointerEvent } from 'react';
import { Link } from 'react-router-dom';
import { useBranding } from '../contexts/BrandingContext';
import { VetoDesignCanvas, defaultTeamFallback, defaultVetoDesign, measureElementGaps, nudgeElementPosition, previewVeto, restoreImageAspectRatio, snapElementPosition, type VetoBinding, type VetoDesign, type VetoElement, type VetoElementKind, type VetoMapMetadata, type VetoScreen, type VetoSnapGuides, type VetoTeamFallback, type VetoDistanceMeasurement } from '../components/veto/VetoDesignCanvas';
import { api } from '../utils/api';
import type { VetoState } from '../types/veto.types';

const scenarios = [
  ['standby', 'No match'], ['pending', 'Match open'], ['ban', 'Ban map'],
  ['pick', 'Pick map'], ['side', 'Choose side'], ['completed', 'Completed'], ['real', 'Current live veto'],
] as const;
const kinds: Array<[VetoElementKind, string]> = [
  ['text', 'Text'], ['image', 'Image'], ['shape', 'Shape'],
  ['line', 'Line'], ['maps', 'Match maps'], ['timeline', 'Veto timeline'],
];
const bindings: Array<[VetoBinding, string]> = [
  ['none', 'No binding'], ['brand', 'Brand name (Settings)'], ['tournamentName', 'Tournament name (Tournament)'], ['team1', 'Team 1'],
  ['team2', 'Team 2'], ['format', 'BO format'], ['status', 'Status'],
  ['turn', 'Current turn'], ['step', 'Veto step'], ['brandLogo', 'Brand logo (Settings)'],
  ['team1Logo', 'Team 1 logo'], ['team2Logo', 'Team 2 logo'],
];

function clone(design: VetoDesign): VetoDesign { return structuredClone(design); }

export default function VetoDesigner() {
  const { branding } = useBranding();
  const [design, setDesign] = useState<VetoDesign>(defaultVetoDesign);
  const [history, setHistory] = useState<VetoDesign[]>([]);
  const [future, setFuture] = useState<VetoDesign[]>([]);
  const [scenario, setScenario] = useState('ban');
  const [format, setFormat] = useState<VetoState['format']>('bo3');
  const [selected, setSelected] = useState<string | null>(null);
  const [status, setStatus] = useState('Loading design…');
  const [dirty, setDirty] = useState(false);
  const [published, setPublished] = useState(false);
  const [publishedDesign, setPublishedDesign] = useState<VetoDesign | null>(null);
  const [previewOnly, setPreviewOnly] = useState(false);
  const [liveVeto, setLiveVeto] = useState<VetoState | null>(null);
  const [liveMaps, setLiveMaps] = useState<VetoMapMetadata>(new Map());
  const [liveLogos, setLiveLogos] = useState({ team1: null as string | null, team2: null as string | null });
  const [tournamentName, setTournamentName] = useState('');
  const [savedDesign, setSavedDesign] = useState<VetoDesign>(defaultVetoDesign);
  const [canvasSnapEnabled, setCanvasSnapEnabled] = useState(true);
  const [elementSnapEnabled, setElementSnapEnabled] = useState(true);
  const [snapGuides, setSnapGuides] = useState<VetoSnapGuides>({});
  const [distanceGuides, setDistanceGuides] = useState<VetoDistanceMeasurement[]>([]);

  const screen: VetoScreen = scenario === 'standby' || scenario === 'real' && !liveVeto ? 'standby' : scenario === 'completed' || scenario === 'real' && liveVeto?.status === 'completed' ? 'completed' : 'live';
  const layout = design.screens[screen];
  const current = layout.elements.find((element) => element.id === selected) || null;
  const mock = useMemo(() => scenario === 'real' ? liveVeto : previewVeto(scenario, format), [scenario, format, liveVeto]);

  useEffect(() => {
    if (scenario !== 'real') return;
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch('/api/integrations/jts-hud/broadcast-veto', { cache: 'no-store' });
        if (!response.ok) { if (active) setLiveVeto(null); return; }
        const data = await response.json() as { veto?: VetoState; maps?: Array<{ id: string; displayName: string; imageUrl: string | null }>; teamLogos?: { team1?: string | null; team2?: string | null } };
        if (active) { setLiveVeto(data.veto || null); setLiveMaps(new Map(data.maps?.map((map) => [map.id, map]) || [])); setLiveLogos({ team1: data.teamLogos?.team1 || null, team2: data.teamLogos?.team2 || null }); }
      } catch { if (active) setLiveVeto(null); }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => { active = false; window.clearInterval(timer); };
  }, [scenario]);

  useEffect(() => {
    let alive = true;
    void api.get<{ design: VetoDesign | null; published: VetoDesign | null; tournamentName?: string }>('/api/broadcast-veto-design/draft')
      .then((data) => { if (alive) { const loaded = data.design || data.published || defaultVetoDesign(); setDesign(loaded); setSavedDesign(clone(loaded)); setPublishedDesign(data.published); setPublished(Boolean(data.published)); setTournamentName(data.tournamentName || ''); setStatus(data.design ? 'Draft loaded' : 'New design'); } })
      .catch(() => { if (alive) setStatus('Could not load design'); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const commit = useCallback((mutate: (next: VetoDesign) => void) => {
    setHistory((items) => [...items.slice(-29), design]);
    setDesign((previous) => { const next = clone(previous); mutate(next); return next; });
    setFuture([]); setDirty(true); setStatus('Unsaved changes');
  }, [design]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!selected || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('input, select, textarea, [contenteditable="true"]')) return;
      const direction = event.key === 'ArrowLeft' ? { x: -1, y: 0 } : event.key === 'ArrowRight' ? { x: 1, y: 0 } : event.key === 'ArrowUp' ? { x: 0, y: -1 } : event.key === 'ArrowDown' ? { x: 0, y: 1 } : null;
      const element = layout.elements.find((item) => item.id === selected);
      if (!direction || !element) return;
      event.preventDefault();
      const step = event.shiftKey ? 10 : 1;
      const nextPosition = nudgeElementPosition(element, direction.x * step, direction.y * step);
      if (nextPosition.x === element.x && nextPosition.y === element.y) return;
      const peers = layout.elements.filter((item) => item.id !== selected && item.visible !== false).map(({ x, y, w, h }) => ({ x, y, w, h }));
      setSnapGuides({});
      setDistanceGuides(measureElementGaps({ ...element, ...nextPosition }, peers));
      const targets: VetoScreen[] = selected === 'brand' || selected === 'logo' ? ['standby', 'live', 'completed'] : [screen];
      commit((next) => {
        for (const targetScreen of targets) {
          const targetElement = next.screens[targetScreen].elements.find((item) => item.id === selected);
          if (targetElement) Object.assign(targetElement, nudgeElementPosition(targetElement, direction.x * step, direction.y * step));
        }
      });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [commit, layout.elements, screen, selected]);

  const updateElement = useCallback((patch: Partial<VetoElement>) => {
    if (!selected) return;
    commit((next) => {
      const targets: VetoScreen[] = selected === 'brand' || selected === 'logo' ? ['standby', 'live', 'completed'] : [screen];
      for (const target of targets) {
        const element = next.screens[target].elements.find((item) => item.id === selected);
        if (element) Object.assign(element, patch);
      }
    });
  }, [commit, screen, selected]);

  const addElement = (kind: VetoElementKind) => {
    const id = `block-${crypto.randomUUID()}`;
    const element: VetoElement = { id, kind, x: 720, y: 400, w: kind === 'maps' ? 900 : 480, h: kind === 'maps' ? 270 : kind === 'line' ? 6 : 110, text: kind === 'text' ? 'NEW TEXT' : undefined, color: '#FFFFFF', background: kind === 'shape' ? '#2C536E' : undefined, fontSize: 40, columns: 7, gap: 10, visible: true };
    commit((next) => { next.screens[screen].elements.push(element); });
    setSelected(id);
  };

  const remove = () => {
    if (!selected) return;
    commit((next) => { for (const target of selected === 'brand' || selected === 'logo' ? ['standby', 'live', 'completed'] as VetoScreen[] : [screen]) next.screens[target].elements = next.screens[target].elements.filter((item) => item.id !== selected); });
    setSelected(null);
  };

  const duplicate = () => {
    if (!current) return;
    const copy = { ...current, id: `block-${crypto.randomUUID()}`, x: Math.min(1800, current.x + 36), y: Math.min(1000, current.y + 36) };
    commit((next) => { next.screens[screen].elements.push(copy); });
    setSelected(copy.id);
  };

  const moveLayer = (direction: -1 | 1) => {
    if (!selected) return;
    commit((next) => {
      const elements = next.screens[screen].elements;
      const index = elements.findIndex((item) => item.id === selected);
      const other = index + direction;
      if (index >= 0 && other >= 0 && other < elements.length) [elements[index], elements[other]] = [elements[other], elements[index]];
    });
  };

  const undo = () => {
    if (!history.length) return;
    setFuture((items) => [design, ...items]); setDesign(history.at(-1)!); setHistory((items) => items.slice(0, -1)); setDirty(true); setStatus('Unsaved changes');
  };
  const redo = () => {
    if (!future.length) return;
    setHistory((items) => [...items, design]); setDesign(future[0]); setFuture((items) => items.slice(1)); setDirty(true); setStatus('Unsaved changes');
  };

  const onPointerDown = (id: string, event: PointerEvent<HTMLDivElement>, mode: 'move' | 'resize') => {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation(); setSelected(id); setSnapGuides({}); setDistanceGuides([]);
    const element = layout.elements.find((item) => item.id === id);
    const canvas = event.currentTarget.closest('.vdc-canvas') as HTMLElement | null;
    if (!element || !canvas) return;
    const scale = canvas.getBoundingClientRect().width / 1920;
    const start = { x: event.clientX, y: event.clientY, element: { ...element } };
    const peers = layout.elements.filter((item) => item.id !== id && item.visible !== false).map(({ x, y, w, h }) => ({ x, y, w, h }));
    const clearOverlay = () => { setSnapGuides({}); setDistanceGuides([]); };
    let changed = false;
    const move = (pointer: globalThis.PointerEvent) => {
      const dx = Math.round((pointer.clientX - start.x) / scale);
      const dy = Math.round((pointer.clientY - start.y) / scale);
      changed ||= Math.abs(dx) + Math.abs(dy) > 2;
      const desiredX = Math.max(0, Math.min(1920 - start.element.w, start.element.x + dx));
      const desiredY = Math.max(0, Math.min(1080 - start.element.h, start.element.y + dy));
      const snapping = canvasSnapEnabled || elementSnapEnabled;
      const snapped: { x: number; y: number; guides: VetoSnapGuides } = mode === 'move' && snapping
        ? snapElementPosition(start.element, desiredX, desiredY, 16, elementSnapEnabled ? peers : [], canvasSnapEnabled)
        : { x: desiredX, y: desiredY, guides: {} };
      setSnapGuides(mode === 'move' && snapping ? snapped.guides : {});
      setDistanceGuides(mode === 'move' ? measureElementGaps({ ...start.element, x: snapped.x, y: snapped.y }, peers) : []);
      setDesign((previous) => {
        const next = clone(previous);
        const target = next.screens[screen].elements.find((item) => item.id === id);
        if (target) {
          if (mode === 'move') { target.x = snapped.x; target.y = snapped.y; }
          else {
            const nextWidth = Math.max(20, Math.min(1920 - target.x, start.element.w + dx));
            const nextHeight = Math.max(6, Math.min(1080 - target.y, start.element.h + dy));
            if (pointer.shiftKey) {
              const ratio = start.element.w / Math.max(1, start.element.h);
              if (Math.abs(dx) >= Math.abs(dy)) {
                target.w = nextWidth;
                target.h = Math.max(6, Math.min(1080 - target.y, Math.round(nextWidth / ratio)));
              } else {
                target.h = nextHeight;
                target.w = Math.max(20, Math.min(1920 - target.x, Math.round(nextHeight * ratio)));
              }
            } else {
              target.w = nextWidth;
              target.h = nextHeight;
            }
          }
        }
        return next;
      });
    };
    const finish = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', cancel); window.removeEventListener('blur', cancel);
      clearOverlay();
      if (changed) { setHistory((items) => [...items.slice(-29), { ...design, screens: { ...design.screens, [screen]: { ...layout, elements: layout.elements.map((item) => item.id === id ? start.element : item) } } }]); setFuture([]); setDirty(true); setStatus('Unsaved changes'); }
    };
    const stop = () => finish();
    const cancel = () => finish();
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop, { once: true }); window.addEventListener('pointercancel', cancel, { once: true }); window.addEventListener('blur', cancel, { once: true });
  };

  const save = async (publish: boolean) => {
    try {
      setStatus(publish ? 'Publishing…' : 'Saving…');
      await api.put('/api/broadcast-veto-design/draft', { design });
      if (publish) { await api.post('/api/broadcast-veto-design/publish'); setPublished(true); setPublishedDesign(clone(design)); }
      setSavedDesign(clone(design)); setDirty(false); setStatus(publish ? 'Published · live output updates automatically' : 'Draft saved');
    } catch (error) { setStatus(`Error: ${error instanceof Error ? error.message : 'could not save'}`); }
  };

  const upload = async (file: File, target: 'background' | 'element' | 'map', mapName?: string) => {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) { setStatus('Use a PNG, JPEG, or WebP file up to 8 MB'); return; }
    try {
      const imageData = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); });
      const response = await api.post<{ url: string }>('/api/broadcast-veto-design/asset', { imageData });
      if (target === 'background') commit((next) => { next.screens[screen].backgroundImage = response.url; });
      else if (target === 'map' && mapName && current) updateElement({ mapImages: { ...current.mapImages, [mapName]: response.url } });
      else updateElement({ imageUrl: response.url, binding: 'none' });
    } catch { setStatus('Could not upload image'); }
  };

  const restoreAspectRatio = () => {
    if (!current || current.kind !== 'image' || !current.imageUrl) return;
    const image = new window.Image();
    image.onload = () => {
      const size = restoreImageAspectRatio(current, image.naturalWidth, image.naturalHeight);
      if (!size) { setStatus('Could not read image dimensions'); return; }
      commit((next) => {
        const element = next.screens[screen].elements.find((item) => item.id === current.id);
        if (element) Object.assign(element, size);
      });
    };
    image.onerror = () => setStatus('Could not read image dimensions');
    image.src = current.imageUrl;
  };

  const resetAllChanges = () => {
    if (!dirty || !window.confirm('Discard all unsaved changes and restore the last saved draft?')) return;
    setHistory((items) => [...items.slice(-29), design]);
    setDesign(clone(savedDesign));
    setFuture([]); setSelected(null); setDirty(false); setStatus('All changes discarded');
  };

  const resetAllScreens = () => {
    if (!window.confirm('Reset all Veto screens to the default template? Your current layout changes will be kept in Undo until you leave the page.')) return;
    const template = defaultVetoDesign();
    setHistory((items) => [...items.slice(-29), design]);
    setDesign((previous) => ({ ...previous, screens: clone(template).screens }));
    setFuture([]); setSelected(null); setSnapGuides({}); setDistanceGuides([]); setDirty(true); setStatus('All screens reset to default template');
  };

  const field = (label: string, value: string | number, change: (value: string) => void, type = 'text') => <label className="vd-field"><span>{label}</span><input type={type} value={value} onChange={(event) => change(event.target.value)} /></label>;
  const numeric = (label: string, key: 'x' | 'y' | 'w' | 'h' | 'fontSize' | 'radius' | 'gap' | 'columns', value: number | undefined) => field(label, value ?? 0, (raw) => { const n = Number(raw); const max = key === 'columns' ? 10 : key === 'gap' ? 100 : key === 'radius' ? 500 : key === 'fontSize' ? 240 : key === 'y' || key === 'h' ? 1080 : 1920; const min = key === 'w' || key === 'h' || key === 'columns' ? 1 : key === 'fontSize' ? 8 : 0; if (Number.isFinite(n)) updateElement({ [key]: Math.max(min, Math.min(max, Math.round(n))) }); }, 'number');
  const teamFallback = { ...defaultTeamFallback, ...design.teamFallback };
  const updateTeamFallback = (patch: Partial<VetoTeamFallback>) => commit((next) => { next.teamFallback = { ...defaultTeamFallback, ...next.teamFallback, ...patch }; });
  const fallbackNumber = (label: string, key: 'maxLetters' | 'radius', min: number, max: number) => <label className="vd-field"><span>{label}</span><input type="number" min={min} max={max} value={teamFallback[key]} onChange={(event) => { const value = Number(event.target.value); if (Number.isFinite(value)) updateTeamFallback({ [key]: Math.max(min, Math.min(max, Math.round(value))) }); }} /></label>;

  return <div className="vd-root">
    <header className="vd-top"><Link to="/settings" className="vd-back">← Settings</Link><div><strong>VETO DESIGNER</strong><small>Canvas 1920 × 1080 · {status}</small></div><div className="vd-actions"><button onClick={() => setPreviewOnly((value) => !value)}>{previewOnly ? 'Show panels' : 'Focus preview'}</button><button onClick={undo} disabled={!history.length}>↶ Undo</button><button onClick={redo} disabled={!future.length}>↷ Redo</button><button onClick={resetAllChanges} disabled={!dirty}>Reset all changes</button><button className="vd-reset-template" onClick={resetAllScreens} title="Restore standby, live, and completed screens to the default template">Reset all screens</button><button onClick={() => void save(false)}>Save draft</button><button className="vd-publish" onClick={() => void save(true)}>Publish</button><a href="/broadcast/veto" target="_blank" rel="noreferrer">Open live output ↗</a></div></header>
    <div className={`vd-workspace ${previewOnly ? 'vd-preview-only' : ''}`}>
      <aside className="vd-panel"><h2>Screen & state</h2><label className="vd-field"><span>Preview scenario</span><select value={scenario} onChange={(event) => { setScenario(event.target.value); setSelected(null); setSnapGuides({}); setDistanceGuides([]); }}>{scenarios.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label className="vd-field"><span>Match format</span><select value={format} disabled={scenario === 'real'} onChange={(event) => setFormat(event.target.value as VetoState['format'])}><option value="bo1">BO1</option><option value="bo3">BO3</option><option value="bo5">BO5</option></select></label><p className="vd-hint">{scenario === 'real' ? 'Live data refreshes automatically. The editor never changes the real Veto.' : 'This is a simulated state. It does not change a real match.'}</p><label className="vd-check"><input type="checkbox" checked={canvasSnapEnabled} onChange={(event) => { setCanvasSnapEnabled(event.target.checked); setSnapGuides({}); setDistanceGuides([]); }} /> Snap to canvas edges & center</label><label className="vd-check"><input type="checkbox" checked={elementSnapEnabled} onChange={(event) => { setElementSnapEnabled(event.target.checked); setSnapGuides({}); setDistanceGuides([]); }} /> Snap to nearby blocks</label><p className="vd-hint">Use either guide system alone or both together while dragging.</p>
        <h2>Add block</h2><div className="vd-add">{kinds.map(([kind, label]) => <button key={kind} onClick={() => addElement(kind)}>＋ {label}</button>)}</div>
        <h2>Layers · {screen}</h2><div className="vd-layers">{[...layout.elements].reverse().map((element) => <button key={element.id} className={selected === element.id ? 'active' : ''} onClick={() => { setSelected(element.id); setSnapGuides({}); setDistanceGuides([]); }}><span>{element.kind === 'text' ? element.text || element.binding || 'Text' : kinds.find(([kind]) => kind === element.kind)?.[1]}</span><b>{element.visible === false ? '○' : '●'}</b></button>)}</div>
      </aside>
      <main className="vd-preview" onPointerDown={(event) => { if (event.target === event.currentTarget || (event.target as HTMLElement).classList.contains('vdc-canvas')) { setSelected(null); setSnapGuides({}); setDistanceGuides([]); } }}><div className="vd-preview-label">PREVIEW · {screen.toUpperCase()} · {published ? 'PUBLISHED DESIGN AVAILABLE' : 'NOT PUBLISHED YET'}</div><div className="vd-stage"><VetoDesignCanvas design={design} screen={screen} veto={mock} branding={branding} tournamentName={tournamentName} maps={scenario === 'real' ? liveMaps : undefined} logos={scenario === 'real' ? liveLogos : undefined} guides={snapGuides} distances={distanceGuides} selectedId={selected} onElementPointerDown={onPointerDown} /></div><div className="vd-preview-foot">Drag a block or its resize handle. Changes appear here immediately and in live output after publishing. Arrow keys move 1 px · Shift + arrow moves 10 px.</div></main>
      <aside className="vd-panel vd-inspector"><h2>{current ? 'Block properties' : 'Screen background'}</h2>{current ? <>
        <p className="vd-hint">{current.kind.toUpperCase()} · {current.id === 'brand' || current.id === 'logo' ? 'shared across all screens' : screen}</p>
        <div className="vd-grid">{numeric('X', 'x', current.x)}{numeric('Y', 'y', current.y)}{numeric('Width', 'w', current.w)}{numeric('Height', 'h', current.h)}</div>
        {(current.kind === 'text' || current.kind === 'image') && <label className="vd-field"><span>Data source</span><select value={current.binding || 'none'} onChange={(event) => updateElement({ binding: event.target.value as VetoBinding })}>{bindings.filter(([value]) => current.kind === 'image' ? ['none', 'brandLogo', 'team1Logo', 'team2Logo'].includes(value) : !value.endsWith('Logo')).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>}
        {current.kind === 'text' && <>{field('Text', current.text || '', (value) => updateElement({ text: value }))}<div className="vd-grid">{numeric('Size', 'fontSize', current.fontSize)}<label className="vd-field"><span>Alignment</span><select value={current.align || 'left'} onChange={(event) => updateElement({ align: event.target.value as VetoElement['align'] })}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label></div><div className="vd-grid"><label className="vd-field"><span>Font</span><select value={current.fontFamily || 'Inter'} onChange={(event) => updateElement({ fontFamily: event.target.value as VetoElement['fontFamily'] })}>{['Inter', 'Arial', 'Impact', 'Georgia', 'monospace'].map((font) => <option key={font}>{font}</option>)}</select></label><label className="vd-field"><span>Weight</span><select value={current.weight || 700} onChange={(event) => updateElement({ weight: Number(event.target.value) as VetoElement['weight'] })}>{[400, 500, 600, 700, 800, 900].map((weight) => <option key={weight} value={weight}>{weight}</option>)}</select></label></div>{field('Text color', current.color || '#FFFFFF', (value) => updateElement({ color: value }), 'color')}</>}
        {(current.kind === 'shape' || current.kind === 'text' || current.kind === 'maps') && field('Fill', current.background || '#0F1B29', (value) => updateElement({ background: value }), 'color')}
        {(current.kind === 'shape' || current.kind === 'maps') && field('Border color', current.borderColor || '#536A83', (value) => updateElement({ borderColor: value }), 'color')}
        {(current.kind === 'image') && <>{field('Image URL', current.imageUrl || '', (value) => updateElement({ imageUrl: value }))}<label className="vd-upload">Upload image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (file) void upload(file, 'element'); }} /></label><button onClick={restoreAspectRatio} disabled={!current.imageUrl}>Restore aspect ratio</button><p className="vd-hint">Fits width and height to the uploaded image while keeping the block centered.</p></>}
        {current.kind === 'maps' && <><div className="vd-grid">{numeric('Columns', 'columns', current.columns)}{numeric('Gap', 'gap', current.gap)}</div><p className="vd-hint">Map images · blank fields use the catalog image</p>{mock?.allMaps?.map((name) => <div key={name} className="vd-map-image"><strong>{name}</strong><input aria-label={`Image for ${name}`} value={current.mapImages?.[name] || ''} placeholder="Image URL" onChange={(event) => { const images = { ...current.mapImages }; if (event.target.value) images[name] = event.target.value; else delete images[name]; updateElement({ mapImages: images }); }} /><label className="vd-upload">Upload<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (file) void upload(file, 'map', name); }} /></label></div>)}</>}
        {(current.kind === 'shape' || current.kind === 'maps' || current.kind === 'text') && numeric('Radius', 'radius', current.radius)}
        <label className="vd-field"><span>Opacity {Math.round((current.opacity ?? 1) * 100)}%</span><input type="range" min="0" max="1" step="0.05" value={current.opacity ?? 1} onChange={(event) => updateElement({ opacity: Number(event.target.value) })} /></label>
        <label className="vd-check"><input type="checkbox" checked={current.visible !== false} onChange={(event) => updateElement({ visible: event.target.checked })} /> Show block</label>
        <div className="vd-tools"><button onClick={() => moveLayer(1)}>Bring forward</button><button onClick={() => moveLayer(-1)}>Send backward</button><button onClick={duplicate}>Duplicate</button><button className="danger" onClick={remove}>Delete</button></div>
      </> : <>{field('Background color', layout.background, (value) => commit((next) => { next.screens[screen].background = value; }), 'color')}{field('Background URL', layout.backgroundImage || '', (value) => commit((next) => { next.screens[screen].backgroundImage = value; }))}<label className="vd-upload">Upload background<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (file) void upload(file, 'background'); }} /></label><button onClick={() => commit((next) => { delete next.screens[screen].backgroundImage; })}>Remove background</button><div className="vd-tools"><button onClick={() => commit((next) => { next.screens[screen] = clone(defaultVetoDesign()).screens[screen]; })}>Reset screen template</button><button disabled={!publishedDesign} onClick={() => { if (publishedDesign) commit((next) => { next.screens[screen] = clone(publishedDesign).screens[screen]; }); }}>Restore published</button></div><h2>Team logo fallback</h2><p className="vd-hint">Used when a team has no uploaded logo, including picked map cards.</p><label className="vd-field"><span>Fallback style</span><select value={teamFallback.mode} onChange={(event) => updateTeamFallback({ mode: event.target.value as VetoTeamFallback['mode'] })}><option value="initials">Initials (KT)</option><option value="first-letter">First letter (K)</option><option value="first-last">First + last (KS)</option><option value="full-name">Full team name</option><option value="hidden">Hide fallback</option></select></label><div className="vd-grid">{fallbackNumber('Maximum short letters', 'maxLetters', 1, 4)}{fallbackNumber('Corner radius', 'radius', 0, 500)}</div><div className="vd-grid">{field('Background', teamFallback.background, (value) => updateTeamFallback({ background: value }), 'color')}{field('Text color', teamFallback.color, (value) => updateTeamFallback({ color: value }), 'color')}</div>{field('Border color', teamFallback.borderColor, (value) => updateTeamFallback({ borderColor: value }), 'color')}<p className="vd-hint">Select a block on the canvas to edit it. Each state has its own background and elements.</p></>}
      </aside>
    </div>
    <style>{editorStyles}</style>
  </div>;
}

const editorStyles = `
  .vd-preview-only{grid-template-columns:minmax(0,1fr)!important}.vd-preview-only .vd-panel{display:none}
  .vd-root{height:calc(100vh - 180px);min-height:650px;display:flex;flex-direction:column;background:#1C1B1F;color:#E6E1E5;font-family:Inter,Arial,sans-serif;border:1px solid #49454F;border-radius:8px;overflow:hidden}.vd-root *{box-sizing:border-box}.vd-top{height:72px;flex:none;display:flex;align-items:center;gap:28px;padding:0 24px;border-bottom:1px solid #49454F;background:#2B2930}.vd-top>div:nth-child(2){display:flex;flex-direction:column;min-width:220px}.vd-top strong{font-size:17px;letter-spacing:.1em}.vd-top small{font-size:12px;color:#CAC4D0}.vd-back{color:#D0BCFF;text-decoration:none;white-space:nowrap}.vd-actions{margin-left:auto;display:flex;align-items:center;gap:8px}.vd-root button,.vd-root select,.vd-root input{font:inherit}.vd-root button,.vd-root .vd-actions a,.vd-upload{border:1px solid #79747E;background:#332D3C;color:#E6E1E5;padding:9px 12px;border-radius:8px;cursor:pointer;text-decoration:none}.vd-root button:hover,.vd-root .vd-actions a:hover,.vd-upload:hover{background:rgba(208,188,255,.12)}.vd-root button:disabled{opacity:.4;cursor:default}.vd-root .vd-publish{background:#D0BCFF;color:#381E72;border-color:#D0BCFF;font-weight:800}.vd-root .vd-reset-template{border-color:#A88992;color:#FFC4C8}.vd-workspace{display:grid;grid-template-columns:290px minmax(0,1fr) 300px;min-height:0;flex:1}.vd-panel{overflow:auto;padding:20px;background:#2B2930;border-right:1px solid #49454F}.vd-inspector{border-right:0;border-left:1px solid #49454F}.vd-panel h2{font-size:14px;letter-spacing:.06em;text-transform:uppercase;margin:7px 0 14px;color:#E8DEF8}.vd-panel h2:not(:first-child){margin-top:29px;border-top:1px solid #49454F;padding-top:18px}.vd-field{display:flex;flex-direction:column;gap:6px;margin:0 0 13px;font-size:12px;color:#CAC4D0}.vd-field input,.vd-field select{height:35px;border:1px solid #79747E;border-radius:6px;background:#1C1B1F;color:#E6E1E5;padding:0 8px;min-width:0}.vd-field input[type=color]{padding:2px;width:100%}.vd-field input[type=range]{padding:0}.vd-hint{color:#CAC4D0;font-size:12px;line-height:1.5}.vd-add{display:grid;grid-template-columns:1fr 1fr;gap:8px}.vd-add button{text-align:left;font-size:12px}.vd-layers{display:flex;flex-direction:column;gap:3px}.vd-layers button{display:flex;justify-content:space-between;text-align:left;overflow:hidden;white-space:nowrap;font-size:12px}.vd-layers button span{overflow:hidden;text-overflow:ellipsis}.vd-layers button.active{border-color:#D0BCFF;background:rgba(208,188,255,.16)}.vd-layers b{margin-left:8px;color:#D0BCFF}.vd-preview{min-width:0;min-height:0;display:flex;flex-direction:column;align-items:stretch;justify-content:center;padding:18px;background:radial-gradient(circle at center,#3A3542,#1C1B1F)}.vd-preview-label,.vd-preview-foot{padding:0 4px 12px;color:#CAC4D0;font-size:12px;letter-spacing:.07em}.vd-preview-foot{padding:12px 4px 0;letter-spacing:0}.vd-stage{width:100%;aspect-ratio:16/9;max-height:calc(100vh - 330px);border:1px solid #79747E;box-shadow:0 24px 70px #0009;background:#080d15}.vd-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.vd-tools{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:15px}.vd-tools .danger{border-color:#FFB4AB;color:#FFB4AB}.vd-check{display:flex;align-items:center;gap:8px;margin:12px 0;font-size:13px}.vd-upload{display:block;text-align:center;margin:8px 0 14px;font-size:12px}.vd-upload input{display:none}.vd-map-image{padding:8px;border:1px solid #49454F;margin-bottom:8px}.vd-map-image strong{display:block;font-size:12px;margin-bottom:6px}.vd-map-image>input{width:100%;background:#1C1B1F;color:#E6E1E5;border:1px solid #79747E;padding:7px}.vd-map-image .vd-upload{margin:6px 0 0}@media(max-width:1200px){.vd-workspace{grid-template-columns:230px minmax(0,1fr) 260px}.vd-top{gap:10px}.vd-top small{display:none}.vd-actions button,.vd-actions a{font-size:12px;padding:6px!important}}
`;
