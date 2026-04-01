import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Mail, Monitor, Users } from 'lucide-react';
import { useState, type ChangeEvent } from 'react';
import { useAuth, useBrand } from '../../hooks';
import { MembersService, NotificationPrefsService } from '../../services/coordination';
import type { ActivityType, BrandMember, BrandMemberRole, NotificationPreferences } from '../../types';
import { DEPARTMENT_LABELS, normalizeBrandMemberRole, ROLE_LABELS } from '../../types';
import { useToast } from '../common';
import { ACTIVITY_GROUPS } from './NotificationSettings';

type Props = {
  members: BrandMember[];
  loadingMembers: boolean;
};

function groupChannels(
  prefs: NotificationPreferences | null,
  types: ActivityType[]
): { inApp: boolean; email: boolean } {
  let inApp = false;
  let email = false;
  for (const t of types) {
    const ch = NotificationPrefsService.getChannelsFor(prefs, t);
    if (ch.includes('inApp')) inApp = true;
    if (ch.includes('email')) email = true;
  }
  return { inApp, email };
}

/** Υπογραφή μελών ώστε αλλαγή τμήματος/label/ρόλου να αλλάζει query key (όχι μόνο uid). */
function membersProfileSig(list: BrandMember[]): string {
  return list
    .map((m) => `${m.userId}:${m.department ?? ''}:${m.departmentLabel ?? ''}:${m.role ?? ''}`)
    .sort()
    .join('|');
}

function effectiveRole(m: BrandMember): BrandMemberRole {
  return normalizeBrandMemberRole(m.role);
}

function canEditRoles(viewer: BrandMember | undefined, isSuperAdmin: boolean): boolean {
  if (isSuperAdmin) return true;
  if (!viewer) return false;
  const r = effectiveRole(viewer);
  return r === 'owner' || r === 'admin';
}

/** Owner, brand admin και super admin: πλήρης λίστα ρόλων (συμπ. αλλαγή owner). */
function roleOptionsForRow(
  viewer: BrandMember | undefined,
  _target: BrandMember,
  isSuperAdmin: boolean
): BrandMemberRole[] | null {
  if (!canEditRoles(viewer, isSuperAdmin)) return null;
  if (isSuperAdmin || (viewer && ['owner', 'admin'].includes(effectiveRole(viewer)))) {
    return ['owner', 'admin', 'member'];
  }
  return ['admin', 'member'];
}

type ToastApi = { error: (msg: string) => void };

function MemberRoleCell({
  member,
  allMembers,
  brandId,
  viewer,
  isSuperAdmin,
  savingUid,
  setSavingUid,
  toast,
  onSaved,
}: {
  member: BrandMember;
  allMembers: BrandMember[];
  brandId: string;
  viewer: BrandMember | undefined;
  isSuperAdmin: boolean;
  savingUid: string | null;
  setSavingUid: (uid: string | null) => void;
  toast: ToastApi;
  onSaved: () => void;
}) {
  const opts = roleOptionsForRow(viewer, member, isSuperAdmin);
  const er = effectiveRole(member);
  const busy = savingUid === member.userId;

  const handleChange = async (e: ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value as BrandMemberRole;
    if (next === er) return;
    const owners = allMembers.filter((m) => effectiveRole(m) === 'owner');
    if (er === 'owner' && next !== 'owner' && owners.length === 1) {
      toast.error('Ορίστε πρώτα άλλον ιδιοκτήτη πριν αλλάξετε αυτόν τον ρόλο.');
      e.target.value = er;
      return;
    }
    setSavingUid(member.userId);
    try {
      await MembersService.updateRole(brandId, member.userId, next);
      onSaved();
    } catch (err) {
      console.error(err);
      toast.error('Αποτυχία αλλαγής ρόλου.');
      e.target.value = er;
    } finally {
      setSavingUid(null);
    }
  };

  if (!opts) {
    return <span className="text-[var(--nts-charcoal)] whitespace-nowrap">{ROLE_LABELS[er]}</span>;
  }

  return (
    <select
      value={er}
      disabled={busy}
      onChange={handleChange}
      className="max-w-[180px] px-2 py-1.5 text-sm bg-white border border-[var(--nts-border-gray)] rounded-lg disabled:opacity-50"
      aria-label={`Ρόλος ${member.email || member.userId}`}
    >
      {opts.map((r) => (
        <option key={r} value={r}>
          {ROLE_LABELS[r]}
        </option>
      ))}
    </select>
  );
}

export function BrandMembersNotificationTable({ members, loadingMembers }: Props) {
  const { currentBrand } = useBrand();
  const { user, isSuperAdmin } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [savingUid, setSavingUid] = useState<string | null>(null);
  const brandId = currentBrand?.id ?? null;
  const me = user?.uid ? members.find((m) => m.userId === user.uid) : undefined;

  const { data: rows = [], isPending: loadingPrefs } = useQuery({
    queryKey: ['memberNotificationPrefs', brandId, membersProfileSig(members)],
    queryFn: () => (brandId ? NotificationPrefsService.listMemberPrefs(brandId, members) : Promise.resolve([])),
    enabled: !!brandId && !loadingMembers,
  });

  const loading = loadingMembers || loadingPrefs;

  if (!currentBrand) return null;

  const sorted = [...rows].sort((a, b) =>
    (a.member.email || '').localeCompare(b.member.email || '', 'el')
  );

  return (
    <div className="p-4 border border-[var(--nts-border-gray)] rounded-xl bg-white">
      <h4 className="font-semibold text-[var(--nts-charcoal)] mb-1 flex items-center gap-2">
        <Users size={18} />
        Χρήστες & ειδοποιήσεις
      </h4>
      <p className="text-sm text-[var(--nts-medium-gray)] mb-4">
        Προβολή ρόλου, email, τμήματος και ενεργών καναλιών (εφαρμογή / email) ανά κατηγορία. Οι ιδιοκτήτες και οι
        διαχειριστές μπορούν να αλλάζουν δικαιώματα (όχι τον ρόλο «Ιδιοκτήτης» από admin — μόνο owner).
      </p>

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 size={22} className="animate-spin text-[var(--nts-medium-gray)]" />
        </div>
      ) : sorted.length === 0 ? (
        <p className="text-sm text-[var(--nts-medium-gray)] py-4">Δεν υπάρχουν ακόμα μέλη σε αυτό το brand.</p>
      ) : (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full min-w-[820px] text-sm border-collapse">
            <thead>
              <tr className="border-b border-[var(--nts-border-gray)] text-left">
                <th className="py-2.5 pr-3 font-medium text-[var(--nts-medium-gray)]">Email</th>
                <th className="py-2.5 pr-3 font-medium text-[var(--nts-medium-gray)] whitespace-nowrap">Ρόλος</th>
                <th className="py-2.5 pr-3 font-medium text-[var(--nts-medium-gray)] whitespace-nowrap">Τμήμα</th>
                {ACTIVITY_GROUPS.map((g) => (
                  <th key={g.label} className="py-2.5 px-1 font-medium text-[var(--nts-medium-gray)] text-center whitespace-nowrap">
                    <span className="hidden sm:inline">{g.label}</span>
                    <span className="sm:hidden">{g.label.split(' ')[0]}…</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map(({ member, prefs }) => (
                <tr key={member.userId} className="border-b border-[var(--nts-border-gray)]/60 hover:bg-[var(--nts-light-gray)]/50">
                  <td className="py-2.5 pr-3 text-[var(--nts-charcoal)] break-all max-w-[220px]">{member.email || '—'}</td>
                  <td className="py-2.5 pr-3 align-middle">
                    <MemberRoleCell
                      member={member}
                      allMembers={members}
                      brandId={brandId!}
                      viewer={me}
                      isSuperAdmin={isSuperAdmin}
                      savingUid={savingUid}
                      setSavingUid={setSavingUid}
                      toast={toast}
                      onSaved={() => queryClient.invalidateQueries({ queryKey: ['members', brandId] })}
                    />
                  </td>
                  <td className="py-2.5 pr-3 text-[var(--nts-charcoal)] whitespace-nowrap">
                    {member.departmentLabel || DEPARTMENT_LABELS[member.department] || member.department || '—'}
                  </td>
                  {ACTIVITY_GROUPS.map((g) => {
                    const { inApp, email } = groupChannels(prefs, g.types);
                    return (
                      <td key={g.label} className="py-2.5 px-1">
                        <div className="flex items-center justify-center gap-2">
                          <span
                            title={inApp ? 'Ενεργό in-app' : 'Ανενεργό in-app'}
                            className={`inline-flex items-center justify-center w-7 h-7 rounded-md ${
                              inApp ? 'bg-[var(--nts-accent)]/15 text-[var(--nts-accent)]' : 'bg-gray-100 text-gray-400'
                            }`}
                          >
                            <Monitor size={14} />
                          </span>
                          <span
                            title={email ? 'Ενεργό email' : 'Ανενεργό email'}
                            className={`inline-flex items-center justify-center w-7 h-7 rounded-md ${
                              email ? 'bg-[var(--nts-accent)]/15 text-[var(--nts-accent)]' : 'bg-gray-100 text-gray-400'
                            }`}
                          >
                            <Mail size={14} />
                          </span>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[11px] text-[var(--nts-medium-gray)] mt-3 flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1">
              <Monitor size={12} /> Εφαρμογή
            </span>
            <span className="inline-flex items-center gap-1">
              <Mail size={12} /> Email
            </span>
            <span className="opacity-80">Αν δεν έχει αποθηκευτεί προσαρμογή, εμφανίζονται οι προεπιλογές.</span>
          </p>
        </div>
      )}
    </div>
  );
}
