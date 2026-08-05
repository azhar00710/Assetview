import { useEffect, useState } from 'react';
import { Image as KonvaImage } from 'react-konva';
import { getPidSymbol } from './pidSymbolCatalog';
import { IsoKonvaElements } from './IsoSymbolRenderer';
import { loadPidSymbolImage } from './pidSymbolImageCache';

/**
 * Render a vector ISO or raster custom symbol inside Konva.
 */
export default function PidKonvaSymbol({
  symbolId,
  symbol: symbolProp,
  width,
  height,
  color = '#1a1a1a',
  strokeWidth = 2.5,
  opacity = 1,
}) {
  const sym = symbolProp || (symbolId ? getPidSymbol(symbolId) : null);
  const [rasterImage, setRasterImage] = useState(null);

  useEffect(() => {
    if (sym?.renderType !== 'raster' || !sym.imageUrl) {
      setRasterImage(null);
      return undefined;
    }
    let cancelled = false;
    loadPidSymbolImage(sym.imageUrl).then((img) => {
      if (!cancelled) setRasterImage(img);
    });
    return () => { cancelled = true; };
  }, [sym?.renderType, sym?.imageUrl]);

  if (!sym) return null;

  if (sym.renderType === 'raster' && sym.imageUrl) {
    if (!rasterImage) return null;
    return (
      <KonvaImage
        image={rasterImage}
        x={0}
        y={0}
        width={width}
        height={height}
        opacity={opacity}
      />
    );
  }

  if (!sym.elements?.length) return null;

  return (
    <IsoKonvaElements
      elements={sym.elements}
      width={width}
      height={height}
      color={color}
      strokeWidth={strokeWidth}
      opacity={opacity}
    />
  );
}
