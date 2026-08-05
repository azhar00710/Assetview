import { useState, useMemo } from 'react';
import { md } from '../../lib/theme';
import { useAiAnalysisRelationships } from '../../hooks/useAiAnalysis';

const REL_TYPE_LABELS = {
  instrument_on_line: 'Instrument on Line',
  equipment_on_line: 'Equipment on Line',
  line_connects_equipment: 'Line connects Equipment',
  instrument_monitors_equipment: 'Instrument monitors Equipment',
};

const TYPE_COLORS = {
  equipment: '#3BE494',
  instrument: '#F39C12',
  line: '#2D33E0',
};

export default function RelationshipView({ jobId }) {
  const { data, isLoading } = useAiAnalysisRelationships(jobId);
  const [filterType, setFilterType] = useState('all');

  const relationships = data?.relationships || [];

  const filtered = useMemo(() => {
    if (filterType === 'all') return relationships;
    return relationships.filter(r => r.type === filterType);
  }, [relationships, filterType]);

  const relTypes = useMemo(() => {
    const types = new Set(relationships.map(r => r.type));
    return [...types];
  }, [relationships]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32 text-md-on-surface-variant">
        <span className="material-symbols-outlined animate-spin text-[16px] mr-2">progress_activity</span>
        Loading relationships...
      </div>
    );
  }

  if (relationships.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-md-on-surface-variant">
        <span className="material-symbols-outlined text-[40px] opacity-20 mb-2">account_tree</span>
        <span className="text-body-md">No relationships discovered</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Filter bar */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-md-outline-variant/20 shrink-0">
        <span className="text-[10px] text-md-on-surface-variant mr-1">Type:</span>
        <button
          onClick={() => setFilterType('all')}
          className={`px-1.5 py-0.5 text-[9px] rounded font-semibold transition-colors ${
            filterType === 'all' ? 'bg-white/10 text-white' : 'text-md-on-surface-variant hover:text-md-on-surface'
          }`}
        >
          All ({relationships.length})
        </button>
        {relTypes.map(type => (
          <button
            key={type}
            onClick={() => setFilterType(type)}
            className={`px-1.5 py-0.5 text-[9px] rounded font-semibold transition-colors ${
              filterType === type ? 'bg-white/10 text-white' : 'text-md-on-surface-variant hover:text-md-on-surface'
            }`}
          >
            {REL_TYPE_LABELS[type] || type} ({relationships.filter(r => r.type === type).length})
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-[11px]">
          <thead className="sticky top-0 z-10">
            <tr className="text-left text-md-on-surface-variant bg-md-surface-container-high/80">
              <th className="px-3 py-2">From</th>
              <th className="px-3 py-2 text-center">Relationship</th>
              <th className="px-3 py-2">To</th>
              <th className="px-3 py-2 text-center">Confidence</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(rel => {
              const confColor = rel.confidence >= 0.9 ? '#3BE494' :
                rel.confidence >= 0.7 ? '#F39C12' : '#E74C3C';
              return (
                <tr key={rel.id} className="border-b border-md-outline-variant/10 hover:bg-md-on-surface/3">
                  <td className="px-3 py-2">
                    <span className="font-bold font-mono" style={{ color: TYPE_COLORS[rel.fromType] }}>
                      {rel.fromTag}
                    </span>
                    <span className="text-[9px] text-md-on-surface-variant ml-1">{rel.fromType}</span>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span className="flex items-center justify-center gap-1 text-purple-400">
                      <span className="material-symbols-outlined text-[12px]">arrow_forward</span>
                      <span className="text-[9px] font-semibold">{REL_TYPE_LABELS[rel.type] || rel.type}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className="font-bold font-mono" style={{ color: TYPE_COLORS[rel.toType] }}>
                      {rel.toTag}
                    </span>
                    <span className="text-[9px] text-md-on-surface-variant ml-1">{rel.toType}</span>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span className="font-bold" style={{ color: confColor }}>
                      {Math.round(rel.confidence * 100)}%
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
