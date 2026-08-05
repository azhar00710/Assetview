import { memo } from 'react';
import useCanvasStore from '../store/useCanvasStore';
import { md, alpha } from '../../lib/theme';

const OVERLAYS = [
  { key: 'tracing', label: 'Tracing' },
  { key: 'isolation', label: 'Isolation' },
  { key: 'corrosion', label: 'Corrosion' },
];

function OverlayManager() {
  const activeOverlays = useCanvasStore((s) => s.activeOverlays);
  const toggleOverlay = useCanvasStore((s) => s.toggleOverlay);

  return (
    <div style={{
      display: 'flex', gap: 4, padding: '4px 8px',
      background: md.surfaceContainer, borderRadius: 8,
    }}>
      <span style={{
        fontSize: 10, fontWeight: 600, color: md.onSurfaceVariant,
        padding: '4px 4px', alignSelf: 'center',
      }}>
        Overlays
      </span>
      {OVERLAYS.map(({ key, label }) => {
        const active = activeOverlays.has(key);
        return (
          <button
            key={key}
            onClick={() => toggleOverlay(key)}
            style={{
              fontSize: 10, fontWeight: 600, padding: '4px 10px',
              borderRadius: 6, border: 'none', cursor: 'pointer',
              background: active ? alpha(md.primary, 0.2) : 'transparent',
              color: active ? md.primary : md.onSurfaceVariant,
              transition: 'background 0.15s, color 0.15s',
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

export default memo(OverlayManager);
