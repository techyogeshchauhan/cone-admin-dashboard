import { z } from "zod";
export const conferenceRoles = [
  "presenter",
  "attendee",
  "speaker",
  "vip",
  "organiser",
  "volunteer",
] as const;
export const accessRoles = [
  "superadmin",
  "conference_admin",
  "organizer",
  "registration_manager",
  "programme_manager",
  "meal_desk",
  "participant",
] as const;
export type AccessRole = (typeof accessRoles)[number];
export type Actor = {
  uid: string;
  email: string;
  fullName: string;
  role: string;
  conferenceId: string;
  status: string;
  authTime?: number;
  permissions?: string[];
};
export const mobile = z
  .string()
  .transform((value) => {
    let digits = value.replace(/[\s()\-]/g, "").replace(/^\+/, "");
    if (digits.length === 12 && digits.startsWith("91"))
      digits = digits.slice(2);
    if (digits.length === 11 && digits.startsWith("0"))
      digits = digits.slice(1);
    return digits;
  })
  .pipe(
    z
      .string()
      .regex(/^[6-9]\d{9}$/, "Enter a valid ten-digit Indian mobile number"),
  );
const text = z.string().trim().min(1).max(1000);
export const identity = z.object({
  fullName: z.string().trim().min(2).max(150),
  email: z
    .string()
    .trim()
    .pipe(z.email())
    .transform((v) => v.toLowerCase()),
  mobile,
});
export const participantSchema = identity
  .extend({
    affiliation: text,
    role: z.enum(conferenceRoles),
    registrationStatus: z.enum([
      "pending",
      "confirmed",
      "cancelled",
      "suspended",
    ]),
    discipline: z.string().trim().max(200).default(""),
    category: z.enum(["", "I", "II", "III", "IV"]).default(""),
    presentationType: z.enum(["", "O", "P"]).default(""),
    registrationFee: z.coerce.number().int().min(0).max(10000000).default(0),
    accommodation: z.enum(["Yes", "No"]).default("No"),
    softCopy: z.enum(["Yes", "No"]).default("No"),
    earlierAwardee: z.enum(["Yes", "No"]).default("No"),
  })
  .strict();
export const userSchema = identity
  .extend({
    accessRole: z.string().regex(/^[a-z][a-z0-9_]{2,40}$/),
    conferenceId: z.literal("main"),
    status: z.enum(["active", "disabled"]),
  })
  .strict();
export const sessionSchema = z
  .object({
    title: text,
    day: z.iso.date(),
    start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    venue: text,
    kind: z.enum(["general", "session", "presentation", "personal"]),
  })
  .strict()
  .refine((v) => v.end > v.start, {
    message: "End must be after start",
    path: ["end"],
  });
export const disciplineSchema = z
  .object({
    name: text,
    code: z.string().trim().min(1).max(20),
    oral: z.coerce.number().int().min(0),
    poster: z.coerce.number().int().min(0),
  })
  .strict();
export const submissionSchema = z
  .object({
    title: text,
    submissionId: text,
    presenterEmail: z.email(),
    abstractText: z.string().max(20000),
    authors: z.string().min(1).max(2000),
    discipline: text,
    category: z.enum(["I", "II", "III", "IV"]),
    presentationType: z.enum(["O", "P"]),
  })
  .strict();
export const mealSchema = z
  .object({
    day: z.iso.date(),
    meal: z.enum(["breakfast", "lunch", "dinner"]),
    window: text,
    opensAt: z.iso.datetime({ offset: true }),
    closesAt: z.iso.datetime({ offset: true }),
  })
  .strict()
  .refine((v) => Date.parse(v.closesAt) > Date.parse(v.opensAt), {
    message: "Closing time must be after opening time",
    path: ["closesAt"],
  });
export const conferenceSchema = z
  .object({
    name: text,
    shortName: text,
    startDate: z.union([z.iso.date(), z.literal("")]).optional(),
    endDate: z.union([z.iso.date(), z.literal("")]).optional(),
    venue: z.string().max(300).optional(),
    contactEmail: z.union([z.email(), z.literal("")]).optional(),
    contactMobile: z.union([mobile, z.literal("")]).optional(),
    timezone: z.literal("Asia/Kolkata").default("Asia/Kolkata"),
    publicationStatus: z.enum(["draft", "published"]).default("draft"),
  })
  .strict()
  .refine((v) => !v.startDate || !v.endDate || v.endDate >= v.startDate, {
    message: "End date must be on or after start date",
    path: ["endDate"],
  });
export const venueSchema = z
  .object({
    name: text,
    location: text,
    capacity: z.coerce.number().int().min(1).max(100000),
  })
  .strict();
export const staffSchema = z
  .object({
    staffEmail: z.email(),
    duty: text,
    day: z.iso.date(),
    start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    vipEmail: z.union([z.email(), z.literal("")]).default(""),
  })
  .strict()
  .refine((v) => v.end > v.start, {
    message: "End must follow start",
    path: ["end"],
  });
export const feeSchema = z
  .object({
    participantEmail: z.email(),
    amount: z.coerce.number().int().min(0),
    currency: z.literal("INR"),
    status: z.enum(["pending", "received", "waived", "refunded"]),
    reference: z.string().max(200),
  })
  .strict();
export const settingsSchema = z
  .object({ maintenanceMode: z.boolean(), registrationOpen: z.boolean() })
  .strict();
export const schemas = {
  participants: participantSchema,
  users: userSchema,
  sessions: sessionSchema,
  disciplines: disciplineSchema,
  submissions: submissionSchema,
  meals: mealSchema,
  venues: venueSchema,
  staff: staffSchema,
  fees: feeSchema,
};
export type Module = keyof typeof schemas;
export const permissions: Record<AccessRole, string[]> = {
  superadmin: ["*"],
  conference_admin: [
    "participants",
    "sessions",
    "disciplines",
    "submissions",
    "meals",
    "imports",
    "media",
    "conference",
    "reports",
    "email",
    "venues",
    "staff",
    "fees",
    "passes",
  ],
  organizer: [
    "participants",
    "sessions",
    "disciplines",
    "submissions",
    "meals",
    "imports",
    "media",
    "conference",
    "reports",
    "email",
    "venues",
    "staff",
    "fees",
    "passes",
  ],
  registration_manager: [
    "participants",
    "imports",
    "reports",
    "fees",
    "passes",
  ],
  programme_manager: [
    "sessions",
    "disciplines",
    "submissions",
    "conference",
    "venues",
  ],
  meal_desk: ["redemptions"],
  participant: ["self"],
};
export function can(
  actor: Actor,
  resource: string,
  action?: "read" | "write" | "archive",
) {
  const grants =
    actor.permissions ?? permissions[actor.role as AccessRole] ?? [];
  const allowed =
    grants.includes(resource) ||
    grants.includes(`${resource}:${action}`) ||
    (!action && grants.some((p) => p.startsWith(`${resource}:`)));
  return (
    actor.status === "active" &&
    (actor.role === "superadmin" || (actor.conferenceId === "main" && allowed))
  );
}
export const collectionNames: Record<Module, string> = {
  participants: "people",
  users: "adminUsers",
  sessions: "sessions",
  disciplines: "disciplines",
  submissions: "submissions",
  meals: "mealSlots",
  venues: "venues",
  staff: "staffAssignments",
  fees: "feeRecords",
};
