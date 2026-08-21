import { useBrandMembers } from '../../hooks';
import { BrandMembersNotificationTable } from './BrandMembersNotificationTable';
import { InviteUserCard } from './InviteUserCard';
import { MyDepartmentCard } from './MyDepartmentCard';
import { NotificationSettings } from './NotificationSettings';
import { PageHeader } from '../common';
import { PageCanvas } from '../layout/ChromeControls';
import { useFullBleedCanvas } from '../layout/AppChrome';

export function InviteUserSection() {
  // The page draws its own gutters, so the shell drops its padded wrapper.
  useFullBleedCanvas();

  const { members, isLoading: membersLoading } = useBrandMembers();

  return (
    <PageCanvas>
      <PageHeader eyebrow="Admin" title="Καλέστε χρήστες" />
      <div>
        <div className="space-y-6">
          <MyDepartmentCard />
          <InviteUserCard />
        </div>
      </div>
      <BrandMembersNotificationTable members={members} loadingMembers={membersLoading} />
      <NotificationSettings />
    </PageCanvas>
  );
}
