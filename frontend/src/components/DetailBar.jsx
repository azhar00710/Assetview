import { C, CC, M3 } from '../data/constants';

export default function DetailBar({ item, onClose }) {
  if (!item) return null;

  return (
    <div className="px-3.5 py-[7px] bg-md-surface-container border-t border-white/[0.03] flex items-center gap-2 shrink-0 flex-wrap">
      <span className="text-[15px] font-bold text-md-on-surface">{item.tag || item.name}</span>
      {item.eqType && <span className="text-[10px] px-1.5 py-[2px] rounded-xl" style={{ background: `${C.g}20`, color: C.g }}>{item.eqType}</span>}
      {item.iType && <span className="text-[10px] px-1.5 py-[2px] rounded-xl" style={{ background: `${C.b}20`, color: C.b }}>{item.iType?.replace(/_/g, " ")}</span>}
      {item.criticality && <span className="text-[10px] px-1.5 py-[2px] rounded-xl" style={{ background: `${CC[item.criticality]}20`, color: CC[item.criticality] }}>{item.criticality}</span>}
      {item.sil && <span className="text-[10px] px-1.5 py-[2px] rounded-xl" style={{ background: `${M3.sil}20`, color: M3.sil }}>{item.sil}</span>}
      {item.title && <span className="text-[11px] text-md-on-surface-variant">{item.title}</span>}
      {item.desc && <span className="text-[11px] text-md-on-surface-variant">{item.desc}</span>}
      {item.service && <span className="text-[11px] text-md-on-surface-variant">{item.service} &middot; {item.size}</span>}
      {item.insp && <span className="text-[10px] text-md-on-surface-variant">Insp:{item.insp}</span>}
      {item.cl && <span className="text-[10px] text-md-on-surface-variant">CL:{item.cl}</span>}
      {item.range && <span className="text-[10px] text-md-on-surface-variant">{item.range}</span>}
      {item.scada && <span className="text-[10px]" style={{ color: C.b }}>{item.scada}</span>}
      <div className="flex-1" />
      <button onClick={onClose} className="bg-transparent border border-white/[0.07] rounded px-1.5 py-[3px] text-md-on-surface-variant text-[10px] cursor-pointer hover:bg-white/5">
        &#10005;
      </button>
    </div>
  );
}
