import { useBrandMembers } from './useCoordination';
import { useAuth } from './useAuth';
import { useBrand } from './useBrand';

/** Mirrors firestore.rules isBrandOwnerOrAdmin(brandId) so the UI can disable controls the
 * server would reject anyway (catalog import / wipe), instead of surfacing a rules error. */
export function useIsBrandOwnerOrAdmin(): boolean {
  const { members } = useBrandMembers();
  const { user, isSuperAdmin } = useAuth();
  const { currentBrand } = useBrand();
  const myRole = members.find((m) => m.userId === user?.uid)?.role ?? 'member';
  return myRole === 'owner' || myRole === 'admin' || currentBrand?.createdBy === user?.uid || isSuperAdmin;
}
