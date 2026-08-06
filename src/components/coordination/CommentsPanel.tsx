import { useState } from 'react';
import { Send } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useBrand } from '../../hooks/useBrand';
import { useComments, useBrandMembers } from '../../hooks/useCoordination';
import { CommentsService } from '../../services/coordination';
import { logAndNotify } from '../../services/coordination';
import type { CommentEntityType } from '../../types';

interface CommentsPanelProps {
  entityType: CommentEntityType;
  entityId: string;
  entityTitle?: string;
}

const DEPT_LABELS: Record<string, string> = {
  management: 'Διοίκηση', commercial: 'Εμπορική', marketing: 'Marketing',
  procurement: 'Procurement', agency: 'Agency', other: '',
};

export function CommentsPanel({ entityType, entityId, entityTitle: _entityTitle }: CommentsPanelProps) {
  const { comments, isLoading, invalidate } = useComments(entityType, entityId);
  const { members } = useBrandMembers();
  const { user } = useAuth();
  const { currentBrand } = useBrand();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const currentMember = members.find(m => m.userId === user?.uid);
  const authorName = currentMember?.displayName || user?.displayName || user?.email || 'User';
  const authorDept = currentMember?.department;

  const handleSend = async () => {
    if (!text.trim() || !currentBrand?.id || !user?.uid) return;
    setSending(true);
    try {
      await CommentsService.create({
        brandId: currentBrand.id,
        entityType,
        entityId,
        text: text.trim(),
        authorId: user.uid,
        authorName,
        authorDepartment: authorDept,
      });
      await logAndNotify(
        currentBrand.id, user.uid, authorName,
        'comment_added', entityType, entityId,
        `${authorName} σχολίασε: "${text.trim().slice(0, 60)}..."`,
        'Νέο σχόλιο',
        `${authorName}: ${text.trim().slice(0, 100)}`
      );
      setText('');
      invalidate();
    } finally {
      setSending(false);
    }
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'Μόλις τώρα';
    if (diffMin < 60) return `${diffMin} λ.`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH} ω.`;
    return d.toLocaleDateString('el-GR', { day: 'numeric', month: 'short' });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto space-y-3 p-3">
        {isLoading && <div className="text-sm text-[var(--text-muted)] text-center py-4">Φόρτωση...</div>}
        {!isLoading && comments.length === 0 && (
          <div className="text-sm text-[var(--text-muted)] text-center py-8">Κανένα σχόλιο ακόμη</div>
        )}
        {comments.map(c => (
          <div key={c.id} className={`flex gap-2.5 ${c.authorId === user?.uid ? 'flex-row-reverse' : ''}`}>
            <div className="w-8 h-8 rounded-full bg-[var(--nts-accent)] text-white flex items-center justify-center text-xs font-bold shrink-0">
              {c.authorName.charAt(0).toUpperCase()}
            </div>
            <div className={`max-w-[80%] ${c.authorId === user?.uid ? 'text-right' : ''}`}>
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="text-xs font-semibold text-[var(--text-secondary)]">{c.authorName}</span>
                {c.authorDepartment && DEPT_LABELS[c.authorDepartment] && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--surface-2)] text-[var(--text-muted)]">
                    {DEPT_LABELS[c.authorDepartment]}
                  </span>
                )}
                <span className="text-[10px] text-[var(--text-muted)]">{formatTime(c.createdAt)}</span>
              </div>
              <div className={`px-3 py-2 rounded-xl text-sm ${
                c.authorId === user?.uid
                  ? 'bg-[var(--nts-accent)] text-white rounded-tr-sm'
                  : 'bg-[var(--surface-2)] text-[var(--text-secondary)] rounded-tl-sm'
              }`}>
                {c.text}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="border-t border-[var(--surface-2)] p-3 flex gap-2">
        <input
          type="text"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
          placeholder="Γράψε σχόλιο..."
          className="flex-1 px-3 py-2 text-sm bg-[var(--surface-1)] border border-[var(--border)] rounded-lg focus:outline-none focus:border-[var(--nts-accent)]"
        />
        <button
          onClick={handleSend}
          disabled={!text.trim() || sending}
          className="w-9 h-9 flex items-center justify-center rounded-lg bg-[var(--nts-accent)] text-white disabled:opacity-40 hover:opacity-90 transition-opacity"
        >
          <Send size={15} />
        </button>
      </div>
    </div>
  );
}
