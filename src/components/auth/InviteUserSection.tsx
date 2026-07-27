import { useBrandMembers } from '../../hooks';
import { BrandMembersNotificationTable } from './BrandMembersNotificationTable';
import { InviteUserCard } from './InviteUserCard';
import { MyDepartmentCard } from './MyDepartmentCard';
import { NotificationSettings } from './NotificationSettings';

export function InviteUserSection() {
  const { members, isLoading: membersLoading } = useBrandMembers();

  return (
    <div className="p-6 max-w-5xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-[var(--nts-charcoal)] mb-4">Καλέστε χρήστες</h2>
        <div className="space-y-6">
          <MyDepartmentCard />
          <InviteUserCard />
        </div>
      </div>
      <BrandMembersNotificationTable members={members} loadingMembers={membersLoading} />
      <NotificationSettings />
    </div>
  );
}
