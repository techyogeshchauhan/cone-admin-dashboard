import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  doc: vi.fn(),
  collection: vi.fn(),
  runTransaction: vi.fn(),
  updateUser: vi.fn(),
  revokeRefreshTokens: vi.fn(),
  deleteUser: vi.fn(),
  assertControlAuthority: vi.fn(),
}));
vi.mock("../server/firebase.js", () => ({ auth: m, db: m }));
vi.mock("../server/control.js", () => ({
  assertControlAuthority: m.assertControlAuthority,
}));
import { deleteDashboardUser } from "../server/delete-user.js";
import type { Actor } from "../shared/schema.js";
const actor: Actor = {
  uid: "owner",
  email: "owner@example.org",
  fullName: "Owner",
  role: "superadmin",
  status: "active",
  conferenceId: "main",
};
let profile: any, adminDocs: any[];
describe("user account deletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    profile = { accessRole: "participant", status: "active", version: 1 };
    adminDocs = [
      { data: () => ({ isTestAccount: false }) },
      { data: () => ({ isTestAccount: false }) },
    ];
    m.doc.mockImplementation((path) => ({ path }));
    m.collection.mockImplementation((name) =>
      name === "adminUsers"
        ? {
            where: () => ({
              where: () => ({ limit: () => ({ admins: true }) }),
            }),
          }
        : { doc: () => ({ path: "auditLogs/new" }) },
    );
    m.assertControlAuthority.mockResolvedValue({
      ref: { path: "lock" },
      version: 1,
    });
    m.runTransaction.mockImplementation(async (fn) =>
      fn({
        get: async (ref: any) =>
          ref.admins
            ? { size: adminDocs.length, docs: adminDocs }
            : { data: () => ({ ...profile }) },
        set: vi.fn(),
        update: (ref: any, data: any) => {
          if (ref.path === "adminUsers/target")
            profile = { ...profile, ...data };
        },
        create: vi.fn(),
      }),
    );
    m.updateUser.mockResolvedValue({});
    m.revokeRefreshTokens.mockResolvedValue(undefined);
    m.deleteUser.mockResolvedValue(undefined);
  });
  it("disables access before deleting Firebase identity and retains an archived audit profile", async () => {
    m.deleteUser.mockImplementation(async () => {
      expect(profile.status).toBe("disabled");
      expect(profile.deletionPending).toBe(true);
    });
    await expect(deleteDashboardUser(actor, "target", 1)).resolves.toEqual({
      deleted: true,
    });
    expect(m.updateUser).toHaveBeenCalledWith("target", { disabled: true });
    expect(m.revokeRefreshTokens).toHaveBeenCalledWith("target");
    expect(profile).toMatchObject({
      status: "deleted",
      deletionPending: false,
      deletedBy: "owner",
    });
    expect(profile.archivedAt).toBeTruthy();
    expect(m.doc.mock.calls.some(([path]) => path.startsWith("people/"))).toBe(
      false,
    );
  });
  it("rejects self deletion before touching storage", async () => {
    await expect(deleteDashboardUser(actor, "owner", 1)).rejects.toThrow(
      "own account",
    );
    expect(m.runTransaction).not.toHaveBeenCalled();
  });
  it("requires Super Admin", async () => {
    await expect(
      deleteDashboardUser({ ...actor, role: "organizer" }, "target", 1),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("rejects stale rows before deleting Auth identity", async () => {
    await expect(deleteDashboardUser(actor, "target", 9)).rejects.toMatchObject(
      { status: 409 },
    );
    expect(m.deleteUser).not.toHaveBeenCalled();
  });
  it("retains the last active non-test Super Admin", async () => {
    profile.accessRole = "superadmin";
    adminDocs = [
      { data: () => ({ isTestAccount: false }) },
      { data: () => ({ isTestAccount: true }) },
    ];
    await expect(deleteDashboardUser(actor, "target", 1)).rejects.toThrow(
      "last active Super Admin",
    );
    expect(m.deleteUser).not.toHaveBeenCalled();
  });
  it("keeps failed deletion disabled and allows a versioned retry", async () => {
    m.deleteUser.mockRejectedValueOnce(new Error("temporary failure"));
    await expect(deleteDashboardUser(actor, "target", 1)).rejects.toMatchObject(
      { status: 503 },
    );
    expect(profile).toMatchObject({
      status: "disabled",
      deletionPending: true,
    });
    await expect(
      deleteDashboardUser(actor, "target", profile.version),
    ).resolves.toEqual({ deleted: true });
  });
  it("finishes when Firebase identity is already gone", async () => {
    m.updateUser.mockRejectedValue({ code: "auth/user-not-found" });
    await expect(deleteDashboardUser(actor, "target", 1)).resolves.toEqual({
      deleted: true,
    });
    expect(profile.deletedAt).toBeTruthy();
  });
});
