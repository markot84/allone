import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  query, where, orderBy, Timestamp, onSnapshot, type Unsubscribe
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { db } from '../config/firebase';
import type {
  BrandMember, BrandDepartment, Decision, CoordinationTask, CoordinationComment,
  ActivityEntry, UserNotification, ActivityType,
  NotificationPreferences, NotificationChannel
} from '../types';
import { DEFAULT_NOTIFICATION_CHANNELS, DEPARTMENT_LABELS, normalizeBrandMemberRole } from '../types';

const ts = () => new Date().toISOString();
const FUNCTIONS_REGION = import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION || 'europe-west1';
const FUNCTIONS_PROJECT =
  import.meta.env.VITE_FIREBASE_PROJECT_ID || 'performance-plus-4a5b2';
const FUNCTIONS_BASE =
  import.meta.env.VITE_FUNCTIONS_BASE_URL ||
  `https://${FUNCTIONS_REGION}-${FUNCTIONS_PROJECT}.cloudfunctions.net`;

// ── Members ─────────────────────────────────────────────────────────────────

export const MembersService = {
  async getAll(brandId: string): Promise<BrandMember[]> {
    const q = query(collection(db, 'brands', brandId, 'members'));
    const snap = await getDocs(q);
    return snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        ...data,
        role: normalizeBrandMemberRole(data.role),
      } as BrandMember;
    });
  },

  async get(brandId: string, userId: string): Promise<BrandMember | null> {
    const ref = doc(db, 'brands', brandId, 'members', userId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const data = snap.data();
    return { id: snap.id, ...data, role: normalizeBrandMemberRole(data.role) } as BrandMember;
  },

  async set(brandId: string, member: Omit<BrandMember, 'id'>): Promise<void> {
    const ref = doc(db, 'brands', brandId, 'members', member.userId);
    await setDoc(ref, { ...member, id: member.userId, updatedAt: Timestamp.now() }, { merge: true });
  },

  async updateRole(brandId: string, userId: string, role: BrandMember['role']): Promise<void> {
    const ref = doc(db, 'brands', brandId, 'members', userId);
    await updateDoc(ref, { role, updatedAt: Timestamp.now() });
  },

  async updateDepartment(brandId: string, userId: string, department: BrandDepartment): Promise<void> {
    const ref = doc(db, 'brands', brandId, 'members', userId);
    await updateDoc(ref, {
      department,
      departmentLabel: DEPARTMENT_LABELS[department],
      updatedAt: Timestamp.now(),
    });
  },

  async remove(brandId: string, userId: string): Promise<void> {
    await deleteDoc(doc(db, 'brands', brandId, 'members', userId));
  },
};

// ── Decisions ───────────────────────────────────────────────────────────────

export const DecisionsService = {
  async getAll(brandId: string): Promise<Decision[]> {
    const q = query(
      collection(db, 'decisions'),
      where('brandId', '==', brandId)
    );
    const snap = await getDocs(q);
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() }) as Decision)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },

  async get(id: string): Promise<Decision | null> {
    const snap = await getDoc(doc(db, 'decisions', id));
    return snap.exists() ? { id: snap.id, ...snap.data() } as Decision : null;
  },

  async create(data: Omit<Decision, 'id' | 'createdAt' | 'updatedAt' | 'commentCount' | 'taskCount'>): Promise<string> {
    const id = `dec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = ts();
    const decision: Decision = { ...data, id, createdAt: now, updatedAt: now, commentCount: 0, taskCount: 0 };
    await setDoc(doc(db, 'decisions', id), decision);
    return id;
  },

  async update(id: string, data: Partial<Decision>): Promise<void> {
    await updateDoc(doc(db, 'decisions', id), { ...data, updatedAt: ts() });
  },

  async remove(id: string): Promise<void> {
    await deleteDoc(doc(db, 'decisions', id));
  },
};

// ── Tasks ───────────────────────────────────────────────────────────────────

export const TasksService = {
  async getAll(brandId: string): Promise<CoordinationTask[]> {
    const q = query(
      collection(db, 'tasks'),
      where('brandId', '==', brandId)
    );
    const snap = await getDocs(q);
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() }) as CoordinationTask)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },

  async create(data: Omit<CoordinationTask, 'id' | 'createdAt' | 'updatedAt' | 'commentCount'>): Promise<string> {
    const id = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = ts();
    const task: CoordinationTask = { ...data, id, createdAt: now, updatedAt: now, commentCount: 0 };
    await setDoc(doc(db, 'tasks', id), task);
    return id;
  },

  async update(id: string, data: Partial<CoordinationTask>): Promise<void> {
    await updateDoc(doc(db, 'tasks', id), { ...data, updatedAt: ts() });
  },

  async remove(id: string): Promise<void> {
    await deleteDoc(doc(db, 'tasks', id));
  },
};

// ── Comments ────────────────────────────────────────────────────────────────

export const CommentsService = {
  async getForEntity(brandId: string, entityType: string, entityId: string): Promise<CoordinationComment[]> {
    const q = query(
      collection(db, 'comments'),
      where('brandId', '==', brandId),
      where('entityId', '==', entityId)
    );
    const snap = await getDocs(q);
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() }) as CoordinationComment)
      .filter(c => c.entityType === entityType)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  },

  async create(data: Omit<CoordinationComment, 'id' | 'createdAt'>): Promise<string> {
    const id = `cmt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const comment: CoordinationComment = { ...data, id, createdAt: ts() };
    await setDoc(doc(db, 'comments', id), comment);
    return id;
  },

  async remove(id: string): Promise<void> {
    await deleteDoc(doc(db, 'comments', id));
  },
};

// ── Activity Feed ───────────────────────────────────────────────────────────

export const ActivityService = {
  async getAll(brandId: string, limitCount = 50): Promise<ActivityEntry[]> {
    const q = query(
      collection(db, 'activity'),
      where('brandId', '==', brandId)
    );
    const snap = await getDocs(q);
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() }) as ActivityEntry)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limitCount);
  },

  async log(data: Omit<ActivityEntry, 'id' | 'createdAt'>): Promise<void> {
    const id = `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await setDoc(doc(db, 'activity', id), { ...data, id, createdAt: ts() });
  },
};

// ── Notifications ───────────────────────────────────────────────────────────

export const NotificationsService = {
  subscribe(userId: string, callback: (notifs: UserNotification[]) => void): Unsubscribe {
    const q = query(
      collection(db, 'users', userId, 'notifications'),
      orderBy('createdAt', 'desc')
    );
    return onSnapshot(q, snap => {
      callback(snap.docs.map(d => ({ id: d.id, ...d.data() }) as UserNotification));
    }, (error) => {
      console.warn('Notifications listener error:', error);
      callback([]);
    });
  },

  async markRead(userId: string, notifId: string): Promise<void> {
    await updateDoc(doc(db, 'users', userId, 'notifications', notifId), { read: true });
  },

  async markAllRead(userId: string): Promise<void> {
    const q = query(
      collection(db, 'users', userId, 'notifications'),
      where('read', '==', false)
    );
    const snap = await getDocs(q);
    const promises = snap.docs.map(d => updateDoc(d.ref, { read: true }));
    await Promise.all(promises);
  },

  async send(userId: string, data: Omit<UserNotification, 'id' | 'createdAt' | 'read'>): Promise<void> {
    const id = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await setDoc(doc(db, 'users', userId, 'notifications', id), {
      ...data, id, read: false, createdAt: ts(),
    });
  },
};

// ── Notification Preferences ────────────────────────────────────────────────

export const NotificationPrefsService = {
  async get(brandId: string, userId: string): Promise<NotificationPreferences | null> {
    const ref = doc(db, 'brands', brandId, 'members', userId, 'settings', 'notifications');
    const snap = await getDoc(ref);
    return snap.exists() ? snap.data() as NotificationPreferences : null;
  },

  async save(brandId: string, userId: string, prefs: Partial<NotificationPreferences>): Promise<void> {
    const ref = doc(db, 'brands', brandId, 'members', userId, 'settings', 'notifications');
    await setDoc(ref, { ...prefs, userId, brandId, updatedAt: new Date().toISOString() }, { merge: true });
  },

  getChannelsFor(prefs: NotificationPreferences | null, type: ActivityType): NotificationChannel[] {
    if (!prefs?.channels) return DEFAULT_NOTIFICATION_CHANNELS[type] ?? ['inApp'];
    return prefs.channels[type] ?? DEFAULT_NOTIFICATION_CHANNELS[type] ?? ['inApp'];
  },

  /** Προτιμήσεις ειδοποιήσεων όλων των μελών του brand (για πίνακα διαχείρισης). */
  async listMemberPrefs(brandId: string, members: BrandMember[]): Promise<{ member: BrandMember; prefs: NotificationPreferences | null }[]> {
    return Promise.all(
      members.map(async (member) => ({
        member,
        prefs: await this.get(brandId, member.userId),
      }))
    );
  },
};

// ── Helpers: broadcast notifications to relevant members ────────────────────

export type BroadcastResult = {
  /** Άλλα μέλη που έλαβαν in-app ειδοποίηση */
  inAppRecipients: number;
  /** Άλλα μέλη με ενεργό κανάλι email για αυτό το event */
  emailRecipients: number;
  emailSent: number;
  emailFailed: number;
};

export async function broadcastNotification(
  brandId: string,
  excludeUserId: string,
  data: Omit<UserNotification, 'id' | 'createdAt' | 'read'>,
  targetDepartments?: BrandDepartment[],
  /** Αν δοθεί, αποφεύγεται δεύτερο getAll (π.χ. από BriefingDrawer με cached members). */
  membersOverride?: BrandMember[]
): Promise<BroadcastResult> {
  const members = membersOverride ?? (await MembersService.getAll(brandId));
  const targets = members.filter(m => {
    if (m.userId === excludeUserId) return false;
    if (targetDepartments && targetDepartments.length > 0) {
      const dept = m.department ?? 'other';
      return targetDepartments.includes(dept);
    }
    return true;
  });

  // Load preferences per member and route accordingly
  const prefsMap = await Promise.all(
    targets.map(async m => ({
      member: m,
      prefs: await NotificationPrefsService.get(brandId, m.userId).catch(() => null),
    }))
  );

  const inAppTargets: string[] = [];
  const emailTargets: string[] = [];

  for (const { member, prefs } of prefsMap) {
    const channels = NotificationPrefsService.getChannelsFor(prefs, data.type);
    if (channels.includes('inApp')) inAppTargets.push(member.userId);
    if (channels.includes('email')) emailTargets.push(member.userId);
  }

  if (inAppTargets.length > 0) {
    await Promise.all(inAppTargets.map(uid => NotificationsService.send(uid, data)));
  }

  let emailSent = 0;
  let emailFailed = 0;
  if (emailTargets.length > 0) {
    // Περιμένουμε το αποτέλεσμα ώστε ο caller να γνωρίζει αν τα email όντως στάλθηκαν.
    const emailResult = await sendEmailNotifications(emailTargets, data);
    emailSent = emailResult.sent;
    emailFailed = emailResult.failed;
    if (emailFailed > 0) {
      console.warn('sendEmailNotification: κάποια email απέτυχαν', emailResult);
    }
  }

  return {
    inAppRecipients: inAppTargets.length,
    emailRecipients: emailTargets.length,
    emailSent,
    emailFailed,
  };
}

async function sendEmailNotifications(
  userIds: string[],
  data: Omit<UserNotification, 'id' | 'createdAt' | 'read'>
): Promise<{ sent: number; failed: number }> {
  if (userIds.length === 0) return { sent: 0, failed: 0 };
  try {
    const auth = getAuth();
    const token = await auth.currentUser?.getIdToken();
    if (!token) {
      console.warn('sendEmailNotification: no auth token');
      return { sent: 0, failed: userIds.length };
    }

    const endpoint = `${FUNCTIONS_BASE}/sendEmailNotification`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        userIds,
        title: data.title,
        body: data.body,
        type: data.type,
        brandId: data.brandId,
        entityType: data.entityType,
        entityId: data.entityId,
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.warn('sendEmailNotification HTTP', res.status, errText);
      return { sent: 0, failed: userIds.length };
    }
    const json = (await res.json()) as { ok?: boolean; results?: string[] };
    const lines = json.results ?? [];
    let sent = 0;
    let failed = 0;
    for (const line of lines) {
      if (line.includes(': sent')) sent += 1;
      else if (line.includes(': failed')) failed += 1;
    }
    if (lines.length === 0 && userIds.length > 0) {
      return { sent: 0, failed: userIds.length };
    }
    return { sent, failed };
  } catch (e) {
    console.warn('Email notification failed (non-critical):', e);
    return { sent: 0, failed: userIds.length };
  }
}

export async function logAndNotify(
  brandId: string,
  actorId: string,
  actorName: string,
  type: ActivityType,
  entityType: string,
  entityId: string,
  summary: string,
  notifTitle: string,
  notifBody: string,
  targetDepartments?: BrandDepartment[],
  membersOverride?: BrandMember[]
): Promise<BroadcastResult> {
  await ActivityService.log({ brandId, type, actorId, actorName, entityType, entityId, summary });
  return broadcastNotification(brandId, actorId, {
    brandId, type, title: notifTitle, body: notifBody, entityType, entityId,
  }, targetDepartments, membersOverride);
}
