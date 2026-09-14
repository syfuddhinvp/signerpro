'use client';

/* A QR code drawn as SVG rather than a canvas bitmap.
 *
 * The matrix comes from `qrcode`'s encoder; only the drawing is ours. SVG keeps
 * the code crisp at any size and — unlike toCanvas/toDataURL — needs no canvas,
 * so this renders identically in the browser and under jsdom in tests. */

import { useMemo } from 'react';
import QRCode from 'qrcode';

export default function QrCode({ value, size = 148, label }: { value: string; size?: number; label?: string }) {
  const path = useMemo(() => {
    let qr: ReturnType<typeof QRCode.create>;
    try {
      qr = QRCode.create(value, { errorCorrectionLevel: 'M' });
    } catch {
      return null;
    }
    const count = qr.modules.size;
    const data = qr.modules.data;
    const parts: string[] = [];
    for (let row = 0; row < count; row += 1) {
      for (let col = 0; col < count; col += 1) {
        if (data[row * count + col]) parts.push(`M${col} ${row}h1v1h-1z`);
      }
    }
    return { d: parts.join(''), count };
  }, [value]);

  /* No QR is better than a wrong one: the secret is also shown as text next to
   * this, so the enrolment still works if encoding fails. */
  if (!path) return null;

  const quiet = 2;
  const span = path.count + quiet * 2;
  return (
    <svg
      width={size} height={size}
      viewBox={`0 0 ${span} ${span}`}
      role="img"
      aria-label={label || 'QR code'}
      shapeRendering="crispEdges"
      style={{ borderRadius:'8px', background:'#fff', border:'1px solid #c7d2fe', padding:'0', flex:`0 0 ${size}px` }}>
      <rect width={span} height={span} fill="#fff" />
      <g transform={`translate(${quiet} ${quiet})`} fill="#0f172a">
        <path d={path.d} />
      </g>
    </svg>
  );
}
