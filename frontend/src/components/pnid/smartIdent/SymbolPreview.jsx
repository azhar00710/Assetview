import { md } from '../../../lib/theme';
import { IsoSymbolSvg } from './IsoSymbolRenderer';

/**
 * Preview for vector (ISO) or raster (custom admin) P&ID symbols.
 */
export default function SymbolPreview({ symbol, size = 36, color = md.onSurface, active = false }) {
  if (!symbol) return null;

  if (symbol.renderType === 'raster' && symbol.imageUrl) {
    return (
      <img
        src={symbol.imageUrl}
        alt={symbol.label || symbol.abbr}
        width={size}
        height={size}
        className={`object-contain ${active ? 'drop-shadow-[0_0_2px_rgba(255,215,0,0.8)]' : ''}`}
        style={{ background: 'transparent' }}
        draggable={false}
      />
    );
  }

  if (!symbol?.elements?.length) return null;

  return (
    <IsoSymbolSvg
      elements={symbol.elements}
      size={size}
      color={color}
      strokeWidth={active ? 2.8 : 2.4}
      className={active ? 'drop-shadow-[0_0_2px_rgba(255,215,0,0.8)]' : undefined}
    />
  );
}
