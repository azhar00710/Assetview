import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Configure worker — Vite resolves the ?url import to the correct asset path
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * PdfCanvas — renders a PDF page to a <canvas> element via pdf.js.
 * Supports multi-page navigation and high-DPI rendering.
 */
const PdfCanvas = forwardRef(function PdfCanvas(
  { url, data, page = 1, onPageCount, onLoaded, onError, onDimensions, className = '', style = {} },
  ref,
) {
  const canvasRef = useRef(null);
  const renderTaskRef = useRef(null);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  useImperativeHandle(ref, () => ({
    get width() { return dimensions.width; },
    get height() { return dimensions.height; },
    get canvas() { return canvasRef.current; },
  }), [dimensions]);

  // Load PDF document when source changes (URL or binary data)
  useEffect(() => {
    if (!url && !data) return;
    let cancelled = false;
    let doc = null;

    let binaryData = null;
    if (data) {
      // pdf.js may transfer/detach the underlying buffer; clone so parent state
      // keeps an intact copy across re-renders/open-close cycles.
      if (data instanceof Uint8Array) {
        binaryData = new Uint8Array(data);
      } else if (data instanceof ArrayBuffer) {
        binaryData = new Uint8Array(data.slice(0));
      } else {
        binaryData = data;
      }
    }

    const input = binaryData
      ? { data: binaryData }
      : { url, withCredentials: false };

    pdfjsLib.getDocument(input).promise
      .then((pdf) => {
        if (cancelled) { pdf.destroy(); return; }
        doc = pdf;
        setPdfDoc(pdf);
        onPageCount?.(pdf.numPages);
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('PdfCanvas: failed to load PDF', err);
          onError?.(err);
        }
      });

    return () => {
      cancelled = true;
      if (doc) { doc.destroy(); doc = null; }
      setPdfDoc(null);
    };
  }, [url, data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Render the requested page whenever pdfDoc or page changes
  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;
    let cancelled = false;

    // Cancel any in-flight render
    if (renderTaskRef.current) {
      renderTaskRef.current.cancel();
      renderTaskRef.current = null;
    }

    (async () => {
      try {
        const pdfPage = await pdfDoc.getPage(page);
        if (cancelled) return;

        const dpr = window.devicePixelRatio || 1;
        // Render at 2x for crisp lines on engineering drawings
        const scale = 2 * dpr;
        const viewport = pdfPage.getViewport({ scale });

        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;

        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const cssW = viewport.width / dpr;
        const cssH = viewport.height / dpr;
        canvas.style.width = `${cssW}px`;
        canvas.style.height = `${cssH}px`;
        setDimensions({ width: cssW, height: cssH });
        onDimensions?.({ width: cssW, height: cssH });

        const ctx = canvas.getContext('2d');
        const task = pdfPage.render({ canvasContext: ctx, viewport });
        renderTaskRef.current = task;

        await task.promise;
        if (!cancelled) {
          renderTaskRef.current = null;
          onLoaded?.();
        }
      } catch (err) {
        if (!cancelled && err?.name !== 'RenderingCancelled') {
          console.error('PdfCanvas: render error', err);
          onError?.(err);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }
    };
  }, [pdfDoc, page]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ display: 'block', ...style }}
    />
  );
});

export default PdfCanvas;
