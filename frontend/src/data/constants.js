// M3 Design System color constants for AssetView

// System type colors (M3 tone 80)
export const SC = {
  process: '#4FE2B0',
  utility: '#8AB4FF',
  safety: '#FF897A',
  instrument: '#FFD666',
};

// Criticality colors
export const CC = {
  high: '#FF897A',
  medium: '#FFD666',
  low: '#4FE2B0',
};

// Document status colors
export const STC = {
  as_built: '#4FE2B0',
  approved: '#8AB4FF',
  draft: '#FFB068',
};

// Column accent colors
export const COL = {
  systems: '#4FE2B0',     // primary / process
  pnids: '#8AB4FF',       // secondary / utility
  lines: '#FFB068',       // tertiary / orange
  equipment: '#4FE2B0',   // primary
  instruments: '#8AB4FF', // secondary
};

// M3 color roles — use these instead of hardcoded hex values
export const M3 = {
  primary: '#4FE2B0',
  secondary: '#8AB4FF',
  tertiary: '#FFB068',
  error: '#FF897A',
  warning: '#FFD666',
  sil: '#CDB4FF',
  surface: '#0E1512',
  surfaceContainer: '#1A2521',
  surfaceContainerHigh: '#243330',
  onSurface: '#E1E8E5',
  onSurfaceVariant: '#BFC9C5',
  outline: '#899490',
};

// Entity type colors (for chart/visualization nodes)
export const EC = {
  line: '#FFB068',       // tertiary — same as COL.lines
  equipment: '#4FE2B0',  // primary  — same as COL.equipment
  instrument: '#FFD666', // warning  — same as SC.instrument
};

// P&ID canvas (always light per design spec)
export const CANVAS_BG = '#F5F7F7';

// Legacy alias for old code that uses C.g, C.b, etc.
export const C = {
  g: '#4FE2B0',
  b: '#8AB4FF',
  o: '#FFB068',
  r: '#FF897A',
  y: '#FFD666',
  bg: '#0E1512',
  p: '#1A2521',
  c: '#243330',
  t: '#E1E8E5',
  m: '#BFC9C5',
  w: '#fff',
};
