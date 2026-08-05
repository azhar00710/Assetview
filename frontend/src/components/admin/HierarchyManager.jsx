import { useState, useCallback, useEffect, useMemo } from 'react';
import { useTheme } from '../../context/ThemeContext';
import {
  useHierarchy,
  useClientMutation,
  useProjectMutation,
  useConcessionMutation,
  useLocationMutation,
  useComplexMutation,
  usePlatformMutation,
  useNextCode,
  usePlatformStats,
} from '../../hooks/useAdminApi';

// ─── M3 Level Colors (use CSS variables where possible, fallback to M3 tokens) ───
const LEVEL_COLORS = {
  client:     'var(--md-sil-purple)',
  project:    'var(--md-tertiary)',
  concession: 'var(--md-on-surface)',
  location:   'var(--md-secondary)',
  complex:    'var(--md-sys-instrument)',
  platform:   'var(--md-primary)',
};

// Raw hex values for JS-computed styles (alpha overlays, gradients)
const LEVEL_HEX = {
  client:     '#CDB4FF',
  project:    '#FFB068',
  concession: '#E1E8E5',
  location:   '#8AB4FF',
  complex:    '#FFD666',
  platform:   '#4FE2B0',
};

const LEVEL_LABELS = {
  client: 'Client',
  project: 'Project',
  concession: 'Concession',
  location: 'Location',
  complex: 'Complex',
  platform: 'Platform',
};

const CHILD_KEYS = {
  client: 'projects',
  project: 'concessions',
  concession: 'locations',
  location: 'complexes',
  complex: 'platforms',
};

const CHILD_LEVELS = {
  client: 'project',
  project: 'concession',
  concession: 'location',
  location: 'complex',
  complex: 'platform',
};

const LEVEL_ICONS = {
  client: (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 16 16">
      <path d="M2 13V5l3-2h6l3 2v8H2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
      <path d="M5 13V9h6v4" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
      <path d="M7 7h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  ),
  project: (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 16 16">
      <path d="M2 4h5l2-2h5v10H2V4z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
      <path d="M2 6h12" stroke="currentColor" strokeWidth="1.5"/>
    </svg>
  ),
  concession: (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 16 16">
      <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M5 8h6M8 5v6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  ),
  location: (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 16 16">
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M8 5v6M5 8h6" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
    </svg>
  ),
  complex: (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 16 16">
      <path d="M3 13V6l5-3 5 3v7H3z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
      <path d="M6 13v-3h4v3" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
    </svg>
  ),
  platform: (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 16 16">
      <rect x="3" y="7" width="10" height="6" rx="1" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M5 7V5a3 3 0 016 0v2" stroke="currentColor" strokeWidth="1.5"/>
    </svg>
  ),
};

// ─── Count descendants recursively ───
function countDescendants(node, levelKey) {
  const childKey = CHILD_KEYS[levelKey];
  if (!childKey) return {};
  const children = node[childKey] || [];

  const counts = {};
  const levels = ['project', 'concession', 'location', 'complex', 'platform'];
  const startIdx = levels.indexOf(CHILD_LEVELS[levelKey]);

  // Direct children count
  counts[CHILD_LEVELS[levelKey]] = children.length;

  // Count deeper descendants
  for (let i = startIdx + 1; i < levels.length; i++) {
    counts[levels[i]] = 0;
  }

  function recurse(items, currentLevel) {
    const ck = CHILD_KEYS[currentLevel];
    if (!ck) return;
    const nextLevel = CHILD_LEVELS[currentLevel];
    for (const item of items) {
      const kids = item[ck] || [];
      if (nextLevel && counts[nextLevel] !== undefined) {
        // Already counted at direct level, count deeper
      }
      recurse(kids, nextLevel);
    }
  }

  // Simpler recursive count
  function deepCount(items, currentLevel) {
    const ck = CHILD_KEYS[currentLevel];
    if (!ck) return;
    for (const item of items) {
      const kids = item[ck] || [];
      const nextLevel = CHILD_LEVELS[currentLevel];
      if (nextLevel !== CHILD_LEVELS[levelKey]) {
        counts[nextLevel] = (counts[nextLevel] || 0) + kids.length;
      }
      deepCount(kids, nextLevel);
    }
  }

  deepCount(children, CHILD_LEVELS[levelKey]);
  return counts;
}


// ─── Inline Add Form ────────────────────────────────────────────────────────

function InlineForm({ fields, onSave, onCancel, suggestedCode }) {
  const [values, setValues] = useState(() => {
    const init = {};
    fields.forEach(f => { init[f.key] = f.defaultValue || ''; });
    if (suggestedCode) init.code = suggestedCode;
    return init;
  });

  useEffect(() => {
    if (suggestedCode && !values.code) {
      setValues(p => ({ ...p, code: suggestedCode }));
    }
  }, [suggestedCode]);

  return (
    <div
      className="flex items-center gap-2 py-1.5 px-2 rounded-lg"
      style={{ background: 'rgba(225,232,229,0.03)' }}
    >
      {fields.map(f => (
        <input
          key={f.key}
          value={values[f.key]}
          onChange={e => setValues(p => ({ ...p, [f.key]: e.target.value }))}
          placeholder={f.label}
          className="px-2 py-1 rounded-md text-[11px] outline-none border transition-colors duration-100"
          style={{
            width: f.width || 140,
            background: 'var(--md-surface-container-high)',
            borderColor: 'var(--md-outline-variant)',
            color: 'var(--md-on-surface)',
            opacity: f.key === 'code' && suggestedCode ? 0.6 : 1,
          }}
          autoFocus={f.autoFocus}
        />
      ))}
      <button
        onClick={() => {
          const hasValue = fields.some(f => values[f.key]?.trim());
          if (hasValue) onSave(values);
        }}
        className="px-2.5 py-1 rounded-md text-[10px] font-semibold transition-colors cursor-pointer"
        style={{ background: 'var(--md-primary-container)', color: 'var(--md-on-primary-container)' }}
      >
        Save
      </button>
      <button
        onClick={onCancel}
        className="px-2.5 py-1 rounded-md text-[10px] font-semibold transition-colors cursor-pointer"
        style={{ color: 'var(--md-on-surface-variant)' }}
      >
        Cancel
      </button>
    </div>
  );
}

// ─── Tree Node ──────────────────────────────────────────────────────────────

function TreeNode({
  item, level, levelKey, childKey, childLevelKey,
  color, childColor, mutation, childMutation, childFields,
  renderChildren, selectedNodeId, selectedNodeLevel, onSelectNode,
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editValues, setEditValues] = useState({ name: item.name, code: item.code });
  const [confirmDelete, setConfirmDelete] = useState(false);

  const childLevel = childLevelKey || null;
  const { data: nextCodeData } = useNextCode(
    adding ? childLevel : null,
    adding ? item.id : null
  );

  const children = item[childKey] || [];
  const hasChildren = children.length > 0;
  const indent = level * 24;
  const isSelected = selectedNodeId === item.id && selectedNodeLevel === levelKey;

  const handleSaveEdit = async () => {
    try {
      await mutation.update(item.id, editValues);
      setEditing(false);
    } catch (err) {
      console.error('Update failed:', err);
    }
  };

  const handleDelete = async () => {
    try {
      await mutation.remove(item.id);
      setConfirmDelete(false);
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  const handleAddChild = async (values) => {
    try {
      const parentField = levelKey === 'client' ? 'client_id'
        : levelKey === 'project' ? 'project_id'
        : levelKey === 'concession' ? 'concession_id'
        : levelKey === 'location' ? 'location_id'
        : levelKey === 'complex' ? 'complex_id'
        : null;
      if (parentField) {
        await childMutation.create({ ...values, [parentField]: item.id });
      }
      setAdding(false);
    } catch (err) {
      console.error('Create failed:', err);
    }
  };

  const handleClick = () => {
    // Toggle selection — clicking selects the node and shows its dashboard
    onSelectNode?.(isSelected ? null : item.id, isSelected ? null : levelKey);
    // Also expand/collapse children
    // Don't auto-expand on selection; user must manually expand/collapse
  };

  return (
    <div>
      <div
        className="flex items-center gap-1.5 py-1.5 px-2 rounded-lg group transition-all duration-150 cursor-pointer"
        style={{
          paddingLeft: indent + 8,
          background: isSelected
            ? `${LEVEL_HEX[levelKey]}12`
            : 'transparent',
          boxShadow: isSelected
            ? `inset 0 0 0 1px ${LEVEL_HEX[levelKey]}30`
            : 'none',
        }}
        onClick={handleClick}
        onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'rgba(225,232,229,0.03)'; }}
        onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
      >
        {/* Expand toggle */}
        {childKey ? (
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
            className="w-4 h-4 flex items-center justify-center rounded transition-colors cursor-pointer shrink-0"
            style={{ color: 'var(--md-on-surface-variant)' }}
          >
            <svg
              className={`w-3 h-3 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
              fill="none" viewBox="0 0 12 12"
            >
              <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        ) : (
          <span className="w-4 h-4 flex items-center justify-center shrink-0">
            <span
              className={`rounded-full transition-all duration-150 ${isSelected ? 'w-2 h-2' : 'w-1.5 h-1.5'}`}
              style={{ background: color }}
            />
          </span>
        )}

        {/* Icon */}
        <span style={{ color }} className="shrink-0">
          {LEVEL_ICONS[levelKey]}
        </span>

        {/* Content */}
        {editing ? (
          <div className="flex items-center gap-2 flex-1" onClick={e => e.stopPropagation()}>
            <input
              value={editValues.code}
              onChange={e => setEditValues(p => ({ ...p, code: e.target.value }))}
              className="px-2 py-0.5 rounded-md text-[11px] outline-none border w-24"
              style={{
                background: 'var(--md-surface-container-high)',
                borderColor: 'var(--md-outline-variant)',
                color: 'var(--md-on-surface)',
              }}
              placeholder="Code"
            />
            <input
              value={editValues.name}
              onChange={e => setEditValues(p => ({ ...p, name: e.target.value }))}
              className="px-2 py-0.5 rounded-md text-[11px] outline-none border flex-1"
              style={{
                background: 'var(--md-surface-container-high)',
                borderColor: 'var(--md-outline-variant)',
                color: 'var(--md-on-surface)',
              }}
              placeholder="Name"
            />
            <button
              onClick={handleSaveEdit}
              className="px-2 py-0.5 rounded-md text-[10px] font-semibold transition-colors cursor-pointer"
              style={{ background: 'var(--md-primary-container)', color: 'var(--md-on-primary-container)' }}
            >
              Save
            </button>
            <button
              onClick={() => { setEditing(false); setEditValues({ name: item.name, code: item.code }); }}
              className="px-2 py-0.5 rounded-md text-[10px] font-semibold transition-colors cursor-pointer"
              style={{ color: 'var(--md-on-surface-variant)' }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <>
            <span className="text-[12px] font-bold" style={{ color }}>{item.code}</span>
            <span className="text-[11px]" style={{ color: 'var(--md-on-surface)' }}>&mdash;</span>
            <span className="text-[11px]" style={{ color: 'var(--md-on-surface)' }}>{item.name}</span>
            {hasChildren && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded-full ml-1"
                style={{ background: 'rgba(225,232,229,0.06)', color: 'var(--md-on-surface-variant)' }}
              >
                {children.length}
              </span>
            )}
            {isSelected && (
              <span
                className="text-[9px] px-1.5 py-0.5 rounded-full ml-1 font-semibold"
                style={{ background: `${LEVEL_HEX[levelKey]}20`, color }}
              >
                Selected
              </span>
            )}
            <div className="flex-1" />

            {/* Action buttons */}
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150" onClick={e => e.stopPropagation()}>
              {childKey && childMutation && (
                <button
                  onClick={() => setAdding(true)}
                  className="px-2 py-0.5 rounded-md text-[10px] font-medium transition-colors cursor-pointer whitespace-nowrap"
                  style={{ background: 'var(--md-primary-container)', color: 'var(--md-on-primary-container)' }}
                >
                  + {childLevelKey ? LEVEL_LABELS[childLevelKey] : 'Child'}
                </button>
              )}
              <button
                onClick={() => setEditing(true)}
                className="p-1 rounded-md transition-colors cursor-pointer"
                style={{ color: 'var(--md-on-surface-variant)' }}
                title="Edit"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 16 16">
                  <path d="M11.5 1.5l3 3-9 9H2.5v-3l9-9z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
                </svg>
              </button>
              {!confirmDelete ? (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="p-1 rounded-md transition-colors cursor-pointer"
                  style={{ color: 'var(--md-on-surface-variant)' }}
                  title="Delete"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 16 16">
                    <path d="M3 4h10M6 4V3a1 1 0 011-1h2a1 1 0 011 1v1m2 0v9a1 1 0 01-1 1H5a1 1 0 01-1-1V4h10z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              ) : (
                <div className="flex items-center gap-1">
                  <button
                    onClick={handleDelete}
                    className="px-2 py-0.5 rounded-md text-[10px] font-semibold transition-colors cursor-pointer"
                    style={{ background: 'var(--md-error-container)', color: 'var(--md-on-error-container)' }}
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="px-2 py-0.5 rounded-md text-[10px] font-semibold transition-colors cursor-pointer"
                    style={{ color: 'var(--md-on-surface-variant)' }}
                  >
                    No
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Add child inline form */}
      {adding && childFields && (
        <div style={{ paddingLeft: indent + 32 }} className="py-1">
          <InlineForm
            fields={childFields}
            onSave={handleAddChild}
            onCancel={() => setAdding(false)}
            suggestedCode={nextCodeData?.code}
          />
        </div>
      )}

      {/* Render children */}
      {expanded && childKey && renderChildren && renderChildren(children)}
    </div>
  );
}

// ─── Level Dashboard (for Client, Project, Concession, Location, Complex) ───

function LevelDashboard({ item, levelKey, hierarchy, onSelectNode, onNavigateTab }) {
  const childKey = CHILD_KEYS[levelKey];
  const childLevel = CHILD_LEVELS[levelKey];
  const children = item?.[childKey] || [];
  const color = LEVEL_HEX[levelKey];
  const descendantCounts = useMemo(() => countDescendants(item, levelKey), [item, levelKey]);

  // Build summary cards for all descendant levels
  const summaryLevels = [];
  let lk = levelKey;
  while (CHILD_LEVELS[lk]) {
    const nextLevel = CHILD_LEVELS[lk];
    const count = nextLevel === childLevel ? children.length : (descendantCounts[nextLevel] || 0);
    summaryLevels.push({ level: nextLevel, count });
    lk = nextLevel;
  }

  return (
    <div className="p-4 overflow-auto h-full">
      {/* Header card */}
      <div
        className="rounded-xl p-4 mb-4"
        style={{
          background: 'var(--md-surface-container)',
          border: '1px solid var(--md-outline-variant)',
        }}
      >
        <div className="flex items-center gap-3 mb-2">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: `${color}15` }}
          >
            <span style={{ color }}>{LEVEL_ICONS[levelKey]}</span>
          </div>
          <div>
            <h2 className="text-[15px] font-bold" style={{ color: 'var(--md-on-surface)' }}>
              {item.code} &mdash; {item.name}
            </h2>
            <span className="text-[11px]" style={{ color: 'var(--md-on-surface-variant)' }}>
              {LEVEL_LABELS[levelKey]}
              {item.operator && <> &middot; Operator: {item.operator}</>}
              {item.region && <> &middot; Region: {item.region}</>}
              {item.location_type && <> &middot; Type: {item.location_type}</>}
              {item.platform_type && <> &middot; Type: {item.platform_type}</>}
              {item.status && (
                <> &middot; Status: <span className="capitalize" style={{ color: item.status === 'operating' ? 'var(--md-primary)' : 'var(--md-sys-instrument)' }}>{item.status?.replace(/_/g, ' ')}</span></>
              )}
            </span>
          </div>
        </div>
      </div>

      {/* Summary stat cards — descendant counts */}
      <div className="grid grid-cols-2 xl:grid-cols-3 gap-3 mb-4">
        {summaryLevels.map(({ level: lv, count }) => {
          const lvColor = LEVEL_HEX[lv];
          return (
            <div
              key={lv}
              className="rounded-xl p-4 transition-all duration-200"
              style={{
                background: 'var(--md-surface-container)',
                border: '1px solid var(--md-outline-variant)',
              }}
            >
              <div className="flex items-center gap-3 mb-2">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center"
                  style={{ background: `${lvColor}20` }}
                >
                  <span style={{ color: lvColor }}>{LEVEL_ICONS[lv]}</span>
                </div>
                <div className="flex-1">
                  <div className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--md-on-surface-variant)' }}>
                    {LEVEL_LABELS[lv]}s
                  </div>
                  <div className="text-[22px] font-bold leading-tight" style={{ color: 'var(--md-on-surface)' }}>
                    {count}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Child items as clickable cards */}
      {children.length > 0 && (
        <>
          <h3
            className="text-[11px] font-bold uppercase tracking-wider mb-3 px-1"
            style={{ color: 'var(--md-on-surface-variant)' }}
          >
            {LEVEL_LABELS[childLevel]}s ({children.length})
          </h3>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
            {children.map(child => {
              const childChildKey = CHILD_KEYS[childLevel];
              const grandchildCount = childChildKey ? (child[childChildKey]?.length || 0) : 0;
              const cColor = LEVEL_HEX[childLevel];

              return (
                <button
                  key={child.id}
                  onClick={() => onSelectNode(child.id, childLevel)}
                  className="rounded-xl p-3 text-left transition-all duration-200 cursor-pointer group"
                  style={{
                    background: 'var(--md-surface-container)',
                    border: '1px solid var(--md-outline-variant)',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.borderColor = `${cColor}50`;
                    e.currentTarget.style.background = 'var(--md-surface-container-high)';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = 'var(--md-outline-variant)';
                    e.currentTarget.style.background = 'var(--md-surface-container)';
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-transform duration-200 group-hover:scale-110"
                      style={{ background: `${cColor}20` }}
                    >
                      <span style={{ color: cColor }}>{LEVEL_ICONS[childLevel]}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] font-bold" style={{ color: cColor }}>{child.code}</span>
                        <span className="text-[11px] truncate" style={{ color: 'var(--md-on-surface)' }}>{child.name}</span>
                      </div>
                      {childChildKey && (
                        <span className="text-[10px]" style={{ color: 'var(--md-on-surface-variant)' }}>
                          {grandchildCount} {LEVEL_LABELS[CHILD_LEVELS[childLevel]] || 'items'}{grandchildCount !== 1 ? 's' : ''}
                        </span>
                      )}
                      {child.operator && (
                        <span className="text-[10px] ml-2" style={{ color: 'var(--md-on-surface-variant)' }}>
                          {child.operator}
                        </span>
                      )}
                    </div>
                    <svg className="w-4 h-4 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" viewBox="0 0 16 16" style={{ color: cColor }}>
                      <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}

      {children.length === 0 && (
        <div className="text-center py-12">
          <p className="text-[12px] mb-2" style={{ color: 'var(--md-on-surface-variant)' }}>
            No {LEVEL_LABELS[childLevel]?.toLowerCase()}s yet
          </p>
          <p className="text-[11px]" style={{ color: 'var(--md-on-surface-variant)' }}>
            Use the tree on the left to add {LEVEL_LABELS[childLevel]?.toLowerCase()}s under this {LEVEL_LABELS[levelKey]?.toLowerCase()}.
          </p>
        </div>
      )}
    </div>
  );
}


// ─── Platform Dashboard (right panel) — uses API stats ──────────────────────

const PLATFORM_STAT_CARDS = [
  { key: 'systems',      label: 'Systems',      tab: 'systems',      icon: 'M3 3h10v10H3z' },
  { key: 'pnids',        label: 'P&IDs',        tab: 'pnids',        icon: 'M2 2h12v12H2z' },
  { key: 'lines',        label: 'Lines',         tab: 'lines',        icon: 'M2 8h12' },
  { key: 'equipment',    label: 'Equipment',     tab: 'equipment',    icon: 'M4 4h8v8H4z' },
  { key: 'instruments',  label: 'Instruments',   tab: 'instruments',  icon: 'M8 2v12M4 6h8' },
];

// Assign colors to stat cards using M3 CSS variables
const STAT_CARD_COLORS = {
  systems:      { var: 'var(--md-primary)',       hex: '#4FE2B0' },
  pnids:        { var: 'var(--md-secondary)',      hex: '#8AB4FF' },
  lines:        { var: 'var(--md-tertiary)',       hex: '#FFB068' },
  equipment:    { var: 'var(--md-primary)',         hex: '#4FE2B0' },
  instruments:  { var: 'var(--md-sys-instrument)', hex: '#FFD666' },
};

function PlatformDashboard({ platformId, onNavigateTab }) {
  const { data, isLoading } = usePlatformStats(platformId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-[12px]" style={{ color: 'var(--md-on-surface-variant)' }}>Loading platform data...</span>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-[12px]" style={{ color: 'var(--md-on-surface-variant)' }}>Platform not found</span>
      </div>
    );
  }

  const { platform, stats } = data;

  return (
    <div className="p-4 overflow-auto h-full">
      {/* Platform header card */}
      <div
        className="rounded-xl p-4 mb-4"
        style={{ background: 'var(--md-surface-container)', border: '1px solid var(--md-outline-variant)' }}
      >
        <div className="flex items-center gap-3 mb-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: 'rgba(79,226,176,0.15)' }}
          >
            <span style={{ color: 'var(--md-primary)' }}>{LEVEL_ICONS.platform}</span>
          </div>
          <div>
            <h2 className="text-[15px] font-bold" style={{ color: 'var(--md-on-surface)' }}>
              {platform.code} &mdash; {platform.name}
            </h2>
            <span className="text-[11px]" style={{ color: 'var(--md-on-surface-variant)' }}>
              Status: <span
                className="capitalize"
                style={{ color: platform.status === 'operating' ? 'var(--md-primary)' : 'var(--md-sys-instrument)' }}
              >
                {platform.status?.replace(/_/g, ' ') || 'Unknown'}
              </span>
            </span>
          </div>
          <div className="flex-1" />
          <button
            onClick={() => onNavigateTab?.('systems')}
            className="px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer"
            style={{ background: 'var(--md-primary-container)', color: 'var(--md-on-primary-container)' }}
          >
            Manage Platform
          </button>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
        {PLATFORM_STAT_CARDS.map(card => {
          const count = stats?.[card.key] ?? 0;
          const colors = STAT_CARD_COLORS[card.key];
          return (
            <button
              key={card.key}
              onClick={() => onNavigateTab?.(card.tab)}
              className="rounded-xl p-4 text-left transition-all duration-200 cursor-pointer group"
              style={{
                background: 'var(--md-surface-container)',
                border: '1px solid var(--md-outline-variant)',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = `${colors.hex}50`; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--md-outline-variant)'; }}
            >
              <div className="flex items-center gap-3 mb-3">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center transition-transform duration-200 group-hover:scale-110"
                  style={{ background: `${colors.hex}20` }}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 16 16" style={{ color: colors.var }}>
                    <path d={card.icon} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <div className="flex-1">
                  <div className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--md-on-surface-variant)' }}>
                    {card.label}
                  </div>
                  <div className="text-[22px] font-bold leading-tight" style={{ color: 'var(--md-on-surface)' }}>
                    {count}
                  </div>
                </div>
              </div>
              <div
                className="text-[10px] font-medium transition-colors"
                style={{ color: 'var(--md-on-surface-variant)' }}
              >
                Click to manage {card.label.toLowerCase()} &rarr;
              </div>
            </button>
          );
        })}
      </div>

      {/* Quick actions */}
      <div
        className="mt-4 rounded-xl p-4"
        style={{ background: 'var(--md-surface-container)', border: '1px solid var(--md-outline-variant)' }}
      >
        <h3
          className="text-[11px] font-bold uppercase tracking-wider mb-3"
          style={{ color: 'var(--md-on-surface-variant)' }}
        >
          Quick Actions
        </h3>
        <div className="flex flex-wrap gap-2">
          {[
            { label: '+ Add System', tab: 'systems', color: 'var(--md-primary)', hex: '#4FE2B0' },
            { label: '+ Upload P&ID', tab: 'pnids', color: 'var(--md-secondary)', hex: '#8AB4FF' },
            { label: 'Import CSV', tab: 'import', color: 'var(--md-tertiary)', hex: '#FFB068' },
            { label: 'View Linkage', tab: 'linkage', color: 'var(--md-sys-instrument)', hex: '#FFD666' },
          ].map(action => (
            <button
              key={action.label}
              onClick={() => onNavigateTab?.(action.tab)}
              className="px-3 py-2 rounded-lg text-[11px] font-medium border transition-colors cursor-pointer"
              style={{
                borderColor: 'var(--md-outline-variant)',
                color: 'var(--md-on-surface-variant)',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.color = action.color;
                e.currentTarget.style.borderColor = `${action.hex}30`;
                e.currentTarget.style.background = `${action.hex}08`;
              }}
              onMouseLeave={e => {
                e.currentTarget.style.color = 'var(--md-on-surface-variant)';
                e.currentTarget.style.borderColor = 'var(--md-outline-variant)';
                e.currentTarget.style.background = 'transparent';
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Hierarchy Overview Dashboard (nothing selected) ─────────────────────────

function HierarchyOverview({ hierarchy }) {
  const clients = hierarchy || [];

  // Count all levels across the entire hierarchy
  const totals = useMemo(() => {
    const counts = { client: 0, project: 0, concession: 0, location: 0, complex: 0, platform: 0 };
    counts.client = clients.length;
    for (const c of clients) {
      const projects = c.projects || [];
      counts.project += projects.length;
      for (const p of projects) {
        const concessions = p.concessions || [];
        counts.concession += concessions.length;
        for (const con of concessions) {
          const locations = con.locations || [];
          counts.location += locations.length;
          for (const loc of locations) {
            const complexes = loc.complexes || [];
            counts.complex += complexes.length;
            for (const cx of complexes) {
              counts.platform += (cx.platforms || []).length;
            }
          }
        }
      }
    }
    return counts;
  }, [clients]);

  const total = Object.values(totals).reduce((s, v) => s + v, 0);

  const overviewCards = [
    { level: 'client', label: 'Clients' },
    { level: 'project', label: 'Projects' },
    { level: 'concession', label: 'Concessions' },
    { level: 'location', label: 'Locations' },
    { level: 'complex', label: 'Complexes' },
    { level: 'platform', label: 'Platforms' },
  ];

  return (
    <div className="p-5 overflow-auto h-full">
      {/* Header */}
      <div
        className="rounded-xl p-5 mb-5"
        style={{ background: 'var(--md-surface-container)', border: '1px solid var(--md-outline-variant)' }}
      >
        <div className="flex items-center gap-3 mb-3">
          <div
            className="w-11 h-11 rounded-xl flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, rgba(79,226,176,0.15), rgba(138,180,255,0.15))' }}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" style={{ color: 'var(--md-primary)' }}>
              <path d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </div>
          <div>
            <h2 className="text-[15px] font-bold" style={{ color: 'var(--md-on-surface)' }}>
              Hierarchy Overview
            </h2>
            <span className="text-[11px]" style={{ color: 'var(--md-on-surface-variant)' }}>
              {total} total entities across {totals.client} client{totals.client !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
        <p className="text-[11px] leading-relaxed" style={{ color: 'var(--md-on-surface-variant)' }}>
          Select any item in the tree to see its dashboard. Click a platform to manage its systems, P&IDs, lines, equipment, and instruments.
        </p>
      </div>

      {/* Stats grid */}
      <h3
        className="text-[11px] font-bold uppercase tracking-wider mb-3 px-1"
        style={{ color: 'var(--md-on-surface-variant)' }}
      >
        Asset Counts
      </h3>
      <div className="grid grid-cols-2 xl:grid-cols-3 gap-3 mb-5">
        {overviewCards.map(({ level, label }) => {
          const color = LEVEL_HEX[level];
          const count = totals[level];
          return (
            <div
              key={level}
              className="rounded-xl p-4"
              style={{
                background: 'var(--md-surface-container)',
                border: '1px solid var(--md-outline-variant)',
              }}
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center"
                  style={{ background: `${color}20` }}
                >
                  <span style={{ color }}>{LEVEL_ICONS[level]}</span>
                </div>
                <div className="flex-1">
                  <div className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--md-on-surface-variant)' }}>
                    {label}
                  </div>
                  <div className="text-[24px] font-bold leading-tight" style={{ color: 'var(--md-on-surface)' }}>
                    {count}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Recent clients list */}
      {clients.length > 0 && (
        <>
          <h3
            className="text-[11px] font-bold uppercase tracking-wider mb-3 px-1"
            style={{ color: 'var(--md-on-surface-variant)' }}
          >
            Clients ({clients.length})
          </h3>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
            {clients.map(client => {
              const projectCount = (client.projects || []).length;
              const cColor = LEVEL_HEX.client;
              return (
                <div
                  key={client.id}
                  className="rounded-xl p-3"
                  style={{
                    background: 'var(--md-surface-container)',
                    border: '1px solid var(--md-outline-variant)',
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                      style={{ background: `${cColor}20` }}
                    >
                      <span style={{ color: cColor }}>{LEVEL_ICONS.client}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] font-bold" style={{ color: cColor }}>{client.code}</span>
                        <span className="text-[11px] truncate" style={{ color: 'var(--md-on-surface)' }}>{client.name}</span>
                      </div>
                      <span className="text-[10px]" style={{ color: 'var(--md-on-surface-variant)' }}>
                        {projectCount} project{projectCount !== 1 ? 's' : ''}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Helper: find a node in the hierarchy tree by id and level ──────────────

function findNodeInTree(hierarchy, nodeId, nodeLevel) {
  if (!hierarchy || !nodeId || !nodeLevel) return null;

  for (const client of hierarchy) {
    if (nodeLevel === 'client' && client.id === nodeId) return client;
    for (const project of (client.projects || [])) {
      if (nodeLevel === 'project' && project.id === nodeId) return project;
      for (const concession of (project.concessions || [])) {
        if (nodeLevel === 'concession' && concession.id === nodeId) return concession;
        for (const location of (concession.locations || [])) {
          if (nodeLevel === 'location' && location.id === nodeId) return location;
          for (const complex of (location.complexes || [])) {
            if (nodeLevel === 'complex' && complex.id === nodeId) return complex;
            for (const platform of (complex.platforms || [])) {
              if (nodeLevel === 'platform' && platform.id === nodeId) return platform;
            }
          }
        }
      }
    }
  }
  return null;
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function HierarchyManager({ onSelectPlatform, onNavigateTab }) {
  const { data: hierarchy, isLoading, error } = useHierarchy();
  const clientMut = useClientMutation();
  const projectMut = useProjectMutation();
  const concessionMut = useConcessionMutation();
  const locationMut = useLocationMutation();
  const complexMut = useComplexMutation();
  const platformMut = usePlatformMutation();

  const [addingClient, setAddingClient] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [selectedNodeLevel, setSelectedNodeLevel] = useState(null);

  const { data: nextClientCode } = useNextCode(addingClient ? 'client' : null, null);

  const handleAddClient = async (values) => {
    try {
      await clientMut.create(values);
      setAddingClient(false);
    } catch (err) {
      console.error('Create client failed:', err);
    }
  };

  const handleSelectNode = useCallback((id, level) => {
    setSelectedNodeId(id);
    setSelectedNodeLevel(level);
    // If a platform is selected, also notify parent for entity manager context
    if (level === 'platform' && id) {
      onSelectPlatform?.(id);
    }
  }, [onSelectPlatform]);

  const handleNavigateTab = useCallback((tab) => {
    onNavigateTab?.(tab);
  }, [onNavigateTab]);

  const clients = hierarchy?.hierarchy || hierarchy?.clients || hierarchy?.data || [];

  // Find the selected node in the tree
  const selectedNode = useMemo(
    () => findNodeInTree(clients, selectedNodeId, selectedNodeLevel),
    [clients, selectedNodeId, selectedNodeLevel]
  );

  return (
    <div className="flex h-full">
      {/* Left panel — Tree */}
      <div
        className="w-[420px] xl:w-[480px] shrink-0 flex flex-col overflow-hidden"
        style={{ borderRight: '1px solid var(--md-outline-variant)' }}
      >
        <div className="flex-1 overflow-auto" style={{ background: 'var(--md-surface-container)' }}>
          {/* Header */}
          <div
            className="px-4 py-3 flex items-center gap-3 sticky top-0 z-10"
            style={{
              background: 'var(--md-surface-container)',
              borderBottom: '1px solid var(--md-outline-variant)',
            }}
          >
            <div className="w-1 h-5 rounded-full shrink-0" style={{ background: 'var(--md-primary)' }} />
            <span className="text-[13px] font-bold" style={{ color: 'var(--md-on-surface)' }}>
              Asset Hierarchy
            </span>
            <span className="text-[10px] hidden xl:block" style={{ color: 'var(--md-on-surface-variant)' }}>
              Client &rarr; Project &rarr; Concession &rarr; Location &rarr; Complex &rarr; Platform
            </span>
            <div className="flex-1" />
            <button
              onClick={() => setAddingClient(true)}
              className="px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer"
              style={{ background: 'var(--md-primary-container)', color: 'var(--md-on-primary-container)' }}
            >
              + Add Client
            </button>
          </div>

          <div className="px-3 py-2">
            {isLoading && (
              <div className="text-center py-12 text-[12px]" style={{ color: 'var(--md-on-surface-variant)' }}>Loading hierarchy...</div>
            )}

            {error && (
              <div className="text-center py-12 text-[12px]" style={{ color: 'var(--md-error)' }}>
                Error loading hierarchy: {error.message}
              </div>
            )}

            {addingClient && (
              <div className="mb-2">
                <InlineForm
                  fields={[
                    { key: 'code', label: 'Code', width: 100, autoFocus: true },
                    { key: 'name', label: 'Client Name', width: 220 },
                  ]}
                  onSave={handleAddClient}
                  onCancel={() => setAddingClient(false)}
                  suggestedCode={nextClientCode?.code}
                />
              </div>
            )}

            {clients.map(client => (
              <TreeNode
                key={client.id}
                item={client}
                level={0}
                levelKey="client"
                childKey="projects"
                childLevelKey="project"
                color={LEVEL_COLORS.client}
                childColor={LEVEL_COLORS.project}
                mutation={clientMut}
                childMutation={projectMut}
                childFields={[
                  { key: 'code', label: 'Code', width: 100, autoFocus: true },
                  { key: 'name', label: 'Project Name', width: 220 },
                ]}
                selectedNodeId={selectedNodeId}
                selectedNodeLevel={selectedNodeLevel}
                onSelectNode={handleSelectNode}
                renderChildren={(projects) =>
                  projects.map(project => (
                    <TreeNode
                      key={project.id}
                      item={project}
                      level={1}
                      levelKey="project"
                      childKey="concessions"
                      childLevelKey="concession"
                      color={LEVEL_COLORS.project}
                      childColor={LEVEL_COLORS.concession}
                      mutation={projectMut}
                      childMutation={concessionMut}
                      childFields={[
                        { key: 'code', label: 'Code', width: 100, autoFocus: true },
                        { key: 'name', label: 'Concession Name', width: 220 },
                      ]}
                      selectedNodeId={selectedNodeId}
                      selectedNodeLevel={selectedNodeLevel}
                      onSelectNode={handleSelectNode}
                      renderChildren={(concessions) =>
                        concessions.map(concession => (
                          <TreeNode
                            key={concession.id}
                            item={concession}
                            level={2}
                            levelKey="concession"
                            childKey="locations"
                            childLevelKey="location"
                            color={LEVEL_COLORS.concession}
                            childColor={LEVEL_COLORS.location}
                            mutation={concessionMut}
                            childMutation={locationMut}
                            childFields={[
                              { key: 'code', label: 'Code', width: 100, autoFocus: true },
                              { key: 'name', label: 'Location Name', width: 220 },
                            ]}
                            selectedNodeId={selectedNodeId}
                            selectedNodeLevel={selectedNodeLevel}
                            onSelectNode={handleSelectNode}
                            renderChildren={(locations) =>
                              locations.map(location => (
                                <TreeNode
                                  key={location.id}
                                  item={location}
                                  level={3}
                                  levelKey="location"
                                  childKey="complexes"
                                  childLevelKey="complex"
                                  color={LEVEL_COLORS.location}
                                  childColor={LEVEL_COLORS.complex}
                                  mutation={locationMut}
                                  childMutation={complexMut}
                                  childFields={[
                                    { key: 'code', label: 'Code', width: 100, autoFocus: true },
                                    { key: 'name', label: 'Complex Name', width: 220 },
                                  ]}
                                  selectedNodeId={selectedNodeId}
                                  selectedNodeLevel={selectedNodeLevel}
                                  onSelectNode={handleSelectNode}
                                  renderChildren={(complexes) =>
                                    complexes.map(complex => (
                                      <TreeNode
                                        key={complex.id}
                                        item={complex}
                                        level={4}
                                        levelKey="complex"
                                        childKey="platforms"
                                        childLevelKey="platform"
                                        color={LEVEL_COLORS.complex}
                                        childColor={LEVEL_COLORS.platform}
                                        mutation={complexMut}
                                        childMutation={platformMut}
                                        childFields={[
                                          { key: 'code', label: 'Code', width: 100, autoFocus: true },
                                          { key: 'name', label: 'Platform Name', width: 220 },
                                        ]}
                                        selectedNodeId={selectedNodeId}
                                        selectedNodeLevel={selectedNodeLevel}
                                        onSelectNode={handleSelectNode}
                                        renderChildren={(platforms) =>
                                          platforms.map(platform => (
                                            <TreeNode
                                              key={platform.id}
                                              item={platform}
                                              level={5}
                                              levelKey="platform"
                                              childKey={null}
                                              color={LEVEL_COLORS.platform}
                                              mutation={platformMut}
                                              selectedNodeId={selectedNodeId}
                                              selectedNodeLevel={selectedNodeLevel}
                                              onSelectNode={handleSelectNode}
                                            />
                                          ))
                                        }
                                      />
                                    ))
                                  }
                                />
                              ))
                            }
                          />
                        ))
                      }
                    />
                  ))
                }
              />
            ))}

            {!isLoading && !error && clients.length === 0 && (
              <div className="text-center py-12 text-[12px]" style={{ color: 'var(--md-on-surface-variant)' }}>
                No clients found. Click "Add Client" to get started.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Right panel — Context-aware Dashboard */}
      <div className="flex-1 overflow-hidden">
        {selectedNode && selectedNodeLevel === 'platform' ? (
          <PlatformDashboard
            platformId={selectedNodeId}
            onNavigateTab={handleNavigateTab}
          />
        ) : selectedNode && selectedNodeLevel !== 'platform' ? (
          <LevelDashboard
            item={selectedNode}
            levelKey={selectedNodeLevel}
            hierarchy={clients}
            onSelectNode={handleSelectNode}
            onNavigateTab={handleNavigateTab}
          />
        ) : (
          <HierarchyOverview hierarchy={clients} />
        )}
      </div>
    </div>
  );
}
