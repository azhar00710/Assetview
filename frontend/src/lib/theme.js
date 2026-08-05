/**
 * Material Design 3 — Theme Constants for AssetView
 *
 * Teal-tinted dark theme following Google's M3 specification.
 * All surfaces carry a subtle green/teal undertone derived from
 * the primary seed color (hue ~160, chroma ~6).
 *
 * Reference: m3.material.io/styles/color/roles
 *
 * Usage:
 *   import { md, systemColor, critColor, statusColor } from '../lib/theme';
 *   style={{ background: md.surface, color: md.onSurface }}
 *   style={{ borderColor: systemColor('process') }}
 */

// ═══════════════════════════════════════════════════════
// M3 Dark Theme Tokens — Teal-Tinted Surfaces
// ═══════════════════════════════════════════════════════
//
// Surfaces use Neutral tonal palette with hue ~160 (teal),
// chroma ~6, at M3 standard tone steps:
//   Dim=6, Surface=6, ContainerLowest=4, ContainerLow=10,
//   Container=12, ContainerHigh=17, ContainerHighest=22, Bright=24
//
// This gives every surface a subtle green warmth instead of dead gray.

export const md = {
  // ─── Surfaces (teal-tinted neutrals) ───
  surface:                '#0E1512',   // Tone 6  — main background
  surfaceDim:             '#0A110E',   // Tone 4  — deepest layer
  surfaceContainerLowest: '#060D0A',   // Tone 2  — absolute deepest
  surfaceContainerLow:    '#141D19',   // Tone 10 — quiet containers
  surfaceContainer:       '#1A2521',   // Tone 12 — standard containers (cards, app bars)
  surfaceContainerHigh:   '#243330',   // Tone 17 — elevated containers (sheets, dialogs)
  surfaceContainerHighest:'#2F3D3A',   // Tone 22 — highest emphasis containers
  surfaceBright:          '#354540',   // Tone 24 — brightest surface
  surfaceVariant:         '#3F4F4A',   // NeutralVariant tone 30

  // ─── On-Surface (text & icons) ───
  onSurface:              '#E1E8E5',   // Tone 90 — primary text (warm white)
  onSurfaceVariant:       '#BFC9C5',   // NeutralVariant tone 80 — secondary text
  outline:                '#899490',   // NeutralVariant tone 60 — visible borders
  outlineVariant:         '#3F4F4A',   // NeutralVariant tone 30 — subtle dividers

  // ─── Primary (Vibrant Teal) — hue 160, chroma 48 ───
  primary:              '#4FE2B0',     // Tone 80 — buttons, active states, FABs
  onPrimary:            '#003828',     // Tone 20 — text on primary fills
  primaryContainer:     '#005E42',     // Tone 30 — selected states, tonal buttons
  onPrimaryContainer:   '#73FFCC',     // Tone 90 — text on primary containers

  // ─── Secondary (Vibrant Blue) — hue 220, chroma 48 ───
  secondary:              '#8AB4FF',   // Tone 80 — secondary actions, info
  onSecondary:            '#002F6B',   // Tone 20 — text on secondary fills
  secondaryContainer:     '#004A9F',   // Tone 30 — chips, secondary selection
  onSecondaryContainer:   '#D4E3FF',   // Tone 90 — text on secondary containers

  // ─── Tertiary (Vibrant Orange) — hue 30, chroma 48 ───
  tertiary:              '#FFB068',     // Tone 80 — complementary accent
  onTertiary:            '#4A2800',     // Tone 20 — text on tertiary fills
  tertiaryContainer:     '#6A3B00',     // Tone 30 — tertiary containers
  onTertiaryContainer:   '#FFDCB8',    // Tone 90 — text on tertiary containers

  // ─── Error (Vibrant Red) — hue 0, chroma 48 ───
  error:                '#FF897A',      // Tone 80 — unmissable error
  onError:              '#690100',      // Tone 20
  errorContainer:       '#930100',      // Tone 30 — error backgrounds
  onErrorContainer:     '#FFDAD4',      // Tone 90

  // ─── Special ───
  silPurple:    '#CDB4FF',             // SIL level indicator
  canvasLight:  '#F5F7F6',             // P&ID viewer background (always light)
  white:        '#FFFFFF',

  // ─── Inverse (for snackbars, tooltips) ───
  inverseSurface:   '#E1E8E5',
  inverseOnSurface: '#2C3330',
  inversePrimary:   '#006C4D',
};

// ═══════════════════════════════════════════════════════
// Semantic Color Maps — Oil & Gas System Types
// ═══════════════════════════════════════════════════════
// These are VIBRANT — meant to be seen immediately on dark backgrounds.
// Used for dots, borders, chips, and column accents.

const SYSTEM_COLORS = {
  process:    '#4FE2B0',  // Teal green — production, process flow
  utility:    '#8AB4FF',  // Blue — utilities, services
  safety:     '#FF897A',  // Red — safety critical, ESD, blowdown
  instrument: '#FFD466',  // Amber — instrumentation, SCADA
};

const CRIT_COLORS = {
  high:   '#FF897A',      // Red — high criticality
  medium: '#FFD466',      // Amber — medium criticality
  low:    '#4FE2B0',      // Teal — low criticality
};

const STATUS_COLORS = {
  as_built: '#4FE2B0',    // Teal — approved as-built
  approved: '#8AB4FF',    // Blue — approved for design
  draft:    '#FFB068',    // Orange — draft, in review
};

/** Get system type color. Returns primary as fallback. */
export function systemColor(type) {
  return SYSTEM_COLORS[type] || md.primary;
}

/** Get criticality color. Returns on-surface-variant as fallback. */
export function critColor(level) {
  return CRIT_COLORS[level] || md.onSurfaceVariant;
}

/** Get document status color. Returns on-surface-variant as fallback. */
export function statusColor(status) {
  return STATUS_COLORS[status] || md.onSurfaceVariant;
}

// ═══════════════════════════════════════════════════════
// M3 Column Color Map (for Miller Columns)
// Each column has a distinct accent color for visual identification
// ═══════════════════════════════════════════════════════

export const COLUMN_COLORS = {
  systems:     md.primary,     // Teal — systems column
  pnids:       md.secondary,   // Blue — P&IDs column
  lines:       md.tertiary,    // Orange — lines column
  equipment:   md.primary,     // Teal — equipment column
  instruments: md.secondary,   // Blue — instruments column
};

// ═══════════════════════════════════════════════════════
// M3 Helper: Color with alpha
// ═══════════════════════════════════════════════════════

/**
 * Apply alpha to a hex color.
 * Usage: alpha('#4FE2B0', 0.15) → 'rgba(79, 226, 176, 0.15)'
 */
export function alpha(hex, opacity) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

// ═══════════════════════════════════════════════════════
// M3 Shape Tokens (border-radius)
// ═══════════════════════════════════════════════════════

export const shape = {
  none:       '0px',
  extraSmall: '4px',
  small:      '8px',
  medium:     '12px',
  large:      '16px',
  extraLarge: '28px',
  full:       '9999px',
};

// ═══════════════════════════════════════════════════════
// M3 Elevation Shadows (teal-tinted for dark theme)
// ═══════════════════════════════════════════════════════

export const elevation = {
  0: 'none',
  1: '0 1px 3px 1px rgba(0,0,0,0.15), 0 1px 2px 0 rgba(0,0,0,0.3)',
  2: '0 2px 6px 2px rgba(0,0,0,0.15), 0 1px 2px 0 rgba(0,0,0,0.3)',
  3: '0 4px 8px 3px rgba(0,0,0,0.15), 0 1px 3px 0 rgba(0,0,0,0.3)',
  4: '0 6px 10px 4px rgba(0,0,0,0.15), 0 2px 3px 0 rgba(0,0,0,0.3)',
  5: '0 8px 12px 6px rgba(0,0,0,0.15), 0 4px 4px 0 rgba(0,0,0,0.3)',
};

// ═══════════════════════════════════════════════════════
// M3 Motion Tokens
// ═══════════════════════════════════════════════════════

export const easing = {
  standard:         'cubic-bezier(0.2, 0.0, 0, 1.0)',
  standardDecel:    'cubic-bezier(0, 0, 0, 1)',
  standardAccel:    'cubic-bezier(0.3, 0, 1, 1)',
  emphasized:       'cubic-bezier(0.2, 0.0, 0, 1.0)',
  emphasizedDecel:  'cubic-bezier(0.05, 0.7, 0.1, 1.0)',
  emphasizedAccel:  'cubic-bezier(0.3, 0.0, 0.8, 0.15)',
};

export const duration = {
  short1:  '50ms',
  short2:  '100ms',
  short3:  '150ms',
  short4:  '200ms',
  medium1: '250ms',
  medium2: '300ms',
  medium3: '350ms',
  medium4: '400ms',
  long1:   '450ms',
  long2:   '500ms',
};
