import { describe, expect, it } from "vitest";
import { can, type Actor } from "../shared/schema.js";
import {
  resolveRole,
  roleDefinitionSchema,
  runtimeSchema,
  runtimeDefaults,
  checkAdminChange,
} from "../shared/control.js";
const actor: Actor = {
  uid: "member",
  email: "member@example.org",
  fullName: "Member",
  role: "support_viewer",
  conferenceId: "main",
  status: "active",
  permissions: ["participants:read"],
};
describe("Live permission policies", () => {
  it("supports custom roles with read-only module permissions", () => {
    expect(can(actor, "participants")).toBe(true);
    expect(can(actor, "participants", "read")).toBe(true);
    expect(can(actor, "participants", "write")).toBe(false);
    expect(can(actor, "participants", "archive")).toBe(false);
  });
  it("denies scope changes, disabled identities, and ungranted modules", () => {
    expect(can({ ...actor, status: "disabled" }, "participants", "read")).toBe(
      false,
    );
    expect(
      can({ ...actor, conferenceId: "other" }, "participants", "read"),
    ).toBe(false);
    expect(can(actor, "users", "write")).toBe(false);
  });
  it("keeps Super Admin unrestricted even if a role definition attempts to limit it", () => {
    expect(
      resolveRole("superadmin", {
        managedRole: true,
        active: false,
        permissions: [],
      }),
    ).toEqual(["*"]);
    expect(can({ ...actor, role: "superadmin" }, "control", "write")).toBe(
      true,
    );
  });
  it("rejects wildcard and reserved global permissions in delegated policies", () => {
    for (const permission of [
      "*",
      "control:write",
      "users:write",
      "settings:write",
      "audit:archive",
    ])
      expect(
        roleDefinitionSchema.safeParse({
          name: "Unsafe",
          description: "",
          active: true,
          version: 0,
          permissions: [permission],
        }).success,
      ).toBe(false);
  });
  it("rejects unknown, disabled, and malformed custom policies", () => {
    expect(resolveRole("unknown")).toBeNull();
    expect(
      resolveRole("support_viewer", {
        managedRole: true,
        name: "Viewer",
        description: "",
        version: 1,
        permissions: ["participants:read"],
        active: false,
      }),
    ).toBeNull();
    expect(
      resolveRole("support_viewer", {
        managedRole: true,
        active: true,
        permissions: ["*"],
      }),
    ).toBeNull();
  });
  it("uses legacy built-in permissions until an explicit managed policy is saved", () => {
    expect(resolveRole("organizer")).toContain("participants");
    expect(
      resolveRole("organizer", {
        managedRole: true,
        name: "Read only",
        description: "",
        version: 1,
        permissions: ["participants:read"],
        active: true,
      }),
    ).toEqual(["participants:read"]);
  });
});
describe("Super Admin lockout protection", () => {
  it("blocks self-demotion and self-deactivation", () => {
    expect(() =>
      checkAdminChange(
        "owner",
        "owner",
        "superadmin",
        "organizer",
        "active",
        2,
      ),
    ).toThrow("own");
    expect(() =>
      checkAdminChange(
        "owner",
        "owner",
        "superadmin",
        "superadmin",
        "disabled",
        2,
      ),
    ).toThrow("own");
  });
  it("blocks removal of the last active Super Admin", () => {
    expect(() =>
      checkAdminChange(
        "other",
        "owner",
        "superadmin",
        "organizer",
        "active",
        1,
      ),
    ).toThrow("last");
  });
  it("permits a different Super Admin to demote an account when another remains", () => {
    expect(() =>
      checkAdminChange(
        "other",
        "owner",
        "superadmin",
        "organizer",
        "active",
        2,
      ),
    ).not.toThrow();
  });
  it("permits updating an already disabled admin without counting it as the last active owner", () => {
    expect(() =>
      checkAdminChange(
        "other",
        "owner",
        "superadmin",
        "organizer",
        "disabled",
        1,
        "disabled",
      ),
    ).not.toThrow();
  });
});
describe("Operational configuration", () => {
  it("validates safe defaults", () =>
    expect(runtimeSchema.parse(runtimeDefaults)).toEqual(runtimeDefaults));
  it("bounds upload sizes and session duration", () => {
    expect(
      runtimeSchema.safeParse({ ...runtimeDefaults, maxUploadMb: 50 }).success,
    ).toBe(false);
    expect(
      runtimeSchema.safeParse({ ...runtimeDefaults, sessionMaxAgeMinutes: 0 })
        .success,
    ).toBe(false);
  });
  it("does not accept infrastructure secrets as runtime configuration", () => {
    expect(
      runtimeSchema.safeParse({
        ...runtimeDefaults,
        FIREBASE_PRIVATE_KEY: "secret",
      }).success,
    ).toBe(false);
  });
});
