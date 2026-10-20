// Real-database integration check. Uses the application's actual routes and Firebase.
// Run: npx tsx server/verify-test-accounts.ts
// Reads the mobile app's seed data and google-services.json from APP_REPO_DIR
// (default ../Cone, the separate Flutter app repository).
import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import supertest from "supertest";

if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST)
  throw new Error("Live account check must not use emulators");
process.env.NODE_ENV = "test";
process.env.APP_ENV = "test";
process.env.TEST_IN_APP_EMAIL_VERIFICATION = "true";
process.env.FIREBASE_PROJECT_ID = "conferencemanagement-239a3";
const { app } = await import("./index.js");
const { auth, db } = await import("./firebase.js");
const api = supertest(app);
const appRepo = path.resolve(process.env.APP_REPO_DIR || "../Cone");
const seed = JSON.parse(readFileSync(path.join(appRepo, "tools/seed/seed_data.json"), "utf8"));
const config = JSON.parse(readFileSync(path.join(appRepo, "android/app/google-services.json"), "utf8"));
const key = config.client.find((c: any) => c.client_info.android_client_info.package_name === "com.usstc.usstc_conferenc").api_key[0].current_key;
const expected = [
  ["presenter", "Aarav Mehra", "presenter@gmail.com", "9876543210"],
  ["attendee", "Riya Bhandari", "attendee@gmail.com", "9876543211"],
  ["speaker", "Prof. Nandini Rautela", "speaker@gmail.com", "9876543212"],
  ["vip", "Dr. Vinod Tamta", "vip@gmail.com", "9876543213"],
  ["organiser", "Dr. Kavita Negi", "organizer@gmail.com", "9876543214"],
  ["volunteer", "Rohit Bisht", "volunteer@gmail.com", "9876543215"],
];
for (const [role, fullName, email, mobile] of expected) {
  const record = db.doc(`people/${email}`);
  const before = (await record.get()).data();
  const fixture = seed.people.find((p: any) => p.email === email);
  // Upsert only the requested identity fields; existing IDs and relationships stay intact.
  if (before) await record.update({ role, fullName, email, mobile });
  else await record.create({ ...fixture, role, fullName, email, mobile });
  let user;
  try { user = await auth.getUserByEmail(email); }
  catch (e: any) {
    if (e.code !== "auth/user-not-found") throw e;
    user = await auth.createUser({email, displayName: fullName, emailVerified: false});
  }
  const baseline = (await record.get()).data()!;
  const continued = await api.post("/api/testing/continue").send({ name: fullName, email, mobile });
  if (continued.status !== 200 || !continued.body.token || continued.body.status !== "Verified")
    throw new Error(`${role}: automatic Continue failed (${continued.status}): ${JSON.stringify(continued.body)}`);
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${key}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: continued.body.token, returnSecureToken: true }),
  });
  const result = await response.json() as any;
  if (!response.ok || result.localId !== user.uid) throw new Error(`${role}: Firebase sign-in failed`);
  const after = (await record.get()).data();
  if (!isDeepStrictEqual(after, { ...baseline, emailVerified: true, emailVerificationStatus: "Verified" }))
    throw new Error(`${role}: unexpected database changes`);
  const authAfter = await auth.getUser(user.uid);
  if (authAfter.email !== email || !authAfter.emailVerified) throw new Error(`${role}: Auth verification missing`);
  const ownRead = await fetch(`https://firestore.googleapis.com/v1/projects/conferencemanagement-239a3/databases/(default)/documents/people/${encodeURIComponent(email)}`, {
    headers: { Authorization: `Bearer ${result.idToken}` },
  });
  if (!ownRead.ok) throw new Error(`${role}: authenticated registration access denied`);
  if (before) {
    for (const [field, value] of Object.entries(before)) {
      if (!["role", "fullName", "email", "mobile", "emailVerified", "emailVerificationStatus"].includes(field) && !isDeepStrictEqual(after![field], value))
        throw new Error(`${role}: associated information changed: ${field}`);
    }
  }
  console.log(`${role}: Continue passed without verification links, Firebase login passed, UID preserved, Verified persisted.`);
}
const people = await db.collection("people").get();
console.log(`Completed six live-account checks. Total people records: ${people.size}.`);
