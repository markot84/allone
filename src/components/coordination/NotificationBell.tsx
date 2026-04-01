import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Bell, CheckCheck, MessageSquare, CheckSquare, Users, Activity, AlertTriangle, Zap } from 'lucide-react';
import { useNotifications } from '../../hooks';
import { NotificationsService } from '../../services/coordination';
import { useAuth } from '../../hooks';
import { useAutomationAlerts } from '../../hooks/useAutomation';
import { AutomationAlertsService } from '../../services/automationSettings';
import { getAlertNavigation } from '../../utils/alertNavigation';

const TYPE_META: Record<string, { icon: typeof Bell; color: string }> = {
  decision_created: { icon: MessageSquare, color: '#3B82F6' },
  decision_updated: { icon: MessageSquare, color: '#F59E0B' },
  decision_completed: { icon: MessageSquare, color: '#10B981' },
  task_created: { icon: CheckSquare, color: '#3B82F6' },
  task_assigned: { icon: CheckSquare, color: '#8B5CF6' },
  task_completed: { icon: CheckSquare, color: '#10B981' },
  comment_added: { icon: MessageSquare, color: '#6B7280' },
  member_joined: { icon: Users, color: '#EC4899' },
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
    setMenuStyle({
      position: 'fixed',
      top: rect.bottom + 8,
      right: window.innerWidth - rect.right,
      width: 380,
      maxHeight: 460,
      overflowY: 'auto',
      background: '#fff',
      borderRadius: 12,
      boxShadow: '0 8px 30px rgba(0,0,0,0.18)',
      border: '1px solid #E5E7EB',
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
    return () => document.removeEventListener('mousedown', handler);
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
          borderRadius: 8,
          border: 'none',
          background: open ? 'rgba(255,255,255,0.12)' : 'transparent',
          cursor: 'pointer',
          color: 'rgba(255,255,255,0.7)',
          transition: 'all 0.15s',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
        onMouseLeave={e => (e.currentTarget.style.background = open ? 'rgba(255,255,255,0.12)' : 'transparent')}
      >
        <Bell size={18} />
        {totalUnread > 0 && (
          <span style={{
            position: 'absolute', top: 4, right: 4,
            minWidth: 16, height: 16, borderRadius: 8,
            backgroundColor: '#EF4444', color: '#fff',
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
            padding: '12px 16px', borderBottom: '1px solid #F3F4F6',
          }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>Ειδοποιήσεις</span>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  fontSize: 12, color: 'var(--nts-accent)',
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
              <div style={{ padding: '8px 16px', fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #F3F4F6' }}>
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
                    background: '#FEF2F2',
                    border: 'none', cursor: 'pointer',
                    borderBottom: '1px solid #F3F4F6',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#FEE2E2')}
                  onMouseLeave={e => (e.currentTarget.style.background = '#FEF2F2')}
                >
                  <div style={{
                    width: 32, height: 32, borderRadius: '50%',
                    backgroundColor: alert.severity === 'critical' ? '#FEE2E2' : '#FFFBEB',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    <AlertTriangle size={14} style={{ color: alert.severity === 'critical' ? '#DC2626' : '#F59E0B' }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', marginBottom: 2 }}>
                      {alert.title}
                    </div>
                    <div style={{ fontSize: 12, color: '#6B7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {alert.description}
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); AutomationAlertsService.dismiss(alert.id); invalidateAlerts(); }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, flexShrink: 0 }}
                    title="Απόρριψη"
                  >
                    <span style={{ fontSize: 12, color: '#9CA3AF' }}>✕</span>
                  </button>
                </button>
              ))}
            </>
          )}

          {notifications.length === 0 && newAlerts.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>
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
                    background: n.read ? 'transparent' : '#F9FAFB',
                    border: 'none', cursor: 'pointer',
                    borderBottom: '1px solid #F3F4F6',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#F3F4F6')}
                  onMouseLeave={e => (e.currentTarget.style.background = n.read ? 'transparent' : '#F9FAFB')}
                >
                  <div style={{
                    width: 32, height: 32, borderRadius: '50%',
                    backgroundColor: `${meta.color}15`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    <Icon size={14} style={{ color: meta.color }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: n.read ? 400 : 600, color: '#111827', marginBottom: 2 }}>
                      {n.title}
                    </div>
                    <div style={{ fontSize: 12, color: '#6B7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {n.body}
                    </div>
                    <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 2 }}>
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
