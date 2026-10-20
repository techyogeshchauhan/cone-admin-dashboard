import {
  createHmac,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type { Express } from "express";
import { z } from "zod";
import { auth, db } from "./firebase.js";
import { mailTransport, sender } from "./mail.js";
import { mobile } from "../shared/schema.js";

const identitySchema = z
  .object({
    name: z.string().trim().min(2).max(150),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.email())
      .refine((value) => !value.includes("/"), "Invalid registration email"),
    mobile,
    audience: z.literal("mobile").default("mobile"),
  })
  .strict();
const verifySchema = z
  .object({ challengeId: z.uuid(), code: z.string().regex(/^\d{6}$/) })
  .strict();
const invalid = () =>
  Object.assign(
    new Error("Invalid or expired code. Request a new code if needed."),
    { status: 400 },
  );
const notFound = () =>
  Object.assign(
    new Error(
      "User data not found in system. Check your name, email and mobile number, or contact the organiser.",
    ),
    { status: 404 },
  );
const normalizedName = (name: string) =>
  name.toLowerCase().replace(/\./g, " ").trim().split(/\s+/).join(" ");
const ttl = 5 * 60_000;
function key() {
  const value = process.env.OTP_HMAC_SECRET || "";
  if (Buffer.from(value, "base64").length < 32)
    throw new Error(
      "OTP_HMAC_SECRET must be a base64 encoded secret of at least 32 bytes",
    );
  return Buffer.from(value, "base64");
}
function digest(value: string) {
  return createHmac("sha256", key()).update(value).digest("hex");
}
function codeHash(id: string, code: string) {
  return digest(`code:${id}:${code}`);
}
const timestamp = () => new Date().toISOString();
export async function eligible(identity: z.infer<typeof identitySchema>) {
  const person = (await db.doc(`people/${identity.email}`).get()).data();
  if (
    !person ||
    person.archivedAt ||
    ["cancelled", "suspended"].includes(person.registrationStatus) ||
    normalizedName(person.fullName || "") !== normalizedName(identity.name) ||
    mobile.safeParse(person.mobile).data !== identity.mobile
  )
    return null;
  const account = await auth.getUserByEmail(identity.email).catch((error) => {
    if (error.code === "auth/user-not-found") return null;
    throw error;
  });
  if (
    !account ||
    account.disabled ||
    account.customClaims?.coneDashboardTest ||
    person.isDemo
  )
    return null;
  return account;
}

export async function requestEmailOtp(body: unknown, ip: string) {
  const identity = identitySchema.parse(body);
  const id = randomUUID(),
    code = String(randomInt(0, 1_000_000)).padStart(6, "0"),
    now = Date.now();
  const account = await eligible(identity);
  const accountRef = db.doc(
      `authOtpLimits/${digest(`account:${identity.email}`)}`,
    ),
    ipRef = db.doc(`authOtpLimits/${digest(`ip:${ip}`)}`),
    ref = db.doc(`authChallenges/${id}`);
  await db.runTransaction(async (tx) => {
    const [a, i, runtime] = await Promise.all([
      tx.get(accountRef),
      tx.get(ipRef),
      tx.get(db.doc("applicationSettings/runtime")),
    ]);
    if (runtime.data()?.emailEnabled === false)
      throw Object.assign(
        new Error("Email sign-in is temporarily unavailable."),
        { status: 503 },
      );
    // Unmatched details count only against the IP, so a typo does not start
    // the per-account cooldown but repeated lookups are still throttled.
    for (const [snapshot, limit] of account
      ? ([
          [a, 5],
          [i, 30],
        ] as const)
      : ([[i, 30]] as const)) {
      const data = snapshot.data();
      if (data && now - data.windowStart < 900_000 && data.count >= limit)
        throw Object.assign(new Error("Too many requests. Try again later."), {
          status: 429,
        });
    }
    if (account && a.data()?.lastSentAt && now - a.data()!.lastSentAt < 60_000)
      throw Object.assign(
        new Error("Wait 60 seconds before requesting another code."),
        { status: 429 },
      );
    for (const [snapshot, limitRef] of account
      ? ([
          [a, accountRef],
          [i, ipRef],
        ] as const)
      : ([[i, ipRef]] as const)) {
      const data = snapshot.data();
      tx.set(
        limitRef,
        {
          windowStart:
            data && now - data.windowStart < 900_000 ? data.windowStart : now,
          count: data && now - data.windowStart < 900_000 ? data.count + 1 : 1,
          lastSentAt: now,
          ...(limitRef === accountRef ? { latest: id } : {}),
          expiresAt: new Date(now + 86400_000),
        },
        { merge: true },
      );
    }
    tx.create(db.doc(`auditLogs/${randomUUID()}`), {
      action: account ? "auth.otp.request" : "auth.otp.not_found",
      actorUid: "authentication",
      actorName: "Email sign-in",
      target: account ? id : "unmatched-details",
      createdAt: timestamp(),
    });
    if (!account) return;
    tx.create(ref, {
      ...identity,
      uid: account.uid,
      accountKey: accountRef.id,
      hash: codeHash(id, code),
      attempts: 0,
      status: "delivering",
      createdAt: timestamp(),
      expiresAt: new Date(now + ttl),
      expiresAtMs: now + ttl,
    });
  });
  if (!account) throw notFound();
  // The response does not wait for SMTP. Codes remain only in this bounded
  // in-memory delivery task, never in the general queue.
  const deliver = async () => {
    try {
      await (
        await mailTransport()
      ).sendMail({
        from: await sender(),
        to: identity.email,
        subject: "Your CONE sign-in code",
        text: `Your CONE sign-in code is ${code}. It expires in 5 minutes. Do not share this code. If you did not request it, ignore this email.`,
      });
      await ref.update({ status: "pending" });
    } catch {
      await ref.update({ status: "delivery_failed", hash: null });
    }
  };
  void deliver().catch(() =>
    console.error("OTP delivery status could not be recorded"),
  );
  return {
    challengeId: id,
    expiresInSeconds: 300,
    resendAfterSeconds: 60,
    message: "A six-digit code has been sent to your registered email.",
  };
}

export async function verifyEmailOtp(body: unknown, ip = "internal") {
  const { challengeId, code } = verifySchema.parse(body),
    ref = db.doc(`authChallenges/${challengeId}`),
    now = Date.now();
  const ipRef = db.doc(`authOtpVerifyLimits/${digest(`verify-ip:${ip}`)}`);
  await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ipRef),
      data = snapshot.data(),
      recent = data && Date.now() - data.windowStart < 900_000;
    if (recent && data.count >= 60)
      throw Object.assign(new Error("Too many attempts. Try again later."), {
        status: 429,
      });
    tx.set(ipRef, {
      windowStart: recent ? data.windowStart : Date.now(),
      count: recent ? data.count + 1 : 1,
      expiresAt: new Date(Date.now() + 86400_000),
    });
  });
  const result = await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref),
      data = snapshot.data();
    if (!data) return null;
    const accountRef = db.doc(`authOtpLimits/${data.accountKey}`),
      attemptRef = db.doc(`authOtpAttempts/${data.accountKey}`);
    const [account, attempts] = await Promise.all([
      tx.get(accountRef),
      tx.get(attemptRef),
    ]);
    const attemptData = attempts.data(),
      current =
        attemptData && now - attemptData.windowStart < 900_000
          ? attemptData.count
          : 0;
    if (
      data.status !== "pending" ||
      data.expiresAtMs <= Date.now() ||
      data.attempts >= 5 ||
      current >= 20 ||
      account.data()?.latest !== challengeId
    )
      return null;
    const expected = Buffer.from(String(data.hash), "hex"),
      actual = Buffer.from(codeHash(challengeId, code), "hex");
    const valid =
      expected.length === actual.length && timingSafeEqual(expected, actual);
    tx.set(attemptRef, {
      windowStart: current ? attemptData!.windowStart : now,
      count: current + 1,
      expiresAt: new Date(now + 86400_000),
    });
    tx.create(db.doc(`auditLogs/${randomUUID()}`), {
      action: valid ? "auth.otp.verified" : "auth.otp.rejected",
      actorUid: "authentication",
      actorName: "Email sign-in",
      target: challengeId,
      createdAt: timestamp(),
    });
    tx.update(ref, {
      attempts: data.attempts + 1,
      ...(valid ? { status: "used", usedAt: timestamp(), hash: null } : {}),
    });
    return valid ? data : null;
  });
  if (!result) throw invalid();
  const identity = identitySchema.parse({
    name: result.name,
    email: result.email,
    mobile: result.mobile,
    audience: result.audience,
  });
  const account = await eligible(identity);
  if (!account || account.uid !== result.uid) throw invalid();
  // The challenge is consumed before any session credential can be issued.
  await auth.updateUser(account.uid, { emailVerified: true });
  await db.doc(`people/${identity.email}`).update({
    emailVerified: true,
    emailVerificationStatus: "Verified",
    emailVerificationMethod: "email_otp",
    lastEmailOtpVerifiedAt: timestamp(),
  });
  const token = await auth.createCustomToken(account.uid, {
    login_method: "email_otp",
    login_audience: "mobile",
    otp_verified_at: Math.floor(now / 1000),
  });
  return { token };
}

export function registerEmailOtp(app: Express) {
  if (process.env.OTP_AUTH_ENABLED !== "true") return;
  key();
  if (
    process.env.APP_ENV === "production" &&
    (process.env.TEST_IN_APP_EMAIL_VERIFICATION === "true" ||
      process.env.ENABLE_DASHBOARD_ROLE_LOGIN === "true" ||
      process.env.ENABLE_ADMIN_TEST_ACCOUNTS === "true")
  )
    throw new Error(
      "Production OTP cannot run with development authentication bypasses",
    );
  const secure = (req: any) =>
    process.env.APP_ENV !== "production" || req.secure;
  for (const action of ["request", "resend"] as const)
    app.post(`/api/auth/email-otp/${action}`, async (req, res) => {
      if (!secure(req))
        return void res.status(400).json({ error: "HTTPS is required" });
      res.setHeader("Cache-Control", "no-store");
      res.json(await requestEmailOtp(req.body, req.ip || "unknown"));
    });
  app.post("/api/auth/email-otp/verify", async (req, res) => {
    if (!secure(req))
      return void res.status(400).json({ error: "HTTPS is required" });
    res.setHeader("Cache-Control", "no-store");
    res.json(await verifyEmailOtp(req.body, req.ip || "unknown"));
  });
}
