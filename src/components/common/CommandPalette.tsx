import { useEffect, useState, lazy, Suspense } from 'react';

/**
 * Command palette — ⌘K / Ctrl+K.
 *
 * Jumps to a section, a SKU, or a segment. Deliberately read-only: everything it does is
 * navigation. Switching a strategy scenario is the one capability the brief lists that is missing,
 * and on purpose — it writes the active strategy to Firestore and triggers AI generation, which is
 * not something a keystroke should do without the confirmation the Configurator asks for.
 *
 * Only the key listener lives in the entry chunk. The contents pull `useProducts` and
 * `useSegments`, which drag in a large slice of the data layer — eagerly imported they added
 * ~108kB to every first paint for a surface most sessions never open — so they load on first ⌘K.
 */

const CommandPaletteDialog = lazy(() =>
  import('./CommandPaletteDialog').then((m) => ({ default: m.CommandPaletteDialog }))
);

export function CommandPalette({ onNavigate }: { onNavigate: (section: string, opts?: { hashQuery?: string }) => void }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((previous) => !previous);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <CommandPaletteDialog onClose={() => setOpen(false)} onNavigate={onNavigate} />
    </Suspense>
  );
}
