import { randomUUID } from "node:crypto";
import { auth, db } from "./firebase.js";

export function developmentVerificationBypass() {
  return (
    process.env.NODE_ENV !== "production" &&
    ["test", "development"].includes(process.env.APP_ENV || "") &&
    process.env.TEST_IN_APP_EMAIL_VERIFICATION === "true"
  );
}

// The dashboard never sets passwords. New logins are created without one:
// participants sign in to the app with an emailed code, and dashboard users set
// their own password from an invitation or password-reset email.
export async function ensureIdentity(email: string, fullName: string) {
  try {
    return { account: await auth.getUserByEmail(email), created: false };
  } catch (error) {
    if ((error as { code?: string }).code !== "auth/user-not-found")
      throw error;
    const account = await auth.createUser({
      email,
      displayName: fullName,
      emailVerified: developmentVerificationBypass(),
    });
    return { account, created: true };
  }
}

export function personDefaults() {
  return {
    registrationId: `CONE-${randomUUID()}`,
    passId: `PASS-${randomUUID()}`,
    role: "attendee",
    affiliation: "Not specified",
    registrationStatus: "pending",
    coupons: [],
    personalSchedule: [],
    duties: [],
    isDemo: false,
  };
}

export async function ensurePerson(
  identity: { email: string; fullName: string; mobile: string },
  actorUid: string,
) {
  const ref = db.doc(`people/${identity.email}`);
  await db.runTransaction(async (tx) => {
    const old = await tx.get(ref);
    tx.set(
      ref,
      {
        ...(!old.exists ? personDefaults() : {}),
        email: identity.email,
        fullName: identity.fullName,
        mobile: identity.mobile,
        version: (old.data()?.version || 0) + 1,
        updatedAt: new Date().toISOString(),
        updatedBy: actorUid,
      },
      { merge: true },
    );
  });
}

export async function ensureParticipantAccess(
  uid: string,
  identity: { email: string; fullName: string; mobile: string },
  actorUid: string,
) {
  const ref = db.doc(`adminUsers/${uid}`);
  await db.runTransaction(async (tx) => {
    const existing = await tx.get(ref);
    // A registration editor must never overwrite an existing privileged role.
    if (!existing.exists)
      tx.create(ref, {
        ...identity,
        accessRole: "participant",
        conferenceId: "main",
        status: "active",
        version: 1,
        createdBy: actorUid,
        createdAt: new Date().toISOString(),
      });
  });
}
