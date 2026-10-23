import { registerPublicBranding, registerBrandingAdmin } from "./branding.js";
import { registerEmailOtp } from "./email-otp.js";
import { renderEmail } from "../shared/email-design.js";
import { emailBranding } from "./email-branding.js";
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
import { registerDepartmentRecords } from "./department-records.js";
import {
  participantRecord,
  pickFields,
  registrationFields,
  financialFields,
  overviewAccess,
  canOpenWorkspace,
} from "../shared/role-fields.js";
import { registerTestingVerification } from "./testing-verification.js";
import {
  registerTestAccountAdmin,
  registerTestAccountLogin,
} from "./test-accounts.js";
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
  clearRequestCaches,
  memo,
  requestCacheStatistics,
} from "./request-cache.js";
import { mutationCaches } from "./cache-policy.js";
import { registrationCounts } from "./overview-counts.js";
import { firebaseOutage } from "./firebase-errors.js";
import { readLog, recordAudit } from "./activity-log.js";
import { pageSize, readPage } from "./pagination.js";
import {
  matchesTerms,
  personSearchKeys,
  searchTerms,
} from "../shared/search.js";
import {
  problemColumns,
  problemFields,
} from "../shared/registration-columns.js";
import {
  importOptions,
  parseRegistrationWorkbook,
  type SummarySheet,
  type WorkbookRow,
} from "./registration-workbook.js";
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
  process.env.TRUST_PROXY === "loopback" ||
  (process.env.OTP_AUTH_ENABLED === "true" &&
    process.env.APP_ENV === "production")
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
// The built dashboard signs in with Firebase Auth from the browser, and Super
// Admin MFA verifies a phone number with reCAPTCHA. Everything else stays
// same-origin under helmet's defaults.
const authDomain = process.env.VITE_FIREBASE_AUTH_DOMAIN;
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        "connect-src": [
          "'self'",
          "https://identitytoolkit.googleapis.com",
          "https://securetoken.googleapis.com",
          "https://www.google.com/recaptcha/",
        ],
        "script-src": [
          "'self'",
          "https://www.google.com/recaptcha/",
          "https://www.gstatic.com/recaptcha/",
          "https://apis.google.com",
        ],
        "frame-src": [
          "'self'",
          "https://www.google.com/recaptcha/",
          "https://recaptcha.google.com/recaptcha/",
          ...(authDomain ? [`https://${authDomain}`] : []),
        ],
        "img-src": ["'self'", "data:", "blob:"],
      },
    },
  }),
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
// The audit trail is a local log file, not Firestore (see activity-log.ts).
async function audit(actor: Actor, action: string, target: string) {
  return recordAudit({
    actorUid: actor.uid,
    actorName: actor.fullName,
    action,
    target,
  });
}
app.get("/api/health", (_req, res) =>
  res.json({ status: "ok", service: "cone-admin-api" }),
);
registerPublicBranding(app, storage);
// What the sign-in screen shows about the conference: only published
// details, and only the fields meant for the public.
const publicFields = [
  "edition",
  "name",
  "shortName",
  "theme",
  "tagline",
  "startDate",
  "endDate",
  "venue",
  "organizer",
  "organizerAddress",
  "website",
  "highlights",
  "logos",
] as const;
const publicConferences = memo<Record<string, unknown>>({
  tags: ["conference"],
});
app.get("/api/public/conference", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(
    await publicConferences("main", async () => {
      const data = (await db.doc("conference/main").get()).data();
      if (data?.publicationStatus !== "published") return { published: false };
      return {
        published: true,
        ...Object.fromEntries(
          publicFields
            .filter((key) => data[key] !== undefined && data[key] !== "")
            .map((key) => [key, data[key]]),
        ),
      };
    }),
  );
});
app.get("/api/public/conference-logo/:id", (req, res, next) => {
  const id = z.uuid().parse(req.params.id);
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res
    .type("webp")
    .sendFile(path.join(storage, `conference-logo-${id}.webp`), (error) => {
      if (!error) return;
      if ((error as { status?: number }).status === 404)
        res.status(404).json({ error: "Logo not found" });
      else next(error);
    });
});
registerEmailOtp(app);
registerTestAccountLogin(app);
registerTestingVerification(app);
registerDevRoleLogin(app);
registerMobileSelfie(app, storage);
// Evict only dependencies of this mutation, including partial failures.
app.use("/api", (req, res, next) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const tags = mutationCaches(req.path);
    res.on("finish", () => clearRequestCaches(tags));
  }
  next();
});
const sessions = memo<Actor & { expiresAt: number }>({ tags: ["sessions"] });
async function resolveSession(token: string) {
  const decoded = await auth.verifyIdToken(token, true);
  if (decoded.login_audience === "mobile")
    fail(
      "This session is for the mobile application. Use the dashboard sign-in.",
      403,
    );
  if (!decoded.email_verified) fail("Verify your email before signing in", 403);
  const snapshot = await db.doc(`adminUsers/${decoded.uid}`).get();
  const user = snapshot.data();
  if (
    !user ||
    user.status !== "active" ||
    typeof user.accessRole !== "string" ||
    !/^[a-z][a-z0-9_]{2,40}$/.test(user.accessRole)
  )
    fail("No active dashboard account. Ask your Super Admin for access.", 403);
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
  return {
    uid: decoded.uid,
    email: decoded.email!,
    fullName: user.fullName,
    role: user.accessRole,
    conferenceId: user.conferenceId,
    status: user.status,
    authTime: decoded.auth_time,
    permissions: effectivePermissions,
    expiresAt: decoded.exp * 1000,
  };
}
app.use("/api", async (req: Request, _res, next) => {
  try {
    const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (!token)
      return next(
        Object.assign(new Error("Sign in to continue"), { status: 401 }),
      );
    const { expiresAt: _expiry, ...actor } = await sessions(
      createHash("sha256").update(token).digest("hex"),
      () => resolveSession(token),
      (session) => session.expiresAt,
    );
    req.actor = { ...actor, permissions: [...(actor.permissions || [])] };
    next();
  } catch (error) {
    next(error);
  }
});
app.get("/api/me", (req, res) => res.json(actorOf(req)));

const switches = memo<{
  maintenanceMode: boolean;
  runtime: Awaited<ReturnType<typeof runtimeConfiguration>>;
}>({ tags: ["switches"] });
app.use("/api", async (req, res, next) => {
  try {
    const { maintenanceMode, runtime } = await switches("gate", async () => {
      const [main, runtime] = await Promise.all([
        db.doc("applicationSettings/main").get(),
        runtimeConfiguration(),
      ]);
      return { maintenanceMode: !!main.data()?.maintenanceMode, runtime };
    });
    if (actorOf(req).role !== "superadmin" && maintenanceMode)
      fail("The dashboard is temporarily under maintenance", 503);
    res.locals.runtime = runtime;
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
// Raw workbook endpoints expose registration and payment source columns.
app.use("/api", (req, _res, next) => {
  if (req.path.startsWith("/imports") || req.path === "/import-template") {
    const actor = actorOf(req);
    if (!canOpenWorkspace(actor, "imports"))
      return next(
        Object.assign(
          new Error(
            "Workbook access requires registration and fee read permissions",
          ),
          { status: 403 },
        ),
      );
    if (
      req.method !== "GET" &&
      req.path.endsWith("/commit") &&
      (!can(actor, "participants", "write") || !can(actor, "fees", "write"))
    )
      return next(
        Object.assign(
          new Error(
            "Import commits require registration and fee write permissions",
          ),
          { status: 403 },
        ),
      );
  }
  next();
});
registerBrandingAdmin(app, storage);
registerSelfieAdmin(app, storage);
registerTestAccountAdmin(app);
registerDepartmentRecords(app, storage);
app.get("/api/workspace-settings", async (_req, res) => {
  const config: Awaited<ReturnType<typeof runtimeConfiguration>> =
    res.locals.runtime ?? (await runtimeConfiguration());
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
  const stored = person.data();
  const data =
    stored &&
    !stored.archivedAt &&
    !["cancelled", "suspended"].includes(stored.registrationStatus)
      ? stored
      : null;
  res.json({
    profile: data
      ? {
          ...Object.fromEntries(
            [
              ...registrationFields.filter((key) => key !== "remark"),
              ...financialFields,
              "coupons",
            ].map((key) => [key, data[key] ?? null]),
          ),
          ...(data.role === "presenter" && data.paper?.title
            ? { abstractTitle: data.paper.title }
            : {}),
        }
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
app.get("/api/profile/fees", async (req, res) => {
  requirePermission(req, "self");
  const email = actorOf(req).email.toLowerCase();
  const person = (await db.doc(`people/${email}`).get()).data();
  if (
    !person ||
    person.archivedAt ||
    ["cancelled", "suspended"].includes(person.registrationStatus)
  )
    return res.json({ rows: [], next: null });
  const page = await readPage({
    query: db
      .collection("feeRecords")
      .where("participantEmail", "==", email)
      .orderBy("__name__"),
    collection: "feeRecords",
    limit: pageSize(req.query.limit),
    after: cursorOf(req.query.after),
    byId: true,
    keep: (d) => !d.archivedAt && d.participantEmail === email,
  });
  res.json({
    ...page,
    rows: page.rows.map((row) =>
      pickFields(row, ["id", "amount", "currency", "status", "reference"]),
    ),
  });
});
app.get("/api/fees/workbook", async (req, res) => {
  requirePermission(req, "fees");
  const terms = searchTerms(req.query.q);
  const page = await readPage({
    query: db
      .collection("people")
      .orderBy("__name__")
      .select(
        "fullName",
        "email",
        "registrationId",
        "registrationFee",
        "feesReceived",
        "importSource",
        "archivedAt",
        "isDemo",
      ),
    collection: "people",
    limit: pageSize(req.query.limit),
    after: cursorOf(req.query.after),
    byId: true,
    keep: (d) =>
      !d.archivedAt &&
      !d.isDemo &&
      !!(d.importSource || d.feesReceived !== undefined) &&
      terms.every((term) =>
        [d.fullName, d.email, d.registrationId, d.feesReceived].some((v) =>
          String(v ?? "")
            .toLowerCase()
            .includes(term),
        ),
      ),
  });
  res.json({
    ...page,
    rows: page.rows.map((row) =>
      pickFields(row, [
        "id",
        "fullName",
        "email",
        "registrationId",
        ...financialFields,
      ]),
    ),
  });
});
// Permission-scoped metrics; local activity is loaded separately so an unrelated
// audited write does not invalidate expensive database metrics.
const overviews = memo<Record<string, unknown>>({ tags: ["overview"] });
async function overview(access: ReturnType<typeof overviewAccess>) {
  const [people, redemptions, imports, fees] = await Promise.all([
    access.people
      ? db
          .runTransaction(
            (tx) =>
              registrationCounts(db.collection("people"), (query) =>
                tx.get(query),
              ),
            { readOnly: true },
          )
          .catch(async (error: unknown) => {
            const code = (error as { code?: unknown })?.code;
            const message = (error as { message?: string })?.message || "";
            if (
              code === 9 ||
              String(code) === "9" ||
              message.includes("requires an index")
            ) {
              const snapshot = await db
                .collection("people")
                .select("isDemo", "archivedAt", "registrationStatus", "role")
                .get();
              const rows = snapshot.docs
                .map((d) => d.data())
                .filter((d) => !d.isDemo && !d.archivedAt);
              const roles = [
                "presenter",
                "attendee",
                "speaker",
                "vip",
                "organiser",
                "volunteer",
              ];
              const byRole = Object.fromEntries(
                roles.map((role) => [
                  role,
                  rows.filter((p) => p.role === role).length,
                ]),
              );
              return {
                registrations: rows.length,
                confirmed: rows.filter(
                  (p) => p.registrationStatus === "confirmed",
                ).length,
                presenters: byRole.presenter,
                byRole,
              };
            }
            throw error;
          })
      : null,
    access.meals ? db.collection("mealRedemptions").count().get() : null,
    access.imports
      ? db
          .collection("importJobs")
          .orderBy("createdAt", "desc")
          .select("fileName", "status", "total", "createdAt", "kind")
          .limit(5)
          .get()
      : null,
    access.fees
      ? db
          .collection("feeRecords")
          .select("amount", "status", "archivedAt")
          .get()
      : null,
  ]);
  const feeRows = (fees?.docs || [])
    .map((d) => d.data())
    .filter((d) => !d.archivedAt);
  return {
    ...(access.people ? people : {}),
    ...(access.meals ? { mealsServed: redemptions?.data().count ?? 0 } : {}),
    ...(access.fees
      ? {
          feeRecords: feeRows.length,
          feesReceivedAmount: feeRows
            .filter((d) => d.status === "received")
            .reduce((sum, d) => sum + Number(d.amount || 0), 0),
        }
      : {}),
    ...(access.imports
      ? {
          recentImports: (imports?.docs || []).map((d) => ({
            id: d.id,
            ...d.data(),
          })),
        }
      : {}),
  };
}
app.get("/api/overview", async (req, res) => {
  requirePermission(req, "reports");
  const access = overviewAccess(actorOf(req));
  const metrics = await overviews(JSON.stringify(access), () =>
    overview(access),
  );
  const activity = access.audit ? await readLog("audit", { limit: 8 }) : null;
  res.json({
    ...metrics,
    ...(activity
      ? {
          recentActivity: activity.rows.map((entry) => ({
            id: entry.id,
            action: entry.action,
            actorName: entry.actorName || "System",
            target: entry.target || "Application",
            createdAt: entry.createdAt,
          })),
        }
      : {}),
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
// An organiser or partner logo for the sign-in screen. It is stored on the
// server and becomes visible once listed in the conference's logos.
app.post("/api/conference/logos", upload.single("logo"), async (req, res) => {
  requirePermission(req, "conference");
  if (!req.file) fail("Choose a logo image");
  const image = sharp(req.file.buffer, { limitInputPixels: 4096 * 4096 });
  const meta = await image.metadata().catch(() => null);
  if (
    !meta ||
    !["jpeg", "png", "webp"].includes(meta.format || "") ||
    (meta.pages || 1) > 1
  )
    fail("Use a static JPEG, PNG or WebP image");
  const id = randomUUID();
  await image
    .rotate()
    .resize({
      width: 480,
      height: 480,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 90 })
    .toFile(path.join(storage, `conference-logo-${id}.webp`));
  await audit(actorOf(req), "conference.logo.upload", id);
  res.json({ src: `/api/public/conference-logo/${id}` });
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
// Cursor of the previous page: the id of its last document.
const cursorOf = (value: unknown) =>
  typeof value === "string" && value ? safeId(value) : undefined;
// Activity-style lists, newest first, a page at a time.
// The audit trail and check reports come from local log files.
for (const [route, kind] of [
  ["audit", "audit"],
  ["analysis", "analysis"],
] as const)
  app.get(`/api/${route}`, async (req, res) => {
    requirePermission(req, route);
    res.json(
      await readLog(kind, {
        limit: pageSize(req.query.limit),
        after: cursorOf(req.query.after),
      }),
    );
  });
for (const [route, collection, permission, newest] of [
  ["imports", "importJobs", "imports", "createdAt"],
  ["redemptions", "mealRedemptions", "redemptions", "redeemedAt"],
] as const) {
  app.get(`/api/${route}`, async (req, res) => {
    requirePermission(req, permission);
    res.json(
      await readPage({
        query: db.collection(collection).orderBy(newest, "desc"),
        collection,
        limit: pageSize(req.query.limit),
        after: cursorOf(req.query.after),
      }),
    );
  });
}
app.get("/api/records/:module", async (req, res) => {
  const module = z
    .enum(Object.keys(schemas) as [Module, ...Module[]])
    .parse(req.params.module);
  requirePermission(req, module);
  const collection = collectionNames[module];
  const terms = searchTerms(req.query.q);
  const keep: ((data: Record<string, unknown>) => boolean)[] = [
    (d) => !d.archivedAt,
  ];
  let query: FirebaseFirestore.Query = db
    .collection(collection)
    .orderBy("__name__");
  // People and dashboard accounts are found through their search keys;
  // the other modules are small and are matched while they are read.
  const keyed = module === "participants" || module === "users";
  if (terms.length && keyed) {
    const lookup = [...terms].sort((a, b) => b.length - a.length)[0];
    query = query.where("searchKeys", "array-contains", lookup);
    keep.push((d) => matchesTerms(d.searchKeys, terms));
  } else if (terms.length)
    keep.push((d) =>
      terms.every((term) =>
        Object.values(d).some(
          (v) =>
            ["string", "number"].includes(typeof v) &&
            String(v).toLowerCase().includes(term),
        ),
      ),
    );
  if (module === "participants") {
    const role = req.query.role
      ? z.enum(conferenceRoles).parse(req.query.role)
      : null;
    const status = req.query.status
      ? z
          .enum(["pending", "confirmed", "cancelled", "suspended"])
          .parse(req.query.status)
      : null;
    // With a search the key lookup is the indexed filter; these then apply
    // in memory, so no composite index is needed.
    if (role)
      if (terms.length) keep.push((d) => d.role === role);
      else query = query.where("role", "==", role);
    if (status)
      if (terms.length) keep.push((d) => d.registrationStatus === status);
      else query = query.where("registrationStatus", "==", status);
    if (req.query.excludeDemo === "true") keep.push((d) => !d.isDemo);
  }
  const page = await readPage({
    query,
    collection,
    limit: pageSize(req.query.limit),
    after: cursorOf(req.query.after),
    byId: true,
    keep: (d) => keep.every((test) => test(d)),
  });
  res.json({
    ...page,
    rows: page.rows.map(({ searchKeys: _keys, ...row }) =>
      module === "participants" ? participantRecord(actorOf(req), row) : row,
    ),
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
  if (module === "participants" && !can(actor, "fees", "write")) {
    if (
      input.data &&
      typeof input.data === "object" &&
      "registrationFee" in input.data
    )
      fail("Changing registration fees requires fee write permission", 403);
    delete data.registrationFee;
  }
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
  let savedAction = "";
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
      if (
        old.exists &&
        String(old.data()!.participantEmail).toLowerCase() !==
          data.participantEmail
      )
        fail("A fee record cannot be reassigned to a different participant");
      // feesReceived is the workbook's payment reference, not ledger status.
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
        ...(module === "participants"
          ? { searchKeys: personSearchKeys(data) }
          : {}),
        version: (old.data()?.version || 0) + 1,
        updatedAt: new Date().toISOString(),
        updatedBy: actor.uid,
        ...(!old.exists
          ? { createdAt: new Date().toISOString(), createdBy: actor.uid }
          : {}),
      },
      { merge: true },
    );
    // Logged once the change is committed (a retried transaction re-runs).
    savedAction = `${module}.${old.exists ? "update" : "create"}`;
  });
  await recordAudit({
    actorUid: actor.uid,
    actorName: actor.fullName,
    action: savedAction,
    target: id,
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
  });
  await audit(actor, `${module}.archive`, id);

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
            searchKeys: personSearchKeys(data),
            version: (old.data()!.version || 1) + 1,
            lastImportJobId: id,
            updatedAt: new Date().toISOString(),
            updatedBy: actorOf(req).uid,
          });
        } else
          tx.create(person, {
            ...data,
            searchKeys: personSearchKeys(data),
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
// Whole registration workbook: every discipline sheet at once, header row and
// column spellings detected per sheet. Nothing is written until commit.
app.post(
  "/api/imports/workbook/preview",
  upload.single("file"),
  async (req, res) => {
    requirePermission(req, "imports");
    if (!req.file || !req.file.originalname.toLowerCase().endsWith(".xlsx"))
      fail("Upload an .xlsx workbook");
    const options = importOptions.parse({
      defaultRole: req.body.defaultRole || undefined,
      registrationStatus: req.body.registrationStatus || undefined,
    });
    const mode = z.enum(["create", "update"]).parse(req.body.mode || "create");
    const { sheets, rows, summaries } = parseRegistrationWorkbook(
      await readWorkbook(req.file.buffer),
      options,
    );
    if (!rows.length)
      fail(
        "No participant rows found. Each sheet needs a header row with Name of Author and Email columns.",
      );
    const count = (status: string) =>
      rows.filter((r) => r.status === status).length;
    const id = randomUUID();
    await writeFile(
      path.join(storage, `import-${id}.json`),
      JSON.stringify({ rows, summaries }),
    );
    await db.doc(`importJobs/${id}`).create({
      kind: "registrationWorkbook",
      summarySheets: summaries.map((s) => s.sheet),
      fileName: req.file.originalname,
      sheet: sheets
        .filter((s) => s.headerRow)
        .map((s) => s.name)
        .join(", "),
      hash: createHash("sha256").update(req.file.buffer).digest("hex"),
      mode,
      ...options,
      status: "preview",
      total: rows.length,
      valid: count("ready"),
      needsFix: count("needs_fix"),
      duplicates: count("duplicate"),
      createdAt: new Date().toISOString(),
      createdBy: actorOf(req).uid,
    });
    res.json({ id, mode, sheets, rows, summaries });
  },
);
// Firestore and Firebase Auth calls can drop on a weak network; each import
// step is idempotent, so it is simply tried again.
const retryDelay = Number(process.env.IMPORT_RETRY_DELAY_MS ?? 1500);
async function retrying<T>(work: () => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await work();
    } catch (error) {
      // A request the server refused on purpose (fail()) is not retried.
      if (attempt >= attempts || (error as { status?: number }).status)
        throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * retryDelay));
    }
  }
}
// Saving runs in the background (the API is a persistent process), so a large
// workbook is not cut off by browser or reverse-proxy request timeouts.
app.post("/api/imports/workbook/:id/commit", async (req, res) => {
  requirePermission(req, "imports");
  const actor = actorOf(req);
  const id = safeId(req.params.id);
  const ref = db.doc(`importJobs/${id}`);
  const { rows, summaries } = JSON.parse(
    await readFile(path.join(storage, `import-${id}.json`), "utf8"),
  ) as { rows: WorkbookRow[]; summaries: SummarySheet[] };
  let job: Record<string, unknown> = {};
  await retrying(() =>
    db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) fail("Import not found", 404);
      job = snap.data()!;
      if (job.kind !== "registrationWorkbook")
        fail("This import was not created from a registration workbook");
      if (
        job.status !== "preview" &&
        job.status !== "failed" &&
        !(
          job.status === "running" &&
          Date.parse(String(job.leaseUntil)) < Date.now()
        )
      )
        fail("This import is already running or complete", 409);
      tx.update(ref, {
        status: "running",
        processed: 0,
        leaseUntil: new Date(Date.now() + 600000).toISOString(),
      });
    }),
  );
  const counts = {
    created: 0,
    updated: 0,
    existing: 0,
    needsFix: 0,
    duplicates: 0,
    loginReady: 0,
    loginFailed: 0,
  };
  const now = () => new Date().toISOString();
  async function importRow(row: WorkbookRow, index: number) {
    // Original cells are kept for every row, including ones that need fixing.
    const rowRef = db.doc(`registrationRows/${id}-${index + 1}`);
    const data = row.status === "ready" ? row.person : null;
    const personRef = data ? db.doc(`people/${String(data.email)}`) : null;
    const result = await retrying(() =>
      db.runTransaction(async (tx) => {
        const [saved, old] = await Promise.all([
          tx.get(rowRef),
          personRef ? tx.get(personRef) : Promise.resolve(null),
        ]);
        // A retried import resumes: rows already written are not written again.
        if (saved.exists)
          return {
            outcome: String(saved.data()!.outcome),
            retryLogin:
              ["created", "updated"].includes(saved.data()!.outcome) &&
              saved.data()!.login !== "ready",
          };
        const base = {
          importJobId: id,
          position: index,
          fileName: job.fileName,
          sheet: row.sheet,
          row: row.row,
          original: row.original,
          errors: row.errors,
          warnings: row.warnings,
          importedAt: now(),
          importedBy: actor.uid,
        };
        if (!data || !personRef || !old) {
          const outcome =
            row.status === "duplicate" ? "duplicate" : "needs_fix";
          tx.create(rowRef, {
            ...base,
            email: row.email,
            outcome,
          });
          return { outcome, retryLogin: false };
        }
        const importSource = {
          jobId: id,
          rowId: rowRef.id,
          sheet: row.sheet,
          row: row.row,
        };
        let outcome: string;
        const previous = old.data();
        if (
          old.exists &&
          (job.mode !== "update" || previous!.isDemo || previous!.isTestAccount)
        )
          outcome = "existing";
        else if (old.exists) {
          const update: Record<string, unknown> = { ...data };
          // Issued coupons are tied to the role; a paper entered through
          // Submissions outranks the workbook title.
          if (previous!.coupons?.length && previous!.role !== data.role)
            update.role = previous!.role;
          if (
            previous!.paper &&
            !String(previous!.paper.submissionId || "").startsWith("ABS-")
          )
            delete update.paper;
          for (const coupon of previous!.coupons || [])
            tx.update(db.doc(`couponIndex/${safeId(coupon.couponId)}`), {
              fullName: data.fullName,
            });
          tx.update(personRef, {
            ...update,
            searchKeys: personSearchKeys(data),
            importSource,
            lastImportJobId: id,
            version: (previous!.version || 1) + 1,
            updatedAt: now(),
            updatedBy: actor.uid,
          });
          outcome = "updated";
        } else {
          tx.create(personRef, {
            ...data,
            searchKeys: personSearchKeys(data),
            registrationId: `CONE-${randomUUID()}`,
            passId: `PASS-${randomUUID()}`,
            coupons: [],
            personalSchedule: [],
            duties: [],
            version: 1,
            isDemo: false,
            importJobId: id,
            importSource,
            createdAt: now(),
            createdBy: actor.uid,
          });
          outcome = "created";
        }
        tx.create(rowRef, { ...base, email: data.email, outcome });
        return { outcome, retryLogin: outcome !== "existing" };
      }),
    );
    if (result.outcome === "created") counts.created++;
    else if (result.outcome === "updated") counts.updated++;
    else if (result.outcome === "existing") counts.existing++;
    else if (result.outcome === "duplicate") counts.duplicates++;
    else counts.needsFix++;
    if (!data || !result.retryLogin) return;
    // Same login setup as a participant created by hand: a passwordless
    // Firebase account so the person can sign in with the emailed OTP.
    try {
      const identity = {
        email: String(data.email),
        fullName: String(data.fullName),
        mobile: String(data.mobile),
      };
      await retrying(async () => {
        const provisioned = await ensureIdentity(
          identity.email,
          identity.fullName,
        );
        await ensureParticipantAccess(
          provisioned.account.uid,
          identity,
          actor.uid,
        );
        await rowRef.update({ login: "ready", loginError: null });
      });
      counts.loginReady++;
    } catch (error) {
      counts.loginFailed++;
      await retrying(() =>
        rowRef.update({
          login: "failed",
          loginError: (error as Error).message.slice(0, 300),
        }),
      ).catch(() => undefined);
    }
  }
  let rowErrors = 0;
  let lastError = "";
  async function run() {
    try {
      // Summary sheets such as MAIN are stored as laid out in Excel.
      for (const [index, summary] of summaries.entries())
        await retrying(() =>
          db.doc(`workbookSummaries/${id}-${index + 1}`).set({
            ...summary,
            importJobId: id,
            position: index,
            fileName: job.fileName,
            savedAt: now(),
            savedBy: actor.uid,
          }),
        );
      // Ready rows have distinct emails, so small parallel batches cannot
      // collide. A row that still fails is left for Retry; the rest continue.
      for (let start = 0; start < rows.length; start += 8) {
        await Promise.all(
          rows.slice(start, start + 8).map((row, offset) =>
            importRow(row, start + offset).catch((error) => {
              rowErrors++;
              lastError = `${row.sheet} row ${row.row}: ${(error as Error).message}`;
            }),
          ),
        );
        await ref
          .update({
            processed: Math.min(start + 8, rows.length),
            leaseUntil: new Date(Date.now() + 600000).toISOString(),
          })
          .catch(() => undefined);
      }
    } catch (error) {
      rowErrors++;
      lastError = (error as Error).message;
    }
    const finished = {
      ...counts,
      rowErrors,
      lastError: lastError.slice(0, 500),
      processed: rows.length,
    };
    await retrying(() =>
      ref.update(
        // Failed rows and failed logins both leave the job open for Retry.
        rowErrors || counts.loginFailed
          ? { status: "failed", ...finished }
          : { status: "completed", ...finished, completedAt: now() },
      ),
    ).catch((error) => console.error(`Import ${id} status update`, error));
    clearRequestCaches(["overview", "sessions"]);
    if (!rowErrors)
      await audit(actor, "import.commit", id).catch(() => undefined);
  }
  void run();
  res.status(202).json({ status: "running", total: rows.length });
});
// A run whose lease lapsed was cut off (server restart or crash): retryable.
const stalled = (job: Record<string, unknown>) =>
  job.status === "running" && Date.parse(String(job.leaseUntil)) < Date.now();
app.get("/api/imports/workbook/:id/status", async (req, res) => {
  requirePermission(req, "imports");
  const job = (
    await db.doc(`importJobs/${safeId(req.params.id)}`).get()
  ).data();
  if (!job || job.kind !== "registrationWorkbook")
    fail("Workbook import not found", 404);
  const fields = [
    "status",
    "processed",
    "total",
    "created",
    "updated",
    "existing",
    "needsFix",
    "duplicates",
    "loginReady",
    "loginFailed",
    "rowErrors",
    "lastError",
  ];
  res.json({
    ...Object.fromEntries(fields.map((f) => [f, job[f] ?? null])),
    stalled: stalled(job),
  });
});
type ReportRow = {
  sheet: string;
  row: number;
  email: string;
  status: string;
  problems: string[];
  // Fields and original columns that are missing or invalid.
  invalidFields: string[];
  invalidColumns: string[];
  original: Record<string, string>;
};
// Saved rows once committed; the preview file until then.
async function workbookReport(id: string) {
  const job = (await db.doc(`importJobs/${id}`).get()).data();
  if (!job || job.kind !== "registrationWorkbook")
    fail("Workbook import not found", 404);
  // Every row's outcome is read, but only rows that still need attention
  // are read in full: imported rows carry their whole original record.
  const saved = await db
    .collection("registrationRows")
    .where("importJobId", "==", id)
    .select("outcome", "login")
    .get();
  let rows: ReportRow[];
  let summaries: SummarySheet[];
  if (saved.size) {
    const open = saved.docs
      .filter(
        (d) =>
          ["needs_fix", "duplicate"].includes(d.data().outcome) ||
          d.data().login === "failed",
      )
      .map((d) => d.ref);
    const chunks = [];
    for (let i = 0; i < open.length; i += 300)
      chunks.push(open.slice(i, i + 300));
    const [full, summaryDocs] = await Promise.all([
      Promise.all(chunks.map((refs) => db.getAll(...refs))),
      db.collection("workbookSummaries").where("importJobId", "==", id).get(),
    ]);
    rows = full
      .flat()
      .map((d) => d.data()!)
      .sort((a, b) => a.position - b.position)
      .map((d) => ({
        sheet: d.sheet,
        row: d.row,
        email: d.email,
        status: d.login === "failed" ? "login_failed" : d.outcome,
        invalidFields: problemFields(d.errors),
        invalidColumns: problemColumns(d.original, d.errors),
        problems: [
          ...d.errors,
          ...d.warnings,
          ...(d.login === "failed"
            ? [`Login setup failed: ${d.loginError}`]
            : []),
        ],
        original: d.original,
      }));
    summaries = summaryDocs.docs
      .map((d) => d.data())
      .sort((a, b) => a.position - b.position)
      .map(({ sheet, title, headerRows, rows }) => ({
        sheet,
        title,
        headerRows,
        rows,
      }));
  } else {
    const file = JSON.parse(
      await readFile(path.join(storage, `import-${id}.json`), "utf8"),
    ) as { rows: WorkbookRow[]; summaries: SummarySheet[] };
    rows = file.rows.map((r) => ({
      sheet: r.sheet,
      row: r.row,
      email: r.email,
      status: r.status,
      problems: [...r.errors, ...r.warnings],
      invalidFields: problemFields(r.errors),
      invalidColumns: problemColumns(r.original, r.errors),
      original: r.original,
    }));
    summaries = file.summaries;
  }
  return {
    job: {
      id,
      fileName: job.fileName,
      status: job.status,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
      total: job.total,
      valid: job.valid,
      created: job.created,
      updated: job.updated,
      existing: job.existing,
      loginReady: job.loginReady,
      loginFailed: job.loginFailed,
      processed: job.processed,
      rowErrors: job.rowErrors,
      lastError: job.lastError,
      stalled: stalled(job),
    },
    summaries,
    rowsToFix: rows.filter((r) =>
      ["needs_fix", "duplicate", "login_failed"].includes(r.status),
    ),
  };
}
app.get("/api/imports/workbook/:id/report", async (req, res) => {
  requirePermission(req, "imports");
  res.json(await workbookReport(safeId(req.params.id)));
});
// Rows to fix with every original column, plus the summary sheets, as Excel.
app.get("/api/imports/workbook/:id/rows-to-fix", async (req, res) => {
  requirePermission(req, "imports");
  const { job, summaries, rowsToFix } = await workbookReport(
    safeId(req.params.id),
  );
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Rows to fix", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  const headers = [
    ...new Set(rowsToFix.flatMap((r) => Object.keys(r.original))),
  ];
  const labels: Record<string, string> = {
    needs_fix: "Needs fix",
    duplicate: "Duplicate",
    login_failed: "Login failed",
  };
  sheet.addRow(["Sheet", "Excel row", "Status", "Problem", ...headers]);
  sheet.getRow(1).font = { bold: true };
  // Missing or invalid cells are filled red, as on screen.
  const red = {
    fill: {
      type: "pattern" as const,
      pattern: "solid" as const,
      fgColor: { argb: "FFFDE2E1" },
    },
    font: { color: { argb: "FFB42318" }, bold: true },
  };
  for (const r of rowsToFix) {
    const added = sheet.addRow([
      r.sheet,
      r.row,
      labels[r.status] || r.status,
      r.problems.join("; "),
      ...headers.map((h) => r.original[h] ?? ""),
    ]);
    if (r.invalidFields.length) added.getCell(4).font = red.font;
    for (const header of r.invalidColumns)
      Object.assign(added.getCell(5 + headers.indexOf(header)), red);
  }
  sheet.columns.forEach((column, i) => {
    column.width = i === 3 ? 45 : i < 3 ? 14 : 22;
  });
  for (const summary of summaries) {
    const out = book.addWorksheet(summary.sheet.slice(0, 31));
    let top = 1;
    if (summary.title) {
      out.getCell(1, 1).value = summary.title;
      out.getCell(1, 1).font = { bold: true, size: 13 };
      top = 3;
    }
    // Re-create merged cells from the stored column and row spans.
    const taken = new Set<string>();
    summary.rows.forEach((row, i) => {
      const r = top + i;
      let c = 1;
      for (const cell of row.cells) {
        while (taken.has(`${r}:${c}`)) c++;
        const cols = cell.colSpan || 1;
        const span = cell.rowSpan || 1;
        const target = out.getCell(r, c);
        target.value = /^\d+(\.\d+)?$/.test(cell.text)
          ? Number(cell.text)
          : cell.text;
        if (i < summary.headerRows) target.font = { bold: true };
        if (cols > 1 || span > 1)
          out.mergeCells(r, c, r + span - 1, c + cols - 1);
        for (let y = 0; y < span; y++)
          for (let x = 0; x < cols; x++) taken.add(`${r + y}:${c + x}`);
        c += cols;
      }
    });
  }
  const base = String(job.fileName || "workbook").replace(/\.xlsx$/i, "");
  res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.attachment(`rows-to-fix - ${base}.xlsx`);
  await book.xlsx.write(res);
  res.end();
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
  res.json(
    await readPage({
      query: db.collection("mediaAssets").orderBy("createdAt", "desc"),
      collection: "mediaAssets",
      limit: pageSize(req.query.limit, 24),
      after: cursorOf(req.query.after),
      keep: (d) => !d.archivedAt,
    }),
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
      html: renderEmail({
        subject: "SMTP connection successful",
        text: "Your CONE dashboard SMTP connection is working.\n\nYour email settings are ready to deliver conference messages and sign-in codes.",
        brand: await emailBranding(),
      }),
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
  // Only the columns shown; message bodies stay on the server.
  const page = await readPage({
    query: db
      .collection("emailJobs")
      .orderBy("createdAt", "desc")
      .select("recipient", "status", "attempts", "createdAt"),
    collection: "emailJobs",
    limit: pageSize(req.query.limit),
    after: cursorOf(req.query.after),
  });
  res.json(page);
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
    searchKeys: personSearchKeys(data),
    version: 1,
    createdAt: new Date().toISOString(),
    createdBy: actorOf(req).uid,
  });
  batch.create(db.collection("emailJobs").doc(), {
    recipient: data.email,
    recipientName: data.fullName,
    subject: "Your CONE dashboard invitation",
    body: `Hello {{name}},\n\nYou have been invited to the CONE conference dashboard. Complete the steps below to get your account ready.\n\n${verification ? `Verify your email:\n${verification}\n\n` : ""}Set your password:\n${reset}\n\nOpen the dashboard:\n${process.env.ADMIN_BASE_URL || "http://localhost:3000"}\n\nPrivileged accounts may also require MFA enrollment.\n\nThis invitation is personal to you. Do not forward it or share the account setup links.`,
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
  requirePermission(req, "participants");
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
    ...(can(actorOf(req), "fees", "read")
      ? ["registrationFee", "feesReceived"]
      : []),
    "accommodation",
  ];
  sheet.addRow(columns);
  for (const person of participants.docs) {
    const data = person.data();
    if (data.archivedAt) continue;
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
    cache: requestCacheStatistics(),
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
    // Quota, network or credential failures of Firebase itself.
    const outage = firebaseOutage(error);
    if (outage) {
      console.error(`Firebase ${outage.kind} failure:`, err.message);
      res.setHeader("Retry-After", outage.kind === "quota" ? "60" : "5");
      res.status(503).json({ error: outage.message });
      return;
    }
    const status =
      err.status ||
      (err.code === "auth/user-not-found"
        ? 404
        : err.code === "auth/email-already-exists"
          ? 409
          : typeof err.code === "string" && err.code.startsWith("auth/")
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
