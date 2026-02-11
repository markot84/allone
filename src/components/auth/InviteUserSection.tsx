import { InviteUserCard } from './InviteUserCard';

export function InviteUserSection() {
  return (
    <div className="p-6 max-w-2xl">
      <h2 className="text-xl font-semibold text-[var(--nts-charcoal)] mb-4">Καλέστε χρήστες</h2>
      <InviteUserCard />
    </div>
  );
}
