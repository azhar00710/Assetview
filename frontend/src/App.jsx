import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useTheme } from './context/ThemeContext';
import { useAuth } from './context/AuthContext';
import { SC, STC, COL } from './data/constants';
import RegisterView from './components/RegisterView';
import AssetExplorer from './components/AssetExplorer';
import HierarchyTree from './components/HierarchyTree';
import AdminLayout from './components/admin/AdminLayout';
import LoginPage from './components/LoginPage';
import PnidViewer from './components/pnid/PnidViewer';
import SystemCanvas from './components/canvas/SystemCanvas';
import SplitPaneView from './components/SplitPaneView';
import PidModule from './components/PidModule';
import OcrPipelineLayout from './components/ocr-pipeline/OcrPipelineLayout';
import AnnotationWorkspace from './components/annotations/AnnotationWorkspace';
import { usePlatforms, useSystems, usePnids, usePnidsByPlatform, useLines, useEquipment, useInstruments } from './hooks/useApi';
import { parseDeepLink, resolveDeepLink, isAdminHash } from './lib/deepLink';

/* ═══ API → UI shape mappers ═══ */
function mapPnid(p) {
  return {
    id: p.id, name: p.drawingNumber, title: p.title, rev: p.revision,
    status: p.status, hasImage: p.hasImage, isPrimary: p.isPrimary ?? true,
    _lineCount: p.lineCount, _xrefSysCount: p.xrefSystemCount,
    _primarySystemId: p.primarySystemId,
  };
}
function mapLine(l) {
  return {
    id: l.id, name: l.lineNumber, service: l.service, size: l.nominalSize,
    pipeClass: l.pipeClass, material: l.material, dp: l.designPressure, dt: l.designTemperature,
    systemId: l.ownerSystemId,
    ownerSys: { id: l.ownerSystemId, code: l.ownerSystemCode, sysType: l.ownerSystemType },
    _xref: l.isCrossReference, isCont: l.isContinuation,
    _equipCount: l.equipmentCount, _instCount: l.instrumentCount,
    _pnidCount: l.pnidCount, _pnidNumbers: l.pnidNumbers || [],
  };
}
function mapEquip(e) {
  return {
    id: e.id, tag: e.tag, eqType: e.equipmentType, desc: e.description,
    systemId: e.systemId, systemCode: e.systemCode, criticality: e.criticality,
    sil: e.silLevel, insp: e.inspectionGroup, cl: e.corrosionLoop,
    lineId: e.lineId, _loc: e.isStandalone ? 'standalone' : 'on-line',
  };
}
function mapInst(i) {
  return {
    id: i.id, tag: i.tag, iType: i.instrumentType, desc: i.description,
    range: [i.rangeMin, i.rangeMax].filter(Boolean).join('-') + (i.rangeUnit ? ` ${i.rangeUnit}` : ''),
    scada: i.scadaTag, systemId: i.systemId, systemCode: i.systemCode,
    lineId: i.lineId, lineName: i.lineNumber,
  };
}

export default function App() {
  const { isDark, toggleTheme } = useTheme();
  const { user, loading: authLoading, isAuthenticated, hasPermission, logout } = useAuth();

  const [platformId, setPlatformId] = useState(null);
  const [selSys, setSelSys] = useState(null);
  const [selPnid, setSelPnid] = useState(null);
  const [selLine, setSelLine] = useState(null);
  const [selItem, setSelItem] = useState(null);
  const [showXref, setShowXref] = useState(true);
  const [search, setSearch] = useState("");
  const [register, setRegister] = useState(null);
  const [showExplorer, setShowExplorer] = useState(false);
  const [showTree, setShowTree] = useState(false);
  const [showAdmin, setShowAdmin] = useState(() => isAdminHash());
  const [viewPnid, setViewPnid] = useState(null); // { id, drawingNumber, title } — opens P&ID viewer
  const [pnidFocus, setPnidFocus] = useState(null); // { entityId, entityType, tag } from deep link
  const [deepLinkError, setDeepLinkError] = useState(null);
  const [deepLinkLoading, setDeepLinkLoading] = useState(false);
  const deepLinkHandledRef = useRef(null);
  const [showCanvas, setShowCanvas] = useState(false);
  const [canvasSystemId, setCanvasSystemId] = useState(null);
  const [showSplitView, setShowSplitView] = useState(false);
  const [showPidModule, setShowPidModule] = useState(false);
  const [showOcrPipeline, setShowOcrPipeline] = useState(false);
  const [showAnnotationWorkspace, setShowAnnotationWorkspace] = useState(false);

  // Sync admin mode with URL hash for page refresh persistence
  const setAdminMode = useCallback((val) => {
    if (val && !hasPermission('admin.access')) return;
    setShowAdmin(val);
    if (val) {
      window.location.hash = '#admin';
    } else if (isAdminHash()) {
      window.location.hash = '';
    }
  }, [hasPermission]);

  // Drop admin hash if user lacks permission
  useEffect(() => {
    if (!authLoading && isAuthenticated && showAdmin && !hasPermission('admin.access')) {
      setShowAdmin(false);
      if (isAdminHash()) window.location.hash = '';
    }
  }, [authLoading, isAuthenticated, showAdmin, hasPermission]);

  const closePnidViewer = useCallback(() => {
    setViewPnid(null);
    setPnidFocus(null);
    setDeepLinkError(null);
    // Clear deep-link hash so Back doesn't immediately re-open
    const link = parseDeepLink();
    if (link && !isAdminHash()) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
      deepLinkHandledRef.current = null;
    }
  }, []);

  // Deep-link: open P&ID and highlight equipment/instrument/line from another app
  useEffect(() => {
    let cancelled = false;

    const applyDeepLink = async () => {
      if (isAdminHash()) {
        setShowAdmin(true);
        return;
      }

      const link = parseDeepLink();
      if (!link) return;

      // Tag-only links need a platform to search — wait until one is selected
      if (!link.pnidId && !link.platformId && !platformId) return;

      const key = `${window.location.hash}|${link.platformId || platformId || ''}`;
      if (deepLinkHandledRef.current === key) return;

      setDeepLinkLoading(true);
      setDeepLinkError(null);
      try {
        const resolved = await resolveDeepLink(link, { defaultPlatformId: platformId });
        if (cancelled) return;
        deepLinkHandledRef.current = key;
        setShowAdmin(false);
        setShowCanvas(false);
        setShowSplitView(false);
        setShowOcrPipeline(false);
        setShowAnnotationWorkspace(false);
        setShowPidModule(false);
        setViewPnid(resolved.pnid);
        setPnidFocus(resolved.focus);
      } catch (err) {
        if (cancelled) return;
        console.error('[deep-link]', err);
        // Don't lock the key on failure so retry works once platform loads
        setDeepLinkError(err.message || 'Could not open P&ID link');
      } finally {
        if (!cancelled) setDeepLinkLoading(false);
      }
    };

    applyDeepLink();

    const onHash = () => {
      if (isAdminHash()) {
        setShowAdmin(true);
        return;
      }
      setShowAdmin(false);
      if (parseDeepLink()) {
        deepLinkHandledRef.current = null;
        applyDeepLink();
      }
    };
    window.addEventListener('hashchange', onHash);
    return () => {
      cancelled = true;
      window.removeEventListener('hashchange', onHash);
    };
  }, [platformId]);

  // ═══ API hooks — live data from backend ═══
  const { data: apiPlatforms, isError: platformsError, isFetching: platformsLoading, refetch: refetchPlatforms } = usePlatforms();

  // Auto-select first platform when platforms load
  useEffect(() => {
    if (apiPlatforms?.length && !platformId) {
      setPlatformId(apiPlatforms[0].id);
    }
  }, [apiPlatforms, platformId]);

  const currentPlatform = useMemo(() => {
    return apiPlatforms?.find(p => p.id === platformId) || null;
  }, [apiPlatforms, platformId]);

  // Systems — Miller Column 1
  const { data: apiSystems } = useSystems(platformId);

  // P&IDs — by system (when selected) or by platform
  const { data: apiPnidsBySys } = usePnids(selSys || null, showXref);
  const { data: apiPnidList } = usePnidsByPlatform(platformId);

  // Lines — cascade: pnid > system > platform
  const lineParams = useMemo(() => {
    if (!platformId) return {};
    if (selPnid) return { pnidId: selPnid };
    if (selSys) return { systemId: selSys, includeXref: showXref };
    return { platformId };
  }, [platformId, selPnid, selSys, showXref]);
  const { data: apiLines } = useLines(lineParams);

  // Equipment — cascade: line > pnid > system > platform
  const equipParams = useMemo(() => {
    if (!platformId) return {};
    if (selLine) return { lineId: selLine };
    if (selPnid) return { pnidId: selPnid };
    if (selSys) return { systemId: selSys };
    return { platformId };
  }, [platformId, selLine, selPnid, selSys]);
  const { data: apiEquipment } = useEquipment(equipParams);

  // Instruments — cascade: line > pnid > system > platform
  const instParams = useMemo(() => {
    if (!platformId) return {};
    if (selLine) return { lineId: selLine };
    if (selPnid) return { pnidId: selPnid };
    if (selSys) return { systemId: selSys };
    return { platformId };
  }, [platformId, selLine, selPnid, selSys]);
  const { data: apiInstruments } = useInstruments(instParams);

  // ═══ Register data ═══
  const allPnids = useMemo(() => {
    if (!apiPnidList) return [];
    return apiPnidList.map(p => ({
      ...mapPnid(p),
      primarySystem: p.primarySystemCode || "",
      systems: "",
      systemCount: p.totalSystemCount,
    }));
  }, [apiPnidList]);

  const allLines = useMemo(() => {
    if (!apiLines) return [];
    return apiLines.map(mapLine);
  }, [apiLines]);

  const allEquip = useMemo(() => {
    if (!apiEquipment) return [];
    return apiEquipment.map(mapEquip);
  }, [apiEquipment]);

  const allInst = useMemo(() => {
    if (!apiInstruments) return [];
    return apiInstruments.map(mapInst);
  }, [apiInstruments]);

  // ═══ Cascade filters — API only ═══
  const fSystems = useMemo(() => {
    let s = apiSystems || [];
    if (search) {
      const q = search.toLowerCase();
      s = s.filter(sy => sy.name.toLowerCase().includes(q) || sy.code.toLowerCase().includes(q));
    }
    return s;
  }, [apiSystems, search]);

  const fPnids = useMemo(() => {
    const raw = selSys ? apiPnidsBySys : apiPnidList;
    if (!raw) return [];
    let mapped = raw.map(mapPnid);
    if (!selSys && search) {
      const q = search.toLowerCase();
      const fSysIds = new Set(fSystems.map(s => s.id));
      mapped = mapped.filter(p =>
        fSysIds.has(p._primarySystemId) ||
        p.name.toLowerCase().includes(q) ||
        p.title.toLowerCase().includes(q)
      );
    }
    return mapped;
  }, [apiPnidsBySys, apiPnidList, selSys, fSystems, search]);

  const fLines = useMemo(() => {
    if (!apiLines) return [];
    return apiLines.map(mapLine);
  }, [apiLines]);

  const fEquip = useMemo(() => {
    if (!apiEquipment) return [];
    return apiEquipment.map(mapEquip);
  }, [apiEquipment]);

  const fInst = useMemo(() => {
    if (!apiInstruments) return [];
    return apiInstruments.map(mapInst);
  }, [apiInstruments]);

  // Click handlers (toggle)
  const clickSys = (id) => { setSelSys(selSys === id ? null : id); setSelPnid(null); setSelLine(null); setSelItem(null); };
  const clickPnid = (id) => { setSelPnid(selPnid === id ? null : id); setSelLine(null); setSelItem(null); };
  const clickLine = (id) => { setSelLine(selLine === id ? null : id); setSelItem(null); };

  // Breadcrumb
  const path = useMemo(() => {
    return [
      currentPlatform?.code,
      selSys ? (fSystems.find(s => s.id === selSys)?.code || null) : null,
      selPnid ? (fPnids.find(p => p.id === selPnid)?.name?.split("-D-")[1] || null) : null,
      selLine ? (fLines.find(l => l.id === selLine)?.name?.split("-").slice(0, 3).join("-") || null) : null,
    ].filter(Boolean);
  }, [currentPlatform, fSystems, selSys, fPnids, selPnid, fLines, selLine]);

  if (authLoading) {
    return (
      <div className="h-screen w-screen bg-md-surface font-sans text-md-on-surface flex items-center justify-center">
        <div className="text-[13px] text-md-on-surface-variant">Loading…</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  // Admin view
  if (showAdmin && hasPermission('admin.access')) {
    const adminPlatforms = (apiPlatforms || []).map(p => ({ id: p.id, code: p.code, name: p.name }));
    return (
      <div className="flex h-screen bg-md-surface font-sans text-md-on-surface overflow-hidden">
        <AdminLayout
          platformId={platformId}
          platforms={adminPlatforms}
          onBack={() => setAdminMode(false)}
          onPlatformChange={(id) => setPlatformId(id)}
        />
      </div>
    );
  }

  // P&ID Viewer (annotation module)
  if (viewPnid) {
    return (
      <div className="h-screen w-screen bg-md-surface font-sans text-md-on-surface overflow-hidden">
        <PnidViewer
          pnidId={viewPnid.id}
          drawingNumber={viewPnid.drawingNumber}
          pnidTitle={viewPnid.title}
          initialFocus={pnidFocus}
          onClose={closePnidViewer}
        />
      </div>
    );
  }

  if (deepLinkLoading) {
    return (
      <div className="h-screen w-screen bg-md-surface font-sans text-md-on-surface flex items-center justify-center">
        <div className="text-center">
          <div className="text-sm font-semibold text-md-on-surface">Opening P&ID…</div>
          <div className="text-xs text-md-on-surface-variant mt-1">Resolving tag link</div>
        </div>
      </div>
    );
  }

  if (deepLinkError) {
    return (
      <div className="h-screen w-screen bg-md-surface font-sans text-md-on-surface flex items-center justify-center">
        <div className="text-center max-w-md px-6">
          <div className="text-sm font-semibold text-md-error">Could not open link</div>
          <div className="text-xs text-md-on-surface-variant mt-2">{deepLinkError}</div>
          <button
            type="button"
            className="mt-4 px-3 py-1.5 rounded text-xs font-semibold bg-md-primary text-md-on-primary"
            onClick={() => {
              setDeepLinkError(null);
              closePnidViewer();
            }}
          >
            Continue to AssetView
          </button>
        </div>
      </div>
    );
  }

  // Split Pane View (2D↔3D sync)
  if (showSplitView) {
    return (
      <div className="h-screen w-screen bg-md-surface font-sans text-md-on-surface overflow-hidden">
        <SplitPaneView
          systemId={canvasSystemId}
          platformId={platformId}
          onSystemSelect={(sysId) => setCanvasSystemId(sysId)}
          onClose={() => { setShowSplitView(false); setCanvasSystemId(null); }}
        />
      </div>
    );
  }

  // System Canvas view (semantic zoom)
  if (showCanvas) {
    return (
      <div className="h-screen w-screen bg-md-surface font-sans text-md-on-surface overflow-hidden">
        <SystemCanvas
          systemId={canvasSystemId}
          platformId={platformId}
          onSystemSelect={(sysId) => setCanvasSystemId(sysId)}
          onClose={() => { setShowCanvas(false); setCanvasSystemId(null); }}
        />
      </div>
    );
  }

  // Asset Explorer view
  if (showExplorer) {
    const explorerPlatforms = (apiPlatforms || []).map(p => ({ id: p.id, code: p.code, name: p.name }));
    return (
      <div className="flex h-screen bg-md-surface font-sans text-md-on-surface overflow-hidden">
        <AssetExplorer
          platformId={platformId}
          platforms={explorerPlatforms}
          onBack={() => setShowExplorer(false)}
          onPlatformChange={(id) => setPlatformId(id)}
        />
      </div>
    );
  }

  // Neural Tree view
  if (showTree) {
    return (
      <div className="flex h-screen bg-md-surface font-sans text-md-on-surface overflow-hidden">
        <HierarchyTree platformId={platformId} onBack={() => setShowTree(false)} />
      </div>
    );
  }

  // Annotation Workspace (standalone module)
  if (showAnnotationWorkspace) {
    return (
      <div className="h-screen w-screen bg-md-surface font-sans text-md-on-surface overflow-hidden">
        <AnnotationWorkspace
          platformId={platformId}
          onClose={() => setShowAnnotationWorkspace(false)}
          initialPnid={viewPnid}
        />
      </div>
    );
  }

  // OCR Pipeline (standalone module)
  if (showOcrPipeline) {
    return (
      <div className="h-screen w-screen bg-md-surface font-sans text-md-on-surface overflow-hidden">
        <OcrPipelineLayout
          onBack={() => setShowOcrPipeline(false)}
          onOpenPnidViewer={(pnid) => { setShowOcrPipeline(false); setViewPnid(pnid); }}
        />
      </div>
    );
  }

  // P&ID Module (dedicated annotation/OCR pipeline view)
  if (showPidModule) {
    return (
      <div className="h-screen w-screen bg-md-surface font-sans text-md-on-surface overflow-hidden">
        <PidModule
          platformId={platformId}
          onClose={() => setShowPidModule(false)}
          onViewPnid={(pnid) => { setShowPidModule(false); setViewPnid(pnid); }}
        />
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-md-surface font-sans text-md-on-surface overflow-hidden">
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* ═══ TOP BAR ═══ */}
        <div className="flex items-center px-4 h-14 bg-md-surface-container shadow-md-1 gap-3 shrink-0 z-10">
          {/* Logo */}
          <div className="w-8 h-8 rounded-md-md bg-md-primary-container flex items-center justify-center">
            <span className="text-md-on-primary-container text-label-md font-bold">AV</span>
          </div>
          <div className="flex flex-col leading-none">
            <span className="text-title-sm text-md-on-surface">AssetView</span>
            <span className="text-label-sm text-md-primary tracking-widest">GEOSOFT</span>
          </div>

          <div className="w-px h-6 bg-md-outline-variant" />

          {/* Breadcrumb or Register label */}
          {!register ? (
            <nav className="flex items-center gap-1">
              {path.map((p, i) => (
                <span key={i} className="flex items-center gap-1">
                  {i > 0 && <span className="text-md-outline text-body-sm">/</span>}
                  <span className={`text-label-md ${i === path.length - 1 ? 'text-md-primary font-semibold' : 'text-md-on-surface-variant'}`}>{p}</span>
                </span>
              ))}
            </nav>
          ) : (
            <span className="text-label-lg text-md-tertiary font-semibold tracking-wider">{register.toUpperCase()} REGISTER</span>
          )}

          <div className="flex-1" />

          {/* Search */}
          <div className="relative">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-md-on-surface-variant text-[18px]">search</span>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search assets..."
              className="md-input pl-10 pr-3 w-52 text-body-sm"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-md-on-surface-variant hover:text-md-error text-body-sm cursor-pointer transition-colors"
              >
                <span className="material-symbols-outlined text-[16px]">close</span>
              </button>
            )}
          </div>

          {/* Platform selector */}
          <select
            value={platformId || ''}
            onChange={e => { setPlatformId(e.target.value); setSelSys(null); setSelPnid(null); setSelLine(null); setSelItem(null); setRegister(null); }}
            className="md-input px-3 py-2 w-auto text-body-sm cursor-pointer"
          >
            {(apiPlatforms || []).map(p => <option key={p.id} value={p.id}>{p.code}</option>)}
          </select>

          {/* X-Ref toggle */}
          <button
            onClick={() => setShowXref(!showXref)}
            className={`md-filter-chip ${showXref ? '' : 'opacity-50'}`}
            data-selected={showXref ? "true" : "false"}
          >
            <span className="material-symbols-outlined text-[16px]">{showXref ? 'link' : 'link_off'}</span>
            X-Ref2
          </button>

          {/* Tree button */}
          <button
            onClick={() => setShowTree(true)}
            className="md-filter-chip"
            data-selected="false"
          >
            <span className="material-symbols-outlined text-[16px]">account_tree</span>
            Tree
          </button>

          {/* Canvas button */}
          {hasPermission('canvas.view') && (
          <button
            onClick={() => { setShowCanvas(true); setCanvasSystemId(selSys); }}
            className="md-filter-chip"
            data-selected="false"
            style={{ borderColor: 'var(--md-secondary)', color: 'var(--md-secondary)' }}
          >
            <span className="material-symbols-outlined text-[16px]">hub</span>
            Canvas
          </button>
          )}

          {/* Split View button (2D↔3D) */}
          {hasPermission('canvas.view') && (
          <button
            onClick={() => { setShowSplitView(true); setCanvasSystemId(selSys); }}
            className="md-filter-chip"
            data-selected="false"
            style={{ borderColor: 'var(--md-tertiary)', color: 'var(--md-tertiary)' }}
          >
            <span className="material-symbols-outlined text-[16px]">vertical_split</span>
            Split
          </button>
          )}

          {/* Explorer button */}
          {hasPermission('explorer.view') && (
          <button
            onClick={() => setShowExplorer(true)}
            className="md-filter-chip"
            data-selected="false"
            style={{ borderColor: 'var(--md-primary)', color: 'var(--md-primary)' }}
          >
            <span className="material-symbols-outlined text-[16px]">explore</span>
            Explorer
          </button>
          )}

          {/* P&ID Module button */}
          {hasPermission('pnid.view') && (
          <button
            onClick={() => setShowPidModule(true)}
            className="md-filter-chip"
            data-selected="false"
            style={{ borderColor: COL.pnids, color: COL.pnids }}
          >
            <span className="material-symbols-outlined text-[16px]">description</span>
            P&amp;IDs
          </button>
          )}

          {/* Annotation Workspace button */}
          {hasPermission('annotations.edit') && (
          <button
            onClick={() => setShowAnnotationWorkspace(true)}
            className="md-filter-chip"
            data-selected="false"
            style={{ borderColor: '#F39C12', color: '#F39C12' }}
          >
            <span className="material-symbols-outlined text-[16px]">edit_note</span>
            Annotate
          </button>
          )}

          {/* OCR Pipeline button — admin tooling */}
          {hasPermission('admin.access') && (
          <button
            onClick={() => setShowOcrPipeline(true)}
            className="md-filter-chip"
            data-selected="false"
            style={{ borderColor: '#A855F7', color: '#A855F7' }}
          >
            <span className="material-symbols-outlined text-[16px]">document_scanner</span>
            OCR Pipeline
          </button>
          )}

          {/* Admin button */}
          {hasPermission('admin.access') && (
          <button
            onClick={() => setAdminMode(true)}
            className="md-filter-chip"
            data-selected="false"
            style={{ borderColor: 'var(--md-tertiary)', color: 'var(--md-tertiary)' }}
          >
            <span className="material-symbols-outlined text-[16px]">admin_panel_settings</span>
            Admin
          </button>
          )}

          {/* Signed-in user */}
          <div className="flex items-center gap-1.5 shrink-0 max-w-[160px]">
            <span className="text-[10px] truncate" style={{ color: 'var(--md-on-surface-variant)' }} title={user?.email}>
              {user?.displayName || user?.email}
            </span>
            <button
              type="button"
              onClick={logout}
              className="md-filter-chip"
              data-selected="false"
              title="Sign out"
              style={{ borderColor: 'var(--md-outline-variant)', color: 'var(--md-on-surface-variant)' }}
            >
              <span className="material-symbols-outlined text-[16px]">logout</span>
            </button>
          </div>

          {/* API status indicator */}
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ background: platformsError ? '#FF897A' : apiPlatforms?.length ? '#4FE2B0' : platformsLoading ? '#F39C12' : '#FF897A' }}
            title={platformsError ? 'API offline' : apiPlatforms?.length ? 'API connected' : platformsLoading ? 'Connecting…' : 'API offline'}
          />

          {/* Theme toggle */}
          <button onClick={toggleTheme} className="md-icon-btn" title={isDark ? 'Light mode' : 'Dark mode'}>
            <span className="material-symbols-outlined text-[20px]">{isDark ? 'light_mode' : 'dark_mode'}</span>
          </button>
        </div>

        {platformsError && (
          <div
            className="shrink-0 px-4 py-2 flex items-center justify-between gap-3 text-sm"
            style={{ background: '#FF897A18', borderBottom: '1px solid #FF897A40', color: 'var(--md-on-surface)' }}
          >
            <span>
              <strong>Backend offline</strong> — P&amp;IDs and data cannot load. Port 3001 is not responding.
            </span>
            <button
              type="button"
              onClick={() => refetchPlatforms()}
              className="shrink-0 px-3 py-1 rounded text-xs font-semibold"
              style={{ background: '#FF897A30' }}
            >
              Retry
            </button>
          </div>
        )}

        {/* ═══ REGISTER or MILLER COLUMNS ═══ */}
        {register ? (
          <RegisterView
            type={register}
            platform={platformId}
            allPnids={allPnids}
            allLines={allLines}
            allEquip={allEquip}
            allInst={allInst}
            onExit={() => setRegister(null)}
            onSelectItem={setSelItem}
            apiReady={true}
            apiPlatformId={platformId}
          />
        ) : (
          <div className="flex-1 flex overflow-hidden">
            {/* SYSTEMS */}
            <MColumn title="SYSTEMS" count={fSystems.length} color={COL.systems} onHeaderClick={() => setRegister("systems")}>
              {fSystems.map((sys, idx) => {
                const isSel = selSys === sys.id;
                const sc = SC[sys.sysType];
                const pc = sys.primaryPnidCount ?? 0;
                const lc = sys.lineCount ?? 0;
                const ec = sys.equipmentCount ?? 0;
                return (
                  <div key={sys.id} onClick={() => clickSys(sys.id)}
                    className="md-list-item px-3 py-2.5 mx-1.5 my-0.5 cursor-pointer animate-md-list-enter"
                    style={{
                      background: isSel ? `${sc}18` : undefined,
                      borderLeft: `3px solid ${isSel ? sc : 'transparent'}`,
                      animationDelay: `${idx * 30}ms`,
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: sc }} />
                      <span className={`text-body-sm font-medium flex-1 truncate ${isSel ? 'font-semibold' : ''}`} style={isSel ? { color: sc } : {}}>
                        {sys.name}
                      </span>
                    </div>
                    <div className="flex gap-1.5 mt-1.5 pl-4 items-center">
                      <Pill color={COL.pnids}>{pc} P&amp;ID</Pill>
                      <Pill color={COL.lines}>{lc} lines</Pill>
                      <Pill color={COL.equipment}>{ec} equip</Pill>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setCanvasSystemId(sys.id);
                          setShowCanvas(true);
                        }}
                        className="shrink-0 px-1.5 py-0.5 rounded text-label-sm font-semibold hover:bg-md-primary/20 transition-colors ml-auto"
                        style={{ color: sc }}
                        title="Open System Canvas"
                      >
                        Canvas
                      </button>
                    </div>
                  </div>
                );
              })}
            </MColumn>

            {/* P&IDs */}
            <MColumn title="P&IDs" count={fPnids.length} color={COL.pnids} onHeaderClick={() => setRegister("pnids")}>
              {fPnids.map((pnid, idx) => {
                const isSel = selPnid === pnid.id;
                const isXref = pnid.isPrimary === false;
                const lc = pnid._lineCount ?? 0;
                const xSys = pnid._xrefSysCount ?? 0;
                return (
                  <div key={pnid.id + (isXref ? "x" : "")} onClick={() => clickPnid(pnid.id)}
                    className="md-list-item px-3 py-2 mx-1.5 my-0.5 cursor-pointer animate-md-list-enter"
                    style={{
                      background: isSel ? `${COL.pnids}18` : undefined,
                      borderLeft: `3px solid ${isSel ? COL.pnids : isXref ? COL.lines + '55' : 'transparent'}`,
                      opacity: isXref ? 0.7 : 1,
                      animationDelay: `${idx * 30}ms`,
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-label-sm text-md-on-surface-variant">{isXref ? '\u2197' : '\u229E'}</span>
                      <span className={`text-body-sm font-medium flex-1 truncate ${isSel ? 'font-semibold' : ''}`} style={isSel ? { color: COL.pnids } : {}}>
                        {pnid.name.split("-D-")[1] || pnid.name}
                      </span>
                      <span className="text-label-sm px-1.5 py-0.5 rounded-md-full" style={{ background: `${STC[pnid.status]}20`, color: STC[pnid.status] }}>
                        {pnid.status.replace(/_/g, " ")}
                      </span>
                      {/* Open P&ID Viewer */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setViewPnid({ id: pnid.id, drawingNumber: pnid.name, title: pnid.title });
                        }}
                        className="shrink-0 px-1.5 py-0.5 rounded text-label-sm font-semibold hover:bg-md-primary/20 transition-colors"
                        style={{ color: COL.pnids }}
                        title="Open P&ID Viewer"
                      >
                        View
                      </button>
                    </div>
                    <div className="text-body-sm text-md-on-surface-variant mt-0.5 truncate pl-6">{pnid.title}</div>
                    <div className="flex gap-2 mt-1 pl-6 text-label-sm text-md-on-surface-variant">
                      <span>{lc} lines</span>
                      {isXref && <Pill color={COL.lines}>x-ref</Pill>}
                      {!isXref && xSys > 0 && <span className="font-medium" style={{ color: COL.lines }}>+{xSys} sys</span>}
                    </div>
                  </div>
                );
              })}
            </MColumn>

            {/* LINES */}
            <MColumn title="LINES" count={fLines.length} color={COL.lines} onHeaderClick={() => setRegister("lines")}>
              {fLines.map((line, idx) => {
                const isSel = selLine === line.id;
                const isXref = line._xref;
                const isCont = line.isCont;
                const os = line.ownerSys;
                const eqC = line._equipCount ?? 0;
                const inC = line._instCount ?? 0;
                const pnidC = line._pnidCount ?? 0;
                return (
                  <div key={line.id + (isXref ? "x" : "")} onClick={() => clickLine(line.id)}
                    className="md-list-item px-3 py-2 mx-1.5 my-0.5 cursor-pointer animate-md-list-enter"
                    style={{
                      background: isSel ? `${COL.lines}18` : undefined,
                      borderLeft: `3px solid ${isSel ? COL.lines : isXref ? SC[os?.sysType] + '55' : 'transparent'}`,
                      opacity: isXref ? 0.7 : 1,
                      animationDelay: `${idx * 30}ms`,
                    }}
                  >
                    <div className="flex items-center gap-1.5">
                      {isXref && <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: SC[os?.sysType] || COL.lines }} />}
                      {isCont && !isXref && <span className="text-label-sm text-md-on-surface-variant">{'\u2197'}</span>}
                      <span className={`text-body-sm font-mono font-medium flex-1 truncate ${isSel ? 'font-semibold' : ''}`} style={isSel ? { color: COL.lines } : {}}>
                        {line.name}
                      </span>
                    </div>
                    <div className="text-body-sm text-md-on-surface-variant mt-0.5">{line.service} &middot; {line.size}</div>
                    <div className="flex gap-2 mt-1 text-label-sm text-md-on-surface-variant">
                      {isXref && <Pill color={SC[os?.sysType]}>{os?.code}</Pill>}
                      {isCont && <Pill color={COL.lines}>cont.</Pill>}
                      {pnidC > 1 && <span style={{ color: COL.pnids }}>{pnidC} P&amp;IDs</span>}
                      {eqC > 0 && <span style={{ color: COL.equipment }}>{eqC} eq</span>}
                      {inC > 0 && <span style={{ color: COL.instruments }}>{inC} inst</span>}
                    </div>
                  </div>
                );
              })}
            </MColumn>

            {/* EQUIPMENT */}
            <MColumn title="EQUIPMENT" count={fEquip.length} color={COL.equipment} onHeaderClick={() => setRegister("equipment")}>
              {fEquip.map((eq, idx) => {
                const isSel = selItem?.id === eq.id;
                const critColor = { high: '#FF897A', medium: '#FFD666', low: '#4FE2B0' }[eq.criticality];
                return (
                  <div key={eq.id} onClick={() => setSelItem(selItem?.id === eq.id ? null : eq)}
                    className="md-list-item px-3 py-2 mx-1.5 my-0.5 cursor-pointer animate-md-list-enter"
                    style={{
                      background: isSel ? `${COL.equipment}18` : undefined,
                      borderLeft: `3px solid ${isSel ? COL.equipment : 'transparent'}`,
                      animationDelay: `${idx * 30}ms`,
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-body-sm font-bold tracking-tight" style={isSel ? { color: COL.equipment } : {}}>{eq.tag}</span>
                      {critColor && (
                        <span className="text-label-sm px-1.5 py-0.5 rounded-md-full" style={{ background: `${critColor}20`, color: critColor }}>
                          {eq.criticality}
                        </span>
                      )}
                    </div>
                    <div className="text-body-sm text-md-on-surface-variant mt-0.5">{eq.eqType}</div>
                    <div className="flex gap-1.5 mt-1">
                      {eq._loc === "standalone" && <Pill color={COL.lines}>standalone</Pill>}
                      {eq.sil && <Pill color="#CDB4FF">{eq.sil}</Pill>}
                    </div>
                  </div>
                );
              })}
            </MColumn>

            {/* INSTRUMENTS */}
            <MColumn title="INSTRUMENTS" count={fInst.length} color={COL.instruments} onHeaderClick={() => setRegister("instruments")}>
              {fInst.map((inst, idx) => (
                <div key={inst.id} onClick={() => setSelItem(selItem?.id === inst.id ? null : inst)}
                  className="md-list-item px-3 py-2 mx-1.5 my-0.5 cursor-pointer animate-md-list-enter"
                  style={{
                    background: selItem?.id === inst.id ? `${COL.instruments}18` : undefined,
                    borderLeft: `3px solid ${selItem?.id === inst.id ? COL.instruments : 'transparent'}`,
                    animationDelay: `${idx * 30}ms`,
                  }}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-body-sm font-bold tracking-tight" style={selItem?.id === inst.id ? { color: COL.instruments } : {}}>{inst.tag}</span>
                    <Pill color={COL.instruments}>{inst.iType.replace(/_/g, " ")}</Pill>
                  </div>
                  <div className="text-body-sm text-md-on-surface-variant mt-0.5">{inst.desc}</div>
                  {inst.scada && <div className="text-label-sm font-mono mt-1" style={{ color: COL.instruments }}>{inst.scada}</div>}
                </div>
              ))}
            </MColumn>
          </div>
        )}

        {/* ═══ DETAIL BAR ═══ */}
        {selItem && (
          <div className="px-4 py-2.5 bg-md-surface-container-high border-t border-md-outline-variant flex items-center gap-3 shrink-0 flex-wrap animate-md-detail-enter">
            <span className="text-title-sm font-bold text-md-on-surface">{selItem.tag || selItem.name}</span>
            {selItem.eqType && <Pill color={COL.equipment}>{selItem.eqType}</Pill>}
            {selItem.iType && <Pill color={COL.instruments}>{selItem.iType?.replace(/_/g, " ")}</Pill>}
            {selItem.criticality && <Pill color={{ high: '#FF897A', medium: '#FFD666', low: '#4FE2B0' }[selItem.criticality]}>{selItem.criticality}</Pill>}
            {selItem.sil && <Pill color="#CDB4FF">{selItem.sil}</Pill>}
            {selItem.desc && <span className="text-body-sm text-md-on-surface-variant">{selItem.desc}</span>}
            {selItem.service && <span className="text-body-sm text-md-on-surface-variant">{selItem.service} &middot; {selItem.size}</span>}
            {selItem.range && <span className="text-body-sm text-md-on-surface-variant">{selItem.range}</span>}
            {selItem.scada && <span className="text-label-md font-mono" style={{ color: COL.instruments }}>{selItem.scada}</span>}
            {selItem.insp && <span className="text-label-sm text-md-on-surface-variant">Insp: {selItem.insp}</span>}
            {selItem.cl && <span className="text-label-sm text-md-on-surface-variant">CL: {selItem.cl}</span>}
            <div className="flex-1" />
            <button onClick={() => setSelItem(null)} className="md-icon-btn w-8 h-8">
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══ Column wrapper ═══ */
function MColumn({ title, count, color, onHeaderClick, children }) {
  return (
    <div className="flex-1 min-w-0 flex flex-col overflow-hidden border-r border-md-outline-variant/30">
      <div
        className="px-3 py-2.5 flex items-center gap-2 shrink-0 cursor-pointer select-none border-b border-md-outline-variant/30 md-interactive"
        style={{ background: `${color}0d` }}
        onClick={onHeaderClick}
        title={`Open ${title} register`}
      >
        <div className="w-[3px] h-4 rounded-md-full shrink-0" style={{ background: color }} />
        <span className="text-label-lg tracking-widest flex-1 font-bold" style={{ color }}>{title}</span>
        <span className="text-label-md font-semibold px-2 py-0.5 rounded-md-full" style={{ background: `${color}20`, color }}>
          {count}
        </span>
        <span className="material-symbols-outlined text-[14px] opacity-40" style={{ color }}>open_in_new</span>
      </div>
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-1">{children}</div>
    </div>
  );
}

/* ═══ Pill (tag/chip) ═══ */
function Pill({ color, children }) {
  return (
    <span className="text-label-sm font-semibold px-1.5 py-0.5 rounded-md-full inline-block" style={{ background: `${color}20`, color }}>
      {children}
    </span>
  );
}
