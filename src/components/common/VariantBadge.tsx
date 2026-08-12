/**
 * Names the visual direction this build is, for the three preview channels.
 *
 * Three preview URLs of the same app are impossible to tell apart from memory, and a client
 * comparing them will lose track of which tab is which within a minute. Set at build time via
 * `VITE_UI_VARIANT`; renders nothing when unset, so it never reaches production.
 */
export function VariantBadge() {
  const label = import.meta.env.VITE_UI_VARIANT as string | undefined;
  if (!label) return null;

  return (
    <div
      // Bottom-left: the bottom-right corner already belongs to the Mark launcher orb.
      style={{
        position: 'fixed',
        left: 12,
        bottom: 12,
        zIndex: 9999,
        pointerEvents: 'none',
        padding: '4px 10px',
        borderRadius: 'var(--ui-radius-pill)',
        background: 'var(--navy-900)',
        color: '#FFFFFF',
        font: '600 11px/1 var(--font-body)',
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        boxShadow: 'var(--elev-2)'
      }}
    >
      {label}
    </div>
  );
}
