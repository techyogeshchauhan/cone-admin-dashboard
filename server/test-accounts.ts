import type { Express } from "express";
import rateLimit from "express-rate-limit";
import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import { auth, db } from "./firebase.js";
import { recordAudit } from "./activity-log.js";
import { identitySchema, normalizedName } from "./email-otp.js";
import { mobile, type Actor } from "../shared/schema.js";

// A registration a Super Admin adds to the testAccounts collection signs in to
// the mobile app with its name, email and mobile alone: no emailed code.
// Every other registration still uses email OTP. people/{email}.accountType
// mirrors membership for the participant list; both change in one
// transaction, and login requires both.
const fail = (message: string, status: number) =>
  Object.assign(new Error(message), { status });
const loginEnabled = () => process.env.ALLOW_TEST_ACCOUNT_LOGIN === "true";

export function registerTestAccountLogin(app: Express) {
  if (!loginEnabled()) return;
  app.post(
    "/api/auth/test-login",
    rateLimit({ windowMs: 60_000, limit: 10 }),
    async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      if (process.env.APP_ENV === "production" && !req.secure)
        return void res.status(400).json({ error: "HTTPS is required" });
      const identity = identitySchema.parse(req.body);
      const [personDoc, testDoc] = await Promise.all([
        db.doc(`people/${identity.email}`).get(),
        db.doc(`testAccounts/${identity.email}`).get(),
      ]);
      const person = personDoc.data();
      // The app falls back to email OTP on this answer, so it says nothing
      // about whether the registration exists.
      const notTest = () =>
        void res.status(404).json({ error: "Not a test account" });
      if (
        !person ||
        !testDoc.exists ||
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
      await Promise.all([
        db.doc(`people/${identity.email}`).update({
          emailVerified: true,
          emailVerificationStatus: "Verified",
          emailVerificationMethod: "test_account",
        }),
        db
          .doc(`testAccounts/${identity.email}`)
          .update({ lastLoginAt: new Date(now).toISOString() }),
      ]);
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

function superAdmin(req: unknown) {
  const actor = (req as { actor: Actor }).actor;
  if (actor.role !== "superadmin")
    throw fail("Only Super Admin can manage test accounts", 403);
  return actor;
}

// Registered after the dashboard authentication middleware.
export function registerTestAccountAdmin(app: Express) {
  app.get("/api/test-accounts", async (req, res) => {
    superAdmin(req);
    const snapshot = await db.collection("testAccounts").orderBy("email").get();
    res.setHeader("Cache-Control", "no-store");
    res.json({
      loginEnabled: loginEnabled(),
      rows: snapshot.docs.map((d) => ({ id: d.id, ...d.data() })),
    });
  });
  app.put("/api/people/:email/test-account", async (req, res) => {
    const actor = superAdmin(req);
    const email = z.email().parse(req.params.email).toLowerCase();
    const { enabled } = z
      .object({ enabled: z.boolean() })
      .strict()
      .parse(req.body);
    const personRef = db.doc(`people/${email}`),
      testRef = db.doc(`testAccounts/${email}`);
    const now = new Date().toISOString();
    await db.runTransaction(async (tx) => {
      const person = (await tx.get(personRef)).data();
      if (!person || person.archivedAt)
        throw fail("No active participant with this email", 404);
      tx.update(personRef, {
        accountType: enabled ? "test" : FieldValue.delete(),
        updatedAt: now,
        updatedBy: actor.uid,
      });
      if (enabled)
        tx.set(testRef, {
          email,
          fullName: person.fullName,
          mobile: person.mobile,
          role: person.role,
          addedAt: now,
          addedBy: actor.uid,
          addedByName: actor.fullName,
        });
      else tx.delete(testRef);
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
