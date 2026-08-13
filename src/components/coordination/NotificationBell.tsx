import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Bell, CheckCheck, MessageSquare, CheckSquare, Users, Activity, AlertTriangle, Zap } from 'lucide-react';
import { useNotifications } from '../../hooks';
import { NotificationsService } from '../../services/coordination';
import { useAuth } from '../../hooks';
import { useAutomationAlerts } from '../../hooks/useAutomation';
import { AutomationAlertsService } from '../../services/automationSettings';
import { getAlertNavigation } from '../../utils/alertNavigation';

/* Tokens below carry `var(--x, fallback)` where the token is part of the redesign's surface/radius
   set, which `main` does not have yet. This file has to be identical on both — the bell bug is on
   main too — and an undefined custom property makes the whole declaration invalid at
   computed-value time, which would leave the dropdown transparent and unrounded there. */

/** Palette tokens, not the old six-colour rainbow: the type is carried by the icon, and colour only
 *  says done (green) / needs you (orange) / neutral (navy). See colors.md §5. */
const TYPE_META: Record<string, { icon: typeof Bell; color: string }> = {
  decision_created: { icon: MessageSquare, color: 'var(--navy-500)' },
  decision_updated: { icon: MessageSquare, color: 'var(--orange-700)' },
  decision_completed: { icon: MessageSquare, color: 'var(--success-700, #0D804A)' },
  task_created: { icon: CheckSquare, color: 'var(--navy-500)' },
  task_assigned: { icon: CheckSquare, color: 'var(--orange-700)' },
  task_completed: { icon: CheckSquare, color: 'var(--success-700, #0D804A)' },
  comment_added: { icon: MessageSquare, color: 'var(--text-muted)' },
  member_joined: { icon: Users, color: 'var(--sky-500)' },
};

export function NotificationBell({
  onNavigate,
}: {
  onNavigate?: (section: string, opts?: { hashQuery?: string }) => void;
}) {
  const { notifications, unreadCount } = useNotifications();
  const { newAlerts, invalidate: invalidateAlerts } = useAutomationAlerts();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const totalUnread = unreadCount + newAlerts.length;
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});

  const updatePosition = useCallback(() => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const gutter = 8;
    const width = Math.min(380, Math.max(280, viewportWidth - gutter * 2));
    const left = Math.min(Math.max(gutter, rect.right - width), viewportWidth - width - gutter);
    setMenuStyle({
      position: 'fixed',
      top: rect.bottom + 8,
      left,
      width,
      maxWidth: `calc(100vw - ${gutter * 2}px)`,
      maxHeight: 460,
      overflowY: 'auto',
      background: 'var(--card-bg, var(--surface-0))',
      borderRadius: 'var(--ui-radius-lg, 12px)',
      boxShadow: 'var(--elev-3, 0 8px 30px rgba(16,24,40,0.18))',
      border: '1px solid var(--card-border, var(--border))',
      zIndex: 9999,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        btnRef.current && !btnRef.current.contains(target) &&
        dropdownRef.current && !dropdownRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      document.removeEventListener('mousedown', handler);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, updatePosition]);

  const handleMarkAllRead = async () => {
    if (user?.uid) await NotificationsService.markAllRead(user.uid);
  };

  const handleClick = async (n: typeof notifications[0]) => {
    if (user?.uid && !n.read) await NotificationsService.markRead(user.uid, n.id);
    if (onNavigate) onNavigate('coordination');
    setOpen(false);
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000);
    if (diffMin < 1) return 'Τώρα';
    if (diffMin < 60) return `${diffMin}λ`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}ω`;
    return d.toLocaleDateString('el-GR', { day: 'numeric', month: 'short' });
  };

  return (
    <div style={{ position: 'relative' }}>
      <button
        ref={btnRef}
        onClick={() => setOpen(o => !o)}
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 36, height: 36,
          borderRadius: 'var(--ui-radius-sm, 8px)',
          border: 'none',
          background: open ? 'var(--chrome-control-hover)' : 'transparent',
          cursor: 'pointer',
          /* The chrome is a WHITE header (--chrome-bg is surface-0). This used to be
             rgba(255,255,255,0.7) left over from the dark chrome, which painted a white bell on a
             white bar — the badge floated over nothing. Colour comes from the chrome tokens now, so
             it follows the header wherever the header goes. */
          color: 'var(--chrome-fg-muted)',
          transition: 'background 0.15s, color 0.15s',
        }}
        aria-label={totalUnread > 0 ? `Ειδοποιήσεις (${totalUnread} νέες)` : 'Ειδοποιήσεις'}
        aria-expanded={open}
        onMouseEnter={e => (e.currentTarget.style.background = 'var(--chrome-control-hover)')}
        onMouseLeave={e => (e.currentTarget.style.background = open ? 'var(--chrome-control-hover)' : 'transparent')}
      >
        <Bell size={18} />
        {totalUnread > 0 && (
          <span style={{
            position: 'absolute', top: 2, right: 2,
            minWidth: 16, height: 16, borderRadius: 'var(--ui-radius-pill, 999px)',
            backgroundColor: 'var(--danger-600, #CC3A30)', color: '#fff',
            border: '1.5px solid var(--chrome-bg)',
            fontSize: 10, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '0 4px',
          }}>
            {totalUnread > 9 ? '9+' : totalUnread}
          </span>
        )}
      </button>

      {open && createPortal(
        <div ref={dropdownRef} style={menuStyle}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 16px', borderBottom: '1px solid var(--border)',
          }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>Ειδοποιήσεις</span>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  fontSize: 12, color: 'var(--nts-accent-text)',
                  background: 'none', border: 'none', cursor: 'pointer',
                }}
              >
                <CheckCheck size={13} /> Αναγνώστηκαν
              </button>
            )}
          </div>

          {/* Automation Alerts */}
          {newAlerts.length > 0 && (
            <>
              <div style={{ padding: '8px 16px', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border)' }}>
                <Zap size={11} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />
                Αυτοματισμοί
              </div>
              {newAlerts.slice(0, 5).map(alert => (
                <button
                  key={`alert-${alert.id}`}
                  onClick={() => {
                    const nav = getAlertNavigation(alert);
                    onNavigate?.(nav.section, nav.hashQuery ? { hashQuery: nav.hashQuery } : undefined);
                    setOpen(false);
                  }}
                  style={{
                    display: 'flex', gap: 10, padding: '10px 16px',
                    width: '100%', textAlign: 'left',
                    background: 'var(--surface-1)',
                    border: 'none', cursor: 'pointer',
                    borderBottom: '1px solid var(--border)',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'var(--surface-1)')}
                >
                  <div style={{
                    width: 32, height: 32, borderRadius: '50%',
                    backgroundColor: alert.severity === 'critical' ? 'var(--danger-light)' : 'var(--warning-light)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    <AlertTriangle size={14} style={{ color: alert.severity === 'critical' ? 'var(--danger-600, #CC3A30)' : 'var(--gold-700)' }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>
                      {alert.title}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {alert.description}
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); AutomationAlertsService.dismiss(alert.id); invalidateAlerts(); }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, flexShrink: 0 }}
                    title="Απόρριψη"
                  >
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>✕</span>
                  </button>
                </button>
              ))}
            </>
          )}

          {notifications.length === 0 && newAlerts.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              Δεν υπάρχουν ειδοποιήσεις
            </div>
          ) : notifications.length === 0 ? null : (
            notifications.slice(0, 20).map(n => {
              const meta = TYPE_META[n.type] || { icon: Activity, color: '#9CA3AF' };
              const Icon = meta.icon;
              return (
                <button
                  key={n.id}
                  onClick={() => handleClick(n)}
                  style={{
                    display: 'flex', gap: 10, padding: '10px 16px',
                    width: '100%', textAlign: 'left',
                    background: n.read ? 'transparent' : 'var(--surface-1)',
                    border: 'none', cursor: 'pointer',
                    borderBottom: '1px solid var(--border)',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                  onMouseLeave={e => (e.currentTarget.style.background = n.read ? 'transparent' : 'var(--surface-1)')}
                >
                  <div style={{
                    width: 32, height: 32, borderRadius: '50%',
                    /* meta.color is a var() now, so the old `${color}15` hex-alpha trick no longer
                       parses — color-mix does the same 12% tint against the card. */
                    backgroundColor: `color-mix(in srgb, ${meta.color} 12%, transparent)`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    <Icon size={14} style={{ color: meta.color }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: n.read ? 400 : 600, color: 'var(--text-primary)', marginBottom: 2 }}>
                      {n.title}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {n.body}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                      {formatTime(n.createdAt)}
                    </div>
                  </div>
                  {!n.read && (
                    <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: 'var(--nts-accent)', flexShrink: 0, marginTop: 4 }} />
                  )}
                </button>
              );
            })
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
