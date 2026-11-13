'use client';

/**
 * Route-segment error boundary — shows the EXACT render error and its
 * Next.js digest instead of a generic failure screen.
 */

import { Button } from '@/components/ui/button';
import { TriangleAlert } from 'lucide-react';
import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[error.tsx] render error:', error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 py-10 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full border border-rose-300 bg-rose-50">
        <TriangleAlert className="h-6 w-6 text-rose-600" />
      </div>
      <h1 className="text-lg font-bold">Chyba při vykreslení stránky</h1>
      <p className="max-w-xl rounded-md border bg-muted/50 p-3 text-left font-mono text-xs leading-relaxed break-words">
        {error.message || '(chyba bez zprávy)'}
      </p>
      {error.digest ? (
        <p className="font-mono text-[11px] text-muted-foreground">Next.js digest: {error.digest}</p>
      ) : null}
      <Button onClick={reset}>Zkusit znovu</Button>
    </div>
  );
}
