import { describe, expect, it } from "vitest";
import {
  can,
  mobile,
  participantSchema,
  sessionSchema,
  mealSchema,
  type Actor,
} from "../shared/schema.js";
const person = {
  fullName: "Dr. A. Mehra",
  email: "aarav+conference@example.org",
  mobile: "+91 98765 43210",
  affiliation: "University",
  role: "presenter",
  registrationStatus: "confirmed",
};
describe("Participant data compatible with Flutter", () => {
  it("normalizes Indian mobile formatting without losing email aliases", () => {
    const result = participantSchema.parse(person);
    expect(result.mobile).toBe("9876543210");
    expect(result.email).toBe("aarav+conference@example.org");
    expect(result.accommodation).toBe("No");
  });
  it.each(["", "12345", "5123456789", "98765abc10"])(
    "rejects invalid mobile %s",
    (value) => {
      expect(mobile.safeParse(value).success).toBe(false);
    },
  );
  it.each(["fullName", "email", "mobile", "affiliation"])(
    "requires %s",
    (key) => {
      expect(
        participantSchema.safeParse({ ...person, [key]: "" }).success,
      ).toBe(false);
    },
  );
  it("rejects privilege injection into a participant record", () => {
    expect(
      participantSchema.safeParse({ ...person, accessRole: "superadmin" })
        .success,
    ).toBe(false);
  });
  it("does not accept a Super Admin as a conference role", () => {
    expect(
      participantSchema.safeParse({ ...person, role: "superadmin" }).success,
    ).toBe(false);
  });
  it("rejects invalid presentation types and negative fees", () => {
    expect(
      participantSchema.safeParse({ ...person, presentationType: "oral" })
        .success,
    ).toBe(false);
    expect(
      participantSchema.safeParse({ ...person, registrationFee: -1 }).success,
    ).toBe(false);
  });
});
describe("Authorization boundary", () => {
  const actor: Actor = {
    uid: "uid",
    email: "admin@example.org",
    fullName: "Admin",
    role: "organizer",
    conferenceId: "main",
    status: "active",
  };
  it("allows organizers to manage participants but not grant access", () => {
    expect(can(actor, "participants")).toBe(true);
    expect(can(actor, "users")).toBe(false);
    expect(can(actor, "settings")).toBe(false);
  });
  it("denies disabled and differently scoped accounts", () => {
    expect(can({ ...actor, status: "disabled" }, "participants")).toBe(false);
    expect(can({ ...actor, conferenceId: "other" }, "participants")).toBe(
      false,
    );
  });
  it("does not turn conference participation into administration", () => {
    expect(can({ ...actor, role: "participant" }, "participants")).toBe(false);
  });
  it("allows a Super Admin global operations", () => {
    expect(can({ ...actor, role: "superadmin" }, "users")).toBe(true);
  });
});
describe("Programme and meal windows", () => {
  it("rejects an end before the start", () => {
    expect(
      sessionSchema.safeParse({
        title: "Session",
        day: "2026-10-18",
        start: "12:00",
        end: "11:00",
        venue: "Hall A",
        kind: "session",
      }).success,
    ).toBe(false);
  });
  it("requires real timestamps for meal redemption windows", () => {
    expect(
      mealSchema.safeParse({
        day: "2026-10-18",
        meal: "lunch",
        window: "Lunch",
        opensAt: "2026-10-18T12:00:00+05:30",
        closesAt: "2026-10-18T13:00:00+05:30",
      }).success,
    ).toBe(true);
    expect(
      mealSchema.safeParse({
        day: "2026-10-18",
        meal: "lunch",
        window: "Lunch",
      }).success,
    ).toBe(false);
  });
});
