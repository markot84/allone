/**
 * Firestore security-rules suite — locks in this session's PP-01..16 + FN-A/F
 * fixes against the Firestore emulator (`@firebase/rules-unit-testing` v5).
 *
 * Every collection in PerformancePlus is brand-scoped by a `brandId`; access is
 * gated through the `firestore.rules` helpers `isBrandMember` /
 * `isBrandOwnerOrAdmin` / `canManageBrandConnectors` / `isSuperAdmin` /
 * `roleRank`. The membership model is a per-brand subcollection:
 *   brands/{brandId}/members/{uid} = { userId, role: 'owner'|'admin'|'member' }
 *
 * This file is arrange-act-assert: fixtures (memberships, existing docs) are
 * seeded with rules DISABLED, then reads/writes are probed through authed/unauth
 * handles that ARE rule-checked. It exists to make a future regression (e.g. the
 * 53 stripped `resource==null` guards) turn a test red.
 */
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  doc,
  collection,
  collectionGroup,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  where,
} from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import {
  initEnv,
  cleanupEnv,
  clearFirestore,
  authed,
  unauth,
  seed,
  assertSucceeds,
  assertFails,
} from './helpers';

// ---- Fixed identities reused across tests -------------------------------------------------

const BRAND_A = 'brandA';
const BRAND_B = 'brandB';

const OWNER_A = 'ownerA'; // owner member of BRAND_A
const ADMIN_A = 'adminA'; // admin member of BRAND_A
const MEMBER_A = 'memberA'; // plain member of BRAND_A
const MEMBER_B = 'memberB'; // plain member of BRAND_B
const OUTSIDER = 'outsider'; // belongs to no brand
const SUPER_ADMIN = 'superUid'; // listed in appConfig/superAdmins.uids

// PP-NEW-1: field-keyed (brandId in body) collections added with the merge that
// originally shipped a collapsed `allow update, delete` WITHOUT brandIdUnchanged()
// — i.e. cross-tenant re-homing (PP-04 class). [coll, seededDocId].
const PP_NEW1_COLLECTIONS: ReadonlyArray<readonly [string, string]> = [
  ['offers', 'offerA'],
  ['commercial_actions', 'caA'],
  ['commercial_decision_events', 'cdeA'],
  ['marketing_plans', 'mpA'],
  ['commercial_info', 'ciA'],
  ['commercial_scenario_cache', 'cscA'],
];

// ---- Fixture seeding (admin context, rules disabled) --------------------------------------

/** Seed a brands/{brandId}/members/{uid} doc with the given role. */
async function seedMember(
  db: Firestore,
  brandId: string,
  uid: string,
  role: 'owner' | 'admin' | 'member',
): Promise<void> {
  await setDoc(doc(db, `brands/${brandId}/members/${uid}`), {
    userId: uid,
    role,
  });
}

/**
 * Common world: two brands with their members, a couple of brand-scoped docs in
 * each, the super-admin allowlist, and the appConfig docs.
 */
async function seedBaseWorld(db: Firestore): Promise<void> {
  // Brands. createdBy is set to the owner so canManageBrandConnectors's
  // creator-branch is exercised by the same uid that is also the 'owner' member.
  await setDoc(doc(db, `brands/${BRAND_A}`), { name: 'Brand A', createdBy: OWNER_A });
  await setDoc(doc(db, `brands/${BRAND_B}`), { name: 'Brand B', createdBy: MEMBER_B });

  // Members.
  await seedMember(db, BRAND_A, OWNER_A, 'owner');
  await seedMember(db, BRAND_A, ADMIN_A, 'admin');
  await seedMember(db, BRAND_A, MEMBER_A, 'member');
  await seedMember(db, BRAND_B, MEMBER_B, 'member');

  // Brand-scoped docs (existing) in each brand.
  await setDoc(doc(db, 'products/prodA'), { brandId: BRAND_A, name: 'A product' });
  await setDoc(doc(db, 'products/prodB'), { brandId: BRAND_B, name: 'B product' });
  await setDoc(doc(db, 'campaigns/campA'), { brandId: BRAND_A, name: 'A campaign' });
  await setDoc(doc(db, 'segments/segA'), { brandId: BRAND_A, name: 'A segment' });
  await setDoc(doc(db, `connectors/${BRAND_A}`), { brandId: BRAND_A, shopify: { token: 'x' } });
  await setDoc(doc(db, `connectors/${BRAND_B}`), { brandId: BRAND_B, shopify: { token: 'y' } });

  // PP-NEW-1 collections (field-keyed by brandId) — one existing doc each in BRAND_A.
  for (const [coll, id] of PP_NEW1_COLLECTIONS) {
    await setDoc(doc(db, `${coll}/${id}`), { brandId: BRAND_A, payload: 'A' });
  }

  // User profile docs (for the users read / enumeration tests).
  await setDoc(doc(db, 'users', OWNER_A), { email: 'owner@a.test', brandIds: [BRAND_A] });
  await setDoc(doc(db, 'users', MEMBER_A), { email: 'member@a.test', brandIds: [BRAND_A] });
  await setDoc(doc(db, 'users', MEMBER_B), { email: 'member@b.test', brandIds: [BRAND_B] });

  // Super-admin allowlist.
  await setDoc(doc(db, 'appConfig/superAdmins'), { uids: [SUPER_ADMIN] });
}

// ---- Lifecycle ----------------------------------------------------------------------------

beforeAll(async () => {
  await initEnv();
});

afterAll(async () => {
  await cleanupEnv();
});

beforeEach(async () => {
  await clearFirestore();
  await seed(seedBaseWorld);
});

// ===========================================================================================
// A. resource==null guard (the regression this session restored)
// ===========================================================================================

describe('A. resource==null read guard (restored 53 guards)', () => {
  it('lets an authed user read a NON-existent connector_sync_jobs doc (returns null, not denied)', async () => {
    const db = authed(MEMBER_A);
    // connector_sync_jobs read rule: resource == null || isBrandMember(...).
    await assertSucceeds(getDoc(doc(db, 'connector_sync_jobs/does_not_exist')));
  });

  it('lets an authed user read a NON-existent *_summary doc that was never created', async () => {
    const db = authed(MEMBER_A);
    // ecommerce_summary/{brandId}: read if isBrandMember(brandId). A member of
    // BRAND_A reading their own never-created summary must not be denied.
    await assertSucceeds(getDoc(doc(db, `ecommerce_summary/${BRAND_A}`)));
  });

  it('lets an authed user read a NON-existent brand-scoped products doc', async () => {
    const db = authed(MEMBER_A);
    await assertSucceeds(getDoc(doc(db, 'products/never_created')));
  });

  it('STILL denies a non-member reading an EXISTING doc in another brand', async () => {
    // The null-guard must not have weakened cross-tenant isolation: an existing
    // doc owned by BRAND_B is off-limits to an outsider.
    const db = authed(OUTSIDER);
    await assertFails(getDoc(doc(db, 'products/prodB')));
  });

  it('denies an unauthenticated caller reading even a non-existent brand-scoped doc', async () => {
    // The guards are `request.auth != null && (resource == null || ...)`, so the
    // null path still requires auth.
    const db = unauth();
    await assertFails(getDoc(doc(db, 'products/never_created')));
  });
});

// ===========================================================================================
// B. Core tenant isolation
// ===========================================================================================

describe('B. core tenant isolation by brandId', () => {
  it('lets a BRAND_A member read BRAND_A products / campaigns / segments', async () => {
    const db = authed(MEMBER_A);
    await assertSucceeds(getDoc(doc(db, 'products/prodA')));
    await assertSucceeds(getDoc(doc(db, 'campaigns/campA')));
    await assertSucceeds(getDoc(doc(db, 'segments/segA')));
  });

  it('lets a BRAND_A member read the BRAND_A connectors doc', async () => {
    const db = authed(MEMBER_A);
    await assertSucceeds(getDoc(doc(db, `connectors/${BRAND_A}`)));
  });

  it('denies a BRAND_A member reading BRAND_B products', async () => {
    const db = authed(MEMBER_A);
    await assertFails(getDoc(doc(db, 'products/prodB')));
  });

  it('denies a BRAND_A member reading the BRAND_B connectors doc', async () => {
    const db = authed(MEMBER_A);
    await assertFails(getDoc(doc(db, `connectors/${BRAND_B}`)));
  });

  it('denies a BRAND_B member reading BRAND_A campaigns', async () => {
    const db = authed(MEMBER_B);
    await assertFails(getDoc(doc(db, 'campaigns/campA')));
  });
});

// ===========================================================================================
// C. PP-01 — invites are not enumerable
// ===========================================================================================

describe('C. PP-01 invites: no enumeration', () => {
  beforeEach(async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'invites/inv_token123'), {
        brandId: BRAND_A,
        email: 'invitee@example.com',
        role: 'member',
      });
    });
  });

  it('denies LISTING the invites collection for an unauthenticated caller', async () => {
    const db = unauth();
    await assertFails(getDocs(collection(db, 'invites')));
  });

  it('denies LISTING the invites collection for an authenticated non-privileged user', async () => {
    const db = authed(OUTSIDER);
    await assertFails(getDocs(collection(db, 'invites')));
  });

  it('allows a single get of an invite by id (the link-holder access path)', async () => {
    // The rule is `allow get: if true;` — the unguessable id is the access control.
    const db = authed(OUTSIDER);
    await assertSucceeds(getDoc(doc(db, 'invites/inv_token123')));
  });
});

// ===========================================================================================
// D. PP-06 — shared_packages are not enumerable
// ===========================================================================================

describe('D. PP-06 shared_packages: no enumeration', () => {
  beforeEach(async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'shared_packages/pkg_abc'), {
        createdBy: OWNER_A,
        payload: { foo: 'bar' },
      });
    });
  });

  it('denies LISTING shared_packages for a non-member / outsider', async () => {
    const db = authed(OUTSIDER);
    await assertFails(getDocs(collection(db, 'shared_packages')));
  });

  it('denies LISTING shared_packages for an unauthenticated caller', async () => {
    const db = unauth();
    await assertFails(getDocs(collection(db, 'shared_packages')));
  });

  it('allows a single get of a shared package by id (the share-link path)', async () => {
    const db = authed(OUTSIDER);
    await assertSucceeds(getDoc(doc(db, 'shared_packages/pkg_abc')));
  });
});

// ===========================================================================================
// E. PP-09 — appConfig/superAdmins is super-admin-read-only
// ===========================================================================================

describe('E. PP-09 appConfig/superAdmins read lock', () => {
  it('denies a NON-superadmin authenticated user reading appConfig/superAdmins', async () => {
    const db = authed(MEMBER_A);
    await assertFails(getDoc(doc(db, 'appConfig/superAdmins')));
  });

  it('denies the appConfig wildcard from leaking superAdmins to an authed user', async () => {
    // Belt-and-braces: the wildcard `appConfig/{docId}` explicitly excludes
    // 'superAdmins'. An owner is still a normal user here.
    const db = authed(OWNER_A);
    await assertFails(getDoc(doc(db, 'appConfig/superAdmins')));
  });

  it('allows a super-admin to read appConfig/superAdmins', async () => {
    const db = authed(SUPER_ADMIN);
    await assertSucceeds(getDoc(doc(db, 'appConfig/superAdmins')));
  });
});

// ===========================================================================================
// E2. appConfig/superAdmins WRITE lock — only a super-admin may grant/revoke super-admin.
// Locks the privilege-escalation gate behind the "make a user superadmin in UI" feature
// (e0755a9): the UI writes this doc directly, so the rule is the only thing stopping a
// normal user from self-granting. Verified live (non-super write -> 403); pinned here.
// ===========================================================================================

describe('E2. appConfig/superAdmins write lock (privilege-escalation gate)', () => {
  it('denies a non-super-admin writing appConfig/superAdmins (self-grant blocked)', async () => {
    const db = authed(OWNER_A); // a brand owner is still a normal user at the platform level
    await assertFails(
      updateDoc(doc(db, 'appConfig/superAdmins'), { uids: [SUPER_ADMIN, OWNER_A] }),
    );
  });

  it('denies an unauthenticated write to appConfig/superAdmins', async () => {
    const db = unauth();
    await assertFails(
      setDoc(doc(db, 'appConfig/superAdmins'), { uids: [OUTSIDER] }),
    );
  });

  it('allows a super-admin to grant a new super-admin', async () => {
    const db = authed(SUPER_ADMIN);
    await assertSucceeds(
      updateDoc(doc(db, 'appConfig/superAdmins'), { uids: [SUPER_ADMIN, MEMBER_A] }),
    );
  });
});

// ===========================================================================================
// E3. users read + enumeration lock — own profile only; cross-user read and full-collection
// enumeration are super-admin-only. Locks the user-listing gate behind the new admin panel
// (e0755a9): a normal user must not be able to harvest the user directory. Verified live
// (non-super list -> 403); pinned here.
// ===========================================================================================

describe('E3. users read + enumeration lock', () => {
  it('allows a user to read their OWN users/{uid} doc', async () => {
    const db = authed(MEMBER_A);
    await assertSucceeds(getDoc(doc(db, 'users', MEMBER_A)));
  });

  it('denies a user reading ANOTHER user doc', async () => {
    const db = authed(MEMBER_A);
    await assertFails(getDoc(doc(db, 'users', MEMBER_B)));
  });

  it('denies a non-super-admin enumerating the whole users collection', async () => {
    const db = authed(OWNER_A);
    await assertFails(getDocs(collection(db, 'users')));
  });

  it('allows a super-admin to read another user doc and enumerate users', async () => {
    const db = authed(SUPER_ADMIN);
    await assertSucceeds(getDoc(doc(db, 'users', MEMBER_B)));
    await assertSucceeds(getDocs(collection(db, 'users')));
  });
});

// ===========================================================================================
// F. PP-02 / PP-03 — self-join & invite-forge are blocked
// ===========================================================================================

describe('F. PP-02/03 self-join and invite forging', () => {
  it('denies an outsider self-creating a member doc to join a brand', async () => {
    const db = authed(OUTSIDER);
    // create allowed only for the brand CREATOR claiming their own 'owner' doc
    // (or super-admin). OUTSIDER is neither.
    await assertFails(
      setDoc(doc(db, `brands/${BRAND_A}/members/${OUTSIDER}`), {
        userId: OUTSIDER,
        role: 'owner',
      }),
    );
  });

  it('denies an outsider self-creating a member doc even as plain member role', async () => {
    const db = authed(OUTSIDER);
    await assertFails(
      setDoc(doc(db, `brands/${BRAND_A}/members/${OUTSIDER}`), {
        userId: OUTSIDER,
        role: 'member',
      }),
    );
  });

  it('denies a BRAND_B member self-joining BRAND_A as owner', async () => {
    const db = authed(MEMBER_B);
    await assertFails(
      setDoc(doc(db, `brands/${BRAND_A}/members/${MEMBER_B}`), {
        userId: MEMBER_B,
        role: 'owner',
      }),
    );
  });

  it('denies an outsider forging an invite for a brand they cannot manage', async () => {
    const db = authed(OUTSIDER);
    // invite create requires isBrandMember(brandId); OUTSIDER is not a member of A.
    await assertFails(
      setDoc(doc(db, 'invites/inv_forged'), {
        brandId: BRAND_A,
        email: 'attacker@example.com',
        role: 'member',
      }),
    );
  });
});

// ===========================================================================================
// G. PP-04 — brandId is immutable on update
// ===========================================================================================

describe('G. PP-04 brandId immutability on update', () => {
  it('denies a member re-homing a doc to another brand by changing brandId', async () => {
    const db = authed(MEMBER_A);
    // brandIdUnchanged() pins request.resource.data.brandId == resource.data.brandId.
    await assertFails(
      updateDoc(doc(db, 'products/prodA'), { brandId: BRAND_B }),
    );
  });

  it('allows a member updating other fields while keeping brandId the same', async () => {
    const db = authed(MEMBER_A);
    await assertSucceeds(
      updateDoc(doc(db, 'products/prodA'), { name: 'renamed', brandId: BRAND_A }),
    );
  });

  it('denies changing brandId even when the new brand is also one the user belongs to', async () => {
    // Seed a user who is a member of BOTH brands, then try to move prodA → BRAND_B.
    await seed(async (db) => {
      await seedMember(db, BRAND_B, MEMBER_A, 'member');
    });
    const db = authed(MEMBER_A);
    await assertFails(
      updateDoc(doc(db, 'products/prodA'), { brandId: BRAND_B }),
    );
  });
});

// ===========================================================================================
// G2. PP-NEW-1 — brandId immutability on the merge-added commercial_*/offers/marketing_plans
// collections (regression: they shipped a collapsed `update, delete` without brandIdUnchanged).
// ===========================================================================================

describe('G2. PP-NEW-1 brandId immutability on merge-added collections', () => {
  for (const [coll, id] of PP_NEW1_COLLECTIONS) {
    it(`${coll}: denies a member re-homing a doc to another brand`, async () => {
      const db = authed(MEMBER_A);
      await assertFails(
        updateDoc(doc(db, `${coll}/${id}`), { brandId: BRAND_B }),
      );
    });

    it(`${coll}: allows a member updating other fields while keeping brandId`, async () => {
      const db = authed(MEMBER_A);
      await assertSucceeds(
        updateDoc(doc(db, `${coll}/${id}`), { payload: 'A-renamed', brandId: BRAND_A }),
      );
    });
  }
});

// ===========================================================================================
// H. PP-05 + FN-A — member role-change rules (escalation / demotion / cross-member)
// ===========================================================================================

describe('H. PP-05 / FN-A member role mutation', () => {
  it('denies an admin self-escalating to owner (admin -> owner)', async () => {
    const db = authed(ADMIN_A);
    await assertFails(
      updateDoc(doc(db, `brands/${BRAND_A}/members/${ADMIN_A}`), { role: 'owner' }),
    );
  });

  it('denies a plain member self-escalating to admin (member -> admin)', async () => {
    const db = authed(MEMBER_A);
    // isBrandOwnerOrAdmin is false for a plain member, and the self-branch
    // forbids any change that touches `role`.
    await assertFails(
      updateDoc(doc(db, `brands/${BRAND_A}/members/${MEMBER_A}`), { role: 'admin' }),
    );
  });

  it('allows an owner self-demoting (owner -> admin) for ownership handoff', async () => {
    const db = authed(OWNER_A);
    await assertSucceeds(
      updateDoc(doc(db, `brands/${BRAND_A}/members/${OWNER_A}`), { role: 'admin' }),
    );
  });

  it("allows an owner changing ANOTHER member's role (member -> admin)", async () => {
    const db = authed(OWNER_A);
    await assertSucceeds(
      updateDoc(doc(db, `brands/${BRAND_A}/members/${MEMBER_A}`), { role: 'admin' }),
    );
  });

  it("allows an admin changing ANOTHER member's role (member -> admin)", async () => {
    const db = authed(ADMIN_A);
    await assertSucceeds(
      updateDoc(doc(db, `brands/${BRAND_A}/members/${MEMBER_A}`), { role: 'admin' }),
    );
  });

  it('allows a plain member updating their own non-role fields', async () => {
    const db = authed(MEMBER_A);
    await assertSucceeds(
      updateDoc(doc(db, `brands/${BRAND_A}/members/${MEMBER_A}`), { department: 'sales' }),
    );
  });
});

// ===========================================================================================
// I. FN-F — invite create gating (membership + role escalation)
// ===========================================================================================

describe('I. FN-F invite create gating', () => {
  it('denies a NON-member creating an invite for a brand', async () => {
    const db = authed(OUTSIDER);
    await assertFails(
      setDoc(doc(db, 'invites/inv_x1'), {
        brandId: BRAND_A,
        email: 'x@example.com',
        role: 'member',
      }),
    );
  });

  it("allows a plain member creating a role:'member' invite for their own brand", async () => {
    const db = authed(MEMBER_A);
    await assertSucceeds(
      setDoc(doc(db, 'invites/inv_x2'), {
        brandId: BRAND_A,
        email: 'newteammate@example.com',
        role: 'member',
      }),
    );
  });

  it("denies a plain member creating a role:'admin' invite (no escalation-by-invite)", async () => {
    const db = authed(MEMBER_A);
    await assertFails(
      setDoc(doc(db, 'invites/inv_x3'), {
        brandId: BRAND_A,
        email: 'elevated@example.com',
        role: 'admin',
      }),
    );
  });

  it("allows an admin creating a role:'admin' invite for their own brand", async () => {
    const db = authed(ADMIN_A);
    await assertSucceeds(
      setDoc(doc(db, 'invites/inv_x4'), {
        brandId: BRAND_A,
        email: 'newadmin@example.com',
        role: 'admin',
      }),
    );
  });

  it("allows an owner creating a role:'admin' invite for their own brand", async () => {
    const db = authed(OWNER_A);
    await assertSucceeds(
      setDoc(doc(db, 'invites/inv_x5'), {
        brandId: BRAND_A,
        email: 'anotheradmin@example.com',
        role: 'admin',
      }),
    );
  });
});

// ===========================================================================================
// J. Collection-group members query (sign-in brand discovery) — sanity that isolation holds
// ===========================================================================================

describe('J. collectionGroup(members) self-scoped query', () => {
  it('lets a user run the sign-in CG query scoped to their OWN uid', async () => {
    // The /{path=**}/members rule allows a CG read only where userId == auth.uid.
    // This is the exact query the SPA runs on sign-in to discover its brands.
    const db = authed(MEMBER_A);
    const q = query(
      collectionGroup(db, 'members'),
      where('userId', '==', MEMBER_A),
    );
    await assertSucceeds(getDocs(q));
  });

  it("denies a CG members query scoped to ANOTHER user's uid", async () => {
    // The CG rule only allows reads where resource.data.userId == auth.uid, so a
    // cross-user collection-group scan is rejected.
    const db = authed(MEMBER_A);
    const q = query(
      collectionGroup(db, 'members'),
      where('userId', '==', OWNER_A),
    );
    await assertFails(getDocs(q));
  });

  it('denies an unscoped CG members scan (enumerating every brand membership)', async () => {
    const db = authed(MEMBER_A);
    await assertFails(getDocs(collectionGroup(db, 'members')));
  });
});

// ===========================================================================================
// K. SEC-M2 — brand.createdBy is immutable on update (persistent-backdoor block)
//    createdBy is trusted as a membership/ownership signal (isBrandMember / isBrandOwnerOrAdmin
//    / Storage rules). It was mutable on update, letting an owner/admin re-point it and keep
//    access after removal. The update rule now pins createdBy == resource.data.createdBy.
// ===========================================================================================

describe('K. SEC-M2 brand.createdBy immutable on update', () => {
  it('lets an owner update a brand field without touching createdBy', async () => {
    const db = authed(OWNER_A);
    await assertSucceeds(updateDoc(doc(db, `brands/${BRAND_A}`), { name: 'Brand A renamed' }));
  });

  it('denies an owner changing brand.createdBy', async () => {
    const db = authed(OWNER_A);
    await assertFails(updateDoc(doc(db, `brands/${BRAND_A}`), { createdBy: 'attackerUid' }));
  });

  it('denies an admin changing brand.createdBy (even to their own uid)', async () => {
    const db = authed(ADMIN_A);
    await assertFails(updateDoc(doc(db, `brands/${BRAND_A}`), { createdBy: ADMIN_A }));
  });
});

// ===========================================================================================
// L. SEC-M10 — member create pins request.resource.data.userId == auth.uid
//    The create rule pinned the doc id (memberId == auth.uid) but not the userId FIELD, so a
//    brand creator could mint a member doc carrying another user's userId — which the
//    collection-group `where userId == X` query then surfaces in the victim's brand list.
// ===========================================================================================

describe('L. SEC-M10 member create userId pin', () => {
  const BRAND_C = 'brandC';
  const CREATOR_C = 'creatorC';

  beforeEach(async () => {
    // A brand whose creator has NOT yet self-provisioned a members doc (so `create` fires).
    await seed(async (db) => {
      await setDoc(doc(db, `brands/${BRAND_C}`), { name: 'Brand C', createdBy: CREATOR_C });
    });
  });

  it('lets the brand creator self-provision an owner member with their OWN userId', async () => {
    const db = authed(CREATOR_C);
    await assertSucceeds(
      setDoc(doc(db, `brands/${BRAND_C}/members/${CREATOR_C}`), { userId: CREATOR_C, role: 'owner' }),
    );
  });

  it('denies a member-create whose userId payload is a DIFFERENT uid (CG-query spoofing)', async () => {
    const db = authed(CREATOR_C);
    await assertFails(
      setDoc(doc(db, `brands/${BRAND_C}/members/${CREATOR_C}`), { userId: OUTSIDER, role: 'owner' }),
    );
  });
});
