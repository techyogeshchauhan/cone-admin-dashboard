// Provisions real conference registrations from a JSON file, the same way the
// dashboard does: people/{email} with role-specific data, meal coupons with
// couponIndex entries, and a passwordless Firebase Auth account. People then
// sign in to the mobile app with the emailed OTP only.
//
//   npm run provision:people -- storage/test-people.json [--dry-run]
//
// Keep the input file in storage/ (ignored by Git): it holds personal data.
// Demo fixtures and dashboard test identities are never modified.
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import { auth, db } from "./firebase.js";
import { ensureIdentity } from "./accounts.js";
import { eligible } from "./email-otp.js";
import { conferenceRoles, mobile } from "../shared/schema.js";

const text = z.string().trim().min(1).max(1000);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const scheduleItem = z
  .object({
    day: text,
    start: time,
    end: time,
    title: text,
    venue: text.nullable().default(null),
    kind: z
      .enum(["general", "session", "presentation", "personal"])
      .default("personal"),
    isOwnPresentation: z.boolean().default(true),
  })
  .strict();
const entrySchema = z
  .object({
    fullName: z.string().trim().min(2).max(150),
    email: z
      .string()
      .trim()
      .pipe(z.email())
      .transform((v) => v.toLowerCase()),
    mobile,
    role: z.enum(conferenceRoles),
    registrationStatus: z
      .enum(["pending", "confirmed", "cancelled", "suspended"])
      .default("confirmed"),
    affiliation: text.optional(),
    designation: text.optional(),
    workingAs: text.optional(),
    discipline: z.string().trim().max(200).optional(),
    category: z.enum(["", "I", "II", "III", "IV"]).optional(),
    presentationType: z.enum(["", "O", "P"]).optional(),
    registrationFee: z.number().int().min(0).optional(),
    accommodation: z.enum(["Yes", "No"]).optional(),
    softCopy: z.enum(["Yes", "No"]).optional(),
    earlierAwardee: z.enum(["Yes", "No"]).optional(),
    paper: z
      .object({
        submissionId: text,
        title: text,
        abstractText: z.string().trim().max(20000).nullable(),
        authors: z
          .array(
            z
              .object({
                name: text,
                affiliation: text.nullable(),
                role: text,
                isParticipant: z.boolean(),
              })
              .strict(),
          )
          .min(1),
      })
      .strict()
      .optional(),
    talk: z
      .object({
        title: text,
        session: text,
        day: text,
        start: time,
        end: time,
        venue: text,
        abstract: z.string().trim().max(5000).nullable().default(null),
      })
      .strict()
      .optional(),
    hostEmail: z.email().optional(),
    duties: z.array(text).optional(),
    personalSchedule: z.array(scheduleItem).default([]),
  })
  .strict()
  .superRefine((p, ctx) => {
    const need = (ok: unknown, field: string) =>
      ok ||
      ctx.addIssue({
        code: "custom",
        path: [field],
        message: `A ${p.role} needs ${field}`,
      });
    if (p.role === "presenter") need(p.paper, "paper");
    if (p.role === "speaker") need(p.talk, "talk");
    if (p.role === "vip") need(p.hostEmail, "hostEmail");
    if (p.role === "organiser" || p.role === "volunteer")
      need(p.duties?.length, "duties");
  });
type Entry = z.infer<typeof entrySchema>;

const [file] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const dryRun = process.argv.includes("--dry-run");
if (!file)
  throw new Error(
    "Usage: npm run provision:people -- <people.json> [--dry-run]",
  );
const entries = z
  .object({ people: z.array(entrySchema).min(1) })
  .parse(JSON.parse(await readFile(file, "utf8"))).people;
if (new Set(entries.map((e) => e.email)).size !== entries.length)
  throw new Error("Each email may appear only once");

const hostLabel: Record<string, string> = {
  organiser: "Organising committee",
  volunteer: "Volunteer",
};
async function hostFor(email: string) {
  const listed = entries.find((e) => e.email === email.toLowerCase());
  const person =
    listed ?? (await db.doc(`people/${email.toLowerCase()}`).get()).data();
  if (!person || !["organiser", "volunteer"].includes(person.role))
    throw new Error(`VIP host ${email} must be an organiser or volunteer`);
  return {
    name: person.fullName,
    role: hostLabel[person.role],
    mobile: person.mobile,
  };
}

// Refuse fixtures before writing anything.
for (const entry of entries) {
  const existing = (await db.doc(`people/${entry.email}`).get()).data();
  const account = await auth.getUserByEmail(entry.email).catch(() => null);
  if (existing?.isDemo || account?.customClaims?.coneDashboardTest)
    throw new Error(
      `Refusing to modify a demo or dashboard test identity: ${entry.email}`,
    );
}

const slots = (await db.collection("mealSlots").get()).docs.filter(
  (s) => !s.data().archivedAt,
);
const now = () => new Date().toISOString();

async function provision(entry: Entry) {
  const { hostEmail, ...fields } = entry;
  const host = hostEmail ? await hostFor(hostEmail) : null;
  const staff = entry.role === "organiser" || entry.role === "volunteer";
  const ref = db.doc(`people/${entry.email}`);
  let summary = "";
  await db.runTransaction(async (tx) => {
    const old = (await tx.get(ref)).data();
    const coupons = [...(old?.coupons || [])];
    const added: typeof coupons = [];
    if (entry.registrationStatus === "confirmed")
      for (const slot of slots) {
        if (coupons.some((c) => c.slotId === slot.id)) continue;
        const value = slot.data();
        const coupon = {
          couponId: `MEAL-${randomUUID().toUpperCase()}`,
          slotId: slot.id,
          day: value.day,
          meal: value.meal,
          window: value.window,
        };
        coupons.push(coupon);
        added.push(coupon);
      }
    const registrationId = old?.registrationId || `CONE-${randomUUID()}`;
    const record: Record<string, unknown> = {
      ...fields,
      // Category and presentation type describe a paper.
      ...(entry.role !== "presenter"
        ? { category: "", presentationType: "" }
        : {}),
      // Role-specific data is replaced so a role change leaves no stale paper,
      // talk, host or duties behind.
      paper: entry.role === "presenter" ? entry.paper : FieldValue.delete(),
      talk: entry.role === "speaker" ? entry.talk : FieldValue.delete(),
      host: host ?? FieldValue.delete(),
      duties: staff ? entry.duties : [],
      personalSchedule: [
        ...(old?.personalSchedule || []).filter(
          (item: Record<string, unknown>) => item.staffAssignmentId,
        ),
        ...entry.personalSchedule,
      ],
      registrationId,
      passId: old?.passId || `PASS-${randomUUID()}`,
      affiliation: entry.affiliation ?? old?.affiliation ?? "Not specified",
      coupons,
      isDemo: false,
      version: (old?.version || 0) + 1,
      updatedAt: now(),
      updatedBy: "provision-people",
      ...(!old ? { createdAt: now(), createdBy: "provision-people" } : {}),
    };
    for (const key of Object.keys(record))
      if (record[key] === undefined) delete record[key];
    summary = `${old ? "updated" : "created"} ${entry.role}, ${added.length} new coupon(s)`;
    if (dryRun) return;
    tx.set(ref, record, { merge: true });
    // Every coupon owned by this person carries the current name and role.
    for (const coupon of coupons)
      tx.set(db.doc(`couponIndex/${coupon.couponId}`), {
        ...coupon,
        email: entry.email,
        fullName: entry.fullName,
        registrationId,
        role: entry.role,
      });
    if (entry.role === "presenter" && entry.paper)
      tx.set(
        db.doc(`submissions/${entry.paper.submissionId}`),
        {
          title: entry.paper.title,
          submissionId: entry.paper.submissionId,
          presenterEmail: entry.email,
          abstractText: entry.paper.abstractText ?? "",
          authors: entry.paper.authors.map((a) => a.name).join("\n"),
          discipline: entry.discipline || "Not specified",
          category: entry.category || "I",
          presentationType: entry.presentationType || "O",
          updatedAt: now(),
          updatedBy: "provision-people",
        },
        { merge: true },
      );
    tx.create(db.collection("auditLogs").doc(), {
      actorUid: "provision-people",
      actorName: "Provisioning script",
      action: old ? "participants.update" : "participants.create",
      target: entry.email,
      createdAt: now(),
      conferenceId: "main",
    });
  });
  if (dryRun) return `${summary} (dry run, nothing written)`;
  const { account, created } = await ensureIdentity(
    entry.email,
    entry.fullName,
  );
  if (account.disabled)
    throw new Error(`Firebase Auth account is disabled: ${entry.email}`);
  // Uses the OTP service's own check, so a pass here means the login form
  // with these exact details will be accepted and a code emailed.
  const ready = await eligible({
    name: entry.fullName,
    email: entry.email,
    mobile: entry.mobile,
    audience: "mobile",
  });
  if (!ready) throw new Error(`Not eligible for OTP login: ${entry.email}`);
  return `${summary}, Auth ${created ? "created" : "existing"}, OTP login ready`;
}

for (const entry of entries)
  console.log(`${entry.email}: ${await provision(entry)}`);
process.exit(0);
