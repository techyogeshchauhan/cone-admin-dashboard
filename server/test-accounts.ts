import type { Express } from "express";
import rateLimit from "express-rate-limit";
import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import { auth, db } from "./firebase.js";
import { recordAudit } from "./activity-log.js";
import { identitySchema, normalizedName } from "./email-otp.js";
import { mobile, type Actor } from "../shared/schema.js";

// A registration a Super Admin marks with accountType "test" signs in to the
// mobile app with its name, email and mobile alone: no emailed code. Every
// other registration still uses email OTP.
const fail = (message: string, status: number) =>
  Object.assign(new Error(message), { status });

export function registerTestAccountLogin(app: Express) {
  if (process.env.ALLOW_TEST_ACCOUNT_LOGIN !== "true") return;
  app.post(
    "/api/auth/test-login",
    rateLimit({ windowMs: 60_000, limit: 10 }),
    async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      if (process.env.APP_ENV === "production" && !req.secure)
        return void res.status(400).json({ error: "HTTPS is required" });
      const identity = identitySchema.parse(req.body);
      const person = (await db.doc(`people/${identity.email}`).get()).data();
      // The app falls back to email OTP on this answer, so it says nothing
      // about whether the registration exists.
      const notTest = () =>
        void res.status(404).json({ error: "Not a test account" });
      if (
        !person ||
        person.accountType !== "test" ||
        person.archivedAt ||
        ["cancelled", "suspended"].includes(person.registrationStatus) ||
        normalizedName(person.fullName || "") !==
          normalizedName(identity.name) ||
        mobile.safeParse(person.mobile).data !== identity.mobile
      )
        return notTest();
      const account = await auth
        .getUserByEmail(identity.email)
        .catch((error) => {
          if (error.code === "auth/user-not-found") return null;
          throw error;
        });
      if (
        !account ||
        account.disabled ||
        account.customClaims?.coneDashboardTest
      )
        return notTest();
      const now = Date.now();
      if (!account.emailVerified)
        await auth.updateUser(account.uid, { emailVerified: true });
      await db.doc(`people/${identity.email}`).update({
        emailVerified: true,
        emailVerificationStatus: "Verified",
        emailVerificationMethod: "test_account",
      });
      const token = await auth.createCustomToken(account.uid, {
        login_method: "test_account",
        login_audience: "mobile",
        otp_verified_at: Math.floor(now / 1000),
      });
      await recordAudit({
        actorUid: account.uid,
        actorName: person.fullName,
        action: "auth.test_account.login",
        target: identity.email,
      });
      res.json({ token });
    },
  );
}

// Registered after the dashboard authentication middleware.
export function registerTestAccountAdmin(app: Express) {
  app.put("/api/people/:email/test-account", async (req, res) => {
    const actor = (req as unknown as { actor: Actor }).actor;
    if (actor.role !== "superadmin")
      throw fail("Only Super Admin can change test accounts", 403);
    const email = z.email().parse(req.params.email).toLowerCase();
    const { enabled } = z
      .object({ enabled: z.boolean() })
      .strict()
      .parse(req.body);
    const ref = db.doc(`people/${email}`);
    if (!(await ref.get()).exists) throw fail("Participant not found", 404);
    await ref.update({
      accountType: enabled ? "test" : FieldValue.delete(),
      updatedAt: new Date().toISOString(),
      updatedBy: actor.uid,
    });
    // Ending the flag also ends sessions it already granted.
    if (!enabled) {
      const account = await auth.getUserByEmail(email).catch(() => null);
      if (account) await auth.revokeRefreshTokens(account.uid);
    }
    await recordAudit({
      actorUid: actor.uid,
      actorName: actor.fullName,
      action: enabled
        ? "participants.test_account.on"
        : "participants.test_account.off",
      target: email,
    });
    res.json({ email, accountType: enabled ? "test" : null });
  });
}
