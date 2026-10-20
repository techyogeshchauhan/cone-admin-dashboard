import { registerPublicBranding, registerBrandingAdmin } from "./branding.js";
import { registerEmailOtp } from "./email-otp.js";
import {
  ensureIdentity,
  ensurePerson,
  ensureParticipantAccess,
  developmentVerificationBypass,
} from "./accounts.js";
import "dotenv/config";
import { allowAdminTestLogin } from "./admin-test-access.js";
import { registerDevRoleLogin } from "./dev-role-login.js";
import { registerMobileSelfie, registerSelfieAdmin } from "./selfies.js";
import {
  controlRouter,
  runtimeConfiguration,
  saveDashboardUser,
} from "./control.js";
import { resolveRole } from "../shared/control.js";
import { registerTestingVerification } from "./testing-verification.js";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import multer from "multer";
import ExcelJS from "exceljs";
import sharp from "sharp";
import {
  randomUUID,
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import { mkdir, writeFile, readFile, unlink, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { auth, db } from "./firebase.js";
import {
  mailTransport,
  sender,
  publicSmtpConfiguration,
  smtpConfiguration,
} from "./mail.js";
import { encryptSecret } from "./secrets.js";
import { readWorkbook } from "./workbook.js";
import {
  personVariables,
  renderTemplate,
  roleTemplates,
} from "../shared/email-templates.js";
import {
  can,
  schemas,
  collectionNames,
  conferenceSchema,
  settingsSchema,
  participantSchema,
  conferenceRoles,
  accessRoles,
  type Actor,
  type Module,
} from "../shared/schema.js";

export const app = express();
if (
  process.env.OTP_AUTH_ENABLED === "true" &&
  process.env.APP_ENV === "production"
)
  app.set("trust proxy", "loopback");
const storage = path.resolve(process.env.STORAGE_ROOT || "./storage");
if (
  process.env.APP_ENV === "production" &&
  (process.env.REQUIRE_ADMIN_MFA === "false" ||
    process.env.FIREBASE_AUTH_EMULATOR_HOST ||
    process.env.FIRESTORE_EMULATOR_HOST)
)
  throw new Error("Production requires MFA and live Firebase services");
await mkdir(storage, { recursive: true });
app.use(
  helmet(),
  cors({
    origin: (process.env.CORS_ALLOWED_ORIGINS || "http://localhost:3000").split(
      ",",
    ),
  }),
  express.json({ limit: "256kb" }),
);
app.use("/api", rateLimit({ windowMs: 60_000, limit: 180 }));
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});
type Request = express.Request & { actor?: Actor };
const actorOf = (req: express.Request) => (req as Request).actor!;
function requirePermission(req: express.Request, resource: string) {
  const action =
    req.method === "GET"
      ? "read"
      : req.path.endsWith("/archive")
        ? "archive"
        : "write";
  if (!can(actorOf(req), resource, action))
    throw Object.assign(
      new Error("You do not have permission for this action"),
      { status: 403 },
    );
}
function requireRecentAuthentication(req: express.Request) {
  if (Date.now() / 1000 - (actorOf(req).authTime || 0) > 300)
    fail(
      "This sensitive change needs a recent sign-in. Sign out and sign in again.",
      403,
    );
}
function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}
function safeId(value: unknown) {
  return z
    .string()
    .min(1)
    .max(250)
    .regex(/^[^/]+$/)
    .parse(value);
}
async function audit(actor: Actor, action: string, target: string) {
  return db.collection("auditLogs").add({
    actorUid: actor.uid,
    actorName: actor.fullName,
    action,
    target,
    conferenceId: "main",
    createdAt: new Date().toISOString(),
  });
}
app.get("/api/health", (_req, res) =>
  res.json({ status: "ok", service: "cone-admin-api" }),
);
registerPublicBranding(app, storage);
registerEmailOtp(app);
registerTestingVerification(app);
registerDevRoleLogin(app);
registerMobileSelfie(app, storage);
app.use("/api", async (req: Request, _res, next) => {
  try {
    const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (!token)
      return next(
        Object.assign(new Error("Sign in to continue"), { status: 401 }),
      );
    const decoded = await auth.verifyIdToken(token, true);
    if (decoded.login_audience === "mobile")
      fail(
        "This session is for the mobile application. Use the dashboard sign-in.",
        403,
      );
    if (!decoded.email_verified)
      fail("Verify your email before signing in", 403);
    const snapshot = await db.doc(`adminUsers/${decoded.uid}`).get();
    const user = snapshot.data();
    if (
      !user ||
      user.status !== "active" ||
      typeof user.accessRole !== "string" ||
      !/^[a-z][a-z0-9_]{2,40}$/.test(user.accessRole)
    )
      fail(
        "No active dashboard account. Ask your Super Admin for access.",
        403,
      );
    const definition =
      user.accessRole === "superadmin"
        ? undefined
        : (await db.doc(`roleDefinitions/${user.accessRole}`).get()).data();
    const effectivePermissions = resolveRole(user.accessRole, definition);
    if (effectivePermissions === null)
      fail("Your assigned dashboard role is inactive or unavailable", 403);
    const developmentTestLogin = allowAdminTestLogin(user, decoded);
    if (user.isTestAccount && !developmentTestLogin)
      fail(
        "Dashboard test accounts are restricted to explicitly enabled local development.",
        403,
      );
    if (
      !developmentTestLogin &&
      process.env.REQUIRE_ADMIN_MFA !== "false" &&
      user.accessRole === "superadmin" &&
      !decoded.firebase.sign_in_second_factor
    )
      fail("Super Admin sign-in requires an enrolled second factor", 403);
    req.actor = {
      uid: decoded.uid,
      email: decoded.email!,
      fullName: user.fullName,
      role: user.accessRole,
      conferenceId: user.conferenceId,
      status: user.status,
      authTime: decoded.auth_time,
      permissions: effectivePermissions,
    };
    next();
  } catch (error) {
    next(error);
  }
});
app.get("/api/me", (req, res) => res.json(actorOf(req)));

app.use("/api", async (req, _res, next) => {
  try {
    if (
      actorOf(req).role !== "superadmin" &&
      (await db.doc("applicationSettings/main").get()).data()?.maintenanceMode
    )
      fail("The dashboard is temporarily under maintenance", 503);
    const runtime = await runtimeConfiguration();
    if (
      typeof actorOf(req).authTime === "number" &&
      Date.now() / 1000 - actorOf(req).authTime! >
        runtime.sessionMaxAgeMinutes * 60
    )
      fail("Session age limit reached. Sign out and sign in again.", 401);
    if (
      actorOf(req).role !== "superadmin" &&
      runtime.writesPaused &&
      req.method !== "GET"
    )
      fail("Administrative writes are temporarily paused", 503);
    if (req.method !== "GET") {
      if (req.path.startsWith("/imports") && !runtime.importsEnabled)
        fail("Excel imports are disabled in Control Center", 503);
      if (req.path === "/media" && !runtime.mediaUploadsEnabled)
        fail("Media uploads are disabled in Control Center", 503);
      if (
        (req.path.startsWith("/email") || req.path === "/users/invite") &&
        !runtime.emailEnabled
      )
        fail("Email operations are disabled in Control Center", 503);
      if (req.path === "/coupons/redeem" && !runtime.redemptionsEnabled)
        fail("Meal redemption is disabled in Control Center", 503);
      if (
        req.path === "/media" &&
        Number(req.headers["content-length"] || 0) >
          runtime.maxUploadMb * 1024 * 1024 + 2048
      )
        fail(
          `Upload exceeds the configured ${runtime.maxUploadMb} MB limit`,
          413,
        );
    }
    if (
      req.path.startsWith("/reports") &&
      !runtime.exportsEnabled &&
      actorOf(req).role !== "superadmin"
    )
      fail("Exports are temporarily disabled", 503);
    next();
  } catch (error) {
    next(error);
  }
});
app.use("/api/control", controlRouter);
registerBrandingAdmin(app, storage);
registerSelfieAdmin(app, storage);
app.get("/api/workspace-settings", async (_req, res) => {
  const config = await runtimeConfiguration();
  res.json({
    applicationName: config.applicationName,
    announcement: config.announcement,
  });
});
app.get("/api/profile", async (req, res) => {
  requirePermission(req, "self");
  const [person, conference] = await Promise.all([
    db.doc(`people/${actorOf(req).email.toLowerCase()}`).get(),
    db.doc("conference/main").get(),
  ]);
  const data = person.data();
  res.json({
    profile: data
      ? Object.fromEntries(
          [
            "fullName",
            "email",
            "mobile",
            "affiliation",
            "registrationId",
            "registrationStatus",
            "role",
            "coupons",
          ].map((key) => [key, data[key] ?? null]),
        )
      : null,
    schedule: [
      ...(conference.data()?.schedule || []),
      ...(data?.personalSchedule || []),
    ].sort(
      (a, b) =>
        String(a.day).localeCompare(String(b.day)) ||
        String(a.start).localeCompare(String(b.start)),
    ),
  });
});
app.get("/api/overview", async (req, res) => {
  requirePermission(req, "reports");
  const [people, redemptions, imports, activity] = await Promise.all([
    db.collection("people").get(),
    db.collection("mealRedemptions").count().get(),
    db.collection("importJobs").orderBy("createdAt", "desc").limit(5).get(),
    can(actorOf(req), "audit", "read")
      ? db.collection("auditLogs").orderBy("createdAt", "desc").limit(8).get()
      : Promise.resolve(null),
  ]);
  const rows = people.docs
    .map((d) => d.data())
    .filter((d) => !d.isDemo && !d.archivedAt);
  res.json({
    registrations: rows.length,
    confirmed: rows.filter((p) => p.registrationStatus === "confirmed").length,
    presenters: rows.filter((p) => p.role === "presenter").length,
    mealsServed: redemptions.data().count,
    byRole: Object.fromEntries(
      ["presenter", "attendee", "speaker", "vip", "organiser", "volunteer"].map(
        (role) => [role, rows.filter((p) => p.role === role).length],
      ),
    ),
    recentImports: imports.docs.map((d) => ({ id: d.id, ...d.data() })),
    recentActivity:
      activity?.docs.map((d) => ({
        id: d.id,
        action: d.data().action,
        actorName: d.data().actorName || "System",
        target: d.data().target || "Application",
        createdAt: d.data().createdAt,
      })) || [],
  });
});
app.get("/api/conference", async (req, res) => {
  requirePermission(req, "conference");
  res.json(
    (await db.doc("conference/main").get()).data() || {
      name: "",
      shortName: "",
    },
  );
});
app.put("/api/conference", async (req, res) => {
  requirePermission(req, "conference");
  const value = conferenceSchema.parse(req.body);
  await db.runTransaction(async (tx) => {
    const ref = db.doc("conference/main");
    const old = await tx.get(ref);
    tx.set(
      ref,
      {
        ...(!old.exists
          ? {
              notInWorkbook: [
                "Conference dates",
                "Venue and halls",
                "Organiser contact details",
              ],
              categories: ["I", "II", "III", "IV"],
              presentationTypes: { O: "Oral", P: "Poster" },
              totals: { oral: 0, poster: 0, abstracts: 0 },
              disciplines: [],
              schedule: [],
            }
          : {}),
        ...value,
      },
      { merge: true },
    );
  });
  await audit(actorOf(req), "conference.update", "main");
  res.json(value);
});
app.get("/api/settings", async (req, res) => {
  requirePermission(req, "settings");
  res.json({
    ...(await db.doc("applicationSettings/main").get()).data(),
    smtp: await publicSmtpConfiguration(),
    storage: { configured: true },
    mfaRequired: process.env.REQUIRE_ADMIN_MFA !== "false",
  });
});
app.put("/api/settings", async (req, res) => {
  requirePermission(req, "settings");
  requireRecentAuthentication(req);
  const data = settingsSchema.parse(req.body);
  await db.doc("applicationSettings/main").set(data, { merge: true });
  await audit(actorOf(req), "settings.update", "main");
  res.json(data);
});
app.get("/api/settings/smtp", async (req, res) => {
  requirePermission(req, "settings");
  res.json(await publicSmtpConfiguration());
});
app.put("/api/settings/smtp", async (req, res) => {
  requirePermission(req, "settings");
  requireRecentAuthentication(req);
  const value = z
    .object({
      host: z.string().trim().min(1).max(253),
      port: z.coerce.number().int().min(1).max(65535),
      security: z.enum(["none", "tls", "starttls"]),
      username: z.string().max(300),
      password: z.string().max(2000).optional(),
      clearPassword: z.boolean().optional(),
      fromEmail: z.email(),
      fromName: z.string().trim().min(1).max(100),
    })
    .strict()
    .parse(req.body);
  if (process.env.APP_ENV === "production" && value.security === "none")
    fail("Production SMTP requires TLS");
  const { password, clearPassword, ...publicValues } = value;
  const old = await smtpConfiguration();
  const nextPassword = clearPassword ? "" : password || old.password;
  await db.doc("applicationSettings/smtp").set({
    ...publicValues,
    passwordEncrypted: nextPassword ? encryptSecret(nextPassword) : "",
    updatedBy: actorOf(req).uid,
    updatedAt: new Date().toISOString(),
  });
  await audit(actorOf(req), "smtp.update", "configuration");
  res.json(await publicSmtpConfiguration());
});
for (const [route, collection, permission] of [
  ["audit", "auditLogs", "audit"],
  ["analysis", "analysisReports", "analysis"],
  ["imports", "importJobs", "imports"],
  ["redemptions", "mealRedemptions", "redemptions"],
] as const) {
  app.get(`/api/${route}`, async (req, res) => {
    requirePermission(req, permission);
    const rows = await db.collection(collection).limit(100).get();
    res.json(rows.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}
app.get("/api/records/:module", async (req, res) => {
  const module = z
    .enum(Object.keys(schemas) as [Module, ...Module[]])
    .parse(req.params.module);
  requirePermission(req, module);
  let query = db
    .collection(collectionNames[module])
    .orderBy("__name__")
    .limit(50);
  if (module === "participants") {
    if (req.query.role)
      query = query.where(
        "role",
        "==",
        z.enum(conferenceRoles).parse(req.query.role),
      );
    if (req.query.status)
      query = query.where(
        "registrationStatus",
        "==",
        z
          .enum(["pending", "confirmed", "cancelled", "suspended"])
          .parse(req.query.status),
      );
  }
  const rows = await (
    req.query.after ? query.startAfter(safeId(req.query.after)) : query
  ).get();
  res.json({
    rows: rows.docs
      .filter(
        (d) =>
          !d.data().archivedAt &&
          !(
            module === "participants" &&
            req.query.excludeDemo === "true" &&
            d.data().isDemo
          ),
      )
      .map((d) => ({ id: d.id, ...d.data() })),
    next: rows.size === 50 ? rows.docs.at(-1)!.id : null,
  });
});
app.post("/api/records/:module", async (req, res) => {
  const module = z
    .enum(Object.keys(schemas) as [Module, ...Module[]])
    .parse(req.params.module);
  requirePermission(req, module);
  const input = z
    .object({
      id: z.string().optional(),
      version: z.number().int().optional(),
      data: z.unknown(),
    })
    .parse(req.body);
  const data = schemas[module].parse(input.data) as Record<string, unknown>;
  const actor = actorOf(req);
  let id = input.id || randomUUID();
  if (module === "participants") {
    id = String(data.email);
    if (input.id && input.id !== id)
      fail(
        "Email changes require an identity migration; create a reviewed migration separately.",
      );
  }
  if (module === "users") {
    requireRecentAuthentication(req);
    const identity = schemas.users.parse(input.data);

    const provisioned = await ensureIdentity(identity.email, identity.fullName);

    let result: { id: string };
    try {
      result = await saveDashboardUser(actor, {
        id: input.id,
        version: input.version,
        data: identity,
      });
    } catch (error) {
      if (
        provisioned.created &&
        !(await db.doc(`adminUsers/${provisioned.account.uid}`).get()).exists
      )
        await auth.deleteUser(provisioned.account.uid);
      throw error;
    }
    res.json({
      ...result,
      message: provisioned.created
        ? "Account and role saved. Send a password reset from Control Center so they can set their own password."
        : "Account and role saved.",
    });
    return;
  }
  if (module === "meals") {
    data.opensAtMs = Date.parse(String(data.opensAt));
    data.closesAtMs = Date.parse(String(data.closesAt));
  }
  const ref = db.collection(collectionNames[module]).doc(safeId(id));
  await db.runTransaction(async (tx) => {
    const old = await tx.get(ref);
    if (
      old.exists &&
      (!input.id || input.version !== (old.data()!.version || 1))
    )
      fail("Record changed or already exists. Reload before saving.", 409);
    if (!old.exists && input.id) fail("Record no longer exists", 404);
    if (
      module === "participants" &&
      old.data()?.role &&
      data.role !== old.data()?.role &&
      old.data()?.coupons?.length
    )
      fail(
        "Changing a role with issued coupons requires a reviewed coupon migration.",
      );
    if (module === "participants") {
      const coupons = old.data()?.coupons || [];
      for (const coupon of coupons)
        tx.set(
          db.doc(`couponIndex/${safeId(coupon.couponId)}`),
          { fullName: data.fullName },
          { merge: true },
        );
    }
    if (module === "sessions") {
      const conference = await tx.get(db.doc("conference/main"));
      const schedule = (conference.data()?.schedule || []).filter(
        (item: Record<string, unknown>) => item.adminSessionId !== id,
      );
      if (
        schedule.some(
          (s: Record<string, unknown>) =>
            s.day === data.day &&
            s.venue === data.venue &&
            String(s.start) < String(data.end) &&
            String(s.end) > String(data.start),
        )
      )
        fail("This venue already has a session during that time");
      schedule.push({ ...data, adminSessionId: id, isOwnPresentation: false });
      if (!conference.exists)
        fail("Save the conference information before publishing sessions");
      tx.set(db.doc("conference/main"), { schedule }, { merge: true });
    }
    if (module === "submissions") {
      const presenterRef = db.doc(
        `people/${String(data.presenterEmail).trim().toLowerCase()}`,
      );
      const presenter = await tx.get(presenterRef);
      if (!presenter.exists || presenter.data()!.role !== "presenter")
        fail(
          "Choose an existing participant with the presenter conference role",
        );
      if (old.exists && old.data()!.presenterEmail !== data.presenterEmail)
        fail("Presenter reassignment requires a reviewed migration");
      if (
        presenter.data()!.paper &&
        presenter.data()!.paper.submissionId !== data.submissionId
      )
        fail(
          "This presenter already has a different paper; the current mobile app supports one paper per person",
        );
      tx.update(presenterRef, {
        paper: {
          submissionId: data.submissionId,
          title: data.title,
          abstractText: data.abstractText,
          authors: String(data.authors)
            .split("\n")
            .filter(Boolean)
            .map((name) => ({
              name,
              affiliation: null,
              role: "author",
              isParticipant: false,
            })),
        },
        discipline: data.discipline,
        category: data.category,
        presentationType: data.presentationType,
        version: (presenter.data()!.version || 1) + 1,
      });
    }
    if (module === "staff") {
      const staffRef = db.doc(
        `people/${String(data.staffEmail).toLowerCase()}`,
      );
      const staff = await tx.get(staffRef);
      const vipRef = data.vipEmail
        ? db.doc(`people/${String(data.vipEmail).toLowerCase()}`)
        : null;
      const vip = vipRef ? await tx.get(vipRef) : null;
      if (
        !staff.exists ||
        !["organiser", "volunteer"].includes(staff.data()!.role)
      )
        fail("Choose an existing organizer or volunteer");
      if (vipRef && (!vip?.exists || vip.data()!.role !== "vip"))
        fail("VIP host assignment requires a registered VIP");
      if (
        old.exists &&
        (old.data()!.staffEmail !== data.staffEmail ||
          old.data()!.vipEmail !== data.vipEmail)
      )
        fail(
          "Staff/VIP reassignment requires archiving the original duty first",
        );
      const existing = await tx.get(
        db
          .collection("staffAssignments")
          .where("staffEmail", "==", data.staffEmail),
      );
      const assignments = existing.docs
        .filter((d) => d.id !== id && !d.data().archivedAt)
        .map((d) => d.data());
      if (
        assignments.some(
          (d) =>
            d.day === data.day &&
            String(d.start) < String(data.end) &&
            String(d.end) > String(data.start),
        )
      )
        fail("Staff member has an overlapping duty");
      assignments.push(data);
      const schedule = (staff.data()!.personalSchedule || []).filter(
        (item: Record<string, unknown>) => !item.staffAssignmentId,
      );
      tx.update(staffRef, {
        duties: assignments.map((d) => d.duty),
        personalSchedule: [
          ...schedule,
          ...assignments.map((d) => ({
            staffAssignmentId: id,
            title: d.duty,
            day: d.day,
            start: d.start,
            end: d.end,
            venue: null,
            kind: "personal",
            isOwnPresentation: true,
          })),
        ],
        version: (staff.data()!.version || 1) + 1,
      });
      if (vipRef)
        tx.update(vipRef, {
          host: {
            name: staff.data()!.fullName,
            role: staff.data()!.role,
            mobile: staff.data()!.mobile,
          },
        });
    }
    if (module === "fees") {
      const participantRef = db.doc(
        `people/${String(data.participantEmail).toLowerCase()}`,
      );
      const person = await tx.get(participantRef);
      if (!person.exists) fail("Participant not found", 404);
      if (old.exists && old.data()!.participantEmail !== data.participantEmail)
        fail("A fee record cannot be reassigned to a different participant");
      tx.update(participantRef, { feesReceived: String(data.status) });
    }
    const extras =
      module === "participants" && !old.exists
        ? {
            registrationId: `CONE-${randomUUID()}`,
            passId: `PASS-${randomUUID()}`,
            coupons: [],
            personalSchedule: [],
            duties: [],
            isDemo: false,
          }
        : {};
    tx.set(
      ref,
      {
        ...extras,
        ...data,
        version: (old.data()?.version || 0) + 1,
        updatedAt: new Date().toISOString(),
        updatedBy: actor.uid,
        ...(!old.exists
          ? { createdAt: new Date().toISOString(), createdBy: actor.uid }
          : {}),
      },
      { merge: true },
    );
    tx.create(db.collection("auditLogs").doc(), {
      actorUid: actor.uid,
      actorName: actor.fullName,
      action: `${module}.${old.exists ? "update" : "create"}`,
      target: id,
      createdAt: new Date().toISOString(),
      conferenceId: "main",
    });
  });
  if (module === "participants") {
    try {
      const identity = {
        email: String(data.email),
        fullName: String(data.fullName),
        mobile: String(data.mobile),
      };
      const provisioned = await ensureIdentity(
        identity.email,
        identity.fullName,
      );
      await ensureParticipantAccess(
        provisioned.account.uid,
        identity,
        actor.uid,
      );
    } catch (error) {
      fail(
        `Participant saved, but login setup failed: ${(error as Error).message}. Edit this participant and retry login setup.`,
        503,
      );
    }
  }
  res.json({ id, message: "Record saved successfully." });
});
app.post("/api/records/:module/:id/archive", async (req, res) => {
  const module = z
    .enum(Object.keys(schemas) as [Module, ...Module[]])
    .parse(req.params.module);
  requirePermission(req, module);
  const id = safeId(req.params.id);
  const actor = actorOf(req);
  if (module === "users") requireRecentAuthentication(req);
  if (module === "users") {
    const old = (await db.doc(`adminUsers/${id}`).get()).data();
    if (!old) fail("Account not found", 404);
    const data = schemas.users.parse(
      Object.fromEntries(
        [
          "fullName",
          "email",
          "mobile",
          "accessRole",
          "conferenceId",
          "status",
        ].map((key) => [key, key === "status" ? "disabled" : old[key]]),
      ),
    );
    res.json(
      await saveDashboardUser(actor, { id, version: old.version || 1, data }),
    );
    return;
  }
  const ref = db.doc(`${collectionNames[module]}/${id}`);
  await db.runTransaction(async (tx) => {
    const old = await tx.get(ref);
    if (!old.exists) fail("Record not found", 404);
    const conference =
      module === "sessions" ? await tx.get(db.doc("conference/main")) : null;
    if (module === "staff" || module === "submissions")
      fail(
        "Archive this linked record only after completing a reviewed relationship migration",
      );
    if (conference?.exists)
      tx.update(conference.ref, {
        schedule: (conference.data()!.schedule || []).filter(
          (s: Record<string, unknown>) => s.adminSessionId !== id,
        ),
      });
    tx.update(ref, {
      archivedAt: new Date().toISOString(),
      updatedBy: actor.uid,
      version: (old.data()!.version || 1) + 1,
      ...(module === "participants" ? { registrationStatus: "cancelled" } : {}),
    });
    tx.create(db.collection("auditLogs").doc(), {
      actorUid: actor.uid,
      actorName: actor.fullName,
      action: `${module}.archive`,
      target: id,
      createdAt: new Date().toISOString(),
    });
  });

  res.json({ archived: true });
});
app.post("/api/imports/inspect", upload.single("file"), async (req, res) => {
  requirePermission(req, "imports");
  if (!req.file || !req.file.originalname.toLowerCase().endsWith(".xlsx"))
    fail("Upload an .xlsx workbook");
  const book = await readWorkbook(req.file.buffer);
  res.json(
    book.worksheets.map((sheet) => ({
      name: sheet.name,
      rows: sheet.rowCount,
      headers: (sheet.getRow(1).values as unknown[])
        .slice(1)
        .map((v) => String(v || "")),
    })),
  );
});
app.post("/api/imports/preview", upload.single("file"), async (req, res) => {
  requirePermission(req, "imports");
  if (!req.file || !req.file.originalname.toLowerCase().endsWith(".xlsx"))
    fail("Upload an .xlsx workbook");
  const workbook = await readWorkbook(req.file.buffer);
  if (workbook.worksheets.length > 30) fail("Maximum 30 sheets per workbook");
  const sheet =
    workbook.getWorksheet(String(req.body.sheet || "")) ||
    workbook.worksheets.find((s) => s.name !== "MAIN");
  if (!sheet || sheet.rowCount > 2001)
    fail("Select a participant sheet with at most 2000 rows");
  const mapping: Record<string, string> = {
    "Name of Author(S)": "fullName",
    "Email Address": "email",
    Mobile: "mobile",
    "Organizational Affiliation": "affiliation",
    Discipline: "discipline",
    "CT.": "category",
    "O/P": "presentationType",
    "Registration Fee": "registrationFee",
    ACCO: "accommodation",
    "Soft Copy": "softCopy",
    "Earlier Awarded": "earlierAwardee",
  };
  if (req.body.mapping) {
    const custom = z
      .record(z.string(), z.string())
      .parse(JSON.parse(req.body.mapping));
    Object.assign(mapping, custom);
  }
  const mode = z.enum(["create", "update"]).parse(req.body.mode || "create");
  const defaultRole = z
    .enum(["presenter", "attendee", "speaker", "vip", "organiser", "volunteer"])
    .parse(req.body.defaultRole || "attendee");
  const headers = sheet.getRow(1).values as unknown[];
  const rows: {
    row: number;
    data: Record<string, unknown> | null;
    errors: string[];
  }[] = [];
  const seen = new Set<string>();
  sheet.eachRow((row, index) => {
    if (index === 1) return;
    const raw: Record<string, unknown> = {
      role: defaultRole,
      registrationStatus: "pending",
    };
    const errors: string[] = [];
    row.eachCell((cell, col) => {
      const header = String(headers[col] || "").trim();
      const key = mapping[header] ?? header;
      if (
        [
          "fullName",
          "email",
          "mobile",
          "affiliation",
          "role",
          "registrationStatus",
          "discipline",
          "category",
          "presentationType",
          "registrationFee",
          "accommodation",
          "softCopy",
          "earlierAwardee",
        ].includes(key)
      ) {
        if (cell.type === ExcelJS.ValueType.Formula)
          errors.push(`${key}: formula cells are not accepted`);
        raw[key] = cell.text.trim();
      }
    });
    const parsed = participantSchema.safeParse(raw);
    if (!parsed.success)
      errors.push(
        ...parsed.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`),
      );
    if (parsed.success) {
      if (seen.has(parsed.data.email))
        errors.push("Duplicate email in this workbook");
      seen.add(parsed.data.email);
    }
    rows.push({
      row: index,
      data: parsed.success ? parsed.data : null,
      errors,
    });
  });
  const hash = createHash("sha256").update(req.file.buffer).digest("hex");
  const id = randomUUID();
  await writeFile(
    path.join(storage, `import-${id}.json`),
    JSON.stringify(rows),
  );
  await db.doc(`importJobs/${id}`).create({
    fileName: req.file.originalname,
    sheet: sheet.name,
    hash,
    mode,
    status: "preview",
    total: rows.length,
    valid: rows.filter((r) => !r.errors.length).length,
    createdAt: new Date().toISOString(),
    createdBy: actorOf(req).uid,
  });
  res.json({ id, sheets: workbook.worksheets.map((s) => s.name), rows });
});
app.post("/api/imports/:id/commit", async (req, res) => {
  requirePermission(req, "imports");
  const id = safeId(req.params.id);
  const ref = db.doc(`importJobs/${id}`);
  const rows = JSON.parse(
    await readFile(path.join(storage, `import-${id}.json`), "utf8"),
  ) as { row: number; data: Record<string, unknown>; errors: string[] }[];
  if (!rows.length || rows.some((r) => r.errors.length))
    fail("Resolve every validation error and upload again before publishing");
  let mode = "create";
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) fail("Import not found", 404);
    if (
      snap.data()!.status !== "preview" &&
      snap.data()!.status !== "failed" &&
      !(
        snap.data()!.status === "running" &&
        Date.parse(snap.data()!.leaseUntil) < Date.now()
      )
    )
      fail("This import is already running or complete", 409);
    mode = snap.data()!.mode || "create";
    tx.update(ref, {
      status: "running",
      leaseUntil: new Date(Date.now() + 600000).toISOString(),
    });
  });
  let created = 0,
    skipped = 0,
    updated = 0;
  try {
    for (const row of rows) {
      const data = participantSchema.parse(row.data);
      const person = db.doc(`people/${data.email}`);
      const action = await db.runTransaction(async (tx) => {
        const resultRef = ref.collection("rows").doc(String(row.row));
        const [old, result] = await Promise.all([
          tx.get(person),
          tx.get(resultRef),
        ]);
        if (result.exists) return "skipped";
        if (old.exists && mode === "create") {
          tx.create(resultRef, { action: "skipped", email: data.email });
          return "skipped";
        }
        if (old.exists) {
          if (old.data()!.role !== data.role && old.data()!.coupons?.length)
            fail(
              `Row ${row.row}: role changes with issued coupons require a reviewed migration`,
            );
          for (const coupon of old.data()!.coupons || [])
            tx.update(db.doc(`couponIndex/${safeId(coupon.couponId)}`), {
              fullName: data.fullName,
            });
          tx.update(person, {
            ...data,
            version: (old.data()!.version || 1) + 1,
            lastImportJobId: id,
            updatedAt: new Date().toISOString(),
            updatedBy: actorOf(req).uid,
          });
        } else
          tx.create(person, {
            ...data,
            registrationId: `CONE-${randomUUID()}`,
            passId: `PASS-${randomUUID()}`,
            coupons: [],
            personalSchedule: [],
            duties: [],
            version: 1,
            isDemo: false,
            importJobId: id,
            createdAt: new Date().toISOString(),
            createdBy: actorOf(req).uid,
          });
        tx.create(resultRef, {
          action: old.exists ? "updated" : "created",
          email: data.email,
        });
        return old.exists ? "updated" : "created";
      });
      if (action === "created") created++;
      else if (action === "updated") updated++;
      else skipped++;
    }
    await ref.update({
      status: "completed",
      created,
      skipped,
      updated,
      completedAt: new Date().toISOString(),
    });
    await audit(actorOf(req), "import.commit", id);
    res.json({ created, skipped, updated });
  } catch (error) {
    await ref.update({ status: "failed", created, skipped, updated });
    throw error;
  }
});
app.get("/api/import-template", async (req, res) => {
  requirePermission(req, "imports");
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Participants");
  sheet.addRow([
    "fullName",
    "email",
    "mobile",
    "affiliation",
    "role",
    "registrationStatus",
  ]);
  sheet.addRow([
    "Example Participant",
    "participant@example.test",
    "9876543210",
    "Example University",
    "attendee",
    "pending",
  ]);
  res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.attachment("cone-participants-template.xlsx");
  await book.xlsx.write(res);
  res.end();
});
app.get("/api/media", async (req, res) => {
  requirePermission(req, "media");
  const snap = await db.collection("mediaAssets").limit(100).get();
  res.json(
    snap.docs
      .filter((d) => !d.data().archivedAt)
      .map((d) => ({ id: d.id, ...d.data() })),
  );
});
app.post("/api/media", upload.single("file"), async (req, res) => {
  requirePermission(req, "media");
  if (!req.file) fail("Choose an image");
  if (req.file.size > (await runtimeConfiguration()).maxUploadMb * 1024 * 1024)
    fail("Image exceeds the configured upload limit", 413);
  const image = sharp(req.file.buffer, { limitInputPixels: 4096 * 4096 });
  const meta = await image.metadata();
  if (
    !["jpeg", "png", "webp"].includes(meta.format || "") ||
    (meta.width || 0) > 4096 ||
    (meta.height || 0) > 4096
  )
    fail("Use JPEG, PNG or WebP up to 4096 pixels per side");
  const id = randomUUID();
  await image
    .rotate()
    .webp({ quality: 85 })
    .toFile(path.join(storage, `${id}.webp`));
  try {
    await db.doc(`mediaAssets/${id}`).create({
      name: req.file.originalname,
      storageKey: `${id}.webp`,
      mime: "image/webp",
      visibility: "private",
      createdAt: new Date().toISOString(),
      createdBy: actorOf(req).uid,
    });
  } catch (error) {
    await unlink(path.join(storage, `${id}.webp`));
    throw error;
  }
  await audit(actorOf(req), "media.upload", id);
  res.json({ id });
});
app.get("/api/media/:id/file", async (req, res) => {
  requirePermission(req, "media");
  const id = z.uuid().parse(req.params.id);
  const asset = await db.doc(`mediaAssets/${id}`).get();
  if (!asset.exists || asset.data()?.archivedAt) fail("Image not found", 404);
  res.setHeader("Cache-Control", "private, no-store");
  res.type("image/webp").sendFile(path.join(storage, `${id}.webp`));
});
app.post("/api/media/:id/archive", async (req, res) => {
  requirePermission(req, "media");
  const id = z.uuid().parse(req.params.id);
  await db
    .doc(`mediaAssets/${id}`)
    .update({ archivedAt: new Date().toISOString() });
  await audit(actorOf(req), "media.archive", id);
  res.json({ archived: true });
});
app.post("/api/email/test", async (req, res) => {
  requirePermission(req, "email");
  const email = z.email().parse(req.body.email);
  if (email !== actorOf(req).email && actorOf(req).role !== "superadmin")
    fail("Test mail can only be sent to your own address", 403);
  const ref = db.collection("emailJobs").doc();
  await ref.create({
    recipient: email,
    status: "sending",
    createdBy: actorOf(req).uid,
    createdAt: new Date().toISOString(),
  });
  try {
    if (!(await smtpConfiguration()).host)
      fail("Configure SMTP_HOST on the server first");
    const transport = await mailTransport();
    await transport.sendMail({
      from: await sender(),
      to: email,
      subject: "CONE SMTP connection test",
      text: "Your CONE dashboard SMTP connection is working.",
    });
    await ref.update({ status: "sent" });
    await audit(actorOf(req), "email.test", ref.id);
    res.json({ sent: true });
  } catch (error) {
    await ref.update({ status: "failed" });
    throw error;
  }
});
app.get("/api/email/templates", async (req, res) => {
  requirePermission(req, "email");
  const snapshot = await db.collection("emailTemplates").limit(50).get();
  res.json(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
});
app.post("/api/email/templates", async (req, res) => {
  requirePermission(req, "email");
  const value = z
    .object({
      name: z.string().trim().min(1).max(100),
      subject: z.string().trim().min(1).max(150),
      body: z.string().trim().min(1).max(10000),
    })
    .strict()
    .parse(req.body);
  const ref = db.collection("emailTemplates").doc();
  await ref.create({
    ...value,
    createdBy: actorOf(req).uid,
    createdAt: new Date().toISOString(),
  });
  await audit(actorOf(req), "email.template.create", ref.id);
  res.json({ id: ref.id });
});
// Adds the built-in role templates that are not already saved (matched by name).
app.post("/api/email/templates/defaults", async (req, res) => {
  requirePermission(req, "email");
  const existing = new Set(
    (await db.collection("emailTemplates").limit(200).get()).docs.map((d) =>
      String(d.data().name),
    ),
  );
  const missing = roleTemplates.filter((t) => !existing.has(t.name));
  const batch = db.batch();
  for (const { name, subject, body, role } of missing)
    batch.create(db.collection("emailTemplates").doc(), {
      name,
      subject,
      body,
      role: role || "all",
      builtIn: true,
      createdBy: actorOf(req).uid,
      createdAt: new Date().toISOString(),
    });
  if (missing.length) await batch.commit();
  await audit(actorOf(req), "email.template.defaults", String(missing.length));
  res.json({ added: missing.length });
});
app.get("/api/email/jobs", async (req, res) => {
  requirePermission(req, "email");
  const snapshot = await db
    .collection("emailJobs")
    .orderBy("createdAt", "desc")
    .limit(100)
    .get();
  res.json(
    snapshot.docs.map((d) => ({
      id: d.id,
      recipient: d.data().recipient,
      status: d.data().status,
      attempts: d.data().attempts,
      createdAt: d.data().createdAt,
    })),
  );
});
app.post("/api/users/invite", async (req, res) => {
  requirePermission(req, "users");
  requireRecentAuthentication(req);
  const data = schemas.users.parse(req.body);
  if (
    resolveRole(
      data.accessRole,
      (await db.doc(`roleDefinitions/${data.accessRole}`).get()).data(),
    ) === null
  )
    fail("Choose an active dashboard role");
  if (!(await smtpConfiguration()).host)
    fail("Configure SMTP and start the email worker before inviting accounts");
  const account = await auth.getUserByEmail(data.email).catch(async (error) => {
    if (error.code !== "auth/user-not-found") throw error;
    return auth.createUser({
      email: data.email,
      displayName: data.fullName,
      emailVerified: developmentVerificationBypass(),
    });
  });
  const existing = await db.doc(`adminUsers/${account.uid}`).get();
  if (existing.exists) fail("This account already has dashboard access", 409);
  if (developmentVerificationBypass() && !account.emailVerified)
    await auth.updateUser(account.uid, { emailVerified: true });
  const [verification, reset] = await Promise.all([
    developmentVerificationBypass()
      ? Promise.resolve("")
      : auth.generateEmailVerificationLink(data.email),
    auth.generatePasswordResetLink(data.email),
  ]);
  const batch = db.batch();
  batch.create(db.doc(`adminUsers/${account.uid}`), {
    ...data,
    version: 1,
    createdAt: new Date().toISOString(),
    createdBy: actorOf(req).uid,
  });
  batch.create(db.collection("emailJobs").doc(), {
    recipient: data.email,
    recipientName: data.fullName,
    subject: "Your CONE dashboard invitation",
    body: `Hello {{name}},\n\n${verification ? `Verify your email:\n${verification}\n\n` : ""}Set your password:\n${reset}\n\nSign in at ${process.env.ADMIN_BASE_URL || "http://localhost:3000"}\n\nPrivileged accounts may also require MFA enrollment.`,
    status: "queued",
    attempts: 0,
    createdAt: new Date().toISOString(),
    createdBy: actorOf(req).uid,
  });
  await batch.commit();
  await ensurePerson(data, actorOf(req).uid);
  await audit(actorOf(req), "user.invite", account.uid);
  res.json({ invited: true });
});
app.post("/api/email/queue", async (req, res) => {
  requirePermission(req, "email");
  const value = z
    .object({
      templateId: z.string(),
      recipients: z.array(z.email()).min(1).max(50),
      requestId: z.uuid(),
    })
    .strict()
    .parse(req.body);
  const template = (
    await db.doc(`emailTemplates/${safeId(value.templateId)}`).get()
  ).data();
  if (!template) fail("Template not found", 404);
  if (!(await smtpConfiguration()).host)
    fail("Configure SMTP before queuing messages");
  const conference = (await db.doc("conference/main").get()).data() || {};
  const recipients = await Promise.all(
    [
      ...new Set(value.recipients.map((email) => email.trim().toLowerCase())),
    ].map(async (email) => {
      const person = (
        await db.doc(`people/${email.toLowerCase()}`).get()
      ).data();
      if (!person) fail(`Recipient is not registered: ${email}`);
      // Each recipient's own registration fills the template placeholders.
      const values = personVariables(person, conference);
      return {
        email: email.toLowerCase(),
        name: person.fullName,
        subject: renderTemplate(template.subject, values),
        body: renderTemplate(template.body, values),
      };
    }),
  );
  const ref = db.doc(`emailBatches/${value.requestId}`);
  await db.runTransaction(async (tx) => {
    if ((await tx.get(ref)).exists) return;
    for (const recipient of recipients)
      tx.create(db.collection("emailJobs").doc(), {
        recipient: recipient.email,
        recipientName: recipient.name,
        subject: recipient.subject,
        body: recipient.body,
        templateId: value.templateId,
        status: "queued",
        attempts: 0,
        batchId: value.requestId,
        createdAt: new Date().toISOString(),
        createdBy: actorOf(req).uid,
      });
    tx.create(ref, {
      total: recipients.length,
      createdBy: actorOf(req).uid,
      createdAt: new Date().toISOString(),
    });
  });
  await audit(actorOf(req), "email.queue", value.requestId);
  res.json({ queued: recipients.length });
});
app.get("/api/reports/participants", async (req, res) => {
  requirePermission(req, "reports");
  const participants = await db.collection("people").limit(5000).get();
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Registrations");
  const columns = [
    "registrationId",
    "fullName",
    "email",
    "mobile",
    "role",
    "registrationStatus",
    "affiliation",
    "discipline",
    "registrationFee",
    "accommodation",
  ];
  sheet.addRow(columns);
  for (const person of participants.docs) {
    const data = person.data();
    sheet.addRow(
      columns.map((key) => {
        const value = data[key];
        return typeof value === "number" ? value : String(value ?? "");
      }),
    );
  }
  await audit(actorOf(req), "report.export", "participants");
  res
    .type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    .attachment("cone-registrations.xlsx");
  await workbook.xlsx.write(res);
  res.end();
});
app.post("/api/coupons/redeem", async (req, res) => {
  requirePermission(req, "redemptions");
  const id = safeId(req.body.couponId);
  const target = db.doc(`mealRedemptions/${id}`);
  await db.runTransaction(async (tx) => {
    const [issued, used] = await Promise.all([
      tx.get(db.doc(`couponIndex/${id}`)),
      tx.get(target),
    ]);
    if (!issued.exists) fail("Unknown coupon", 404);
    if (used.exists) fail("Already used", 409);
    const coupon = issued.data()!;
    const owner = await tx.get(db.doc(`people/${coupon.email}`));
    if (owner.data()?.registrationStatus !== "confirmed")
      fail("Registration is not confirmed");
    const slot = await tx.get(
      db.doc(`mealSlots/${coupon.slotId || "unconfigured"}`),
    );
    if (!slot.exists || !slot.data()?.opensAt || !slot.data()?.closesAt)
      fail("Meal window must be configured before redemption");
    const now = Date.now();
    if (
      now < Date.parse(slot.data()!.opensAt) ||
      now > Date.parse(slot.data()!.closesAt)
    )
      fail("Outside the meal window");
    tx.create(target, {
      couponId: id,
      registrationId: coupon.registrationId,
      participantEmail: coupon.email,
      meal: coupon.meal,
      day: coupon.day,
      redeemedAt: new Date(),
      redeemedBy: actorOf(req).email,
    });
  });
  res.json({ redeemed: true });
});
app.post("/api/coupons/issue", async (req, res) => {
  requirePermission(req, "meals");
  const email = z.email().parse(req.body.email).trim().toLowerCase();
  const slots = await db.collection("mealSlots").limit(100).get();
  if (slots.empty) fail("Configure meal slots first");
  const ref = db.doc(`people/${email}`);
  let issued = 0;
  await db.runTransaction(async (tx) => {
    issued = 0;
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) fail("Participant not found", 404);
    const person = snapshot.data()!;
    if (person.registrationStatus !== "confirmed")
      fail("Confirm the participant registration before issuing coupons");
    const coupons = [...(person.coupons || [])];
    for (const slot of slots.docs) {
      const value = slot.data();
      if (value.archivedAt || coupons.some((c) => c.slotId === slot.id))
        continue;
      const coupon = {
        couponId: `MEAL-${randomUUID().toUpperCase()}`,
        slotId: slot.id,
        day: value.day,
        meal: value.meal,
        window: value.window,
      };
      coupons.push(coupon);
      tx.create(db.doc(`couponIndex/${coupon.couponId}`), {
        ...coupon,
        email,
        fullName: person.fullName,
        registrationId: person.registrationId,
        role: person.role,
      });
      issued++;
    }
    tx.update(ref, { coupons, version: (person.version || 1) + 1 });
  });
  await audit(actorOf(req), "coupons.issue", email);
  res.json({ issued });
});
app.post("/api/passes/issue", async (req, res) => {
  requirePermission(req, "passes");
  const email = z.email().parse(req.body.email).toLowerCase();
  const secret = process.env.PASS_SIGNING_SECRET;
  if (!secret || secret.length < 32)
    fail("Configure PASS_SIGNING_SECRET with at least 32 random characters");
  const id = randomUUID();
  const payload = Buffer.from(
    JSON.stringify({ id, conferenceId: "main", issuedAt: Date.now() }),
  ).toString("base64url");
  const token = `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
  await db.runTransaction(async (tx) => {
    const personRef = db.doc(`people/${email}`);
    const person = await tx.get(personRef);
    if (!person.exists || person.data()!.registrationStatus !== "confirmed")
      fail("Choose a confirmed participant");
    const previous = person.data()!.managedPassId;
    if (previous)
      tx.update(db.doc(`passes/${safeId(previous)}`), {
        status: "revoked",
        revokedAt: new Date().toISOString(),
      });
    tx.create(db.doc(`passes/${id}`), {
      email,
      status: "active",
      registrationId: person.data()!.registrationId,
      conferenceId: "main",
      createdAt: new Date().toISOString(),
      createdBy: actorOf(req).uid,
    });
    tx.update(personRef, {
      passId: token,
      managedPassId: id,
      version: (person.data()!.version || 1) + 1,
    });
  });
  await audit(actorOf(req), "pass.issue", id);
  res.json({ id, token });
});
app.post("/api/passes/revoke", async (req, res) => {
  requirePermission(req, "passes");
  const email = z.email().parse(req.body.email).toLowerCase();
  const person = (await db.doc(`people/${email}`).get()).data();
  if (!person?.managedPassId)
    fail("No managed pass exists for this participant");
  await db
    .doc(`passes/${safeId(person.managedPassId)}`)
    .update({ status: "revoked", revokedAt: new Date().toISOString() });
  await audit(actorOf(req), "pass.revoke", person.managedPassId);
  res.json({ revoked: true });
});
app.post("/api/passes/verify", async (req, res) => {
  if (!can(actorOf(req), "passes") && !can(actorOf(req), "redemptions"))
    fail("Access denied", 403);
  const token = z.string().max(3000).parse(req.body.token);
  const [payload, signature, ...extra] = token.split(".");
  const secret = process.env.PASS_SIGNING_SECRET;
  if (!secret || !payload || !signature || extra.length)
    fail("Invalid signed pass");
  const expected = createHmac("sha256", secret).update(payload).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    fail("Invalid pass signature");
  const value = z
    .object({
      id: z.uuid(),
      conferenceId: z.literal("main"),
      issuedAt: z.number(),
    })
    .parse(JSON.parse(Buffer.from(payload, "base64url").toString()));
  const pass = (await db.doc(`passes/${value.id}`).get()).data();
  if (!pass || pass.status !== "active") fail("Pass is revoked or unknown");
  const person = (await db.doc(`people/${pass.email}`).get()).data();
  if (
    !person ||
    person.registrationStatus !== "confirmed" ||
    person.passId !== token
  )
    fail("Participant is not eligible for entry");
  await audit(actorOf(req), "pass.verify", value.id);
  res.json({
    valid: true,
    fullName: person.fullName,
    registrationId: person.registrationId,
    role: person.role,
  });
});
app.get("/api/system-health", async (req, res) => {
  requirePermission(req, "analysis");
  await db.doc("conference/main").get();
  const disk = await stat(storage);
  res.json({
    firestore: "connected",
    storage: disk.isDirectory() ? "available" : "unavailable",
    smtp: (await smtpConfiguration()).host
      ? "configured; delivery not checked"
      : "not configured",
    checkedAt: new Date().toISOString(),
  });
});
app.use(express.static(path.resolve("dist")));
app.get("/{*path}", (_req, res) =>
  res.sendFile(path.resolve("dist/index.html")),
);
app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (error instanceof z.ZodError)
      return void res.status(400).json({
        error: error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      });
    const err = error as { status?: number; code?: string; message?: string };
    if (
      ["EAUTH", "ECONNECTION", "ESOCKET", "ETIMEDOUT", "EENVELOPE"].includes(
        err.code || "",
      )
    ) {
      res.status(502).json({
        error:
          err.code === "EAUTH"
            ? "SMTP authentication failed. Check the sender address and app password in SMTP settings."
            : "Email delivery failed. Check SMTP settings, recipient address and server connectivity.",
      });
      return;
    }
    const status =
      err.status ||
      (err.code === "auth/user-not-found"
        ? 404
        : err.code === "auth/email-already-exists"
          ? 409
          : err.code?.startsWith("auth/")
            ? 400
            : 500);
    if (status === 500) console.error(error);
    res.status(status).json({
      error:
        status === 500
          ? "The operation could not be completed. Check server configuration and logs."
          : err.message,
    });
  },
);
// HOST=0.0.0.0 lets phones on the network reach the mobile OTP endpoints.
const host = process.env.HOST || "127.0.0.1";
if (process.env.NODE_ENV !== "test")
  app.listen(Number(process.env.PORT || 8080), host, () =>
    console.log(
      `CONE API listening on http://${host}:${process.env.PORT || 8080}`,
    ),
  );
