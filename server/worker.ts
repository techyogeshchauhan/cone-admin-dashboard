import "dotenv/config";
import { randomUUID } from "node:crypto";
import { db } from "./firebase.js";
import { mailTransport, sender } from "./mail.js";
import { runtimeConfiguration } from "./control.js";
let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});
export async function tick() {
  if (!(await runtimeConfiguration()).emailEnabled) return;
  const jobs = await db
    .collection("emailJobs")
    .where("status", "in", ["queued", "retry", "processing"])
    .limit(50)
    .get();
  for (const document of jobs.docs) {
    if (stopping) return;
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
        messageId: `<${document.id}@cone.local>`,
      });
      await document.ref.update({
        status: "sent",
        sentAt: new Date().toISOString(),
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
}
if (process.env.NODE_ENV !== "test") console.log("CONE email worker started");
while (process.env.NODE_ENV !== "test" && !stopping) {
  try {
    await tick();
  } catch {
    console.error("Email queue unavailable; retrying");
  }
  await new Promise((resolve) => setTimeout(resolve, 3000));
}
