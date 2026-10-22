import "dotenv/config";
import { randomUUID } from "node:crypto";
import { db } from "./firebase.js";
import { mailTransport, sender } from "./mail.js";
import { runtimeConfiguration } from "./control.js";
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
export async function tick() {
  if (!(await runtimeConfiguration()).emailEnabled) return "disabled";
  const jobs = await db
    .collection("emailJobs")
    .where("status", "in", active)
    .limit(50)
    .get();
  let claimed = 0;
  for (const document of jobs.docs) {
    if (stopping) return claimed;
    const lease = randomUUID();
    const job = await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(document.ref);
      const runtime = await tx.get(db.doc("applicationSettings/runtime"));
      if (runtime.data()?.emailEnabled === false) return null;
      const data = snapshot.data()!;
      if (!["queued", "retry", "processing"].includes(data.status)) return null;
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
    if (!job) continue;
    claimed++;
    try {
      const text = String(job.body).replaceAll(
        "{{name}}",
        String(job.recipientName || "Participant"),
      );
      await (
        await mailTransport()
      ).sendMail({
        from: await sender(),
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
      await document.ref.update({
        status: "sent",
        sentAt: new Date().toISOString(),
        deliveryFormat: "html",
        rendererVersion: "cone-branded-v1",
        error: null,
      });
    } catch (error) {
      const code = (error as { code?: string }).code;
      await document.ref.update({
        status: "retry",
        error: code || "DELIVERY_FAILED",
        nextAttemptAt: new Date(
          Date.now() + Math.min(3600000, 30000 * 2 ** (job.attempts || 0)),
        ).toISOString(),
      });
    }
  }
  return claimed;
}

// Milliseconds until the earliest job can be sent: queued jobs now, retries
// at nextAttemptAt, abandoned "processing" jobs when their lease ends.
// Null when nothing is waiting.
export function nextDue(jobs: Record<string, unknown>[], now = Date.now()) {
  let due: number | null = null;
  for (const job of jobs) {
    const at =
      job.status === "processing"
        ? Date.parse(String(job.leaseUntil))
        : job.nextAttemptAt
          ? Date.parse(String(job.nextAttemptAt))
          : now;
    const when = Number.isNaN(at) ? now : at;
    due = due === null ? when : Math.min(due, when);
  }
  return due === null ? null : Math.max(0, due - now);
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    wake = () => {
      clearTimeout(timer);
      resolve();
    };
  });
const idle = 600000;
const pausedFor = (error: unknown) =>
  firebaseOutage(error)?.kind === "quota" ? 300000 : 15000;

// The queue is watched with a Firestore listener instead of polled: an idle
// listener costs no reads, and a newly queued email wakes the worker at once.
// (Polling every few seconds cost about 57,000 reads a day, more than the
// whole free daily quota.)
if (process.env.NODE_ENV !== "test") {
  console.log("CONE email worker started (cone-branded-v1, HTML + plain text)");
  let jobs: Record<string, unknown>[] = [];
  let listenerError: unknown = null;
  const listen = () =>
    db
      .collection("emailJobs")
      .where("status", "in", active)
      .onSnapshot(
        (snapshot) => {
          jobs = snapshot.docs.map((d) => d.data());
          wake();
        },
        (error) => {
          listenerError = error;
          wake();
        },
      );
  let unsubscribe = listen();
  while (!stopping) {
    if (listenerError) {
      const wait = pausedFor(listenerError);
      console.error(
        `Email queue unavailable: ${firebaseOutage(listenerError)?.message ?? (listenerError as Error).message}. Retrying in ${wait / 1000}s.`,
      );
      listenerError = null;
      await sleep(wait);
      if (!stopping) unsubscribe = listen();
      continue;
    }
    const due = nextDue(jobs);
    // Nothing waiting, or not yet due: sleep until the listener wakes us.
    if (due === null || due > 0) {
      await sleep(Math.min(due ?? idle, idle));
      continue;
    }
    try {
      // Email switched off in Control Center: check again later rather
      // than reading the settings in a tight loop.
      // Nothing claimable (another worker has them, or they are not due
      // among the first 50): wait instead of re-reading the queue.
      const result = await tick();
      await sleep(result === "disabled" ? 300000 : result ? 1000 : 30000);
    } catch (error) {
      const wait = pausedFor(error);
      console.error(
        `Email queue unavailable: ${firebaseOutage(error)?.message ?? (error as Error).message}. Retrying in ${wait / 1000}s.`,
      );
      await sleep(wait);
    }
  }
  unsubscribe();
}
