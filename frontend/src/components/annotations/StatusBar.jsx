import { useAnnotationSummary } from '../../hooks/useAnnotationSearch';

export default function StatusBar({ pnidId }) {
  const { data: summary } = useAnnotationSummary(pnidId);

  if (!summary) return null;

  const items = [
    { label: 'equipment', count: summary.byType?.equipment || 0, color: '#3BE494' },
    { label: 'lines', count: summary.byType?.lines || 0, color: '#8AB4FF' },
    { label: 'instruments', count: summary.byType?.instruments || 0, color: '#FFD466' },
  ];

  const unpos = summary.unpositioned || 0;
  const total = summary.total || 0;
  const positioned = summary.positioned || 0;
  const positionedNoAnnotation = summary.positionedNoAnnotation || 0;
  const draft = summary.draft || 0;
  const coverage = total > 0 ? Math.round((positioned / total) * 100) : 0;

  return (
    <div className="h-7 px-4 flex items-center gap-4 bg-[#0D1F17] border-t border-[#919A9B]/10 shrink-0 text-[9px]">
      {/* Entity counts */}
      {items.map(item => (
        <span key={item.label} className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: item.color }} />
          <span className="font-semibold" style={{ color: item.color }}>{item.count}</span>
          <span className="text-[#919A9B]">{item.label}</span>
        </span>
      ))}

      <span className="text-[#919A9B]/30">|</span>

      <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[#3BE494]" /><span className="font-semibold text-[#3BE494]">{summary.approved || 0}</span><span className="text-[#919A9B]">approved</span></span>
      <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[#F59E0B]" /><span className="font-semibold text-[#F59E0B]">{draft}</span><span className="text-[#919A9B]">draft</span></span>
      <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[#8AB4FF]" /><span className="font-semibold text-[#8AB4FF]">{positionedNoAnnotation}</span><span className="text-[#919A9B]">positioned no-geom</span></span>
      <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[#919A9B]" /><span className="font-semibold text-[#919A9B]">{unpos}</span><span className="text-[#919A9B]">not positioned</span></span>

      <div className="flex-1" />

      {/* Coverage bar */}
      <div className="flex items-center gap-2">
        <span className="text-[#919A9B]">Coverage</span>
        <div className="w-16 h-1.5 rounded-full bg-[#919A9B]/20 overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${coverage}%`,
              background: coverage === 100 ? '#3BE494' : coverage > 50 ? '#FFD466' : '#FF897A',
            }}
          />
        </div>
        <span className="font-semibold" style={{
          color: coverage === 100 ? '#3BE494' : coverage > 50 ? '#FFD466' : '#FF897A',
        }}>
          {coverage}%
        </span>
      </div>
    </div>
  );
}
