import { useState, useCallback, useMemo } from 'react';
import { useTheme } from '../../context/ThemeContext';
import { useHierarchy } from '../../hooks/useAdminApi';
import HierarchyManager from './HierarchyManager';
import SystemManager from './SystemManager';
import PnidManager from './PnidManager';
import LineManager from './LineManager';
import EquipmentManager from './EquipmentManager';
import InstrumentManager from './InstrumentManager';
import LinkageDashboard from './LinkageDashboard';
import StorageSettings from './StorageSettings';
import FileManager from './FileManager';
import AuditLog from './AuditLog';
import ImportPreview from './ImportPreview';
import SymbolLibraryManager from './SymbolLibraryManager';
import AccessControlManager from './AccessControlManager';
import { useAuth } from '../../context/AuthContext';

// Utility tabs — always accessible from toolbar, not tied to a platform
const UTILITY_TABS = [
  { key: 'access', label: 'Access', icon: 'M8 7a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 14c0-2.5 2.7-4 6-4s6 1.5 6 4M11 3.5l3 1.5M14 5l-1.5 2' },
  { key: 'storage', label: 'Storage', icon: 'M4 4h8v2H4zM3 8h10v6H3z' },
  { key: 'audit', label: 'Audit Log', icon: 'M4 2h8v12H4zM6 5h4M6 7h4M6 9h2' },
  { key: 'import', label: 'Import', icon: 'M8 2v8M5 7l3 3 3-3M3 12h10' },
  { key: 'symbols', label: 'Symbols', icon: 'M2 3h12v10H2zM4 6h8M4 9h5' },
];

// Entity tabs with icons and accent colors
const ENTITY_TABS = [
  { key: 'systems', label: 'Systems', icon: 'account_tree', color: '#4FE2B0' },
  { key: 'pnids', label: 'P&IDs', icon: 'description', color: '#8AB4FF' },
  { key: 'lines', label: 'Lines', icon: 'route', color: '#FFB068' },
  { key: 'equipment', label: 'Equipment', icon: 'precision_manufacturing', color: '#4FE2B0' },
  { key: 'instruments', label: 'Instruments', icon: 'sensors', color: '#8AB4FF' },
  { key: 'linkage', label: 'Linkage', icon: 'hub', color: '#CDB4FF' },
];

const ENTITY_LABELS = Object.fromEntries(ENTITY_TABS.map(t => [t.key, t.label]));

/** Traverse nested hierarchy tree to find platform and build ancestor path */
function findPlatformPath(hierarchy, platformId) {
  if (!hierarchy || !platformId) return null;
  const clients = hierarchy.hierarchy || hierarchy;
  if (!Array.isArray(clients)) return null;

  for (const client of clients) {
    for (const project of (client.projects || [])) {
      for (const concession of (project.concessions || [])) {
        for (const location of (concession.locations || [])) {
          for (const complex of (location.complexes || [])) {
            for (const platform of (complex.platforms || [])) {
              if (platform.id === platformId) {
                return [
                  { type: 'client', code: client.code, name: client.name },
                  { type: 'project', code: project.code, name: project.name },
                  { type: 'concession', code: concession.code, name: concession.name },
                  { type: 'location', code: location.code, name: location.name },
                  { type: 'complex', code: complex.code, name: complex.name },
                  { type: 'platform', code: platform.code, name: platform.name },
                ];
              }
            }
          }
        }
      }
    }
  }
  return null;
}

const ChevronSep = () => (
  <svg className="w-3 h-3 shrink-0 opacity-40" fill="none" viewBox="0 0 12 12" style={{ color: 'var(--md-on-surface-variant)' }}>
    <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

export default function AdminLayout({ onBack, platformId, platforms, onPlatformChange }) {
  const { isDark } = useTheme();
  const { hasPermission } = useAuth();
  const { data: hierarchyData } = useHierarchy();
  // view: 'hierarchy' | 'entity:<type>' | 'utility:<type>' | 'file-manager'
  const [view, setView] = useState('hierarchy');
  const [importType, setImportType] = useState('lines');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [fileManagerConfig, setFileManagerConfig] = useState(null); // { id, provider, ... }

  const canManageUsers = hasPermission('users.manage');
  const visibleUtilityTabs = UTILITY_TABS.filter((tab) => {
    if (tab.key === 'access') return canManageUsers;
    if (tab.key === 'storage') return hasPermission('storage.manage') || hasPermission('admin.access');
    if (tab.key === 'audit') return hasPermission('audit.view') || hasPermission('admin.access');
    if (tab.key === 'import') return hasPermission('import.manage') || hasPermission('admin.access');
    if (tab.key === 'symbols') return hasPermission('symbols.manage') || hasPermission('admin.access');
    return true;
  });

  // Parse view state
  const isHierarchy = view === 'hierarchy';
  const entityMatch = view.match(/^entity:(.+)$/);
  const utilityMatch = view.match(/^utility:(.+)$/);
  const entityType = entityMatch?.[1];
  const utilityType = utilityMatch?.[1];

  // Build full hierarchy breadcrumb path for the active platform
  const platformPath = useMemo(
    () => findPlatformPath(hierarchyData, platformId),
    [hierarchyData, platformId]
  );

  const handleNavigateTab = useCallback((tab) => {
    if (tab in ENTITY_LABELS) {
      setView(`entity:${tab}`);
    }
  }, []);

  const handleSelectPlatform = useCallback((id) => {
    if (id) onPlatformChange(id);
  }, [onPlatformChange]);

  const handleBackToHierarchy = () => { setView('hierarchy'); setFileManagerConfig(null); };

  // Clicking a breadcrumb segment navigates back to hierarchy view
  const handleBreadcrumbClick = useCallback((segIndex) => {
    // Clicking any breadcrumb segment goes back to the hierarchy view
    // In the future this could filter the hierarchy to that level
    setView('hierarchy');
  }, []);

  const showSidebar = !!entityType;

  return (
    <div className="flex flex-col h-full w-full" style={{ background: 'var(--md-surface)' }}>
      {/* ── Top bar — full width ── */}
      <div
        className="flex items-center px-3 py-2 gap-2 shrink-0 w-full"
        style={{
          background: 'var(--md-surface-container)',
          borderBottom: '1px solid var(--md-outline-variant)',
          minWidth: 0,
        }}
      >
        {/* Back button */}
        <button
          onClick={isHierarchy ? onBack : handleBackToHierarchy}
          className="flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1.5 rounded-lg transition-colors duration-150 cursor-pointer shrink-0"
          style={{
            background: 'var(--md-surface-container-high)',
            border: '1px solid var(--md-outline-variant)',
            color: 'var(--md-on-surface-variant)',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--md-on-surface)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--md-on-surface-variant)'; }}
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 12 12">
            <path d="M8 2L4 6l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          {(entityType || utilityType) ? 'Hierarchy' : 'Back'}
        </button>

        <div className="w-px h-5 shrink-0" style={{ background: 'var(--md-outline-variant)' }} />

        {/* Sidebar collapse toggle (only when entity sidebar is visible) */}
        {showSidebar && (
          <button
            onClick={() => setSidebarCollapsed(prev => !prev)}
            className="flex items-center justify-center w-7 h-7 rounded-lg transition-colors cursor-pointer shrink-0"
            style={{
              color: 'var(--md-on-surface-variant)',
              background: sidebarCollapsed ? 'var(--md-surface-container-high)' : 'transparent',
            }}
            title={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--md-surface-container-high)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = sidebarCollapsed ? 'var(--md-surface-container-high)' : 'transparent'; }}
          >
            <span className="material-symbols-outlined text-[16px]">
              {sidebarCollapsed ? 'menu_open' : 'left_panel_close'}
            </span>
          </button>
        )}

        {/* ── Breadcrumb — full hierarchy path (clickable) ── */}
        <div className="flex items-center gap-1 min-w-0 overflow-x-auto flex-1">
          <button
            onClick={handleBackToHierarchy}
            className="text-[10px] font-medium px-1.5 py-0.5 rounded transition-colors cursor-pointer shrink-0"
            style={{
              color: isHierarchy ? 'var(--md-primary)' : 'var(--md-on-surface-variant)',
              background: isHierarchy ? 'var(--md-primary-container)' : 'transparent',
            }}
            onMouseEnter={e => { if (!isHierarchy) e.currentTarget.style.background = 'rgba(225,232,229,0.06)'; }}
            onMouseLeave={e => { if (!isHierarchy) e.currentTarget.style.background = isHierarchy ? 'var(--md-primary-container)' : 'transparent'; }}
          >
            Admin
          </button>

          {/* Show full path when viewing entity or utility */}
          {(entityType || utilityType) && platformPath && (
            <>
              {platformPath.map((seg, i) => (
                <span key={i} className="flex items-center gap-1 shrink-0">
                  <ChevronSep />
                  <button
                    onClick={() => handleBreadcrumbClick(i)}
                    className="text-[10px] px-1.5 py-0.5 rounded shrink-0 transition-colors cursor-pointer"
                    style={{
                      color: i === platformPath.length - 1 ? 'var(--md-on-surface)' : 'var(--md-on-surface-variant)',
                      fontWeight: i === platformPath.length - 1 ? 600 : 400,
                      background: 'transparent',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(225,232,229,0.08)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                    title={`${seg.type}: ${seg.name || seg.code}`}
                  >
                    {seg.code}
                  </button>
                </span>
              ))}
              {entityType && (
                <>
                  <ChevronSep />
                  <span
                    className="text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0"
                    style={{ color: 'var(--md-primary)', background: 'var(--md-primary-container)' }}
                  >
                    {ENTITY_LABELS[entityType]}
                  </span>
                </>
              )}
            </>
          )}

          {/* Utility breadcrumb (no platform path needed) */}
          {utilityType && !platformPath && (
            <>
              <ChevronSep />
              <button
                onClick={() => setFileManagerConfig(null)}
                className="text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 cursor-pointer"
                style={{
                  color: fileManagerConfig ? 'var(--md-on-surface-variant)' : 'var(--md-primary)',
                  background: fileManagerConfig ? 'transparent' : 'var(--md-primary-container)',
                }}
              >
                {UTILITY_TABS.find(t => t.key === utilityType)?.label}
              </button>
              {fileManagerConfig && (
                <>
                  <ChevronSep />
                  <span
                    className="text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0"
                    style={{ color: 'var(--md-primary)', background: 'var(--md-primary-container)' }}
                  >
                    File Manager
                  </span>
                </>
              )}
            </>
          )}
        </div>

        {/* ── Utility buttons — pushed to far right ── */}
        <div className="flex items-center gap-1 shrink-0">
          {visibleUtilityTabs.map(tab => {
            const isActive = utilityType === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => { setView(isActive ? 'hierarchy' : `utility:${tab.key}`); setFileManagerConfig(null); }}
                title={tab.label}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all duration-150 cursor-pointer"
                style={{
                  color: isActive ? 'var(--md-primary)' : 'var(--md-on-surface-variant)',
                  background: isActive ? 'var(--md-primary-container)' : 'transparent',
                }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'rgba(225,232,229,0.06)'; }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 16 16">
                  <path d={tab.icon} stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Content area ── */}
      <div className="flex-1 overflow-hidden flex" style={{ minHeight: 0 }}>
        {/* ── Entity sidebar — collapsible navigation between entity types ── */}
        {showSidebar && !sidebarCollapsed && (
          <div
            className="w-44 shrink-0 flex flex-col overflow-y-auto"
            style={{
              background: 'var(--md-surface-container)',
              borderRight: '1px solid var(--md-outline-variant)',
            }}
          >
            {/* Platform header */}
            <div className="px-3 pt-3 pb-2">
              <div className="text-[9px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--md-on-surface-variant)' }}>
                Platform
              </div>
              <div className="text-[12px] font-semibold" style={{ color: 'var(--md-on-surface)' }}>
                {platformPath?.[platformPath.length - 1]?.name || platformPath?.[platformPath.length - 1]?.code || 'Select'}
              </div>
            </div>

            <div className="w-full h-px" style={{ background: 'var(--md-outline-variant)' }} />

            {/* Entity navigation tabs */}
            <div className="p-2 flex flex-col gap-0.5">
              {ENTITY_TABS.map(tab => {
                const isActive = entityType === tab.key;
                return (
                  <button
                    key={tab.key}
                    onClick={() => setView(`entity:${tab.key}`)}
                    className="flex items-center gap-2 w-full text-left px-3 py-2 rounded-lg text-[11px] font-medium transition-all duration-150 cursor-pointer"
                    style={{
                      color: isActive ? tab.color : 'var(--md-on-surface-variant)',
                      background: isActive ? `${tab.color}15` : 'transparent',
                      borderLeft: isActive ? `2px solid ${tab.color}` : '2px solid transparent',
                    }}
                    onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'rgba(225,232,229,0.06)'; }}
                    onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = isActive ? `${tab.color}15` : 'transparent'; }}
                  >
                    <span className="material-symbols-outlined text-[16px]">{tab.icon}</span>
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Collapsed sidebar — icon-only strip ── */}
        {showSidebar && sidebarCollapsed && (
          <div
            className="w-10 shrink-0 flex flex-col items-center pt-2 gap-1 overflow-y-auto"
            style={{
              background: 'var(--md-surface-container)',
              borderRight: '1px solid var(--md-outline-variant)',
            }}
          >
            {ENTITY_TABS.map(tab => {
              const isActive = entityType === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => setView(`entity:${tab.key}`)}
                  className="w-8 h-8 flex items-center justify-center rounded-lg transition-all duration-150 cursor-pointer"
                  style={{
                    color: isActive ? tab.color : 'var(--md-on-surface-variant)',
                    background: isActive ? `${tab.color}15` : 'transparent',
                  }}
                  title={tab.label}
                  onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'rgba(225,232,229,0.06)'; }}
                  onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = isActive ? `${tab.color}15` : 'transparent'; }}
                >
                  <span className="material-symbols-outlined text-[16px]">{tab.icon}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* ── Main content ── */}
        <div className="flex-1 overflow-hidden flex flex-col" style={{ minHeight: 0, minWidth: 0 }}>
          {/* Hierarchy view (default) */}
          {isHierarchy && (
            <HierarchyManager
              onSelectPlatform={handleSelectPlatform}
              onNavigateTab={handleNavigateTab}
            />
          )}

          {/* Entity managers (navigated from platform dashboard) */}
          {entityType === 'systems' && <SystemManager platformId={platformId} />}
          {entityType === 'pnids' && <PnidManager platformId={platformId} />}
          {entityType === 'lines' && <LineManager platformId={platformId} />}
          {entityType === 'equipment' && <EquipmentManager platformId={platformId} />}
          {entityType === 'instruments' && <InstrumentManager platformId={platformId} />}
          {entityType === 'linkage' && <LinkageDashboard platformId={platformId} />}

          {/* Utility views */}
          {utilityType === 'access' && canManageUsers && <AccessControlManager />}
          {utilityType === 'storage' && !fileManagerConfig && (
            <StorageSettings
              onBrowseConfig={(cfg) => {
                setFileManagerConfig(cfg);
              }}
            />
          )}
          {utilityType === 'storage' && fileManagerConfig && (
            <FileManager
              configId={fileManagerConfig.id}
              configName={`${(fileManagerConfig.provider || '').toUpperCase()} — ${fileManagerConfig.bucket_or_container || fileManagerConfig.base_path || 'Storage'}`}
              onBack={() => setFileManagerConfig(null)}
              platformId={platformId}
            />
          )}
          {utilityType === 'audit' && <AuditLog />}
          {utilityType === 'import' && (
            <div className="flex flex-col h-full">
              <div className="flex items-center gap-2 px-4 pt-3 shrink-0">
                {['lines', 'equipment'].map(t => (
                  <button
                    key={t}
                    onClick={() => setImportType(t)}
                    className="px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all duration-150 cursor-pointer"
                    style={{
                      color: importType === t ? 'var(--md-primary)' : 'var(--md-on-surface-variant)',
                      background: importType === t ? 'var(--md-primary-container)' : 'transparent',
                    }}
                  >
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
              <ImportPreview key={importType} type={importType} platformId={platformId} />
            </div>
          )}
          {utilityType === 'symbols' && <SymbolLibraryManager />}
        </div>
      </div>
    </div>
  );
}
