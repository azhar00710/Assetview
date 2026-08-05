/**
 * ISA 5.1 P&ID Symbol Library
 *
 * Pure functions returning React SVG JSX elements.
 * Equipment symbols: 80×80 viewBox
 * Instrument symbols: 40×40 viewBox
 * All symbols accept { color, size, strokeWidth } props.
 */

// ─── Defaults ────────────────────────────────────────────────────────
const EQ_VB = '0 0 80 80'; // equipment viewBox
const IN_VB = '0 0 40 40'; // instrument viewBox
const DEFAULTS = { color: '#D3DFE2', size: 80, strokeWidth: 2 };
const IN_DEFAULTS = { color: '#D3DFE2', size: 40, strokeWidth: 1.5 };

function p(defaults, props) {
  return { ...defaults, ...props };
}

// ─── Connection-point helper (metadata, not rendered) ────────────────
// Inline equipment: left/right connections on centerline
// Tap instruments: top/bottom
export const connectionPoints = {
  inline: { left: { x: 0, y: 40 }, right: { x: 80, y: 40 } },
  tap: { top: { x: 20, y: 0 }, bottom: { x: 20, y: 40 } },
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  VALVE SYMBOLS (bow-tie base, 80×80 viewBox)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Gate Valve — two triangles point-to-point */
export function GateValve(props) {
  const { color, size, strokeWidth } = p(DEFAULTS, props);
  return (
    <svg width={size} height={size} viewBox={EQ_VB} fill="none" xmlns="http://www.w3.org/2000/svg">
      <polygon points="10,20 40,40 10,60" stroke={color} strokeWidth={strokeWidth} fill="none" />
      <polygon points="70,20 40,40 70,60" stroke={color} strokeWidth={strokeWidth} fill="none" />
      <line x1="0" y1="40" x2="10" y2="40" stroke={color} strokeWidth={strokeWidth} />
      <line x1="70" y1="40" x2="80" y2="40" stroke={color} strokeWidth={strokeWidth} />
    </svg>
  );
}

/** Globe Valve — bow-tie with horizontal line through center */
export function GlobeValve(props) {
  const { color, size, strokeWidth } = p(DEFAULTS, props);
  return (
    <svg width={size} height={size} viewBox={EQ_VB} fill="none" xmlns="http://www.w3.org/2000/svg">
      <polygon points="10,20 40,40 10,60" stroke={color} strokeWidth={strokeWidth} fill="none" />
      <polygon points="70,20 40,40 70,60" stroke={color} strokeWidth={strokeWidth} fill="none" />
      <line x1="25" y1="40" x2="55" y2="40" stroke={color} strokeWidth={strokeWidth} />
      <line x1="0" y1="40" x2="10" y2="40" stroke={color} strokeWidth={strokeWidth} />
      <line x1="70" y1="40" x2="80" y2="40" stroke={color} strokeWidth={strokeWidth} />
    </svg>
  );
}

/** Ball Valve — bow-tie with filled circle at center */
export function BallValve(props) {
  const { color, size, strokeWidth } = p(DEFAULTS, props);
  return (
    <svg width={size} height={size} viewBox={EQ_VB} fill="none" xmlns="http://www.w3.org/2000/svg">
      <polygon points="10,20 40,40 10,60" stroke={color} strokeWidth={strokeWidth} fill="none" />
      <polygon points="70,20 40,40 70,60" stroke={color} strokeWidth={strokeWidth} fill="none" />
      <circle cx="40" cy="40" r="5" fill={color} stroke={color} strokeWidth={strokeWidth} />
      <line x1="0" y1="40" x2="10" y2="40" stroke={color} strokeWidth={strokeWidth} />
      <line x1="70" y1="40" x2="80" y2="40" stroke={color} strokeWidth={strokeWidth} />
    </svg>
  );
}

/** Check Valve — bow-tie with single filled triangle */
export function CheckValve(props) {
  const { color, size, strokeWidth } = p(DEFAULTS, props);
  return (
    <svg width={size} height={size} viewBox={EQ_VB} fill="none" xmlns="http://www.w3.org/2000/svg">
      <polygon points="10,20 40,40 10,60" stroke={color} strokeWidth={strokeWidth} fill={color} />
      <polygon points="70,20 40,40 70,60" stroke={color} strokeWidth={strokeWidth} fill="none" />
      <line x1="0" y1="40" x2="10" y2="40" stroke={color} strokeWidth={strokeWidth} />
      <line x1="70" y1="40" x2="80" y2="40" stroke={color} strokeWidth={strokeWidth} />
    </svg>
  );
}

/** Control Valve — bow-tie with diaphragm actuator on top */
export function ControlValve(props) {
  const { color, size, strokeWidth } = p(DEFAULTS, props);
  return (
    <svg width={size} height={size} viewBox={EQ_VB} fill="none" xmlns="http://www.w3.org/2000/svg">
      <polygon points="10,35 40,50 10,65" stroke={color} strokeWidth={strokeWidth} fill="none" />
      <polygon points="70,35 40,50 70,65" stroke={color} strokeWidth={strokeWidth} fill="none" />
      <line x1="40" y1="50" x2="40" y2="30" stroke={color} strokeWidth={strokeWidth} />
      <polygon points="25,10 40,30 55,10" stroke={color} strokeWidth={strokeWidth} fill="none" />
      <line x1="25" y1="10" x2="55" y2="10" stroke={color} strokeWidth={strokeWidth} />
      <line x1="0" y1="50" x2="10" y2="50" stroke={color} strokeWidth={strokeWidth} />
      <line x1="70" y1="50" x2="80" y2="50" stroke={color} strokeWidth={strokeWidth} />
    </svg>
  );
}

/** Butterfly Valve — bow-tie with vertical line through center */
export function ButterflyValve(props) {
  const { color, size, strokeWidth } = p(DEFAULTS, props);
  return (
    <svg width={size} height={size} viewBox={EQ_VB} fill="none" xmlns="http://www.w3.org/2000/svg">
      <polygon points="10,20 40,40 10,60" stroke={color} strokeWidth={strokeWidth} fill="none" />
      <polygon points="70,20 40,40 70,60" stroke={color} strokeWidth={strokeWidth} fill="none" />
      <line x1="40" y1="20" x2="40" y2="60" stroke={color} strokeWidth={strokeWidth} />
      <line x1="0" y1="40" x2="10" y2="40" stroke={color} strokeWidth={strokeWidth} />
      <line x1="70" y1="40" x2="80" y2="40" stroke={color} strokeWidth={strokeWidth} />
    </svg>
  );
}

/** Needle Valve — bow-tie with pointed stem from top */
export function NeedleValve(props) {
  const { color, size, strokeWidth } = p(DEFAULTS, props);
  return (
    <svg width={size} height={size} viewBox={EQ_VB} fill="none" xmlns="http://www.w3.org/2000/svg">
      <polygon points="10,25 40,45 10,65" stroke={color} strokeWidth={strokeWidth} fill="none" />
      <polygon points="70,25 40,45 70,65" stroke={color} strokeWidth={strokeWidth} fill="none" />
      <line x1="40" y1="45" x2="40" y2="10" stroke={color} strokeWidth={strokeWidth} />
      <polygon points="37,18 40,10 43,18" stroke={color} strokeWidth={strokeWidth} fill={color} />
      <line x1="0" y1="45" x2="10" y2="45" stroke={color} strokeWidth={strokeWidth} />
      <line x1="70" y1="45" x2="80" y2="45" stroke={color} strokeWidth={strokeWidth} />
    </svg>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  EQUIPMENT SYMBOLS (80×80 viewBox)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Christmas Tree — stack of valves with wing valves */
export function ChristmasTree(props) {
  const { color, size, strokeWidth } = p(DEFAULTS, props);
  return (
    <svg width={size} height={size} viewBox={EQ_VB} fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Main vertical bore */}
      <line x1="40" y1="10" x2="40" y2="75" stroke={color} strokeWidth={strokeWidth} />
      {/* Master valve (bow-tie) */}
      <polygon points="32,60 40,55 48,60" stroke={color} strokeWidth={strokeWidth} fill="none" />
      <polygon points="32,70 40,65 48,70" stroke={color} strokeWidth={strokeWidth} fill="none" />
      {/* Swab valve top */}
      <polygon points="32,15 40,20 48,15" stroke={color} strokeWidth={strokeWidth} fill="none" />
      <polygon points="32,25 40,20 48,25" stroke={color} strokeWidth={strokeWidth} fill="none" />
      {/* Wing valve left */}
      <line x1="15" y1="40" x2="40" y2="40" stroke={color} strokeWidth={strokeWidth} />
      <polygon points="18,35 25,40 18,45" stroke={color} strokeWidth={strokeWidth} fill="none" />
      <polygon points="32,35 25,40 32,45" stroke={color} strokeWidth={strokeWidth} fill="none" />
      {/* Wing valve right */}
      <line x1="40" y1="40" x2="65" y2="40" stroke={color} strokeWidth={strokeWidth} />
      <polygon points="48,35 55,40 48,45" stroke={color} strokeWidth={strokeWidth} fill="none" />
      <polygon points="62,35 55,40 62,45" stroke={color} strokeWidth={strokeWidth} fill="none" />
      {/* Connection points */}
      <line x1="0" y1="40" x2="15" y2="40" stroke={color} strokeWidth={strokeWidth} />
      <line x1="65" y1="40" x2="80" y2="40" stroke={color} strokeWidth={strokeWidth} />
    </svg>
  );
}

/** Choke Valve — bow-tie with adjustable arrow on stem */
export function ChokeValve(props) {
  const { color, size, strokeWidth } = p(DEFAULTS, props);
  return (
    <svg width={size} height={size} viewBox={EQ_VB} fill="none" xmlns="http://www.w3.org/2000/svg">
      <polygon points="10,25 40,45 10,65" stroke={color} strokeWidth={strokeWidth} fill="none" />
      <polygon points="70,25 40,45 70,65" stroke={color} strokeWidth={strokeWidth} fill="none" />
      {/* Stem with adjustable arrow */}
      <line x1="40" y1="45" x2="40" y2="10" stroke={color} strokeWidth={strokeWidth} />
      <line x1="30" y1="18" x2="50" y2="18" stroke={color} strokeWidth={strokeWidth} />
      <line x1="45" y1="14" x2="50" y2="18" stroke={color} strokeWidth={strokeWidth} />
      <line x1="45" y1="22" x2="50" y2="18" stroke={color} strokeWidth={strokeWidth} />
      <line x1="0" y1="45" x2="10" y2="45" stroke={color} strokeWidth={strokeWidth} />
      <line x1="70" y1="45" x2="80" y2="45" stroke={color} strokeWidth={strokeWidth} />
    </svg>
  );
}

/** Safety Valve (PSV/PRV) — bow-tie with spring/weight on bonnet */
export function SafetyValve(props) {
  const { color, size, strokeWidth } = p(DEFAULTS, props);
  return (
    <svg width={size} height={size} viewBox={EQ_VB} fill="none" xmlns="http://www.w3.org/2000/svg">
      <polygon points="10,35 40,50 10,65" stroke={color} strokeWidth={strokeWidth} fill="none" />
      <polygon points="70,35 40,50 70,65" stroke={color} strokeWidth={strokeWidth} fill="none" />
      {/* Stem */}
      <line x1="40" y1="50" x2="40" y2="30" stroke={color} strokeWidth={strokeWidth} />
      {/* Spring zigzag */}
      <polyline points="40,30 34,26 46,22 34,18 46,14 40,10" stroke={color} strokeWidth={strokeWidth} fill="none" />
      <line x1="35" y1="10" x2="45" y2="10" stroke={color} strokeWidth={strokeWidth} />
      <line x1="0" y1="50" x2="10" y2="50" stroke={color} strokeWidth={strokeWidth} />
      <line x1="70" y1="50" x2="80" y2="50" stroke={color} strokeWidth={strokeWidth} />
    </svg>
  );
}

/** Spectacle Blind — figure-8 blind (two circles connected) */
export function SpectacleBind(props) {
  const { color, size, strokeWidth } = p(DEFAULTS, props);
  return (
    <svg width={size} height={size} viewBox={EQ_VB} fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="28" cy="40" r="14" stroke={color} strokeWidth={strokeWidth} fill="none" />
      <circle cx="52" cy="40" r="14" stroke={color} strokeWidth={strokeWidth} fill="none" />
      <line x1="0" y1="40" x2="14" y2="40" stroke={color} strokeWidth={strokeWidth} />
      <line x1="66" y1="40" x2="80" y2="40" stroke={color} strokeWidth={strokeWidth} />
    </svg>
  );
}

/** Header / Manifold — horizontal pipe with branch nozzles */
export function Header(props) {
  const { color, size, strokeWidth } = p(DEFAULTS, props);
  return (
    <svg width={size} height={size} viewBox={EQ_VB} fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Main horizontal pipe */}
      <rect x="5" y="35" width="70" height="10" stroke={color} strokeWidth={strokeWidth} fill="none" />
      {/* Branch nozzles */}
      <line x1="20" y1="35" x2="20" y2="18" stroke={color} strokeWidth={strokeWidth} />
      <line x1="40" y1="35" x2="40" y2="18" stroke={color} strokeWidth={strokeWidth} />
      <line x1="60" y1="35" x2="60" y2="18" stroke={color} strokeWidth={strokeWidth} />
      {/* Flanges on nozzles */}
      <line x1="16" y1="18" x2="24" y2="18" stroke={color} strokeWidth={strokeWidth} />
      <line x1="36" y1="18" x2="44" y2="18" stroke={color} strokeWidth={strokeWidth} />
      <line x1="56" y1="18" x2="64" y2="18" stroke={color} strokeWidth={strokeWidth} />
      {/* Connections */}
      <line x1="0" y1="40" x2="5" y2="40" stroke={color} strokeWidth={strokeWidth} />
      <line x1="75" y1="40" x2="80" y2="40" stroke={color} strokeWidth={strokeWidth} />
    </svg>
  );
}

/** Vessel — pressure vessel: cylinder with hemispherical heads */
export function Vessel(props) {
  const { color, size, strokeWidth } = p(DEFAULTS, props);
  return (
    <svg width={size} height={size} viewBox={EQ_VB} fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Cylinder body */}
      <line x1="20" y1="20" x2="60" y2="20" stroke={color} strokeWidth={strokeWidth} />
      <line x1="20" y1="60" x2="60" y2="60" stroke={color} strokeWidth={strokeWidth} />
      {/* Hemispherical heads */}
      <path d="M20,20 A20,20 0 0,0 20,60" stroke={color} strokeWidth={strokeWidth} fill="none" />
      <path d="M60,20 A20,20 0 0,1 60,60" stroke={color} strokeWidth={strokeWidth} fill="none" />
      {/* Connections */}
      <line x1="0" y1="40" x2="8" y2="40" stroke={color} strokeWidth={strokeWidth} />
      <line x1="72" y1="40" x2="80" y2="40" stroke={color} strokeWidth={strokeWidth} />
    </svg>
  );
}

/** Package — dashed rectangle with label area */
export function Package(props) {
  const { color, size, strokeWidth } = p(DEFAULTS, props);
  return (
    <svg width={size} height={size} viewBox={EQ_VB} fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="10" y="15" width="60" height="50" stroke={color} strokeWidth={strokeWidth} strokeDasharray="6 3" fill="none" />
      <text x="40" y="43" textAnchor="middle" fill={color} fontSize="10" fontFamily="sans-serif">PKG</text>
      <line x1="0" y1="40" x2="10" y2="40" stroke={color} strokeWidth={strokeWidth} />
      <line x1="70" y1="40" x2="80" y2="40" stroke={color} strokeWidth={strokeWidth} />
    </svg>
  );
}

/** Pump — circle with discharge triangle */
export function Pump(props) {
  const { color, size, strokeWidth } = p(DEFAULTS, props);
  return (
    <svg width={size} height={size} viewBox={EQ_VB} fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="40" cy="40" r="20" stroke={color} strokeWidth={strokeWidth} fill="none" />
      {/* Discharge triangle pointing right */}
      <polygon points="60,40 72,32 72,48" stroke={color} strokeWidth={strokeWidth} fill="none" />
      <line x1="0" y1="40" x2="20" y2="40" stroke={color} strokeWidth={strokeWidth} />
      <line x1="72" y1="40" x2="80" y2="40" stroke={color} strokeWidth={strokeWidth} />
    </svg>
  );
}

/** Separator — vertical vessel with internal baffles */
export function Separator(props) {
  const { color, size, strokeWidth } = p(DEFAULTS, props);
  return (
    <svg width={size} height={size} viewBox={EQ_VB} fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Vertical vessel */}
      <line x1="25" y1="15" x2="55" y2="15" stroke={color} strokeWidth={strokeWidth} />
      <line x1="25" y1="65" x2="55" y2="65" stroke={color} strokeWidth={strokeWidth} />
      <path d="M25,15 A15,8 0 0,0 25,65" stroke={color} strokeWidth={strokeWidth} fill="none" />
      <path d="M55,15 A15,8 0 0,1 55,65" stroke={color} strokeWidth={strokeWidth} fill="none" />
      {/* Internal baffles */}
      <line x1="30" y1="30" x2="50" y2="30" stroke={color} strokeWidth={strokeWidth * 0.7} strokeDasharray="3 2" />
      <line x1="30" y1="50" x2="50" y2="50" stroke={color} strokeWidth={strokeWidth * 0.7} strokeDasharray="3 2" />
      {/* Connections */}
      <line x1="0" y1="40" x2="18" y2="40" stroke={color} strokeWidth={strokeWidth} />
      <line x1="62" y1="40" x2="80" y2="40" stroke={color} strokeWidth={strokeWidth} />
    </svg>
  );
}

/** Heat Exchanger — circle with S-curve inside (shell & tube) */
export function HeatExchanger(props) {
  const { color, size, strokeWidth } = p(DEFAULTS, props);
  return (
    <svg width={size} height={size} viewBox={EQ_VB} fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="40" cy="40" r="22" stroke={color} strokeWidth={strokeWidth} fill="none" />
      {/* S-curve inside */}
      <path d="M30,28 C38,28 34,40 40,40 C46,40 42,52 50,52" stroke={color} strokeWidth={strokeWidth} fill="none" />
      <line x1="0" y1="40" x2="18" y2="40" stroke={color} strokeWidth={strokeWidth} />
      <line x1="62" y1="40" x2="80" y2="40" stroke={color} strokeWidth={strokeWidth} />
    </svg>
  );
}

/** Tank — storage tank, cylinder open top */
export function Tank(props) {
  const { color, size, strokeWidth } = p(DEFAULTS, props);
  return (
    <svg width={size} height={size} viewBox={EQ_VB} fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Open top */}
      <line x1="18" y1="15" x2="18" y2="60" stroke={color} strokeWidth={strokeWidth} />
      <line x1="62" y1="15" x2="62" y2="60" stroke={color} strokeWidth={strokeWidth} />
      {/* Bottom ellipse */}
      <path d="M18,60 A22,8 0 0,0 62,60" stroke={color} strokeWidth={strokeWidth} fill="none" />
      <path d="M18,60 A22,8 0 0,1 62,60" stroke={color} strokeWidth={strokeWidth} fill="none" />
      {/* Top rim (open) */}
      <line x1="14" y1="15" x2="22" y2="15" stroke={color} strokeWidth={strokeWidth} />
      <line x1="58" y1="15" x2="66" y2="15" stroke={color} strokeWidth={strokeWidth} />
      {/* Connections */}
      <line x1="0" y1="40" x2="18" y2="40" stroke={color} strokeWidth={strokeWidth} />
      <line x1="62" y1="40" x2="80" y2="40" stroke={color} strokeWidth={strokeWidth} />
    </svg>
  );
}

/** Filter/Strainer — Y-strainer shape */
export function FilterStrainer(props) {
  const { color, size, strokeWidth } = p(DEFAULTS, props);
  return (
    <svg width={size} height={size} viewBox={EQ_VB} fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Main body - Y shape */}
      <line x1="10" y1="30" x2="40" y2="40" stroke={color} strokeWidth={strokeWidth} />
      <line x1="70" y1="30" x2="40" y2="40" stroke={color} strokeWidth={strokeWidth} />
      <line x1="40" y1="40" x2="40" y2="68" stroke={color} strokeWidth={strokeWidth} />
      {/* Strainer cone */}
      <path d="M30,34 L50,34 L44,52 L36,52 Z" stroke={color} strokeWidth={strokeWidth} fill="none" />
      {/* Screen lines inside */}
      <line x1="35" y1="38" x2="35" y2="48" stroke={color} strokeWidth={strokeWidth * 0.5} />
      <line x1="40" y1="36" x2="40" y2="50" stroke={color} strokeWidth={strokeWidth * 0.5} />
      <line x1="45" y1="38" x2="45" y2="48" stroke={color} strokeWidth={strokeWidth * 0.5} />
      {/* Connections */}
      <line x1="0" y1="30" x2="10" y2="30" stroke={color} strokeWidth={strokeWidth} />
      <line x1="70" y1="30" x2="80" y2="30" stroke={color} strokeWidth={strokeWidth} />
    </svg>
  );
}

/** Compressor — circle with crossed diagonals */
export function Compressor(props) {
  const { color, size, strokeWidth } = p(DEFAULTS, props);
  return (
    <svg width={size} height={size} viewBox={EQ_VB} fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="40" cy="40" r="22" stroke={color} strokeWidth={strokeWidth} fill="none" />
      {/* Crossed diagonals */}
      <line x1="25" y1="25" x2="55" y2="55" stroke={color} strokeWidth={strokeWidth} />
      <line x1="55" y1="25" x2="25" y2="55" stroke={color} strokeWidth={strokeWidth} />
      <line x1="0" y1="40" x2="18" y2="40" stroke={color} strokeWidth={strokeWidth} />
      <line x1="62" y1="40" x2="80" y2="40" stroke={color} strokeWidth={strokeWidth} />
    </svg>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  INSTRUMENT SYMBOLS (ISA 5.1 bubbles, 40×40 viewBox)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Field-mounted instrument — plain circle with tag text */
export function InstrumentFieldMounted(props) {
  const { color, size, strokeWidth, tag } = { ...IN_DEFAULTS, tag: '', ...props };
  return (
    <svg width={size} height={size} viewBox={IN_VB} fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="20" cy="20" r="16" stroke={color} strokeWidth={strokeWidth} fill="none" />
      {tag && <text x="20" y="24" textAnchor="middle" fill={color} fontSize="8" fontFamily="sans-serif">{tag}</text>}
    </svg>
  );
}

/** Panel-mounted instrument — circle with horizontal line through center */
export function InstrumentPanelMounted(props) {
  const { color, size, strokeWidth, tag } = { ...IN_DEFAULTS, tag: '', ...props };
  return (
    <svg width={size} height={size} viewBox={IN_VB} fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="20" cy="20" r="16" stroke={color} strokeWidth={strokeWidth} fill="none" />
      <line x1="4" y1="20" x2="36" y2="20" stroke={color} strokeWidth={strokeWidth} />
      {tag && <text x="20" y="17" textAnchor="middle" fill={color} fontSize="7" fontFamily="sans-serif">{tag}</text>}
    </svg>
  );
}

/** DCS/SCADA instrument — circle with horizontal dashed line */
export function InstrumentDCS(props) {
  const { color, size, strokeWidth, tag } = { ...IN_DEFAULTS, tag: '', ...props };
  return (
    <svg width={size} height={size} viewBox={IN_VB} fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="20" cy="20" r="16" stroke={color} strokeWidth={strokeWidth} fill="none" />
      <line x1="4" y1="20" x2="36" y2="20" stroke={color} strokeWidth={strokeWidth} strokeDasharray="4 2" />
      {tag && <text x="20" y="17" textAnchor="middle" fill={color} fontSize="7" fontFamily="sans-serif">{tag}</text>}
    </svg>
  );
}

/** Safety (SIS) instrument — circle with double border */
export function InstrumentSafety(props) {
  const { color, size, strokeWidth, tag } = { ...IN_DEFAULTS, tag: '', ...props };
  return (
    <svg width={size} height={size} viewBox={IN_VB} fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="20" cy="20" r="16" stroke={color} strokeWidth={strokeWidth} fill="none" />
      <circle cx="20" cy="20" r="13" stroke={color} strokeWidth={strokeWidth} fill="none" />
      {tag && <text x="20" y="24" textAnchor="middle" fill={color} fontSize="7" fontFamily="sans-serif">{tag}</text>}
    </svg>
  );
}
