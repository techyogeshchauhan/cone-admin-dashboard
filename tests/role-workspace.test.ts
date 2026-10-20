import { describe, expect, it } from "vitest";
import { roleDesign, permittedShortcuts } from "../src/RoleWorkspace.js";
import { accessRoles, type Actor } from "../shared/schema.js";
const links = [
  { key: "overview", label: "Overview", permission: "reports" },
  { key: "control", label: "Control Center", permission: "control" },
  { key: "participants", label: "Participants", permission: "participants" },
  { key: "sessions", label: "Programme", permission: "sessions" },
  { key: "imports", label: "Imports", permission: "imports" },
  { key: "fees", label: "Fees", permission: "fees" },
  { key: "redemptions", label: "Meal Desk", permission: "redemptions" },
  { key: "profile", label: "My account", permission: "self" },
];
const actor: Actor = {
  uid: "member",
  email: "member@example.org",
  fullName: "Member",
  role: "registration_manager",
  conferenceId: "main",
  status: "active",
};
describe("Role-specific workspace presentation", () => {
  it.each(accessRoles)(
    "has an explicit design and useful description for %s",
    (role) => {
      expect(roleDesign(role).label.length).toBeGreaterThan(3);
      expect(roleDesign(role).description.length).toBeGreaterThan(20);
    },
  );
  it("keeps registration actions relevant and does not link to ungranted programme/system features", () => {
    expect(permittedShortcuts(actor, links).map((l) => l.key)).toEqual([
      "participants",
      "imports",
      "fees",
    ]);
  });
  it("limits meal-desk shortcuts to meal operations", () => {
    expect(
      permittedShortcuts({ ...actor, role: "meal_desk" }, links).map(
        (l) => l.key,
      ),
    ).toEqual(["redemptions"]);
  });
  it("shows only personal workspace access for participants", () => {
    expect(
      permittedShortcuts({ ...actor, role: "participant" }, links).map(
        (l) => l.key,
      ),
    ).toEqual(["profile"]);
  });
  it("respects dynamic permission changes and custom roles", () => {
    expect(
      permittedShortcuts(
        { ...actor, role: "custom_reader", permissions: ["sessions:read"] },
        links,
      ).map((l) => l.key),
    ).toEqual(["sessions"]);
  });
  it("does not invent capabilities for unknown roles", () => {
    expect(permittedShortcuts({ ...actor, role: "unknown" }, links)).toEqual(
      [],
    );
  });
});
