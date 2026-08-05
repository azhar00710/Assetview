/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // ═══ M3 Theme — CSS Variable-based for dark/light toggle ═══
        'md-surface':                    'var(--md-surface)',
        'md-surface-dim':                'var(--md-surface-dim)',
        'md-surface-container-lowest':   'var(--md-surface-container-lowest)',
        'md-surface-container-low':      'var(--md-surface-container-low)',
        'md-surface-container':          'var(--md-surface-container)',
        'md-surface-container-high':     'var(--md-surface-container-high)',
        'md-surface-container-highest':  'var(--md-surface-container-highest)',
        'md-surface-bright':             'var(--md-surface-bright)',
        'md-surface-variant':            'var(--md-surface-variant)',

        // ═══ On-Surface (text & icons) ═══
        'md-on-surface':         'var(--md-on-surface)',
        'md-on-surface-variant': 'var(--md-on-surface-variant)',
        'md-outline':            'var(--md-outline)',
        'md-outline-variant':    'var(--md-outline-variant)',

        // ═══ Primary (Vibrant Teal) ═══
        'md-primary':               'var(--md-primary)',
        'md-on-primary':            'var(--md-on-primary)',
        'md-primary-container':     'var(--md-primary-container)',
        'md-on-primary-container':  'var(--md-on-primary-container)',

        // ═══ Secondary (Vibrant Blue) ═══
        'md-secondary':               'var(--md-secondary)',
        'md-on-secondary':            'var(--md-on-secondary)',
        'md-secondary-container':     'var(--md-secondary-container)',
        'md-on-secondary-container':  'var(--md-on-secondary-container)',

        // ═══ Tertiary (Vibrant Orange) ═══
        'md-tertiary':               'var(--md-tertiary)',
        'md-on-tertiary':            'var(--md-on-tertiary)',
        'md-tertiary-container':     'var(--md-tertiary-container)',
        'md-on-tertiary-container':  'var(--md-on-tertiary-container)',

        // ═══ Error (Vibrant Red) ═══
        'md-error':               'var(--md-error)',
        'md-on-error':            'var(--md-on-error)',
        'md-error-container':     'var(--md-error-container)',
        'md-on-error-container':  'var(--md-on-error-container)',

        // ═══ Inverse (snackbars, tooltips) ═══
        'md-inverse-surface':    'var(--md-inverse-surface)',
        'md-inverse-on-surface': 'var(--md-inverse-on-surface)',
        'md-inverse-primary':    'var(--md-inverse-primary)',

        // ═══ Semantic — System Types (vibrant) ═══
        'sys-process':    '#4FE2B0',
        'sys-utility':    '#8AB4FF',
        'sys-safety':     '#FF897A',
        'sys-instrument': '#FFD466',

        // ═══ Semantic — Criticality ═══
        'crit-high':   '#FF897A',
        'crit-medium': '#FFD466',
        'crit-low':    '#4FE2B0',

        // ═══ Semantic — Document Status ═══
        'status-built':    '#4FE2B0',
        'status-approved': '#8AB4FF',
        'status-draft':    '#FFB068',

        // ═══ Special ═══
        'sil-purple':    '#CDB4FF',
        'canvas-light':  '#F5F7F6',

        // ═══ Legacy aliases (bridge for existing branch code) ═══
        'av-bg':    '#0E1512',
        'av-panel': '#1A2521',
        'av-card':  '#243330',
        'av-text':  '#E1E8E5',
        'av-muted': '#BFC9C5',
        'av-bg-dark':    '#0E1512',
        'av-panel-dark': '#1A2521',
        'av-card-dark':  '#243330',
        'av-text-dark':  '#E1E8E5',
        'av-text-secondary-dark': '#BFC9C5',
      },

      fontFamily: {
        'sans':  ['Google Sans', 'Roboto', 'system-ui', 'sans-serif'],
        'brand': ['Google Sans', 'Roboto', 'system-ui', 'sans-serif'],
        'mono':  ['Roboto Mono', 'ui-monospace', 'monospace'],
      },

      fontSize: {
        'display-lg':  ['57px', { lineHeight: '64px',  fontWeight: '400' }],
        'display-md':  ['45px', { lineHeight: '52px',  fontWeight: '400' }],
        'display-sm':  ['36px', { lineHeight: '44px',  fontWeight: '400' }],
        'headline-lg': ['32px', { lineHeight: '40px',  fontWeight: '400' }],
        'headline-md': ['28px', { lineHeight: '36px',  fontWeight: '400' }],
        'headline-sm': ['24px', { lineHeight: '32px',  fontWeight: '400' }],
        'title-lg':    ['22px', { lineHeight: '28px',  fontWeight: '400' }],
        'title-md':    ['16px', { lineHeight: '24px',  fontWeight: '500' }],
        'title-sm':    ['14px', { lineHeight: '20px',  fontWeight: '500' }],
        'body-lg':     ['16px', { lineHeight: '24px',  fontWeight: '400' }],
        'body-md':     ['14px', { lineHeight: '20px',  fontWeight: '400' }],
        'body-sm':     ['12px', { lineHeight: '16px',  fontWeight: '400' }],
        'label-lg':    ['14px', { lineHeight: '20px',  fontWeight: '500' }],
        'label-md':    ['12px', { lineHeight: '16px',  fontWeight: '500' }],
        'label-sm':    ['11px', { lineHeight: '16px',  fontWeight: '500' }],
      },

      borderRadius: {
        'md-none': '0px',
        'md-xs':   '4px',
        'md-sm':   '8px',
        'md-md':   '12px',
        'md-lg':   '16px',
        'md-xl':   '28px',
        'md-full': '9999px',
      },

      boxShadow: {
        'md-1': '0 1px 3px 1px rgba(0,0,0,0.15), 0 1px 2px 0 rgba(0,0,0,0.3)',
        'md-2': '0 2px 6px 2px rgba(0,0,0,0.15), 0 1px 2px 0 rgba(0,0,0,0.3)',
        'md-3': '0 4px 8px 3px rgba(0,0,0,0.15), 0 1px 3px 0 rgba(0,0,0,0.3)',
        'md-4': '0 6px 10px 4px rgba(0,0,0,0.15), 0 2px 3px 0 rgba(0,0,0,0.3)',
        'md-5': '0 8px 12px 6px rgba(0,0,0,0.15), 0 4px 4px 0 rgba(0,0,0,0.3)',
      },

      transitionTimingFunction: {
        'md-standard':        'cubic-bezier(0.2, 0.0, 0, 1.0)',
        'md-standard-decel':  'cubic-bezier(0, 0, 0, 1)',
        'md-standard-accel':  'cubic-bezier(0.3, 0, 1, 1)',
        'md-emphasized':      'cubic-bezier(0.2, 0.0, 0, 1.0)',
        'md-emphasized-decel':'cubic-bezier(0.05, 0.7, 0.1, 1.0)',
        'md-emphasized-accel':'cubic-bezier(0.3, 0.0, 0.8, 0.15)',
      },

      transitionDuration: {
        'md-short1':  '50ms',
        'md-short2':  '100ms',
        'md-short3':  '150ms',
        'md-short4':  '200ms',
        'md-medium1': '250ms',
        'md-medium2': '300ms',
        'md-medium3': '350ms',
        'md-medium4': '400ms',
      },

      animation: {
        'md-list-enter':     'md-list-enter 250ms cubic-bezier(0.05,0.7,0.1,1.0) both',
        'md-register-enter': 'md-register-enter 300ms cubic-bezier(0.05,0.7,0.1,1.0) both',
        'md-detail-enter':   'md-detail-enter 250ms cubic-bezier(0.05,0.7,0.1,1.0) both',
        'md-fade-in':        'md-fade-in 200ms cubic-bezier(0.2,0,0,1) both',
        'md-ripple':         'md-ripple 450ms cubic-bezier(0.2,0,0,1) forwards',
      },

      keyframes: {
        'md-list-enter': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        'md-register-enter': {
          from: { opacity: '0', transform: 'translateY(16px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        'md-detail-enter': {
          from: { opacity: '0', transform: 'translateY(100%)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        'md-fade-in': {
          from: { opacity: '0' },
          to:   { opacity: '1' },
        },
        'md-ripple': {
          from: { transform: 'scale(0)', opacity: '0.12' },
          to:   { transform: 'scale(2.5)', opacity: '0' },
        },
      },
    },
  },
  plugins: [],
};
