import { useState } from 'react';
import { useTheme } from '../context/ThemeContext';
import { SC, STC, COL, CC, M3 } from '../data/constants';

function Col({ title, count, color, regKey, onHeaderClick, children, isDark }) {
  const [hdr, setHdr] = useState(false);
  return (
    <div className={`flex-1 min-w-0 flex flex-col overflow-hidden ${isDark ? 'border-r border-white/[0.05]' : 'border-r border-gray-200'}`}>
      <div
        className={`px-3 py-2 flex items-center gap-2 shrink-0 cursor-pointer select-none transition-colors duration-150 ${isDark ? 'border-b border-white/[0.05]' : 'border-b border-gray-200'}`}
        style={{ background: hdr ? `${color}18` : `${color}0d` }}
        onClick={() => onHeaderClick(regKey)}
        onMouseEnter={() => setHdr(true)}
        onMouseLeave={() => setHdr(false)}
        title="Open register view"
      >
        <div className="w-[3px] h-4 rounded-full shrink-0" style={{ background: color }} />
        <span className="text-[11px] font-bold tracking-widest flex-1" style={{ color }}>{title}</span>
        <span
          className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
          style={{ background: `${color}20`, color }}
        >
          {count}
        </span>
        <svg className={`w-3 h-3 opacity-40 transition-opacity duration-150 ${hdr ? 'opacity-70' : ''}`} style={{ color }} fill="none" viewBox="0 0 16 16">
          <path d="M3 3h10v10M3 13L13 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </div>
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-1">{children}</div>
    </div>
  );
}

function SystemItem({ sys, selected, onClick, isDark }) {
  const sc = SC[sys.sysType] || M3.primary;
  return (
    <div
      onClick={onClick}
      className={`px-3 py-2.5 mx-1.5 my-0.5 rounded-lg cursor-pointer transition-colors duration-100 group`}
      style={{
        background: selected ? `${sc}18` : undefined,
        borderLeft: `3px solid ${selected ? sc : 'transparent'}`,
      }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = selected ? `${sc}18` : ''; }}
    >
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: sc }} />
        <span className={`text-[12px] font-semibold leading-snug truncate ${selected ? '' : isDark ? 'text-md-on-surface' : 'text-gray-800'}`} style={selected ? { color: sc } : {}}>
          {sys.name}
        </span>
      </div>
      <div className="flex gap-1.5 mt-1.5 pl-4">
        <Pill color={M3.secondary}>{sys.primaryPnidCount} P&amp;ID</Pill>
        <Pill color={M3.tertiary}>{sys.lineCount} lines</Pill>
        <Pill color={M3.primary}>{sys.equipmentCount} equip</Pill>
      </div>
    </div>
  );
}

function PnidItem({ pnid, selected, onClick, onViewPnid, isDark }) {
  const isXref = pnid.isPrimary === false;
  const statusColor = STC[pnid.status] || M3.outline;
  return (
    <div
      onClick={onClick}
      className={`px-3 py-2 mx-1.5 my-0.5 rounded-lg cursor-pointer transition-colors duration-100`}
      style={{
        background: selected ? `${M3.secondary}18` : undefined,
        borderLeft: `3px solid ${selected ? M3.secondary : isXref ? M3.tertiary + '55' : 'transparent'}`,
        opacity: isXref ? 0.7 : 1,
      }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = selected ? `${M3.secondary}18` : ''; }}
    >
      <div className="flex items-center gap-2">
        <span className={`text-[10px] leading-none ${isDark ? 'text-md-on-surface-variant' : 'text-gray-400'}`}>{isXref ? '↗' : '⊞'}</span>
        <span className={`text-[11.5px] font-semibold flex-1 truncate ${selected ? 'text-md-secondary' : isDark ? 'text-md-on-surface' : 'text-gray-800'}`}>
          {pnid.drawingNumber}
        </span>
        <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full" style={{ background: `${statusColor}20`, color: statusColor }}>
          {(pnid.status || '').replace(/_/g, ' ')}
        </span>
        {pnid.hasImage && (
          <button
            onClick={e => { e.stopPropagation(); onViewPnid(pnid.id); }}
            className="text-[9px] font-semibold px-2 py-0.5 rounded-md bg-md-primary/10 border border-md-primary/25 text-md-primary cursor-pointer hover:bg-md-primary/20 transition-colors duration-100 shrink-0"
            title="View P&ID drawing"
          >
            View
          </button>
        )}
      </div>
      <div className={`text-[10px] mt-1 truncate pl-5 ${isDark ? 'text-md-on-surface-variant' : 'text-gray-500'}`}>{pnid.title}</div>
      <div className="flex items-center gap-1.5 mt-1 pl-5">
        <Pill color={M3.tertiary}>{pnid.lineCount} lines</Pill>
        {pnid.equipmentCount > 0 && <Pill color={M3.primary}>{pnid.equipmentCount} equip</Pill>}
        {pnid.instrumentCount > 0 && <Pill color={M3.secondary}>{pnid.instrumentCount} instr</Pill>}
        {isXref && <Pill color={M3.tertiary}>x-ref</Pill>}
        {!isXref && pnid.xrefSystemCount > 0 && <span className="text-[9px] font-medium text-md-tertiary">+{pnid.xrefSystemCount} sys</span>}
      </div>
    </div>
  );
}

function LineItem({ line, selected, onClick, isDark }) {
  const isXref = line.isCrossReference;
  const isCont = line.isContinuation;
  const osColor = SC[line.ownerSystemType] || M3.outline;
  const accent = M3.tertiary;
  return (
    <div
      onClick={onClick}
      className={`px-3 py-2 mx-1.5 my-0.5 rounded-lg cursor-pointer transition-colors duration-100`}
      style={{
        background: selected ? `${accent}15` : undefined,
        borderLeft: `3px solid ${selected ? accent : isXref ? osColor + '55' : 'transparent'}`,
        opacity: isXref ? 0.75 : 1,
      }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = selected ? `${accent}15` : ''; }}
    >
      <div className="flex items-center gap-1.5">
        {isXref && <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: osColor }} />}
        {isCont && !isXref && <span className={`text-[9px] ${isDark ? 'text-md-on-surface-variant' : 'text-gray-400'}`}>↗</span>}
        <span className={`text-[11px] font-mono font-semibold flex-1 truncate ${selected ? 'text-md-tertiary' : isDark ? 'text-md-on-surface' : 'text-gray-800'}`}>
          {line.lineNumber}
        </span>
      </div>
      <div className={`text-[10px] mt-0.5 truncate ${isDark ? 'text-md-on-surface-variant' : 'text-gray-500'}`}>
        {line.service}{line.nominalSize ? ` · ${line.nominalSize}` : ''}
      </div>
      <div className={`flex gap-2 mt-1 text-[9px] ${isDark ? 'text-md-on-surface-variant' : 'text-gray-400'}`}>
        {line.equipmentCount > 0 && <span>{line.equipmentCount} eq</span>}
        {line.instrumentCount > 0 && <span>{line.instrumentCount} inst</span>}
        {line.pnidCount > 0 && <span>{line.pnidCount} P&amp;ID</span>}
      </div>
    </div>
  );
}

function EquipItem({ eq, selected, onClick, isDark }) {
  const accent = M3.primary;
  const critColor = CC[eq.criticality];
  return (
    <div
      onClick={onClick}
      className={`px-3 py-2 mx-1.5 my-0.5 rounded-lg cursor-pointer transition-colors duration-100`}
      style={{
        background: selected ? `${accent}15` : undefined,
        borderLeft: `3px solid ${selected ? accent : 'transparent'}`,
      }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = selected ? `${accent}15` : ''; }}
    >
      <div className="flex items-center gap-2">
        <span className={`text-[12px] font-bold tracking-tight ${selected ? 'text-md-primary' : isDark ? 'text-md-on-surface' : 'text-gray-800'}`}>{eq.tag}</span>
        {critColor && (
          <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: `${critColor}20`, color: critColor }}>
            {eq.criticality}
          </span>
        )}
      </div>
      <div className={`text-[10px] mt-0.5 ${isDark ? 'text-md-on-surface-variant' : 'text-gray-500'}`}>{eq.equipmentType}</div>
      <div className="flex gap-1.5 mt-1">
        {eq.isStandalone && <Pill color={M3.tertiary}>standalone</Pill>}
        {eq.silLevel && <Pill color={M3.sil}>{eq.silLevel}</Pill>}
      </div>
    </div>
  );
}

function InstItem({ inst, selected, onClick, isDark }) {
  const accent = M3.secondary;
  return (
    <div
      onClick={onClick}
      className={`px-3 py-2 mx-1.5 my-0.5 rounded-lg cursor-pointer transition-colors duration-100`}
      style={{
        background: selected ? `${accent}15` : undefined,
        borderLeft: `3px solid ${selected ? accent : 'transparent'}`,
      }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = selected ? `${accent}15` : ''; }}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-[12px] font-bold tracking-tight ${selected ? 'text-md-secondary' : isDark ? 'text-md-on-surface' : 'text-gray-800'}`}>{inst.tag}</span>
        <Pill color={M3.secondary}>{(inst.instrumentType || '').replace(/_/g, ' ')}</Pill>
      </div>
      <div className={`text-[10px] mt-0.5 truncate ${isDark ? 'text-md-on-surface-variant' : 'text-gray-500'}`}>{inst.description}</div>
      {inst.scadaTag && (
        <div className="text-[9px] font-mono mt-1 text-md-secondary opacity-80">{inst.scadaTag}</div>
      )}
    </div>
  );
}

function Pill({ color, children }) {
  return (
    <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full inline-block" style={{ background: `${color}20`, color }}>
      {children}
    </span>
  );
}

function EmptyState({ isDark }) {
  return (
    <div className={`flex flex-col items-center justify-center h-full gap-2 py-8 ${isDark ? 'text-md-outline' : 'text-gray-300'}`}>
      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 3"/>
      </svg>
      <span className="text-[10px]">No items</span>
    </div>
  );
}

export default function MillerColumns({
  systems, pnids, lines, equipment, instruments,
  selSys, setSelSys, selPnid, setSelPnid, selLine, setSelLine, selItem, setSelItem,
  search, onHeaderClick, onViewPnid,
}) {
  const { isDark } = useTheme();

  const filter = (items, fields) => {
    if (!search) return items || [];
    const q = search.toLowerCase();
    return (items || []).filter(item => fields.some(f => (item[f] || '').toString().toLowerCase().includes(q)));
  };

  const fSystems = filter(systems, ['name', 'code']);
  const fPnids = search ? filter(pnids, ['drawingNumber', 'title']) : (pnids || []);
  const fLines = search ? filter(lines, ['lineNumber', 'service']) : (lines || []);
  const fEquip = search ? filter(equipment, ['tag', 'description', 'equipmentType']) : (equipment || []);
  const fInst = search ? filter(instruments, ['tag', 'description', 'scadaTag']) : (instruments || []);

  return (
    <div className="flex-1 flex overflow-hidden">
      <Col title="SYSTEMS" count={fSystems.length} color={COL.systems} regKey="systems" onHeaderClick={onHeaderClick} isDark={isDark}>
        {fSystems.length ? fSystems.map(s => (
          <SystemItem key={s.id} sys={s} selected={selSys === s.id} isDark={isDark} onClick={() => {
            setSelSys(selSys === s.id ? null : s.id);
            setSelPnid(null); setSelLine(null); setSelItem(null);
          }} />
        )) : <EmptyState isDark={isDark} />}
      </Col>

      <Col title="P&IDs" count={fPnids.length} color={COL.pnids} regKey="pnids" onHeaderClick={onHeaderClick} isDark={isDark}>
        {fPnids.length ? fPnids.map(p => (
          <PnidItem key={p.id + (p.isPrimary === false ? 'x' : '')} pnid={p} selected={selPnid === p.id} isDark={isDark} onClick={() => {
            setSelPnid(selPnid === p.id ? null : p.id);
            setSelLine(null); setSelItem(null);
          }} onViewPnid={onViewPnid} />
        )) : <EmptyState isDark={isDark} />}
      </Col>

      <Col title="LINES" count={fLines.length} color={COL.lines} regKey="lines" onHeaderClick={onHeaderClick} isDark={isDark}>
        {fLines.length ? fLines.map(l => (
          <LineItem key={l.id} line={l} selected={selLine === l.id} isDark={isDark} onClick={() => {
            setSelLine(selLine === l.id ? null : l.id);
            setSelItem(null);
          }} />
        )) : <EmptyState isDark={isDark} />}
      </Col>

      <Col title="EQUIPMENT" count={fEquip.length} color={COL.equipment} regKey="equipment" onHeaderClick={onHeaderClick} isDark={isDark}>
        {fEquip.length ? fEquip.map(e => (
          <EquipItem key={e.id} eq={e} selected={selItem?.id === e.id} isDark={isDark} onClick={() => setSelItem(selItem?.id === e.id ? null : e)} />
        )) : <EmptyState isDark={isDark} />}
      </Col>

      <Col title="INSTRUMENTS" count={fInst.length} color={COL.instruments} regKey="instruments" onHeaderClick={onHeaderClick} isDark={isDark}>
        {fInst.length ? fInst.map(i => (
          <InstItem key={i.id} inst={i} selected={selItem?.id === i.id} isDark={isDark} onClick={() => setSelItem(selItem?.id === i.id ? null : i)} />
        )) : <EmptyState isDark={isDark} />}
      </Col>
    </div>
  );
}
