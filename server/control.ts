import { deleteDashboardUser } from "./delete-user.js";
import { personDefaults, developmentVerificationBypass } from "./accounts.js";
import { Router } from "express";
import type { Request } from "express";
import type { Transaction } from "firebase-admin/firestore";
import { statfs } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { auth, db } from "./firebase.js";
import { type Actor, accessRoles, userSchema } from "../shared/schema.js";
import {
  roleId,
  roleDefinitionSchema,
  resolveRole,
  defaultRole,
  runtimeSchema,
  runtimeDefaults,
  checkAdminChange,
} from "../shared/control.js";

const actorOf = (req: Request) => (req as Request & { actor: Actor }).actor;
function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}
const uidSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[^/]+$/);
export async function runtimeConfiguration() {
  const value = (await db.doc("applicationSettings/runtime").get()).data();
  const parsed = runtimeSchema.safeParse({ ...runtimeDefaults, ...value });
  return parsed.success ? parsed.data : runtimeDefaults;
}
export async function assertControlAuthority(tx: Transaction, actor: Actor) {
  const [owner, lock] = await Promise.all([
    tx.get(db.doc(`adminUsers/${actor.uid}`)),
    tx.get(db.doc("applicationSettings/securityLock")),
  ]);
  if (
    owner.data()?.accessRole !== "superadmin" ||
    owner.data()?.status !== "active"
  )
    fail("Your Super Admin access has changed. Sign in again.", 403);
  return {
    ref: db.doc("applicationSettings/securityLock"),
    version: Number(lock.data()?.version || 0) + 1,
  };
}
function log(
  tx: Transaction,
  actor: Actor,
  action: string,
  target: string,
  details: Record<string, unknown> = {},
) {
  tx.create(db.collection("auditLogs").doc(), {
    actorUid: actor.uid,
    actorName: actor.fullName,
    action,
    target,
    details,
    conferenceId: "main",
    createdAt: new Date().toISOString(),
  });
}
export async function saveDashboardUser(
  actor: Actor,
  input: { id?: string; version?: number; data: z.infer<typeof userSchema> },
) {
  const account = await auth.getUserByEmail(input.data.email);
  if (input.id && input.id !== account.uid)
    fail("Email changes require an identity migration");
  const ref = db.doc(`adminUsers/${account.uid}`);
  let revoke = false;
  await db.runTransaction(async (tx) => {
    const lock = await assertControlAuthority(tx, actor);
    const personRef = db.doc(`people/${input.data.email}`);
    const [old, role, admins, person] = await Promise.all([
      tx.get(ref),
      tx.get(db.doc(`roleDefinitions/${input.data.accessRole}`)),
      tx.get(
        db
          .collection("adminUsers")
          .where("accessRole", "==", "superadmin")
          .where("status", "==", "active")
          .limit(1000),
      ),
      tx.get(personRef),
    ]);
    if (old.data()?.deletionPending || old.data()?.deletedAt)
      fail("This account is being deleted or has been deleted", 409);
    if (resolveRole(input.data.accessRole, role.data()) === null)
      fail("Choose an active role from Roles & permissions");
    if (
      old.exists &&
      (!input.id || input.version !== (old.data()?.version || 1))
    )
      fail("Account changed. Reload before saving.", 409);
    if (!old.exists && input.id && input.version !== 0)
      fail("Dashboard account not found", 404);
    try {
      checkAdminChange(
        actor.uid,
        account.uid,
        old.data()?.accessRole,
        input.data.accessRole,
        input.data.status,
        old.data()?.isTestAccount === true
          ? admins.size
          : admins.docs.filter((doc) => doc.data().isTestAccount !== true)
              .length,
        old.data()?.status,
      );
    } catch (error) {
      fail((error as Error).message);
    }
    revoke =
      input.data.status === "disabled" ||
      old.data()?.authSyncPending === true ||
      (!!old.exists &&
        (old.data()?.accessRole !== input.data.accessRole ||
          old.data()?.status !== input.data.status));
    tx.set(lock.ref, { version: lock.version });
    tx.set(
      ref,
      {
        ...input.data,
        archivedAt: null,
        version: (old.data()?.version || 0) + 1,
        updatedBy: actor.uid,
        updatedAt: new Date().toISOString(),
        authSyncPending: true,
        ...(!old.exists
          ? { createdBy: actor.uid, createdAt: new Date().toISOString() }
          : {}),
      },
      { merge: true },
    );
    tx.set(
      personRef,
      {
        ...(!person.exists ? personDefaults() : {}),
        fullName: input.data.fullName,
        email: input.data.email,
        mobile: input.data.mobile,
        version: (person.data()?.version || 0) + 1,
        updatedBy: actor.uid,
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );
    log(tx, actor, "user.access.update", account.uid, {
      previousRole: old.data()?.accessRole || null,
      nextRole: input.data.accessRole,
      status: input.data.status,
    });
  });
  try {
    await auth.updateUser(account.uid, {
      disabled: input.data.status === "disabled",
    });
    if (revoke) await auth.revokeRefreshTokens(account.uid);
    await ref.update({ authSyncPending: false });
  } catch {
    fail(
      "Dashboard access was saved, but Firebase Auth synchronization needs retrying. Save the account again or use Enable/Disable in Control Center.",
      503,
    );
  }
  return { id: account.uid };
}
export const controlRouter = Router();
controlRouter.use((req, _res, next) => {
  const actor = actorOf(req);
  if (actor.role !== "superadmin")
    return next(
      Object.assign(new Error("Super Admin access required"), { status: 403 }),
    );
  if (req.method !== "GET" && Date.now() / 1000 - (actor.authTime || 0) > 300)
    return next(
      Object.assign(
        new Error("Sign out and sign in again before this sensitive action"),
        { status: 403 },
      ),
    );
  next();
});
controlRouter.post("/users/:uid/delete", async (req, res) => {
  const uid = uidSchema.parse(req.params.uid);
  const { version } = z
    .object({ version: z.number().int().min(1) })
    .strict()
    .parse(req.body);
  res.json(await deleteDashboardUser(actorOf(req), uid, version));
});
controlRouter.get("/roles", async (_req, res) => {
  const saved = await db.collection("roleDefinitions").limit(100).get();
  const roles = new Map(
    accessRoles.map((id) => [id as string, defaultRole(id)]),
  );
  for (const doc of saved.docs) {
    if (doc.id === "superadmin") continue;
    roles.set(doc.id, {
      id: doc.id,
      ...doc.data(),
      builtIn: accessRoles.includes(doc.id as (typeof accessRoles)[number]),
    } as ReturnType<typeof defaultRole>);
  }
  res.json([...roles.values()]);
});
controlRouter.put("/roles/:id", async (req, res) => {
  const id = roleId.parse(req.params.id);
  if (id === "superadmin")
    fail("Super Admin is protected and always retains full control");
  const value = roleDefinitionSchema.parse(req.body);
  const actor = actorOf(req);
  await db.runTransaction(async (tx) => {
    const lock = await assertControlAuthority(tx, actor);
    const ref = db.doc(`roleDefinitions/${id}`);
    const [old, assigned] = await Promise.all([
      tx.get(ref),
      tx.get(
        db
          .collection("adminUsers")
          .where("accessRole", "==", id)
          .where("status", "==", "active")
          .limit(1),
      ),
    ]);
    if ((old.data()?.version || 0) !== value.version)
      fail("Role changed. Reload before saving.", 409);
    if (!value.active && !assigned.empty)
      fail("Reassign or disable active users before disabling this role");
    tx.set(lock.ref, { version: lock.version });
    tx.set(ref, {
      ...value,
      permissions: [...new Set(value.permissions)],
      managedRole: true,
      version: value.version + 1,
      updatedBy: actor.uid,
      updatedAt: new Date().toISOString(),
    });
    log(tx, actor, "role.update", id, {
      permissions: value.permissions,
      active: value.active,
      previousPermissions:
        old.data()?.permissions || defaultRole(id).permissions,
    });
  });
  res.json({ saved: true });
});
controlRouter.get("/users", async (req, res) => {
  const page = z.string().max(2000).optional().parse(req.query.page);
  const users = await auth.listUsers(30, page);
  const profiles = await Promise.all(
    users.users.map((user) => db.doc(`adminUsers/${user.uid}`).get()),
  );
  res.json({
    users: users.users.map((user, i) => ({
      uid: user.uid,
      email: user.email || "",
      fullName: profiles[i].data()?.fullName || user.displayName || "",
      mobile: profiles[i].data()?.mobile || "",
      accessRole: profiles[i].data()?.accessRole || "",
      status: profiles[i].data()?.status || "not_assigned",
      version: profiles[i].data()?.version || 0,
      disabled: user.disabled,
      emailVerified: user.emailVerified,
      mfaFactors: user.multiFactor?.enrolledFactors?.length || 0,
      lastSignIn: user.metadata.lastSignInTime || null,
      createdAt: user.metadata.creationTime,
      authSyncPending: profiles[i].data()?.authSyncPending || false,
      isTestAccount: profiles[i].data()?.isTestAccount || false,
    })),
    next: users.pageToken || null,
  });
});
controlRouter.post("/users/:uid/action", async (req, res) => {
  const uid = uidSchema.parse(req.params.uid);
  const value = z
    .object({
      action: z.enum([
        "enable",
        "disable",
        "revoke_sessions",
        "password_reset",
        "verification_email",
      ]),
    })
    .strict()
    .parse(req.body);
  if (value.action === "verification_email" && developmentVerificationBypass())
    fail(
      "Email verification is disabled during development. Use the assigned password to sign in.",
    );
  const actor = actorOf(req);
  const user = await auth.getUser(uid);
  if (value.action === "disable" || value.action === "enable") {
    const profile = (await db.doc(`adminUsers/${uid}`).get()).data();
    if (profile) {
      await saveDashboardUser(actor, {
        id: uid,
        version: profile.version || 1,
        data: userSchema.parse({
          ...Object.fromEntries(
            ["fullName", "email", "mobile", "accessRole", "conferenceId"].map(
              (key) => [key, profile[key]],
            ),
          ),
          status: value.action === "enable" ? "active" : "disabled",
        }),
      });
    } else {
      if (uid === actor.uid) fail("You cannot disable your own account");
      await auth.updateUser(uid, { disabled: value.action === "disable" });
      if (value.action === "disable") await auth.revokeRefreshTokens(uid);
    }
  } else if (value.action === "revoke_sessions") {
    await auth.revokeRefreshTokens(uid);
  } else {
    if (!user.email || user.email.endsWith(".test"))
      fail("Account recovery requires a deliverable email address");
    const link =
      value.action === "password_reset"
        ? await auth.generatePasswordResetLink(user.email)
        : await auth.generateEmailVerificationLink(user.email);
    await db.collection("emailJobs").add({
      recipient: user.email,
      recipientName: user.displayName || "User",
      subject:
        value.action === "password_reset"
          ? "CONE password reset"
          : "CONE email verification",
      body: `Hello {{name}},\n\nComplete your account action here:\n${link}`,
      status: "queued",
      attempts: 0,
      createdBy: actor.uid,
      createdAt: new Date().toISOString(),
    });
  }
  await db.collection("auditLogs").add({
    actorUid: actor.uid,
    actorName: actor.fullName,
    action: `user.${value.action}`,
    target: uid,
    createdAt: new Date().toISOString(),
  });
  res.json({ completed: true });
});
controlRouter.put("/users/:uid/access", async (req, res) => {
  const uid = uidSchema.parse(req.params.uid);
  const input = z
    .object({ version: z.number().int(), data: userSchema })
    .strict()
    .parse(req.body);
  res.json(await saveDashboardUser(actorOf(req), { ...input, id: uid }));
});
controlRouter.get("/runtime", async (_req, res) =>
  res.json(await runtimeConfiguration()),
);
controlRouter.put("/runtime", async (req, res) => {
  const value = runtimeSchema.parse(req.body);
  const actor = actorOf(req);
  await db.runTransaction(async (tx) => {
    const lock = await assertControlAuthority(tx, actor);
    const ref = db.doc("applicationSettings/runtime");
    const old = await tx.get(ref);
    if ((old.data()?.version || 0) !== value.version)
      fail("Settings changed. Reload before saving.", 409);
    tx.set(lock.ref, { version: lock.version });
    tx.set(ref, { ...value, version: value.version + 1 });
    tx.set(
      db.doc("conference/branding"),
      {
        applicationName: value.applicationName,
        updatedAt: new Date().toISOString(),
        version: value.version + 1,
      },
      { merge: true },
    );
    log(tx, actor, "runtime.update", "main", {
      changedFields: Object.keys(value).filter(
        (key) => value[key as keyof typeof value] !== old.data()?.[key],
      ),
    });
  });
  res.json({ saved: true });
});
controlRouter.get("/jobs", async (_req, res) => {
  const [email, imports] = await Promise.all([
    db.collection("emailJobs").orderBy("createdAt", "desc").limit(50).get(),
    db.collection("importJobs").orderBy("createdAt", "desc").limit(50).get(),
  ]);
  res.json({
    email: email.docs.map((d) => ({
      id: d.id,
      status: d.data().status,
      recipient: d.data().recipient,
      attempts: d.data().attempts || 0,
      error: d.data().error || null,
      createdAt: d.data().createdAt,
    })),
    imports: imports.docs.map((d) => ({
      id: d.id,
      status: d.data().status,
      fileName: d.data().fileName,
      total: d.data().total,
      createdAt: d.data().createdAt,
    })),
  });
});
controlRouter.post("/jobs/email/:id/action", async (req, res) => {
  const id = uidSchema.parse(req.params.id);
  const action = z.enum(["retry", "cancel"]).parse(req.body.action);
  const actor = actorOf(req);
  await db.runTransaction(async (tx) => {
    const lock = await assertControlAuthority(tx, actor);
    const ref = db.doc(`emailJobs/${id}`);
    const job = await tx.get(ref);
    if (!job.exists) fail("Job not found", 404);
    if (
      !["failed", "retry", "queued", "cancelled"].includes(job.data()!.status)
    )
      fail("Sent or in-flight messages cannot be cancelled or resent");
    tx.set(lock.ref, { version: lock.version });
    tx.update(
      ref,
      action === "retry"
        ? { status: "queued", attempts: 0, nextAttemptAt: null, error: null }
        : { status: "cancelled", cancelledAt: new Date().toISOString() },
    );
    log(tx, actor, `email.${action}`, id);
  });
  res.json({ completed: true });
});
controlRouter.get("/system", async (_req, res) => {
  const [accounts, email, imports, media, disk] = await Promise.all([
    db.collection("adminUsers").count().get(),
    db.collection("emailJobs").count().get(),
    db.collection("importJobs").count().get(),
    db.collection("mediaAssets").count().get(),
    statfs(path.resolve(process.env.STORAGE_ROOT || "./storage")),
  ]);
  res.json({
    environment: process.env.APP_ENV || "not configured",
    node: process.version,
    uptimeSeconds: Math.round(process.uptime()),
    firebaseProject: process.env.FIREBASE_PROJECT_ID || "",
    storageRoot: path.resolve(process.env.STORAGE_ROOT || "./storage"),
    diskFreeBytes: disk.bavail * disk.bsize,
    counts: {
      dashboardUsers: accounts.data().count,
      emailJobs: email.data().count,
      importJobs: imports.data().count,
      mediaAssets: media.data().count,
    },
    security: {
      mfaRequired: process.env.REQUIRE_ADMIN_MFA !== "false",
      testAccountsEnabled: process.env.ENABLE_ADMIN_TEST_ACCOUNTS === "true",
      roleShortcutsEnabled: process.env.ENABLE_DASHBOARD_ROLE_LOGIN === "true",
      smtpEncryptionConfigured: !!process.env.CONFIG_ENCRYPTION_KEY,
      passSigningConfigured: !!process.env.PASS_SIGNING_SECRET,
    },
    checkedAt: new Date().toISOString(),
  });
});
