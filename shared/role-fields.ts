import { can, type Actor } from "./schema.js";

export const registrationFields = [
  "fullName",
  "email",
  "mobile",
  "affiliation",
  "role",
  "registrationStatus",
  "registrationId",
  "discipline",
  "category",
  "presentationType",
  "workingAs",
  "gender",
  "dob",
  "district",
  "rollNo",
  "softCopy",
  "accommodation",
  "travelAssistance",
  "earlierAwardee",
  "remark",
] as const;
export const financialFields = ["registrationFee", "feesReceived"] as const;

export function pickFields(
  data: Record<string, unknown>,
  keys: readonly string[],
) {
  return Object.fromEntries(
    keys
      .filter((key) => data[key] !== undefined)
      .map((key) => [key, data[key]]),
  );
}

// Do not return whole people documents: they also hold import originals,
// payment data, credentials/markers and unrelated mobile role payloads.
export function participantRecord(actor: Actor, data: Record<string, unknown>) {
  return pickFields(data, [
    "id",
    "version",
    "isDemo",
    "createdAt",
    "updatedAt",
    ...registrationFields,
    ...(actor.role === "superadmin" ? ["accountType"] : []),
    ...(can(actor, "fees", "read") ? financialFields : []),
  ]);
}

export function canOpenWorkspace(actor: Actor, resource: string) {
  return (
    can(actor, resource, "read") &&
    (resource !== "imports" ||
      (can(actor, "participants", "read") && can(actor, "fees", "read")))
  );
}

export function overviewAccess(actor: Actor) {
  return {
    people: can(actor, "participants", "read"),
    meals: can(actor, "meals", "read") || can(actor, "redemptions", "read"),
    imports: canOpenWorkspace(actor, "imports"),
    fees: can(actor, "fees", "read"),
    audit: can(actor, "audit", "read"),
  };
}
