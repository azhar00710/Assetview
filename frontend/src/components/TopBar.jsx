import { useMemo } from 'react';
import { useTheme } from '../context/ThemeContext';

export default function TopBar({ platforms, platformId, setPlatformId, selSys, selPnid, selLine, showXref, setShowXref, search, setSearch, register, systems, pnids, onExplorerClick, onAdminClick }) {
  const { isDark, toggleTheme } = useTheme();

  const path = useMemo(() => {
    const p = [platforms?.find(p => p.id === platformId)?.code || ''];
    if (selSys) {
      const sys = systems?.find(s => s.id === selSys);
      if (sys) p.push(sys.code);
    }
    if (selPnid) {
      const pnid = pnids?.find(p => p.id === selPnid);
      if (pnid) p.push(pnid.drawingNumber.split('-D-')[1] || pnid.drawingNumber);
    }
    if (selLine) p.push('Line');
    return p;
  }, [platforms, platformId, selSys, selPnid, selLine, systems, pnids]);

  const bg = isDark ? 'bg-md-surface-container border-white/[0.06]' : 'bg-white border-gray-200';
  const divider = isDark ? 'bg-white/[0.07]' : 'bg-gray-200';
  const inputCls = isDark
    ? 'bg-md-surface-container-high border-white/[0.07] text-md-on-surface placeholder-white/25 focus:border-md-primary/50'
    : 'bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400 focus:border-md-primary/60';
  const btnBase = isDark
    ? 'border-white/[0.07] text-md-on-surface-variant hover:text-md-on-surface hover:bg-white/[0.06]'
    : 'border-gray-200 text-gray-500 hover:text-gray-700 hover:bg-gray-100';

  return (
    <div className={`flex items-center px-3 py-2 ${bg} border-b gap-2.5 shrink-0`}>

      {/* Brand mark */}
      <div className="flex items-center gap-2 shrink-0">
        <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-md-primary to-md-secondary flex items-center justify-center shadow-sm">
          <span className="text-[10px] font-black text-md-on-surface tracking-tighter">G</span>
        </div>
        <div className="flex flex-col leading-none">
          <span className={`text-[12px] font-bold tracking-tight ${isDark ? 'text-md-on-surface' : 'text-gray-900'}`}>AssetView</span>
          <span className="text-[8px] font-semibold tracking-widest text-md-primary">GEOSOFT</span>
        </div>
      </div>

      <div className={`w-px h-5 shrink-0 ${divider}`} />

      {/* Breadcrumb / Register label */}
      {!register ? (
        <nav className="flex items-center gap-0.5 min-w-0">
          {path.map((segment, i) => (
            <span key={i} className="flex items-center gap-0.5">
              {i > 0 && (
                <svg className={`w-3 h-3 shrink-0 ${isDark ? 'text-white/[0.15]' : 'text-gray-300'}`} fill="none" viewBox="0 0 12 12">
                  <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
              <span
                className={`text-[11px] font-medium whitespace-nowrap ${
                  i === path.length - 1
                    ? 'text-md-primary font-semibold'
                    : isDark ? 'text-md-on-surface-variant' : 'text-gray-400'
                }`}
              >
                {segment}
              </span>
            </span>
          ))}
        </nav>
      ) : (
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-md-tertiary" />
          <span className="text-[11px] font-bold text-md-tertiary tracking-widest">{register.toUpperCase()} REGISTER</span>
        </div>
      )}

      <div className="flex-1" />

      {/* Search */}
      <div className="relative flex items-center">
        <svg className={`absolute left-2 w-3 h-3 pointer-events-none ${isDark ? 'text-md-on-surface-variant' : 'text-gray-400'}`} fill="none" viewBox="0 0 16 16">
          <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search…"
          className={`pl-6 pr-2 py-1.5 w-44 rounded-lg text-[11px] outline-none border transition-colors duration-150 ${inputCls}`}
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className={`absolute right-2 text-[9px] font-bold cursor-pointer transition-colors duration-100 ${isDark ? 'text-md-on-surface-variant hover:text-md-on-surface' : 'text-gray-400 hover:text-gray-600'}`}
          >
            ✕
          </button>
        )}
      </div>

      {/* Platform selector */}
      <select
        value={platformId ?? ''}
        onChange={e => setPlatformId(e.target.value)}
        className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium outline-none border transition-colors duration-150 cursor-pointer appearance-none ${inputCls}`}
        style={{ paddingRight: '1.5rem' }}
      >
        {platforms?.map(p => <option key={p.id} value={p.id}>{p.code}</option>)}
      </select>

      {/* X-Ref toggle */}
      <button
        onClick={() => setShowXref(!showXref)}
        className={`px-2.5 py-1.5 rounded-lg text-[10px] font-semibold border transition-colors duration-150 cursor-pointer ${
          showXref
            ? 'bg-md-tertiary/12 border-md-tertiary/30 text-md-tertiary'
            : `${isDark ? 'bg-transparent border-white/[0.07] text-md-on-surface-variant' : 'bg-gray-50 border-gray-200 text-gray-400'}`
        }`}
        title={showXref ? 'Cross-references shown' : 'Cross-references hidden'}
      >
        X-Ref2
      </button>

      {/* Explorer button */}
      {onExplorerClick && (
        <button
          onClick={onExplorerClick}
          className="px-2.5 py-1.5 rounded-lg text-[10px] font-semibold border transition-colors duration-150 cursor-pointer bg-md-primary/10 border-md-primary/30 text-md-primary hover:bg-md-primary/20"
          title="Asset Explorer — Visual Hierarchy"
        >
          Explorer
        </button>
      )}

      {/* Admin button */}
      {onAdminClick && (
        <button
          onClick={onAdminClick}
          className={`px-2.5 py-1.5 rounded-lg text-[10px] font-semibold border transition-colors duration-150 cursor-pointer ${btnBase}`}
          title="Open Admin Panel"
        >
          Admin
        </button>
      )}

      {/* Theme toggle */}
      <button
        onClick={toggleTheme}
        className={`px-2.5 py-1.5 rounded-lg text-[11px] border transition-colors duration-150 cursor-pointer ${btnBase}`}
        title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        {isDark ? '☀' : '☽'}
      </button>

    </div>
  );
}
