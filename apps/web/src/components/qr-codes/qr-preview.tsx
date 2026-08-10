'use client';

import { toCanvas } from 'qrcode';
import * as React from 'react';

export interface QrPreviewConfig {
  data: string;
  size: number;
  foregroundColor: string;
  backgroundColor: string;
  errorCorrectionLevel: 'L' | 'M' | 'Q' | 'H';
  margin: number;
}

/**
 * Renders a QR code entirely client-side (via the browser build of the
 * same `qrcode` library the backend uses) for instant visual feedback as
 * the user adjusts colors/size/error-correction/margin — no network
 * round-trip per keystroke. This is deliberately an approximation of the
 * final asset: the exact bytes downloaded always come from the backend
 * (QrCodesService/QrGeneratorService), which is the only place the real
 * encoded URL (short URL + UTM attribution params) is assembled. Good
 * enough for "does this look readable / do I like these colors", not
 * meant to be pixel-identical to the download.
 */
export function QrPreview({ config }: { config: QrPreviewConfig }) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!canvasRef.current) return;
    let cancelled = false;

    toCanvas(canvasRef.current, config.data, {
      width: Math.min(config.size, 320), // cap the on-screen preview size regardless of the configured output size
      margin: config.margin,
      errorCorrectionLevel: config.errorCorrectionLevel,
      color: { dark: config.foregroundColor, light: config.backgroundColor },
    })
      .then(() => {
        if (!cancelled) setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(
            err instanceof Error ? err.message : 'Failed to render preview',
          );
      });

    return () => {
      cancelled = true;
    };
  }, [
    config.data,
    config.size,
    config.foregroundColor,
    config.backgroundColor,
    config.errorCorrectionLevel,
    config.margin,
  ]);

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-center justify-center rounded-md border bg-muted/20 p-4">
        <canvas ref={canvasRef} className="max-w-full" />
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
