import { InviteUserCard } from './InviteUserCard';
import { NotificationSettings } from './NotificationSettings';

export function InviteUserSection() {
  return (
    <div className="p-6 max-w-2xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-[var(--nts-charcoal)] mb-4">Καλέστε χρήστες</h2>
        <InviteUserCard />
      </div>
      <NotificationSettings />
    </div>
  );
}
