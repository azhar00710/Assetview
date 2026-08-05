import { C } from '../data/constants';

export default function Column({ title, count, color, onHeaderClick, children }) {
  return (
    <div className="flex-1 min-w-0 flex flex-col border-r border-white/[0.024] overflow-hidden">
      <div
        className="px-2 py-[5px] border-b border-white/[0.03] flex items-center gap-1 shrink-0 cursor-pointer"
        style={{ background: `${color}08` }}
        onClick={onHeaderClick}
        title={`Click to open ${title} register`}
      >
        <div className="w-[3px] h-[14px] rounded-sm shrink-0" style={{ background: color }} />
        <span className="text-[10px] font-bold tracking-wide flex-1" style={{ color }}>{title}</span>
        <span className="text-[9px] text-md-on-surface-variant bg-md-surface-container-high px-1.5 py-[1px] rounded-lg">{count}</span>
        <span className="text-[10px] text-md-on-surface-variant opacity-50" title="Open full register">&#10530;</span>
      </div>
      <div className="flex-1 overflow-auto py-[2px]">{children}</div>
    </div>
  );
}
