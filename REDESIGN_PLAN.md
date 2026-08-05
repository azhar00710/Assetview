# AssetView Google Material Design 3 Redesign Plan

## Executive Summary

This document outlines a comprehensive redesign strategy to transform AssetView from its current GeoSoft brand aesthetic (dark green/aquamarine industrial theme) into a Google-grade application following **Material Design 3 (M3) Expressive** guidelines. The goal: AssetView should look and feel as if it were built by Google — identical motion, color system, typography, elevation, shape, and interaction patterns.

**Core principle**: Zero functional changes. Every Miller Column cascade, register view, cross-reference toggle, and detail bar interaction remains identical. Only the visual layer changes.

---

## 1. COLOR SYSTEM — Complete Overhaul

### Current State (Problems)
| Token | Current Value | Issue |
|-------|--------------|-------|
| `av-bg` | `#0D1F17` | Dark forest green — not M3 compliant, too warm/green |
| `av-panel` | `#111D14` | Green-tinted panel — M3 uses neutral gray surfaces |
| `av-card` | `#16352B` | Deep green card — violates M3 neutral surface principle |
| `av-text` | `#D3DFE2` | Acceptable but not M3 `on-surface` |
| `av-muted` | `#919A9B` | Acceptable but not M3 `on-surface-variant` |
| `aquamarine` | `#3BE494` | Too saturated for M3 dark theme (M3 uses tone 80 = desaturated) |
| `ultramarine` | `#2D33E0` | Too saturated for dark theme |
| `#E74C3C` | safety red | Non-M3 red, too saturated |
| `#F39C12` | instrument yellow | Non-M3 yellow |
| `#E67E22` | draft orange | Non-M3 orange |

### New M3 Dark Theme Color System

Generated using Google's Material Theme Builder algorithm with a **teal-blue primary** (to honor the oil & gas domain while matching Google aesthetic):

```javascript
// ═══════════════════════════════════════════════════════
// M3 DARK THEME — Core Surface System
// ═══════════════════════════════════════════════════════

// Surfaces (neutral, no color tint — this is KEY difference from current)
const surface          = "#121212";  // M3 baseline dark surface (was #0D1F17)
const surfaceDim       = "#0E0E0E";  // Dimmest surface
const surfaceContainer = "#1E1E1E";  // Cards, panels (was #16352B)
const surfaceContainerLow  = "#1A1A1A";  // Subtle containers
const surfaceContainerHigh = "#2C2C2C";  // Elevated containers
const surfaceBright    = "#383838";  // Highest surface
const surfaceVariant   = "#444746";  // Variant surfaces

// On-Surface (text colors)
const onSurface        = "#E3E3E3";  // Primary text (was #D3DFE2)
const onSurfaceVariant = "#C4C7C5";  // Secondary text (was #919A9B)
const outline          = "#8E918F";  // Borders, dividers
const outlineVariant   = "#444746";  // Subtle borders (was #ffffff08)

// ═══════════════════════════════════════════════════════
// M3 DARK THEME — Accent Colors (tone 80 for dark theme)
// ═══════════════════════════════════════════════════════

// Primary (Teal — domain-appropriate, Google-compliant)
const primary          = "#80D8C4";  // Tone 80 (was #3BE494 — too vivid)
const onPrimary        = "#003829";  // Tone 20
const primaryContainer = "#005140";  // Tone 30
const onPrimaryContainer = "#9DF5E0"; // Tone 90

// Secondary (Blue — for P&IDs, instruments, data)
const secondary        = "#A8C8FF";  // Tone 80 (was #2D33E0 — too vivid)
const onSecondary      = "#003062";  // Tone 20
const secondaryContainer = "#004689"; // Tone 30
const onSecondaryContainer = "#D6E3FF"; // Tone 90

// Tertiary (Orange — for lines, drafts, cross-refs)
const tertiary         = "#FFB77C";  // Tone 80 (was #E67E22)
const onTertiary       = "#4D2700";  // Tone 20
const tertiaryContainer = "#6D3900";  // Tone 30
const onTertiaryContainer = "#FFDCC2"; // Tone 90

// Error (for safety systems, high criticality)
const error            = "#FFB4AB";  // Tone 80 (was #E74C3C)
const onError          = "#690005";  // Tone 20
const errorContainer   = "#93000A";  // Tone 30
const onErrorContainer = "#FFDAD6";  // Tone 90

// ═══════════════════════════════════════════════════════
// SEMANTIC — System Type Mapping (M3 tone 80 for dark)
// ═══════════════════════════════════════════════════════
const sysProcess    = "#80D8C4";  // Primary (teal) — was #3BE494
const sysUtility    = "#A8C8FF";  // Secondary (blue) — was #2D33E0
const sysSafety     = "#FFB4AB";  // Error (red) — was #E74C3C
const sysInstrument = "#FFD666";  // Custom yellow tone 80 — was #F39C12

// Criticality
const critHigh   = "#FFB4AB";  // Error tone 80
const critMedium = "#FFD666";  // Yellow tone 80
const critLow    = "#80D8C4";  // Primary tone 80

// Document Status
const statusBuilt    = "#80D8C4";  // Primary
const statusApproved = "#A8C8FF";  // Secondary
const statusDraft    = "#FFB77C";  // Tertiary

// SIL badge
const silPurple = "#D0BCFF";  // M3 purple tone 80 (was #9B59B6)
```

### Why These Specific Values?
- **M3 dark theme rule**: Accent colors use **tone 80** (desaturated, light) on **tone 30** containers
- **Surfaces are NEUTRAL**: No green/blue tint. Pure gray scale. This is the #1 visible difference.
- **Google products** (Cloud Console, Android Settings, YouTube) all use `#121212` base with neutral gray surfaces
- **Contrast ratios** all meet WCAG AA (4.5:1 for normal text, 3:1 for large text)

---

## 2. TYPOGRAPHY — Font Replacement

### Current State
```javascript
fontFamily: ['Aeonik', 'Inter', 'Arial', 'sans-serif']
```
Aeonik is a commercial geometric sans — not Google.

### New M3 Typography

```css
/* Google Sans for brand/display, Roboto for body/UI */
@import url('https://fonts.googleapis.com/css2?family=Google+Sans:wght@400;500;700&family=Google+Sans+Text:wght@400;500;700&family=Roboto:wght@400;500;700&family=Roboto+Mono:wght@400;500&display=swap');
```

**Note**: Google Sans requires a license for external use. For this project, we'll use **Google Sans Text** (available via Google Fonts as "Product Sans" alternative) or fall back to **Roboto** as the open-source M3 default.

### Type Scale Mapping

| UI Element | Current | New (M3) | Size | Weight |
|-----------|---------|----------|------|--------|
| App title "AssetView" | 13px bold Aeonik | Title Medium | 16px | 500 (Roboto) |
| Column headers | 10px 700 | Label Large | 14px | 500 |
| List item primary | 11px 400/600 | Body Medium | 14px | 400/500 |
| List item secondary | 10px muted | Body Small | 12px | 400 |
| Badges/chips | 8px | Label Small | 11px | 500 |
| Register headers | 10px 700 | Label Large | 14px | 500 |
| Register cells | 11px | Body Small | 12px | 400 |
| Search input | 11px | Body Medium | 14px | 400 |
| Detail bar title | 15px 700 | Title Large | 22px | 400 |
| Detail bar chips | 10px | Label Medium | 12px | 500 |
| Breadcrumb | 11px | Label Large | 14px | 400 |
| Count badges | 9px | Label Small | 11px | 500 |

### Key Changes
1. **Larger base sizes** — M3 minimum body text is 12px (Label Small), most UI text is 14px
2. **Medium weight (500)** replaces Bold (700) for emphasis — M3 uses weight 500 for emphasis, not 700
3. **Monospace for technical data** — Line numbers, SCADA tags use `Roboto Mono`
4. **Letter spacing** — M3 specifies letter-spacing per scale (e.g., Label Large = 0.1px)

---

## 3. SHAPE — Corner Radius System

### Current State
- `border-radius: 5px` on list items
- `border-radius: 6px` on inputs/buttons
- `border-radius: 8px` on count badges
- `border-radius: 10px` on detail chips
- Inconsistent, not following any system

### New M3 Shape Tokens

```javascript
const shape = {
  none:       '0px',    // Sharp edges (table headers)
  extraSmall: '4px',    // Compact elements (tiny badges)
  small:      '8px',    // List items, inputs, small cards
  medium:     '12px',   // Cards, dialogs, containers
  large:      '16px',   // Prominent containers, FABs
  extraLarge: '28px',   // Large sheets, bottom bars
  full:       '9999px', // Pill shapes (chips, badges)
};
```

### Application Map

| Element | Current | New M3 |
|---------|---------|--------|
| List items | 5px | 8px (small) |
| Inputs/buttons | 6px | 8px (small) |
| Count badges | 8px | 9999px (full — pill) |
| Detail chips | 10px | 9999px (full — pill) |
| Cards/panels | 0px | 12px (medium) |
| Column containers | 0px | 0px (none — edge-to-edge) |
| Search bar | 6px | 9999px (full — Google-style pill search) |
| Top bar logo | 6px | 12px (medium) |
| Register table | 0px | 12px (medium) — rounded container |

---

## 4. ELEVATION — Shadow System

### Current State
- No shadows anywhere
- Depth indicated only by background color differences and borders (`#ffffff08`)
- Flat design throughout

### New M3 Elevation

M3 dark theme uses **tonal elevation** (lighter surfaces = higher) PLUS subtle shadows:

```css
/* M3 Elevation Levels */
--md-elevation-0: none;
--md-elevation-1: 0 1px 4px 0 rgba(0, 0, 0, 0.37);
--md-elevation-2: 0 2px 2px 0 rgba(0, 0, 0, 0.2), 0 6px 10px 0 rgba(0, 0, 0, 0.3);
--md-elevation-3: 0 11px 7px 0 rgba(0, 0, 0, 0.19), 0 13px 25px 0 rgba(0, 0, 0, 0.3);
```

### Application Map

| Element | Current Elevation | New M3 Elevation |
|---------|------------------|-----------------|
| Page background | `#0D1F17` flat | `surface` (#121212) Level 0 |
| Top bar | `#111D14` + bottom border | `surfaceContainer` (#1E1E1E) Level 2 + shadow |
| Column panels | flat + right border | `surfaceContainerLow` (#1A1A1A) Level 0 |
| List item hover | `#ffffff06` | `surfaceContainerHigh` (#2C2C2C) Level 1 |
| List item selected | `${color}15` | `primaryContainer`/`secondaryContainer` + Level 1 |
| Detail bar | `#111D14` + top border | `surfaceContainer` Level 2 + shadow |
| Search input | flat | `surfaceContainerHigh` Level 1 |
| Dropdown | flat | `surfaceContainerHigh` Level 3 + shadow |
| Register table | flat | `surfaceContainerLow` Level 1 |

### Key Change
M3 dark theme represents elevation primarily through **tonal color overlays** — higher surfaces are *lighter*. Shadows are subtle reinforcement, not the primary depth cue.

---

## 5. MOTION — Animation System

### Current State
- Only animation: `pulse-dot` keyframe (scale 0.8→1.2, opacity 0.3→1)
- No transitions on hover, selection, or state changes
- No enter/exit animations
- Interactions feel instant and flat

### New M3 Motion Tokens

```css
/* ═══ M3 Easing Curves ═══ */
--md-easing-standard:             cubic-bezier(0.2, 0.0, 0, 1.0);
--md-easing-standard-decelerate:  cubic-bezier(0, 0, 0, 1);
--md-easing-standard-accelerate:  cubic-bezier(0.3, 0, 1, 1);
--md-easing-emphasized:           cubic-bezier(0.2, 0.0, 0, 1.0);
--md-easing-emphasized-decelerate: cubic-bezier(0.05, 0.7, 0.1, 1.0);
--md-easing-emphasized-accelerate: cubic-bezier(0.3, 0.0, 0.8, 0.15);

/* ═══ M3 Durations ═══ */
--md-duration-short1: 50ms;    /* Micro-interactions */
--md-duration-short2: 100ms;   /* Small state changes */
--md-duration-short3: 150ms;   /* Standard transitions */
--md-duration-short4: 200ms;   /* Standard transitions */
--md-duration-medium1: 250ms;  /* Page-level changes */
--md-duration-medium2: 300ms;  /* Navigation transitions */
--md-duration-medium3: 350ms;  /* Complex transitions */
--md-duration-medium4: 400ms;  /* Full-screen transitions */
--md-duration-long1: 450ms;    /* Elaborate transitions */
--md-duration-long2: 500ms;    /* Complex animations */
```

### Animation Application Map

| Interaction | Current | New M3 |
|------------|---------|--------|
| List item hover | Instant background change | `150ms standard` background + subtle scale |
| List item select | Instant background + border | `200ms emphasized` background + border slide-in |
| Column data load | Instant render | `250ms emphasized-decelerate` staggered fade-in (30ms per item) |
| Register open | Instant swap | `300ms emphasized` slide-up + fade |
| Register close | Instant swap | `200ms emphasized-accelerate` slide-down + fade |
| Search input focus | Instant | `150ms standard` border glow + expand |
| Detail bar appear | Instant | `250ms emphasized-decelerate` slide-up from bottom |
| Detail bar dismiss | Instant | `200ms emphasized-accelerate` slide-down |
| Badge/chip appear | Instant | `150ms standard-decelerate` scale-in |
| Button hover | Instant | `100ms standard` state-layer opacity |
| Platform switch | Instant | `300ms emphasized` cross-fade columns |
| Scrollbar visibility | Always visible | Fade in/out on hover (`200ms standard`) |
| Cross-ref toggle | Instant filter | `200ms standard` items fade in/out |

### New Keyframe Animations

```css
/* Staggered list item entrance */
@keyframes md-list-enter {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Register slide in */
@keyframes md-register-enter {
  from { opacity: 0; transform: translateY(16px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Detail bar slide up */
@keyframes md-detail-enter {
  from { opacity: 0; transform: translateY(100%); }
  to { opacity: 1; transform: translateY(0); }
}

/* Ripple effect on click (Google signature) */
@keyframes md-ripple {
  from { transform: scale(0); opacity: 0.12; }
  to { transform: scale(2.5); opacity: 0; }
}

/* State layer (hover/focus/press) */
@keyframes md-state-layer {
  from { opacity: 0; }
  to { opacity: var(--md-state-hover-opacity, 0.08); }
}
```

### Reduced Motion Support
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## 6. COMPONENT-LEVEL REDESIGN

### 6.1 Top Bar (App Bar)

**Current**: Dark green panel, gradient logo, thin with 6px padding
**New M3**:

```
┌─────────────────────────────────────────────────────────────────────┐
│  [G logo]  AssetView          WHT-5 › Prod... │ ╭──Search...──╮ ▼  │
│            by GeoSoft         breadcrumb       │ ╰────────────╯    │
└─────────────────────────────────────────────────────────────────────┘
```

- Background: `surfaceContainer` (#1E1E1E) with Level 2 elevation
- Height: 64px (M3 Top App Bar standard)
- Logo: Google-style rounded square with `medium` corner radius, uses `primary` color
- Title: `Title Medium` (16px/500) in `onSurface`
- Subtitle "by GeoSoft": `Label Small` (11px/500) in `onSurfaceVariant`
- Search: Pill-shaped (`full` radius), `surfaceContainerHigh` background
- Breadcrumb: `Label Large` with `›` separator, last segment in `primary`
- Platform selector: M3 dropdown style with `outline` border
- X-Ref toggle: M3 Filter Chip component (pill, outlined, checkmark icon)

### 6.2 Miller Columns

**Current**: 5 equal columns, color-coded headers, thin borders
**New M3**:

- Column dividers: `outlineVariant` (#444746) — 1px, not `#ffffff06`
- Column header:
  - Background: `surfaceContainerLow`
  - Left accent bar: 3px, using M3 tone 80 color (desaturated)
  - Title: `Label Large` (14px/500) in column accent color
  - Count badge: Pill shape, `surfaceContainerHigh` bg, `onSurfaceVariant` text
  - Register icon: M3 icon style (outlined, 18px)
- List items:
  - Padding: 12px horizontal, 10px vertical (more generous than current 7px/8px)
  - Border-radius: `small` (8px)
  - **Idle state**: transparent background
  - **Hover state**: State layer at 8% opacity of `onSurface` (#E3E3E3 at 8% = subtle gray)
  - **Selected state**: `primaryContainer` (#005140) background + `primary` left border 3px
  - **Cross-ref items**: 65% opacity maintained + owner system color border (using M3 tone 80)
  - Primary text: `Body Medium` (14px/400) — `onSurface`
  - Secondary text: `Body Small` (12px/400) — `onSurfaceVariant`
  - Metadata badges: Pill chips with M3 container colors

### 6.3 Register View

**Current**: Full-width table, colored header row, minimal styling
**New M3**:

- Outer container: `surfaceContainerLow` with `medium` border-radius
- Header bar: `surfaceContainer` with accent color text
- Filter row: `surfaceContainerLow`, inputs use `small` radius + `outline` border
- Column headers: `Label Large` (14px/500), sortable with M3 sort icon
- Data rows:
  - Alternating: transparent / `surfaceContainerLow` (not `#ffffff03`)
  - Hover: State layer 8% on `onSurface`
  - Text: `Body Small` (12px/400)
  - Status chips: Pill shape with M3 container colors
- Back button: M3 Filled Tonal Button (rounded, `secondaryContainer` bg)
- Row dividers: `outlineVariant` at 50% opacity

### 6.4 Detail Bar

**Current**: Thin bottom bar with inline badges
**New M3**:

- Background: `surfaceContainer` with Level 2 elevation (shadow above)
- Padding: 16px horizontal, 12px vertical
- Title: `Title Large` (22px/400) in `onSurface`
- Chips: M3 Assist Chip style — pill shape, `outline` border, `onSurfaceVariant` text
  - Type chip: `primaryContainer` bg + `onPrimaryContainer` text
  - Criticality chip: semantic color container
  - SIL chip: `tertiaryContainer` bg (purple replaced with M3 tertiary)
- Close button: M3 Icon Button — circular, 40px touch target, `onSurfaceVariant`
- Animation: Slide up with `250ms emphasized-decelerate`

### 6.5 Search Input

**Current**: 160px, dark green background, thin border
**New M3 Search Bar**:

```
╭─────────────────────────────────────╮
│  🔍  Search assets...           ✕   │
╰─────────────────────────────────────╯
```

- Width: 240px (expandable to 320px on focus)
- Shape: `full` radius (pill)
- Background: `surfaceContainerHigh`
- Border: none (M3 search bars are borderless)
- Icon: 20px search icon in `onSurfaceVariant`
- Text: `Body Large` (16px/400) in `onSurface`
- Placeholder: `onSurfaceVariant`
- Focus: Subtle `primary` color glow (outline)
- Clear button: Circular icon button, appears only when text present

### 6.6 Buttons & Controls

**Current**: Various backgrounds with thin borders, inconsistent sizing
**New M3 Button Styles**:

| Control | M3 Type | Background | Text | Shape |
|---------|---------|-----------|------|-------|
| Back to Columns | Filled Tonal | `secondaryContainer` | `onSecondaryContainer` | `full` |
| X-Ref toggle | Filter Chip | `surfaceContainerHigh` (off) / `secondaryContainer` (on) | `onSurface` / `onSecondaryContainer` | `small` (8px) |
| Clear search | Icon Button | transparent | `error` | circular 40px |
| Close detail | Icon Button | transparent | `onSurfaceVariant` | circular 40px |
| Platform select | M3 Dropdown | `surfaceContainerHigh` | `onSurface` | `small` |

### 6.7 Scrollbar

**Current**: 5px, green-tinted (#0D1F17 track, #3BE49444 thumb)
**New M3**:

```css
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb {
  background: rgba(227, 227, 227, 0.2); /* onSurface at 20% */
  border-radius: 9999px;
}
::-webkit-scrollbar-thumb:hover {
  background: rgba(227, 227, 227, 0.4);
}
```

---

## 7. ICONS

### Current State
- Using emoji icons: 🏗️ 📋 ↗ 🔗 🔓 ⤢ ✕
- No icon library

### New M3 Icons
Replace ALL emojis with **Material Symbols (Outlined)** from Google Fonts:

```html
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200" rel="stylesheet" />
```

| Current | Replacement | Material Symbol Name |
|---------|------------|---------------------|
| 📋 P&ID icon | `description` | Document icon |
| ↗ Cross-ref | `call_made` | Outgoing arrow |
| 🔗 X-Ref on | `link` | Link icon |
| 🔓 X-Ref off | `link_off` | Link off icon |
| ⤢ Register expand | `open_in_full` | Expand icon |
| ✕ Close | `close` | Close icon |
| 🏗️ Placeholder | `engineering` | Building icon |
| · Dot indicator | `circle` (8px filled) | Small circle |

Usage pattern:
```jsx
<span className="material-symbols-outlined" style={{fontSize: 18}}>description</span>
```

---

## 8. STATE LAYERS (Google Signature)

One of the most distinctive Google UI patterns is the **state layer** — a semi-transparent overlay that indicates hover, focus, and press states:

```css
/* M3 State Layer Opacities */
--md-state-hover:    0.08;  /* 8% of on-surface color */
--md-state-focus:    0.10;  /* 10% */
--md-state-pressed:  0.10;  /* 10% */
--md-state-dragged:  0.16;  /* 16% */
```

### Implementation
Every interactive element gets a `::before` pseudo-element as a state layer:

```css
.md-interactive {
  position: relative;
  overflow: hidden;
}
.md-interactive::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: currentColor;
  opacity: 0;
  transition: opacity 150ms cubic-bezier(0.2, 0, 0, 1);
  pointer-events: none;
}
.md-interactive:hover::before { opacity: 0.08; }
.md-interactive:focus-visible::before { opacity: 0.10; }
.md-interactive:active::before { opacity: 0.10; }
```

### Ripple Effect (Optional but very Google)
On click, a circular ripple expands from click point:

```css
.md-ripple {
  position: absolute;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.12;
  transform: scale(0);
  animation: md-ripple 450ms cubic-bezier(0.2, 0, 0, 1) forwards;
}
```

---

## 9. TAILWIND CONFIG CHANGES

### Complete New Configuration

```javascript
// tailwind.config.js — Material Design 3 Dark Theme
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // M3 Surfaces
        'md-surface': '#121212',
        'md-surface-dim': '#0E0E0E',
        'md-surface-container': '#1E1E1E',
        'md-surface-container-low': '#1A1A1A',
        'md-surface-container-high': '#2C2C2C',
        'md-surface-bright': '#383838',
        'md-surface-variant': '#444746',

        // M3 On-Surface (text)
        'md-on-surface': '#E3E3E3',
        'md-on-surface-variant': '#C4C7C5',
        'md-outline': '#8E918F',
        'md-outline-variant': '#444746',

        // M3 Primary (Teal)
        'md-primary': '#80D8C4',
        'md-on-primary': '#003829',
        'md-primary-container': '#005140',
        'md-on-primary-container': '#9DF5E0',

        // M3 Secondary (Blue)
        'md-secondary': '#A8C8FF',
        'md-on-secondary': '#003062',
        'md-secondary-container': '#004689',
        'md-on-secondary-container': '#D6E3FF',

        // M3 Tertiary (Orange)
        'md-tertiary': '#FFB77C',
        'md-on-tertiary': '#4D2700',
        'md-tertiary-container': '#6D3900',
        'md-on-tertiary-container': '#FFDCC2',

        // M3 Error
        'md-error': '#FFB4AB',
        'md-on-error': '#690005',
        'md-error-container': '#93000A',
        'md-on-error-container': '#FFDAD6',

        // Semantic — System Types (M3 tone 80)
        'sys-process': '#80D8C4',
        'sys-utility': '#A8C8FF',
        'sys-safety': '#FFB4AB',
        'sys-instrument': '#FFD666',

        // Semantic — Criticality
        'crit-high': '#FFB4AB',
        'crit-medium': '#FFD666',
        'crit-low': '#80D8C4',

        // Semantic — Status
        'status-built': '#80D8C4',
        'status-approved': '#A8C8FF',
        'status-draft': '#FFB77C',

        // Special
        'sil-purple': '#D0BCFF',
        'canvas-light': '#F5F7F7', // P&ID canvas stays light
      },

      fontFamily: {
        'sans': ['Roboto', 'Google Sans Text', 'system-ui', 'sans-serif'],
        'mono': ['Roboto Mono', 'monospace'],
      },

      fontSize: {
        'display-lg': ['57px', { lineHeight: '64px', fontWeight: '400' }],
        'display-md': ['45px', { lineHeight: '52px', fontWeight: '400' }],
        'display-sm': ['36px', { lineHeight: '44px', fontWeight: '400' }],
        'headline-lg': ['32px', { lineHeight: '40px', fontWeight: '400' }],
        'headline-md': ['28px', { lineHeight: '36px', fontWeight: '400' }],
        'headline-sm': ['24px', { lineHeight: '32px', fontWeight: '400' }],
        'title-lg': ['22px', { lineHeight: '28px', fontWeight: '400' }],
        'title-md': ['16px', { lineHeight: '24px', fontWeight: '500' }],
        'title-sm': ['14px', { lineHeight: '20px', fontWeight: '500' }],
        'body-lg': ['16px', { lineHeight: '24px', fontWeight: '400' }],
        'body-md': ['14px', { lineHeight: '20px', fontWeight: '400' }],
        'body-sm': ['12px', { lineHeight: '16px', fontWeight: '400' }],
        'label-lg': ['14px', { lineHeight: '20px', fontWeight: '500' }],
        'label-md': ['12px', { lineHeight: '16px', fontWeight: '500' }],
        'label-sm': ['11px', { lineHeight: '16px', fontWeight: '500' }],
      },

      borderRadius: {
        'md-none': '0px',
        'md-xs': '4px',
        'md-sm': '8px',
        'md-md': '12px',
        'md-lg': '16px',
        'md-xl': '28px',
        'md-full': '9999px',
      },

      boxShadow: {
        'md-1': '0 1px 4px 0 rgba(0, 0, 0, 0.37)',
        'md-2': '0 2px 2px 0 rgba(0, 0, 0, 0.2), 0 6px 10px 0 rgba(0, 0, 0, 0.3)',
        'md-3': '0 11px 7px 0 rgba(0, 0, 0, 0.19), 0 13px 25px 0 rgba(0, 0, 0, 0.3)',
        'md-4': '0 14px 12px 0 rgba(0, 0, 0, 0.17), 0 20px 40px 0 rgba(0, 0, 0, 0.3)',
        'md-5': '0 17px 17px 0 rgba(0, 0, 0, 0.15), 0 27px 55px 0 rgba(0, 0, 0, 0.3)',
      },

      transitionTimingFunction: {
        'md-standard': 'cubic-bezier(0.2, 0.0, 0, 1.0)',
        'md-standard-decel': 'cubic-bezier(0, 0, 0, 1)',
        'md-standard-accel': 'cubic-bezier(0.3, 0, 1, 1)',
        'md-emphasized': 'cubic-bezier(0.2, 0.0, 0, 1.0)',
        'md-emphasized-decel': 'cubic-bezier(0.05, 0.7, 0.1, 1.0)',
        'md-emphasized-accel': 'cubic-bezier(0.3, 0.0, 0.8, 0.15)',
      },

      transitionDuration: {
        'md-short1': '50ms',
        'md-short2': '100ms',
        'md-short3': '150ms',
        'md-short4': '200ms',
        'md-medium1': '250ms',
        'md-medium2': '300ms',
        'md-medium3': '350ms',
        'md-medium4': '400ms',
      },

      animation: {
        'md-list-enter': 'md-list-enter 250ms cubic-bezier(0.05, 0.7, 0.1, 1.0) forwards',
        'md-register-enter': 'md-register-enter 300ms cubic-bezier(0.05, 0.7, 0.1, 1.0) forwards',
        'md-detail-enter': 'md-detail-enter 250ms cubic-bezier(0.05, 0.7, 0.1, 1.0) forwards',
        'md-fade-in': 'md-fade-in 200ms cubic-bezier(0.2, 0, 0, 1) forwards',
        'md-ripple': 'md-ripple 450ms cubic-bezier(0.2, 0, 0, 1) forwards',
      },

      keyframes: {
        'md-list-enter': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'md-register-enter': {
          from: { opacity: '0', transform: 'translateY(16px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'md-detail-enter': {
          from: { opacity: '0', transform: 'translateY(100%)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'md-fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'md-ripple': {
          from: { transform: 'scale(0)', opacity: '0.12' },
          to: { transform: 'scale(2.5)', opacity: '0' },
        },
      },
    }
  },
  plugins: []
};
```

---

## 10. FILE-BY-FILE CHANGE LIST

### Files to Modify

| # | File | Changes |
|---|------|---------|
| 1 | `frontend/tailwind.config.js` | Complete replacement with M3 token system (Section 9) |
| 2 | `frontend/src/index.css` | Replace scrollbar styles, add M3 animation keyframes, state layers, reduced-motion, Google Fonts import |
| 3 | `frontend/index.html` | Add Google Fonts preconnect, Material Symbols link, update body classes |
| 4 | `frontend/src/App.jsx` | Update all Tailwind classes to M3 tokens, restructure top bar to 64px M3 app bar |
| 5 | `docs/AssetView_v4_WithRegisters.html` | Update color constants (C object), update all inline styles to M3 values — this is the reference POC |

### Files to Create (Component Extraction from POC)

When the Miller Columns are built as components, they should use the M3 tokens from day one. These files don't exist yet but should follow M3 when created:

| # | Future File | M3 Guidelines to Apply |
|---|------------|----------------------|
| 1 | `src/components/MillerColumns.jsx` | M3 surfaces, type scale, state layers, animations |
| 2 | `src/components/RegisterView.jsx` | M3 table patterns, filter inputs, sort headers |
| 3 | `src/components/DetailBar.jsx` | M3 bottom bar, chips, slide-up animation |
| 4 | `src/components/SearchBar.jsx` | M3 pill search, expand animation |
| 5 | `src/components/FilterChip.jsx` | M3 chip component (X-Ref toggle) |
| 6 | `src/lib/theme.js` | Centralized M3 color/token constants for inline styles |

---

## 11. IMPLEMENTATION ORDER

### Phase 1: Foundation (Config + Global CSS)
1. Update `tailwind.config.js` with complete M3 token system
2. Update `index.css` with M3 animations, state layers, scrollbar, fonts
3. Update `index.html` with Google Fonts + Material Symbols
4. Create `src/lib/theme.js` for M3 constants used in inline styles

### Phase 2: App Shell
5. Redesign top bar in `App.jsx` to M3 64px app bar
6. Update body/root classes to M3 surface colors
7. Update search bar to M3 pill style
8. Replace emoji icons with Material Symbols

### Phase 3: Reference POC
9. Update color constants in `AssetView_v4_WithRegisters.html`
10. Update all inline styles to M3 values
11. Add transitions and animations
12. Add state layers and ripple effects

### Phase 4: Polish
13. Verify all contrast ratios meet WCAG AA
14. Test reduced-motion media query
15. Cross-browser scrollbar styling
16. Final visual audit against Google products (Cloud Console, Android Settings)

---

## 12. VISUAL COMPARISON — Before & After

### Top Bar
```
BEFORE:
┌──────────────────────────────────────────────────────┐
│ [G gradient] AssetView GEOSOFT    Phase 2 — Connect  │  ← 30px, dark green
└──────────────────────────────────────────────────────┘

AFTER:
┌──────────────────────────────────────────────────────┐
│                                                      │
│  [AV] AssetView    WHT-5 › Prod  ╭─Search...─╮  ≡   │  ← 64px, #1E1E1E
│       by GeoSoft                 ╰───────────╯      │     with shadow
└──────────────────────────────────────────────────────┘
```

### Miller Column Item
```
BEFORE:                              AFTER:
┌─────────────────────────┐          ┌─────────────────────────┐
│● Production PV019       │ 8px font │ ● Production PV019      │ 14px Roboto
│  3 P&ID  5 line  8 eq   │ 8px     │   3 P&ID  5 lines  8 eq │ 11px pills
└─────────────────────────┘          └─────────────────────────┘
  5px radius, green tint               8px radius, neutral gray
  No transition                        150ms hover transition
```

### Selected State
```
BEFORE: background #3BE49415, left border #3BE494
AFTER:  background #005140 (primaryContainer), left border #80D8C4 (primary)
        + 200ms emphasized transition + subtle shadow
```

---

## 13. GOOGLE PRODUCT BENCHMARKS

The redesign targets visual parity with these Google products:

| Product | What We Match |
|---------|--------------|
| **Google Cloud Console** | Dark sidebar, neutral grays, data tables, breadcrumb navigation |
| **Android Settings** | List items, state layers, section headers, pill search |
| **Google Workspace** | Top bar height/spacing, search bar style, icon usage |
| **Google Maps (Dark)** | Tonal surface elevation in dark theme |
| **Material Theme Builder** | Exact M3 token values and color roles |

---

## 14. WHAT STAYS THE SAME (Core Functionality)

- Miller Column 5-panel cascade filter logic
- Toggle selection behavior (click to select, click again to deselect)
- Cross-reference display at 65% opacity with owner system border
- Register view sorting, filtering, and column configuration
- Detail bar showing selected item properties
- Platform switcher dropdown
- Search filtering across all columns
- All data relationships (systems → P&IDs → lines → equipment → instruments)
- P&ID canvas area remains light (#F5F7F7)
- API integration architecture
- React Query data fetching

---

## Sources

- [Expressive Material Design — Google Research](https://design.google/library/expressive-material-design-google-research)
- [M3 Color Roles](https://m3.material.io/styles/color/roles)
- [M3 Color Scheme Selection](https://m3.material.io/styles/color/choosing-a-scheme)
- [M3 Typography Type Scale Tokens](https://m3.material.io/styles/typography/type-scale-tokens)
- [M3 Typography Fonts](https://m3.material.io/styles/typography/fonts)
- [M3 Corner Radius Scale](https://m3.material.io/styles/shape/corner-radius-scale)
- [M3 Elevation](https://m3.material.io/styles/elevation/applying-elevation)
- [M3 Box Shadow CSS Values](https://studioncreations.com/blog/material-design-3-box-shadow-css-values/)
- [M3 Easing and Duration](https://m3.material.io/styles/motion/easing-and-duration)
- [M3 Motion Transitions](https://m3.material.io/styles/motion/transitions)
- [M3 Design Tokens](https://m3.material.io/foundations/design-tokens)
- [Google Dark Theme Color Scheme](https://www.schemecolor.com/google-dark-theme.php)
- [Material Design Dark Theme](https://m2.material.io/design/color/dark-theme.html)
- [M3 Material Design System Overview](https://zoewave.medium.com/material-3-design-system-e91a15d303a0)
