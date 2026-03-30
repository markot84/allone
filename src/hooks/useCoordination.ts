import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect, useRef } from 'react';
import { useBrand } from './useBrand';
import { useAuth } from './useAuth';
import {
  MembersService, DecisionsService, TasksService,
  CommentsService, ActivityService, NotificationsService
} from '../services/coordination';
import type { UserNotification } from '../types';

export function useBrandMembers() {
  const { currentBrand } = useBrand();
  const { user } = useAuth();
  const brandId = currentBrand?.id ?? null;
  const provisioned = useRef<string | null>(null);

  const { data: members = [], isPending } = useQuery({
    queryKey: ['members', brandId],
    queryFn: async () => {
      if (!brandId) return [];
      const list = await MembersService.getAll(brandId);
      if (list.length === 0 && user?.uid && provisioned.current !== brandId) {
        provisioned.current = brandId;
        const isCreator = currentBrand?.createdBy === user.uid;
        await MembersService.set(brandId, {
          userId: user.uid,
          email: user.email || '',
          displayName: user.displayName || user.email || '',
          role: isCreator ? 'owner' : 'member',
          department: isCreator ? 'management' : 'other',
          joinedAt: new Date().toISOString(),
        });
        return MembersService.getAll(brandId);
      }
      return list;
    },
    enabled: !!brandId,
  });

  return { members, isLoading: isPending };
}

export function useDecisions() {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;
  const qc = useQueryClient();

  const { data: decisions = [], isPending } = useQuery({
    queryKey: ['decisions', brandId],
    queryFn: () => (brandId ? DecisionsService.getAll(brandId) : Promise.resolve([])),
    enabled: !!brandId,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['decisions', brandId] });

  return { decisions, isLoading: isPending, invalidate };
}

export function useTasks() {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;
  const qc = useQueryClient();

  const { data: tasks = [], isPending } = useQuery({
    queryKey: ['tasks', brandId],
    queryFn: () => (brandId ? TasksService.getAll(brandId) : Promise.resolve([])),
    enabled: !!brandId,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['tasks', brandId] });

  return { tasks, isLoading: isPending, invalidate };
}

export function useComments(entityType: string, entityId: string) {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;
  const qc = useQueryClient();

  const { data: comments = [], isPending } = useQuery({
    queryKey: ['comments', brandId, entityType, entityId],
    queryFn: () => (brandId ? CommentsService.getForEntity(brandId, entityType, entityId) : Promise.resolve([])),
    enabled: !!brandId && !!entityId,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['comments', brandId, entityType, entityId] });

  return { comments, isLoading: isPending, invalidate };
}

export function useActivity() {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;

  const { data: activity = [], isPending } = useQuery({
    queryKey: ['activity', brandId],
    queryFn: () => (brandId ? ActivityService.getAll(brandId) : Promise.resolve([])),
    enabled: !!brandId,
  });

  return { activity, isLoading: isPending };
}

export function useNotifications() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<UserNotification[]>([]);

  useEffect(() => {
    if (!user?.uid) return;
    const unsub = NotificationsService.subscribe(user.uid, setNotifications);
    return unsub;
  }, [user?.uid]);

  const unreadCount = notifications.filter(n => !n.read).length;

  return { notifications, unreadCount };
}
