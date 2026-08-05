import { useState, useMemo } from 'react';
import { useTheme } from '../../context/ThemeContext';
import { M3 } from '../../data/constants';
import { useLinkage } from '../../hooks/useAdminApi';

function SummaryCard({ title, total, linked, unlinked, color, isDark }) {
  const pct = total > 0 ? Math.round((linked / total) * 100) : 0;
  const borderC = isDark ? 'border-white/[0.06]' : 'border-gray-200';
  const mutedText = isDark ? 'text-md-on-surface-variant' : 'text-gray-500';

  return (
    <div className={`flex-1 rounded-xl border ${borderC} p-4 ${isDark ? 'bg-md-surface-container' : 'bg-white'}`}>
      <div className="flex items-center gap-2 mb-3">
        <div className="w-1 h-5 rounded-full" style={{ background: color }} />
        <span className={`text-[12px] font-bold ${isDark ? 'text-md-on-surface' : 'text-gray-900'}`}>{title}</span>
      </div>

      <div className="flex items-baseline gap-3 mb-3">
        <div className="flex flex-col">
          <span className={`text-[22px] font-black ${isDark ? 'text-md-on-surface' : 'text-gray-900'}`}>{total}</span>
          <span className={`text-[10px] ${mutedText}`}>Total</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[18px] font-bold text-md-primary">{linked}</span>
          <span className={`text-[10px] ${mutedText}`}>Linked</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[18px] font-bold text-md-error">{unlinked}</span>
          <span className={`text-[10px] ${mutedText}`}>Unlinked</span>
        </div>
        <div className="flex-1" />
        <span className="text-[18px] font-bold" style={{ color: pct === 100 ? M3.primary : pct > 50 ? M3.warning : M3.error }}>
          {pct}%
        </span>
      </div>

      {/* Progress bar */}
      <div className={`w-full h-2 rounded-full overflow-hidden ${isDark ? 'bg-white/[0.06]' : 'bg-gray-100'}`}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${pct}%`,
            background: pct === 100
              ? M3.primary
              : `linear-gradient(90deg, ${M3.primary}, ${pct > 50 ? M3.warning : M3.error})`,
          }}
        />
      </div>
    </div>
  );
}

function UnlinkedTable({ items, columns, isDark }) {
  const borderC = isDark ? 'border-white/[0.06]' : 'border-gray-200';
  const mutedText = isDark ? 'text-md-on-surface-variant' : 'text-gray-500';
  const panelBg = isDark ? 'bg-md-surface-container' : 'bg-white';

  if (!items || items.length === 0) {
    return (
      <div className={`text-center py-12 text-[12px] ${mutedText}`}>
        All items are linked. No action needed.
      </div>
    );
  }

  return (
    <div className={`rounded-xl border ${borderC} overflow-hidden ${panelBg}`}>
      <table className="w-full border-collapse">
        <thead>
          <tr
            className={`border-b ${borderC}`}
            style={{ background: isDark ? 'rgba(231,76,60,0.07)' : 'rgba(231,76,60,0.05)' }}
          >
            {columns.map(col => (
              <th
                key={col.key}
                className="px-3 py-2 text-left text-[10px] font-bold tracking-wider uppercase text-md-error"
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item, ri) => (
            <tr
              key={item.id || ri}
              className={`border-b transition-colors duration-100 ${
                isDark ? 'border-white/[0.03]' : 'border-gray-100'
              } ${ri % 2 !== 0 ? (isDark ? 'bg-white/[0.015]' : 'bg-gray-50/50') : ''}`}
              onMouseEnter={e => { e.currentTarget.style.background = isDark ? 'rgba(231,76,60,0.04)' : 'rgba(231,76,60,0.03)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = ri % 2 !== 0 ? (isDark ? 'rgba(255,255,255,0.015)' : 'rgba(249,250,251,0.5)') : ''; }}
            >
              {columns.map(col => (
                <td
                  key={col.key}
                  className={`px-3 py-2 text-[11px] ${isDark ? 'text-md-on-surface' : 'text-gray-800'}`}
                >
                  <span className="block truncate">{(item[col.key] ?? '').toString()}</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const TABS = [
  { key: 'lines', label: 'Unlinked Lines' },
  { key: 'equipment', label: 'Unlinked Equipment' },
  { key: 'instruments', label: 'Unlinked Instruments' },
];

const LINE_COLS = [
  { key: 'systemCode', label: 'System' },
  { key: 'lineNumber', label: 'Line Number' },
  { key: 'service', label: 'Service' },
  { key: 'size', label: 'Size' },
];

const EQUIPMENT_COLS = [
  { key: 'systemCode', label: 'System' },
  { key: 'tag', label: 'Tag' },
  { key: 'type', label: 'Type' },
  { key: 'description', label: 'Description' },
];

const INSTRUMENT_COLS = [
  { key: 'systemCode', label: 'System' },
  { key: 'tag', label: 'Tag' },
  { key: 'type', label: 'Type' },
  { key: 'description', label: 'Description' },
];

export default function LinkageDashboard({ platformId }) {
  const { isDark } = useTheme();
  const { data: linkageData, isLoading, error } = useLinkage(platformId);
  const [activeTab, setActiveTab] = useState('lines');

  const borderC = isDark ? 'border-white/[0.06]' : 'border-gray-200';
  const mutedText = isDark ? 'text-md-on-surface-variant' : 'text-gray-500';

  const stats = useMemo(() => {
    if (!linkageData) {
      return {
        lines: { total: 0, linked: 0, unlinked: 0 },
        equipment: { total: 0, linked: 0, unlinked: 0 },
        instruments: { total: 0, linked: 0, unlinked: 0 },
      };
    }
    const d = linkageData.data || linkageData;
    return {
      lines: {
        total: d.lines?.total ?? 0,
        linked: d.lines?.linked ?? 0,
        unlinked: d.lines?.unlinked ?? 0,
      },
      equipment: {
        total: d.equipment?.total ?? 0,
        linked: d.equipment?.linked ?? 0,
        unlinked: d.equipment?.unlinked ?? 0,
      },
      instruments: {
        total: d.instruments?.total ?? 0,
        linked: d.instruments?.linked ?? 0,
        unlinked: d.instruments?.unlinked ?? 0,
      },
    };
  }, [linkageData]);

  const verification = useMemo(() => {
    const d = linkageData?.data || linkageData || {};
    const v = d.verification;
    if (!v) return null;
    return {
      equipment: {
        verified: v.equipment?.verified ?? 0,
        unverified: v.equipment?.unverified ?? 0,
      },
      instruments: {
        verified: v.instruments?.verified ?? 0,
        unverified: v.instruments?.unverified ?? 0,
      },
    };
  }, [linkageData]);

  const unlinkedItems = useMemo(() => {
    const d = linkageData?.data || linkageData || {};
    return {
      lines: d.lines?.unlinkedItems || [],
      equipment: d.equipment?.unlinkedItems || [],
      instruments: d.instruments?.unlinkedItems || [],
    };
  }, [linkageData]);

  if (isLoading) {
    return (
      <div className={`flex-1 flex items-center justify-center text-[12px] ${mutedText}`}>
        Loading linkage data...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center text-[12px] text-md-error">
        Error loading linkage data: {error.message}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto p-4 space-y-4">
      {/* Summary cards */}
      <div className="flex gap-4">
        <SummaryCard
          title="Lines"
          total={stats.lines.total}
          linked={stats.lines.linked}
          unlinked={stats.lines.unlinked}
          color={M3.warning}
          isDark={isDark}
        />
        <SummaryCard
          title="Equipment"
          total={stats.equipment.total}
          linked={stats.equipment.linked}
          unlinked={stats.equipment.unlinked}
          color={M3.primary}
          isDark={isDark}
        />
        <SummaryCard
          title="Instruments"
          total={stats.instruments.total}
          linked={stats.instruments.linked}
          unlinked={stats.instruments.unlinked}
          color={M3.secondary}
          isDark={isDark}
        />
      </div>

      {/* Annotation Verification */}
      {verification && (
        <div className={`rounded-xl border ${borderC} p-4 ${isDark ? 'bg-md-surface-container' : 'bg-white'}`}>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-1 h-5 rounded-full" style={{ background: M3.secondary }} />
            <span className={`text-[12px] font-bold ${isDark ? 'text-md-on-surface' : 'text-gray-900'}`}>
              Annotation Verification
            </span>
          </div>
          <div className="flex gap-6">
            {/* Equipment verification */}
            <div className="flex items-center gap-4">
              <span className={`text-[11px] font-medium ${isDark ? 'text-md-on-surface' : 'text-gray-800'}`}>Equipment</span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: M3.primary }} />
                <span className="text-[11px] font-bold" style={{ color: M3.primary }}>
                  {verification.equipment.verified}
                </span>
                <span className={`text-[10px] ${mutedText}`}>verified</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: M3.error }} />
                <span className="text-[11px] font-bold" style={{ color: M3.error }}>
                  {verification.equipment.unverified}
                </span>
                <span className={`text-[10px] ${mutedText}`}>unverified</span>
              </span>
            </div>

            <div className={`w-px h-6 ${isDark ? 'bg-white/[0.07]' : 'bg-gray-200'}`} />

            {/* Instrument verification */}
            <div className="flex items-center gap-4">
              <span className={`text-[11px] font-medium ${isDark ? 'text-md-on-surface' : 'text-gray-800'}`}>Instruments</span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: M3.primary }} />
                <span className="text-[11px] font-bold" style={{ color: M3.primary }}>
                  {verification.instruments.verified}
                </span>
                <span className={`text-[10px] ${mutedText}`}>verified</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: M3.error }} />
                <span className="text-[11px] font-bold" style={{ color: M3.error }}>
                  {verification.instruments.unverified}
                </span>
                <span className={`text-[10px] ${mutedText}`}>unverified</span>
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className={`flex items-center gap-1 border-b ${borderC} pb-0`}>
        {TABS.map(tab => {
          const isActive = activeTab === tab.key;
          const count = stats[tab.key]?.unlinked ?? 0;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-3 py-2 text-[11px] font-medium border-b-2 transition-all duration-150 cursor-pointer -mb-px ${
                isActive
                  ? 'border-md-error text-md-error font-semibold'
                  : `border-transparent ${isDark ? 'text-md-on-surface-variant hover:text-md-on-surface' : 'text-gray-500 hover:text-gray-700'}`
              }`}
            >
              {tab.label}
              {count > 0 && (
                <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold ${
                  isActive
                    ? 'bg-md-error/15 text-md-error'
                    : isDark ? 'bg-white/[0.06] text-md-on-surface-variant' : 'bg-gray-100 text-gray-500'
                }`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {activeTab === 'lines' && (
        <UnlinkedTable items={unlinkedItems.lines} columns={LINE_COLS} isDark={isDark} />
      )}
      {activeTab === 'equipment' && (
        <UnlinkedTable items={unlinkedItems.equipment} columns={EQUIPMENT_COLS} isDark={isDark} />
      )}
      {activeTab === 'instruments' && (
        <UnlinkedTable items={unlinkedItems.instruments} columns={INSTRUMENT_COLS} isDark={isDark} />
      )}
    </div>
  );
}
