import { auth, db } from "./firebase.js";
import { identity } from "../shared/schema.js";
const [email, fullName, mobile] = process.argv.slice(2);
const person = identity.parse({ email, fullName, mobile });
const user = await auth.getUserByEmail(person.email);
if (!user.emailVerified)
  throw new Error(
    "Verify this Firebase account email before assigning Super Admin.",
  );
await db.runTransaction(async (tx) => {
  const lock = db.doc("applicationSettings/bootstrap");
  const [initialized, existing] = await Promise.all([
    tx.get(lock),
    tx.get(
      db
        .collection("adminUsers")
        .where("accessRole", "==", "superadmin")
        .limit(1),
    ),
  ]);
  if (initialized.exists || !existing.empty)
    throw new Error(
      "A Super Admin already exists. Use the authenticated dashboard to manage users.",
    );
  tx.create(db.doc(`adminUsers/${user.uid}`), {
    ...person,
    accessRole: "superadmin",
    conferenceId: "main",
    status: "active",
    version: 1,
    createdAt: new Date().toISOString(),
    createdBy: "bootstrap",
  });
  tx.create(lock, { initializedAt: new Date().toISOString() });
});
console.log(
  "Super Admin assigned. Sign in with the existing verified Firebase account.",
);
