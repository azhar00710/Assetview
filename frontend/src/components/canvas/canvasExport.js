import { toPng, toSvg } from 'html-to-image';

function getTitleBlock(systemLabel, platformName) {
  const today = new Date().toISOString().slice(0, 10);
  return `${systemLabel || 'System Topology'} | ${platformName || 'Platform'} | ${today} | Revision: A`;
}

function downloadFile(dataUrl, filename) {
  const link = document.createElement('a');
  link.download = filename;
  link.href = dataUrl;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export async function exportPng(viewportElement, { systemLabel, platformName } = {}) {
  if (!viewportElement) return;
  const titleText = getTitleBlock(systemLabel, platformName);

  const dataUrl = await toPng(viewportElement, {
    backgroundColor: '#F5F7F7',
    pixelRatio: 2,
    filter: (node) => {
      // Exclude minimap and controls from export
      if (node?.classList?.contains?.('react-flow__minimap')) return false;
      if (node?.classList?.contains?.('react-flow__controls')) return false;
      return true;
    },
  });

  // Add title block via canvas
  const img = new Image();
  img.src = dataUrl;
  await new Promise((resolve) => { img.onload = resolve; });

  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height + 40;
  const ctx = canvas.getContext('2d');

  // Title bar
  ctx.fillStyle = '#16352B';
  ctx.fillRect(0, 0, canvas.width, 40);
  ctx.fillStyle = '#D3DFE2';
  ctx.font = '12px monospace';
  ctx.fillText(titleText, 12, 26);

  // Image below title
  ctx.drawImage(img, 0, 40);

  const finalUrl = canvas.toDataURL('image/png');
  const filename = `${(systemLabel || 'canvas').replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.png`;
  downloadFile(finalUrl, filename);
}

export async function exportSvg(viewportElement, { systemLabel, platformName } = {}) {
  if (!viewportElement) return;
  const titleText = getTitleBlock(systemLabel, platformName);

  const svgDataUrl = await toSvg(viewportElement, {
    backgroundColor: '#F5F7F7',
    filter: (node) => {
      if (node?.classList?.contains?.('react-flow__minimap')) return false;
      if (node?.classList?.contains?.('react-flow__controls')) return false;
      return true;
    },
  });

  // Decode SVG and inject title block
  const svgText = decodeURIComponent(svgDataUrl.split(',')[1] || '');
  const titleSvg = svgText.replace(
    '<svg ',
    `<svg `
  ).replace(
    '</svg>',
    `<rect x="0" y="0" width="100%" height="32" fill="#16352B"/>
     <text x="12" y="22" fill="#D3DFE2" font-family="monospace" font-size="11">${titleText}</text>
    </svg>`
  );

  const blob = new Blob([titleSvg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const filename = `${(systemLabel || 'canvas').replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.svg`;
  downloadFile(url, filename);
  URL.revokeObjectURL(url);
}
