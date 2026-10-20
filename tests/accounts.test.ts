import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  getUserByEmail: vi.fn(),
  createUser: vi.fn(),
  doc: vi.fn(),
  runTransaction: vi.fn(),
}));
vi.mock("../server/firebase.js", () => ({ auth: mock, db: mock }));
import {
  ensureIdentity,
  ensureParticipantAccess,
  ensurePerson,
  developmentVerificationBypass,
} from "../server/accounts.js";
describe("dashboard account provisioning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("APP_ENV", "test");
    vi.stubEnv("TEST_IN_APP_EMAIL_VERIFICATION", "true");
    vi.stubEnv("NODE_ENV", "test");
    mock.getUserByEmail.mockRejectedValue({ code: "auth/user-not-found" });
    mock.createUser.mockResolvedValue({ uid: "new" });
  });
  afterEach(() => vi.unstubAllEnvs());
  it("creates a Firebase login without any password", async () => {
    await ensureIdentity("new@example.org", "New User");
    expect(mock.createUser).toHaveBeenCalledWith({
      email: "new@example.org",
      displayName: "New User",
      emailVerified: true,
    });
  });
  it("never bypasses verification in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(developmentVerificationBypass()).toBe(false);
    await ensureIdentity("new@example.org", "New User");
    expect(mock.createUser.mock.calls[0][0].emailVerified).toBe(false);
  });
  it("does not reset an existing identity or hide Firebase failures", async () => {
    mock.getUserByEmail.mockResolvedValue({ uid: "existing" });
    expect((await ensureIdentity("a@example.org", "A")).created).toBe(false);
    expect(mock.createUser).not.toHaveBeenCalled();
    mock.getUserByEmail.mockRejectedValue({ code: "auth/internal-error" });
    await expect(ensureIdentity("a@example.org", "A")).rejects.toEqual({
      code: "auth/internal-error",
    });
  });
  it("does not replace privileged dashboard access during participant creation", async () => {
    const tx = {
      get: vi.fn().mockResolvedValue({ exists: true }),
      create: vi.fn(),
    };
    mock.runTransaction.mockImplementation((fn) => fn(tx));
    await ensureParticipantAccess(
      "admin",
      { email: "a@example.org", fullName: "A", mobile: "9876543210" },
      "owner",
    );
    expect(tx.create).not.toHaveBeenCalled();
  });
  it("creates complete mobile profiles without credentials", async () => {
    const tx = {
      get: vi.fn().mockResolvedValue({ exists: false, data: () => undefined }),
      set: vi.fn(),
    };
    mock.runTransaction.mockImplementation((fn) => fn(tx));
    await ensurePerson(
      { email: "a@example.org", fullName: "A", mobile: "9876543210" },
      "owner",
    );
    const saved = tx.set.mock.calls[0][1];
    expect(saved).toMatchObject({
      role: "attendee",
      affiliation: "Not specified",
      registrationStatus: "pending",
      coupons: [],
    });
    expect(saved.registrationId).toBeTruthy();
    expect(saved.passId).toBeTruthy();
    expect(saved.password).toBeUndefined();
  });
});
