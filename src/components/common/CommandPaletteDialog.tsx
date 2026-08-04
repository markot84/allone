import { useMemo, useState } from 'react';
import { Command } from 'cmdk';
import { Search, LayoutGrid, Package, Users } from 'lucide-react';
import { useModules } from '../../hooks/useModules';
import { useProducts } from '../../hooks/useProducts';
import { useSegments } from '../../hooks/useSegments';
import { APP_SECTIONS, getSectionLabelForPalette } from '../../config/modules';

/**
 * The palette's contents, in their own module on purpose.
 *
 * It pulls `useProducts` and `useSegments`, which drag in a large slice of the data layer. Kept in
 * the entry chunk it added ~108kB to every first paint for a surface most sessions never open, so
 * `CommandPalette` loads this lazily on first ⌘K.
 */

const MAX_RESULTS = 6;

export function CommandPaletteDialog({
  onClose,
  onNavigate,
}: {
  onClose: () => void;
  onNavigate: (section: string, opts?: { hashQuery?: string }) => void;
}) {
  const [query, setQuery] = useState('');
  const { isSectionEnabled, getSectionLabel } = useModules();
  // Capped: the palette needs enough to search by name, not the whole catalogue.
  const { products } = useProducts({ maxDocs: 500 });
  const { segments } = useSegments();

  const sections = useMemo(
    () =>
      APP_SECTIONS.filter((section) => isSectionEnabled(section))
        // The data/* aliases all open the same page; one entry is enough.
        .filter((section) => !section.startsWith('data-'))
        .map((section) => ({ id: section, label: getSectionLabel(section) ?? getSectionLabelForPalette(section) })),
    [isSectionEnabled, getSectionLabel]
  );

  const trimmed = query.trim().toLowerCase();

  const productMatches = useMemo(() => {
    if (trimmed.length < 2) return [];
    return products
      .filter((p) => p.sku?.toLowerCase().includes(trimmed) || p.name?.toLowerCase().includes(trimmed))
      .slice(0, MAX_RESULTS);
  }, [products, trimmed]);

  const segmentMatches = useMemo(() => {
    if (trimmed.length < 2) return [];
    return segments.filter((s) => s.name?.toLowerCase().includes(trimmed)).slice(0, MAX_RESULTS);
  }, [segments, trimmed]);

  const go = (section: string, opts?: { hashQuery?: string }) => {
    onClose();
    onNavigate(section, opts);
  };

  return (
    <div
      role="presentation"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1200,
        background: 'rgba(16, 24, 40, 0.45)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '12vh 16px 16px',
      }}
    >
      <div onClick={(event) => event.stopPropagation()} style={{ width: '100%', maxWidth: 560 }}>
        <Command
          label="Παλέτα εντολών"
          shouldFilter={false}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onClose();
          }}
          style={{
            background: 'var(--surface-0)',
            border: '1px solid var(--border)',
            borderRadius: 14,
            boxShadow: '0 24px 64px rgba(16, 24, 40, 0.24)',
            overflow: 'hidden',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
            <Search size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <Command.Input
              autoFocus
              value={query}
              onValueChange={setQuery}
              placeholder="Μετάβαση σε ενότητα, SKU ή segment…"
              style={{
                flex: 1,
                border: 'none',
                outline: 'none',
                background: 'transparent',
                font: '400 15px Inter, sans-serif',
                color: 'var(--text-primary)',
              }}
            />
            <kbd
              style={{
                font: '500 11px "JetBrains Mono", monospace',
                color: 'var(--text-muted)',
                border: '1px solid var(--border)',
                borderRadius: 5,
                padding: '2px 6px',
              }}
            >
              esc
            </kbd>
          </div>

          <Command.List style={{ maxHeight: 380, overflowY: 'auto', padding: 8 }}>
            <Command.Empty style={{ padding: '18px 12px', font: '400 14px Inter, sans-serif', color: 'var(--text-muted)' }}>
              Κανένα αποτέλεσμα.
            </Command.Empty>

            <PaletteGroup heading="Ενότητες">
              {sections
                .filter((section) => !trimmed || section.label.toLowerCase().includes(trimmed))
                .map((section) => (
                  <PaletteItem key={section.id} icon={<LayoutGrid size={15} />} onSelect={() => go(section.id)}>
                    {section.label}
                  </PaletteItem>
                ))}
            </PaletteGroup>

            {productMatches.length > 0 && (
              <PaletteGroup heading="Προϊόντα">
                {productMatches.map((product) => (
                  <PaletteItem
                    key={product.id}
                    icon={<Package size={15} />}
                    hint={product.sku}
                    onSelect={() => go('products', { hashQuery: `q=${encodeURIComponent(product.sku ?? product.name ?? '')}` })}
                  >
                    {product.name}
                  </PaletteItem>
                ))}
              </PaletteGroup>
            )}

            {segmentMatches.length > 0 && (
              <PaletteGroup heading="Segments">
                {segmentMatches.map((segment) => (
                  <PaletteItem key={segment.id ?? segment.name} icon={<Users size={15} />} onSelect={() => go('rfm')}>
                    {segment.name}
                  </PaletteItem>
                ))}
              </PaletteGroup>
            )}
          </Command.List>
        </Command>
      </div>
    </div>
  );
}

function PaletteGroup({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <Command.Group
      heading={heading}
      style={{ font: '600 10px Inter, sans-serif', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.12em' }}
    >
      {children}
    </Command.Group>
  );
}

function PaletteItem({
  icon,
  hint,
  onSelect,
  children,
}: {
  icon: React.ReactNode;
  hint?: string;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <Command.Item
      onSelect={onSelect}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '9px 10px',
        borderRadius: 8,
        cursor: 'pointer',
        font: '400 14px Inter, sans-serif',
        color: 'var(--text-primary)',
      }}
    >
      <span style={{ color: 'var(--text-muted)', display: 'flex' }}>{icon}</span>
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{children}</span>
      {hint && <span data-numeric style={{ font: '400 12px "JetBrains Mono", monospace', color: 'var(--text-muted)' }}>{hint}</span>}
    </Command.Item>
  );
}
