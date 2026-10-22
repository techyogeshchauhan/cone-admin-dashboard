import assert from "node:assert/strict";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { registrationCounts } from "../server/overview-counts.js";
import { acquireWorkerLease, leaderTtlMs } from "../server/worker-lease.js";

// No ADC, .env or production modules. Refuse every non-local target before
// constructing a client. This script is only run by the emulator command.
const project = "demo-cone-quota";
assert(
  /^(127\.0\.0\.1|localhost):\d+$/.test(
    process.env.FIRESTORE_EMULATOR_HOST ?? "",
  ),
  "Local emulator required",
);
assert(
  !process.env.GCLOUD_PROJECT || process.env.GCLOUD_PROJECT === project,
  "Demo project required",
);
const app = initializeApp({ projectId: project }, "quota-integration");
const db = getFirestore(app);
try {
  const batch = db.batch();
  const rows = [
    {
      fullName: "Same name",
      role: "presenter",
      registrationStatus: "confirmed",
    },
    {
      fullName: "Same name",
      role: "attendee",
      registrationStatus: "pending",
      archivedAt: null,
      isDemo: false,
    },
    { fullName: "Same name", role: "speaker", archivedAt: "" },
    { fullName: "Same name", role: "vip", isDemo: true },
    { fullName: "Same name", role: "organiser", archivedAt: "2026-10-01" },
    {
      fullName: "Same name",
      role: "volunteer",
      isDemo: true,
      archivedAt: "2026-10-01",
    },
  ];
  rows.forEach((row, i) => batch.set(db.doc(`people/person${i}`), row));
  await batch.commit();
  const counts = await db.runTransaction(
    (tx) =>
      registrationCounts(db.collection("people"), (query) => tx.get(query)),
    { readOnly: true },
  );
  assert.equal(counts.registrations, 3);
  assert.equal(counts.confirmed, 1);
  assert.deepEqual(counts.byRole, {
    presenter: 1,
    attendee: 1,
    speaker: 1,
    vip: 0,
    organiser: 0,
    volunteer: 0,
  });
  console.log(
    "PASS: real Firestore aggregation semantics match legacy visibility",
  );
  const [one, two] = await Promise.all([
    acquireWorkerLease(db),
    acquireWorkerLease(db),
  ]);
  assert.equal([one, two].filter(Boolean).length, 1);
  const leader = (one ?? two)!;
  assert.equal(await acquireWorkerLease(db), null);
  assert.equal(await leader.renew(), true);
  const replacement = await acquireWorkerLease(
    db,
    () => Date.now() + leaderTtlMs + 1000,
  );
  assert(replacement);
  assert.equal(await leader.renew(), false);
  await leader.release();
  assert.equal((await replacement.ref.get()).data()?.owner, replacement.owner);
  await replacement.release();
  console.log(
    "PASS: concurrent singleton claims, renewal, expiry, fencing and safe release",
  );
} finally {
  await db.terminate();
  await deleteApp(app);
}
