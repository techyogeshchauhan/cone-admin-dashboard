import { auth, db } from "./firebase.js";
import { assertControlAuthority } from "./control.js";
import { checkAdminChange } from "../shared/control.js";
import type { Actor } from "../shared/schema.js";
function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}
export async function deleteDashboardUser(
  actor: Actor,
  uid: string,
  version: number,
) {
  if (actor.role !== "superadmin") fail("Super Admin access required", 403);
  if (uid === actor.uid) fail("You cannot delete your own account");
  const ref = db.doc(`adminUsers/${uid}`);
  const done = await db.runTransaction(async (tx) => {
    const lock = await assertControlAuthority(tx, actor);
    const [snapshot, admins] = await Promise.all([
      tx.get(ref),
      tx.get(
        db
          .collection("adminUsers")
          .where("accessRole", "==", "superadmin")
          .where("status", "==", "active")
          .limit(1000),
      ),
    ]);
    const old = snapshot.data();
    if (!old) fail("Dashboard account not found", 404);
    if (old.deletedAt) return true;
    if ((old.version || 1) !== version)
      fail("Account changed. Reload before deleting.", 409);
    try {
      checkAdminChange(
        actor.uid,
        uid,
        old.accessRole,
        old.accessRole,
        "disabled",
        old.isTestAccount
          ? admins.size
          : admins.docs.filter((d) => !d.data().isTestAccount).length,
        old.status,
      );
    } catch (error) {
      fail((error as Error).message);
    }
    tx.set(lock.ref, { version: lock.version });
    tx.update(ref, {
      status: "disabled",
      deletionPending: true,
      version: version + 1,
      updatedAt: new Date().toISOString(),
      updatedBy: actor.uid,
    });
    return false;
  });
  if (done) return { deleted: true };
  try {
    await auth.updateUser(uid, { disabled: true });
    await auth.revokeRefreshTokens(uid);
    await auth.deleteUser(uid);
  } catch (error) {
    if ((error as { code?: string }).code !== "auth/user-not-found")
      fail(
        "Account access is disabled, but Firebase deletion failed. Reload and retry Delete.",
        503,
      );
  }
  await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const data = snapshot.data();
    if (data?.deletedAt) return;
    if (!data?.deletionPending)
      fail("Deletion state changed. Reload this account.", 409);
    const now = new Date().toISOString();
    tx.update(ref, {
      status: "deleted",
      archivedAt: now,
      deletedAt: now,
      deletedBy: actor.uid,
      deletionPending: false,
      version: (data.version || 1) + 1,
    });
    tx.create(db.collection("auditLogs").doc(), {
      actorUid: actor.uid,
      actorName: actor.fullName,
      action: "user.delete",
      target: uid,
      createdAt: now,
    });
  });
  return { deleted: true };
}
