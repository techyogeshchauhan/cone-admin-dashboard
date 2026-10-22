import "dotenv/config";
import { randomUUID } from "node:crypto";
import { db } from "./firebase.js";
import { mailTransport, sender, smtpConfiguration } from "./mail.js";
import {
  QueueSchedule,
  nextDue,
  retryDelay,
  type JobData,
  type QueueDocument,
} from "./worker-queue.js";
import { acquireWorkerLease, leaderRenewMs } from "./worker-lease.js";
export { nextDue } from "./worker-queue.js";
import { firebaseOutage } from "./firebase-errors.js";
import { renderEmail } from "../shared/email-design.js";
import { emailBranding } from "./email-branding.js";
let stopping = false;
// Ends the wait between polls at once when the worker is asked to stop.
let wake = () => {};
process.on("SIGINT", () => {
  stopping = true;
  wake();
});
process.on("SIGTERM", () => {
  stopping = true;
  wake();
});
const active = ["queued", "retry", "processing"];
export async function tick(
  documents: QueueDocument[],
  options: {
    enabled?: boolean;
    leader?: Awaited<ReturnType<typeof acquireWorkerLease>>;
    observed?: (document: QueueDocument, data: JobData | null) => void;
  } = {},
) {
  if (options.enabled === false) return "disabled";
  let claimed = 0;
  for (const document of documents) {
    if (stopping) return claimed;
    if (nextDue([document.data()]) !== 0) continue;
    const lease = randomUUID();
    let observed: JobData | null = null;
    let disabled = false;
    const job = await db.runTransaction(async (tx) => {
      disabled = false;
      observed = null;
      const snapshot = await tx.get(
        document.ref as import("firebase-admin/firestore").DocumentReference,
      );
      const data = snapshot.data();
      observed = data ?? null;
      if (!data || !["queued", "retry", "processing"].includes(data.status))
        return null;
      if (nextDue([data]) !== 0) return null;
      const runtime = await tx.get(db.doc("applicationSettings/runtime"));
      if (options.leader) {
        const leader = await tx.get(options.leader.ref);
        if (!options.leader.valid(leader.data(), leader.readTime.toMillis()))
          throw new Error("WORKER_LEASE_LOST");
      }
      if (runtime.data()?.emailEnabled === false) {
        disabled = true;
        return null;
      }
      if (
        data.status === "processing" &&
        Date.parse(data.leaseUntil) > Date.now()
      )
        return null;
      if (data.nextAttemptAt && Date.parse(data.nextAttemptAt) > Date.now())
        return null;
      if ((data.attempts || 0) >= 5) {
        tx.update(document.ref, {
          status: "failed",
          error: "Maximum delivery attempts reached",
        });
        observed = null;
        return null;
      }
      tx.update(document.ref, {
        status: "processing",
        lease,
        leaseUntil: new Date(Date.now() + 120000).toISOString(),
        attempts: (data.attempts || 0) + 1,
      });
      return data;
    });
    if (disabled) return "disabled";
    if (!job) {
      options.observed?.(document, observed);
      continue;
    }
    claimed++;
    try {
      const text = String(job.body).replaceAll(
        "{{name}}",
        String(job.recipientName || "Participant"),
      );
      const config = await smtpConfiguration();
      await (
        await mailTransport(config)
      ).sendMail({
        from: await sender(config),
        to: job.recipient,
        subject: job.subject,
        text,
        html: renderEmail({
          subject: String(job.subject),
          text,
          brand: await emailBranding(),
        }),
        messageId: `<${document.id}@cone.local>`,
      });
    } catch (error) {
      if (firebaseOutage(error)) throw error;
      const code = (error as { code?: string }).code;
      await document.ref.update({
        status: "retry",
        error: code || "DELIVERY_FAILED",
        nextAttemptAt: new Date(
          Date.now() + Math.min(3600000, 30000 * 2 ** (job.attempts || 0)),
        ).toISOString(),
      });
      continue;
    }
    await document.ref.update({
      status: "sent",
      sentAt: new Date().toISOString(),
      deliveryFormat: "html",
      rendererVersion: "cone-branded-v1",
      error: null,
    });
  }
  return claimed;
}

// One wait primitive for normal notifications. Error backoff uses an absolute
// deadline: snapshot feedback cannot shorten it. Shutdown always wakes it.
const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, Math.min(ms, 2147483647));
    wake = () => {
      clearTimeout(timer);
      resolve();
    };
  });

export async function runWorker(signal?: AbortSignal) {
  const stop = () => wake();
  const leader = await acquireWorkerLease(db);
  if (!leader) {
    console.log(
      JSON.stringify({
        event: "email_worker_duplicate",
        project: process.env.FIREBASE_PROJECT_ID,
        pid: process.pid,
      }),
    );
    return "standby" as const;
  }
  signal?.addEventListener("abort", stop, { once: true });
  console.log(
    JSON.stringify({
      event: "email_worker_started",
      project: process.env.FIREBASE_PROJECT_ID,
      pid: process.pid,
    }),
  );
  const schedule = new QueueSchedule();
  const switches: { enabled: boolean | null; revision: number } = {
    enabled: null,
    revision: 0,
  };
  let listenerError: unknown = null;
  let failed = 0;
  let notBefore = 0;
  let renewAt = Date.now() + leaderRenewMs;
  let unsubscribe = () => {};
  let restart = true;
  const stats = {
    snapshots: 0,
    activeJobs: 0,
    candidates: 0,
    sentOrRetried: 0,
    failures: 0,
    leadershipRenewals: 0,
  };
  const listen = () => {
    const queue = db
      .collection("emailJobs")
      .where("status", "in", active)
      .onSnapshot(
        (snapshot) => {
          stats.snapshots++;
          stats.activeJobs = snapshot.docs.length;
          schedule.replace(snapshot.docs);
          wake();
        },
        (error) => {
          listenerError = error;
          wake();
        },
      );
    // A live switch eliminates runtime polling while email is disabled. Claims
    // still recheck it transactionally; a stale listener cannot permit delivery.
    const runtime = db.doc("applicationSettings/runtime").onSnapshot(
      (snapshot) => {
        switches.enabled = snapshot.data()?.emailEnabled !== false;
        switches.revision++;
        wake();
      },
      (error) => {
        listenerError = error;
        wake();
      },
    );
    return () => {
      queue();
      runtime();
    };
  };
  try {
    while (!stopping && !signal?.aborted) {
      if (listenerError) {
        unsubscribe();
        switches.enabled = null;
        restart = true;
        const error = listenerError;
        listenerError = null;
        notBefore =
          Date.now() +
          retryDelay(failed++, firebaseOutage(error)?.kind === "quota");
        stats.failures++;
        console.error(
          JSON.stringify({
            event: "email_worker_backoff",
            kind: firebaseOutage(error)?.kind ?? "listener",
            retryAt: new Date(notBefore).toISOString(),
          }),
        );
      }
      if (Date.now() < notBefore) {
        await sleep(notBefore - Date.now());
        continue;
      }
      if (Date.now() >= renewAt) {
        try {
          if (!(await leader.renew())) throw new Error("WORKER_LEASE_LOST");
          stats.leadershipRenewals++;
          renewAt = Date.now() + leaderRenewMs;
          console.log(
            JSON.stringify({ event: "email_worker_metrics", ...stats }),
          );
        } catch (error) {
          if ((error as Error).message === "WORKER_LEASE_LOST") throw error;
          notBefore =
            Date.now() +
            retryDelay(failed++, firebaseOutage(error)?.kind === "quota");
          stats.failures++;
          console.error(
            JSON.stringify({
              event: "email_worker_renewal_backoff",
              retryAt: new Date(notBefore).toISOString(),
            }),
          );
          continue;
        }
      }
      if (restart) {
        unsubscribe = listen();
        restart = false;
      }
      const documents =
        switches.enabled === true ? schedule.due().slice(0, 1) : [];
      if (!documents.length) {
        const due = switches.enabled === true ? schedule.delay() : null;
        await sleep(
          Math.max(1, Math.min(due ?? Infinity, renewAt - Date.now())),
        );
        continue;
      }
      try {
        // Mark revisions before processing so our own snapshot writes cannot
        // repeatedly dispatch the same queued version.
        for (const document of documents) schedule.considered(document);
        stats.candidates += documents.length;
        const runtimeRevision = switches.revision;
        const result = await tick(documents, {
          enabled: true,
          leader,
          observed: (d, data) => schedule.observed(d, data),
        });
        if (result === "disabled") {
          for (const document of documents) schedule.retry(document);
          if (switches.revision === runtimeRevision) switches.enabled = false;
        } else {
          stats.sentOrRetried += result;
          failed = 0;
        }
      } catch (error) {
        for (const document of documents) schedule.retry(document);
        if ((error as Error).message === "WORKER_LEASE_LOST") throw error;
        notBefore =
          Date.now() +
          retryDelay(failed++, firebaseOutage(error)?.kind === "quota");
        stats.failures++;
        console.error(
          JSON.stringify({
            event: "email_worker_backoff",
            kind: firebaseOutage(error)?.kind ?? "delivery",
            retryAt: new Date(notBefore).toISOString(),
          }),
        );
      }
    }
  } finally {
    signal?.removeEventListener("abort", stop);
    unsubscribe();
    await leader.release().catch(() => {});
  }
}
if (process.env.NODE_ENV !== "test") {
  let failures = 0;
  while (!stopping) {
    try {
      const result = await runWorker();
      if (result !== "standby") break;
      // A crashed leader's lease eventually expires. Stay out of its queue,
      // but retry election slowly rather than permanently stopping delivery
      // after a supervisor restart finds the old lease still present.
      const until = Date.now() + leaderRenewMs;
      while (!stopping && Date.now() < until) await sleep(until - Date.now());
    } catch (error) {
      const kind = firebaseOutage(error)?.kind;
      if (!kind || kind === "credentials") {
        console.error("Email worker stopped", kind ?? (error as Error).message);
        process.exitCode = 1;
        break;
      }
      const until = Date.now() + retryDelay(failures++, kind === "quota");
      console.error(
        JSON.stringify({
          event: "email_worker_startup_backoff",
          kind,
          retryAt: new Date(until).toISOString(),
        }),
      );
      while (!stopping && Date.now() < until) await sleep(until - Date.now());
    }
  }
}
