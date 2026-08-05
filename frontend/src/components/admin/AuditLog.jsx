import { useState } from 'react';
import { useTheme } from '../../context/ThemeContext';
import { M3 } from '../../data/constants';
import { useAuditLog } from '../../hooks/useAdminApi';

const ENTITY_TYPES = ['', 'pnid', 'line', 'equipment', 'instrument'];
const ACTIONS = ['', 'create', 'update', 'delete', 'upload', 'activate', 'verify'];
const PAGE_SIZE = 25;

export default function AuditLog() {
  const { isDark } = useTheme();
  const [filters, setFilters] = useState({ entity_type: '', action: '', page: 1, limit: PAGE_SIZE });
  const [expandedRow, setExpandedRow] = useState(null);

  const { data, isLoading, error } = useAuditLog(filters);

  const borderC = isDark ? 'border-white/[0.06]' : 'border-gray-200';
  const mutedText = isDark ? 'text-md-on-surface-variant' : 'text-gray-500';
  const panelBg = isDark ? 'bg-md-surface-container' : 'bg-white';
  const inputCls = isDark
    ? 'bg-md-surface-container-high border-white/[0.07] text-md-on-surface focus:border-md-primary/50'
    : 'bg-gray-50 border-gray-200 text-gray-900 focus:border-md-primary/60';

  const entries = data?.data || data?.entries || [];
  const totalPages = data?.totalPages || data?.meta?.totalPages || 1;

  const updateFilter = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value, page: 1 }));
  };

  const exportUrl = '/api/v1/admin/audit-log/export';

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center text-[12px] text-md-error">
        Error loading audit log: {error.message}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto p-4 space-y-4">
      {/* Header + filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className={`text-[13px] font-bold ${isDark ? 'text-md-on-surface' : 'text-gray-900'}`}>
          Audit Log
        </h2>

        <div className="flex-1" />

        <select
          value={filters.entity_type}
          onChange={e => updateFilter('entity_type', e.target.value)}
          className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium outline-none border transition-colors duration-150 cursor-pointer appearance-none ${inputCls}`}
        >
          <option value="">All Entities</option>
          {ENTITY_TYPES.filter(Boolean).map(t => (
            <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
          ))}
        </select>

        <select
          value={filters.action}
          onChange={e => updateFilter('action', e.target.value)}
          className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium outline-none border transition-colors duration-150 cursor-pointer appearance-none ${inputCls}`}
        >
          <option value="">All Actions</option>
          {ACTIONS.filter(Boolean).map(a => (
            <option key={a} value={a}>{a.charAt(0).toUpperCase() + a.slice(1)}</option>
          ))}
        </select>

        <a
          href={exportUrl}
          download
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors duration-150 bg-md-primary/15 text-md-primary hover:bg-md-primary/25"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 12 12">
            <path d="M6 2v6M3 6l3 3 3-3M2 10h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Export
        </a>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className={`text-center py-12 text-[12px] ${mutedText}`}>Loading audit log...</div>
      ) : entries.length === 0 ? (
        <div className={`text-center py-12 text-[12px] ${mutedText}`}>No audit entries found.</div>
      ) : (
        <div className={`rounded-xl border ${borderC} overflow-hidden ${panelBg}`}>
          <table className="w-full border-collapse">
            <thead>
              <tr className={`border-b ${borderC}`} style={{ background: isDark ? 'rgba(79,226,176,0.05)' : 'rgba(79,226,176,0.03)' }}>
                <th className="px-3 py-2 text-left text-[10px] font-bold tracking-wider uppercase text-md-primary">Timestamp</th>
                <th className="px-3 py-2 text-left text-[10px] font-bold tracking-wider uppercase text-md-primary">Entity</th>
                <th className="px-3 py-2 text-left text-[10px] font-bold tracking-wider uppercase text-md-primary">Action</th>
                <th className="px-3 py-2 text-left text-[10px] font-bold tracking-wider uppercase text-md-primary">Changes</th>
                <th className="px-3 py-2 text-left text-[10px] font-bold tracking-wider uppercase text-md-primary">User</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, ri) => {
                const isExpanded = expandedRow === ri;
                return (
                  <tr
                    key={entry.id || ri}
                    className={`border-b transition-colors duration-100 ${
                      isDark ? 'border-white/[0.03]' : 'border-gray-100'
                    } ${ri % 2 !== 0 ? (isDark ? 'bg-white/[0.015]' : 'bg-gray-50/50') : ''}`}
                  >
                    <td className={`px-3 py-2 text-[11px] ${isDark ? 'text-md-on-surface' : 'text-gray-800'} whitespace-nowrap`}>
                      {entry.timestamp ? new Date(entry.timestamp).toLocaleString() : '-'}
                    </td>
                    <td className={`px-3 py-2 text-[11px] ${isDark ? 'text-md-on-surface' : 'text-gray-800'}`}>
                      <span
                        className="px-1.5 py-0.5 rounded text-[10px] font-bold"
                        style={{
                          background: isDark ? 'rgba(138,180,255,0.12)' : 'rgba(138,180,255,0.1)',
                          color: M3.secondary,
                        }}
                      >
                        {entry.entity_type || '-'}
                      </span>
                    </td>
                    <td className={`px-3 py-2 text-[11px] ${isDark ? 'text-md-on-surface' : 'text-gray-800'}`}>
                      <ActionBadge action={entry.action} isDark={isDark} />
                    </td>
                    <td className={`px-3 py-2 text-[11px] ${isDark ? 'text-md-on-surface' : 'text-gray-800'} max-w-[300px]`}>
                      {entry.changes ? (
                        <button
                          onClick={() => setExpandedRow(isExpanded ? null : ri)}
                          className={`text-[11px] cursor-pointer underline decoration-dotted ${isDark ? 'text-md-primary' : 'text-md-primary'}`}
                        >
                          {isExpanded ? 'Hide' : 'View changes'}
                        </button>
                      ) : (
                        <span className={mutedText}>-</span>
                      )}
                      {isExpanded && entry.changes && (
                        <pre className={`mt-2 p-2 rounded-lg text-[10px] overflow-auto max-h-48 ${
                          isDark ? 'bg-md-surface-container-high text-md-on-surface' : 'bg-gray-100 text-gray-800'
                        }`}>
                          {typeof entry.changes === 'string' ? entry.changes : JSON.stringify(entry.changes, null, 2)}
                        </pre>
                      )}
                    </td>
                    <td className={`px-3 py-2 text-[11px] ${mutedText}`}>
                      {entry.created_by || entry.user || '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            disabled={filters.page <= 1}
            onClick={() => setFilters(prev => ({ ...prev, page: prev.page - 1 }))}
            className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors duration-150 cursor-pointer border ${
              filters.page <= 1
                ? `opacity-40 cursor-not-allowed ${isDark ? 'border-white/[0.04] text-md-on-surface-variant' : 'border-gray-200 text-gray-400'}`
                : `${isDark ? 'border-white/[0.07] text-md-on-surface hover:bg-white/[0.04]' : 'border-gray-200 text-gray-700 hover:bg-gray-100'}`
            }`}
          >
            Previous
          </button>
          <span className={`text-[11px] ${mutedText}`}>
            Page {filters.page} of {totalPages}
          </span>
          <button
            disabled={filters.page >= totalPages}
            onClick={() => setFilters(prev => ({ ...prev, page: prev.page + 1 }))}
            className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors duration-150 cursor-pointer border ${
              filters.page >= totalPages
                ? `opacity-40 cursor-not-allowed ${isDark ? 'border-white/[0.04] text-md-on-surface-variant' : 'border-gray-200 text-gray-400'}`
                : `${isDark ? 'border-white/[0.07] text-md-on-surface hover:bg-white/[0.04]' : 'border-gray-200 text-gray-700 hover:bg-gray-100'}`
            }`}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

function ActionBadge({ action, isDark }) {
  const colorMap = {
    create: M3.primary,
    update: M3.warning,
    delete: M3.error,
    upload: M3.secondary,
    activate: M3.primary,
    verify: M3.primary,
  };
  const color = colorMap[action] || M3.onSurfaceVariant;

  return (
    <span
      className="px-1.5 py-0.5 rounded text-[10px] font-bold"
      style={{
        background: isDark ? `${color}1F` : `${color}1A`,
        color,
      }}
    >
      {action || '-'}
    </span>
  );
}
