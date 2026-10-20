import type { Express } from "express";
import rateLimit from "express-rate-limit";
import { auth, db } from "./firebase.js";

// Admin SDK generates a genuine sign-in link without delivering any email.
export function registerTestingVerification(app: Express) {
  if (process.env.TEST_IN_APP_EMAIL_VERIFICATION !== "true") return;
  if (!["test", "development"].includes(process.env.APP_ENV || ""))
    throw new Error("In-app testing verification requires APP_ENV=test or development; cannot run in production");
  const limit = () => rateLimit({ windowMs: 60_000, limit: 10 });
  const name = (v: string) => v.toLowerCase().replace(/\./g, " ").trim().split(/\s+/).join(" ");
  const mobile = (v: string) => {
    let n = v.replace(/[\s()+-]/g, "");
    if (n.length === 12 && n.startsWith("91")) n = n.slice(2);
    if (n.length === 11 && n.startsWith("0")) n = n.slice(1);
    return /^[6-9]\d{9}$/.test(n) ? n : null;
  };
  async function registration(req: any, res: any) {
    const { email, name: fullName, mobile: phone } = req.body;
    if (![email, fullName, phone].every(v => typeof v === "string") ||
        !/^[^@\s/]+@[^@\s/]+\.[^@\s/]+$/.test(email)) {
      res.status(400).json({ error: "Enter valid registration details." }); return null;
    }
    const address = email.trim().toLowerCase();
    const person = (await db.doc(`people/${address}`).get()).data();
    if (!person || name(fullName) !== name(person.fullName) ||
        !mobile(phone) || mobile(phone) !== mobile(person.mobile)) {
      res.status(400).json({ error: "The details do not match an existing registration." }); return null;
    }
    return { address, person };
  }
  // Temporary bypass: no email links, OTPs or manual verification.
  app.post("/api/testing/continue", limit(), async (req, res) => {
    const matched = await registration(req, res);
    if (!matched) return;
    const user = await auth.getUserByEmail(matched.address);
    if (user.disabled) {
      res.status(403).json({ error: "This account is disabled." }); return;
    }
    // Generate the credential before changing status, so signing errors fail closed.
    let token: string;
    try {
      token = await auth.createCustomToken(user.uid);
    } catch {
      res.status(503).json({ error: "Automatic sign-in requires Firebase Admin signing credentials. Configure a service-account credential or FIREBASE_SERVICE_ACCOUNT_ID with signBlob permission. No email was sent." });
      return;
    }
    await auth.updateUser(user.uid, { emailVerified: true });
    await db.doc(`people/${matched.address}`).update({
      emailVerified: true, emailVerificationStatus: "Verified",
    });
    res.setHeader("Cache-Control", "no-store");
    res.json({ token, status: "Verified" });
  });
  app.post("/api/testing/email-link", limit(), async (req, res) => {
    const matched = await registration(req, res);
    if (!matched) return;
    const { address } = matched;
    const link = await auth.generateSignInWithEmailLink(address, {
      url: "https://conferencemanagement-239a3.firebaseapp.com/finishSignIn",
      handleCodeInApp: true,
      android: { packageName: "com.usstc.usstc_conferenc", installApp: false, minimumVersion: "1" },
    });
    res.setHeader("Cache-Control", "no-store");
    res.json({ link });
  });
  app.post("/api/testing/email-verified", limit(), async (req, res) => {
    try {
      const token = await auth.verifyIdToken((req.headers.authorization || "").replace(/^Bearer /, ""), true);
      if (!token.email || !token.email_verified) {
        res.status(403).json({ error: "Complete Firebase verification first." }); return;
      }
      const record = db.doc(`people/${token.email.toLowerCase()}`);
      if (!(await record.get()).exists) {
        res.status(404).json({ error: "Registration not found." }); return;
      }
      await record.update({ emailVerified: true, emailVerificationStatus: "Verified" });
      res.json({ status: "Verified" });
    } catch {
      res.status(401).json({ error: "Could not save verification. Please try again." });
    }
  });
}
