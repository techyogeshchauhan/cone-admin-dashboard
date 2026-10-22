import { randomUUID } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";

export const leaderRenewMs = 300000;
export const leaderTtlMs = 600000;
// One leader per database across hosts, not just a PID file per checkout.
// A duplicate exits normally, so systemd Restart=on-failure cannot spin it.
export async function acquireWorkerLease(db: Firestore, clock?: () => number) {
  const owner = randomUUID();
  const ref = db.doc("applicationLocks/emailWorker");
  async function renew(initial = false) {
    return db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      const current = snapshot.data();
      // Lease arbitration uses the database clock, avoiding cross-host skew.
      // An explicit clock is used only by the local expiry integration test.
      const at = clock?.() ?? snapshot.readTime.toMillis();
      if (
        initial
          ? current?.owner && current.until > at
          : current?.owner !== owner || current.until <= at
      )
        return false;
      tx.set(ref, {
        owner,
        until: at + leaderTtlMs,
        updatedAt: new Date(at).toISOString(),
      });
      return true;
    });
  }
  if (!(await renew(true))) return null;
  return {
    owner,
    ref,
    renew: () => renew(),
    valid: (
      value: Record<string, any> | undefined,
      at = clock?.() ?? Date.now(),
    ) => value?.owner === owner && value.until > at,
    release: () =>
      db.runTransaction(async (tx) => {
        const current = (await tx.get(ref)).data();
        if (current?.owner === owner) tx.set(ref, { owner, until: 0 });
      }),
  };
}
