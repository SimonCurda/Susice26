'use client';

/**
 * Global error boundary (last resort when the root layout itself fails).
 * Shows the exact error message — never a generic screen.
 */

import { Button } from '@/components/ui/button';
import { TriangleAlert } from 'lucide-react';
import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[global-error.tsx] fatal error:', error);
  }, [error]);

  return (
    <html lang="cs">
      <body style={{ fontFamily: 'system-ui, sans-serif', background: '#fafaf9', color: '#1c1917' }}>
        <div style={{ display: 'flex', minHeight: '100vh', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24, textAlign: 'center' }}>
          <div style={{ display: 'flex', height: 48, width: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 9999, border: '1px solid #fecdd3', background: '#fff1f2' }}>
            <TriangleAlert style={{ height: 24, width: 24, color: '#e11d48' }} />
          </div>
          <h1 style={{ fontSize: 18, fontWeight: 700 }}>Kritická chyba aplikace</h1>
          <p style={{ maxWidth: 640, border: '1px solid #e7e5e4', background: '#f5f5f4', padding: 12, borderRadius: 8, fontFamily: 'monospace', fontSize: 12, textAlign: 'left', wordBreak: 'break-word' }}>
            {error.message || '(chyba bez zprávy)'}
          </p>
          {error.digest ? <p style={{ fontSize: 11, color: '#78716c', fontFamily: 'monospace' }}>digest: {error.digest}</p> : null}
          <button
            onClick={reset}
            style={{ border: '1px solid #d6d3d1', borderRadius: 8, padding: '8px 16px', background: 'white', cursor: 'pointer' }}
          >
            Zkusit znovu
          </button>
        </div>
      </body>
    </html>
  );
}
