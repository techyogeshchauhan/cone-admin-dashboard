import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { auth, db } from "./firebase.js";
import { accessRoles, type AccessRole } from "../shared/schema.js";

if (
  process.env.APP_ENV !== "development" ||
  process.env.ENABLE_ADMIN_TEST_ACCOUNTS !== "true"
)
  throw new Error(
    "Enable APP_ENV=development and ENABLE_ADMIN_TEST_ACCOUNTS=true explicitly first.",
  );
if (
  process.env.FIREBASE_AUTH_EMULATOR_HOST ||
  process.env.FIRESTORE_EMULATOR_HOST
)
  throw new Error(
    "This provisioning command expects the configured real Firebase project.",
  );
const key = process.env.VITE_FIREBASE_API_KEY;
if (!key)
  throw new Error("VITE_FIREBASE_API_KEY is required to verify each login.");
type Account = {
  role: AccessRole;
  email: string;
  password: string;
  uid?: string;
};
const credentialsFile = "storage/admin-test-credentials.json";
await mkdir("storage", { recursive: true });
let previous: Account[] = [];
try {
  previous = JSON.parse(await readFile(credentialsFile, "utf8")).accounts;
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
const accounts: Account[] = accessRoles.map((role) => ({
  role,
  email: `${role.replaceAll("_", "-")}@cone-admin.test`,
  password:
    previous.find((a) => a.role === role)?.password ||
    `Cone!${randomBytes(18).toString("base64url")}`,
}));
// Check ownership of existing accounts before changing anything.
for (const account of accounts) {
  const existing = await auth.getUserByEmail(account.email).catch((error) => {
    if (error.code === "auth/user-not-found") return null;
    throw error;
  });
  if (existing) {
    const profile = await db.doc(`adminUsers/${existing.uid}`).get();
    if (
      !existing.customClaims?.coneDashboardTest &&
      !profile.data()?.isTestAccount &&
      !previous.some((a) => a.email === account.email)
    )
      throw new Error(
        `Refusing to modify an account not marked as a dashboard test account: ${account.email}`,
      );
  }
}
await writeFile(
  credentialsFile,
  JSON.stringify(
    { projectId: process.env.FIREBASE_PROJECT_ID, accounts },
    null,
    2,
  ),
  { mode: 0o600 },
);
for (const [index, account] of accounts.entries()) {
  const existing = await auth.getUserByEmail(account.email).catch((error) => {
    if (error.code === "auth/user-not-found") return null;
    throw error;
  });
  // Reserved .test addresses are explicitly provisioned fixtures, never claims
  // that an external person's real mailbox was verified.
  const user = existing
    ? await auth.updateUser(existing.uid, {
        password: account.password,
        emailVerified: true,
        disabled: false,
      })
    : await auth.createUser({
        email: account.email,
        password: account.password,
        emailVerified: true,
        displayName: `CONE Test ${account.role}`,
      });
  account.uid = user.uid;
  await auth.setCustomUserClaims(user.uid, {
    ...(user.customClaims || {}),
    coneDashboardTest: true,
  });
  const fullName = `CONE Test ${account.role.replaceAll("_", " ")}`;
  const mobile = `90000001${String(index + 1).padStart(2, "0")}`;
  const conferenceRole =
    account.role === "participant"
      ? "attendee"
      : account.role === "meal_desk"
        ? "volunteer"
        : "organiser";
  const batch = db.batch();
  batch.set(
    db.doc(`adminUsers/${user.uid}`),
    {
      fullName,
      email: account.email,
      mobile,
      accessRole: account.role,
      conferenceId: "main",
      status: "active",
      isTestAccount: true,
      isDemo: true,
      version: 1,
      createdBy: "authorized-test-provisioning",
      createdAt: new Date().toISOString(),
    },
    { merge: true },
  );
  const personRef = db.doc(`people/${account.email}`);
  const person = await personRef.get();
  if (!person.exists)
    batch.create(personRef, {
      fullName,
      email: account.email,
      mobile,
      role: conferenceRole,
      affiliation: "CONE dashboard test fixture",
      registrationId: `TEST-ADMIN-${index + 1}`,
      passId: `TEST-PASS-${randomBytes(12).toString("hex")}`,
      registrationStatus: "confirmed",
      coupons: [],
      personalSchedule: [],
      duties: [],
      isDemo: true,
      isTestAccount: true,
      version: 1,
    });
  batch.create(db.collection("auditLogs").doc(), {
    actorUid: "authorized-test-provisioning",
    action: "test-account.provision",
    target: user.uid,
    role: account.role,
    createdAt: new Date().toISOString(),
  });
  await batch.commit();
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${key}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: account.email,
        password: account.password,
        returnSecureToken: true,
      }),
    },
  );
  const result = (await response.json()) as {
    idToken?: string;
    error?: { message?: string };
  };
  if (!response.ok || !result.idToken)
    throw new Error(
      `Firebase login failed for ${account.email}: ${result.error?.message || response.status}`,
    );
  const verified = await auth.verifyIdToken(result.idToken, true);
  if (verified.uid !== user.uid || verified.coneDashboardTest !== true)
    throw new Error("Test account verification failed");
  console.log(`Verified Firebase login: ${account.email} (${account.role})`);
}
await writeFile(
  credentialsFile,
  JSON.stringify(
    { projectId: process.env.FIREBASE_PROJECT_ID, accounts },
    null,
    2,
  ),
  { mode: 0o600 },
);
console.log(`Credentials saved in ignored local file: ${credentialsFile}`);
