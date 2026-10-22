import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  doc: vi.fn(),
  collection: vi.fn(),
  runTransaction: vi.fn(),
  getUserByEmail: vi.fn(),
  updateUser: vi.fn(),
  createCustomToken: vi.fn(),
  revokeRefreshTokens: vi.fn(),
  recordAudit: vi.fn(),
}));
vi.mock("../server/firebase.js", () => ({ db: m, auth: m }));
vi.mock("../server/activity-log.js", () => ({ recordAudit: m.recordAudit }));
import express from "express";
import supertest from "supertest";
import {
  registerTestAccountAdmin,
  registerTestAccountLogin,
} from "../server/test-accounts.js";

let records: Map<string, any>;
const details = {
  name: "Aarav Mehra",
  email: "presenter@gmail.com",
  mobile: "9876543210",
};
const person = "people/presenter@gmail.com",
  member = "testAccounts/presenter@gmail.com";
function api(role = "superadmin") {
  const app = express();
  app.use(express.json());
  registerTestAccountLogin(app);
  app.use((req, _res, next) => {
    (req as any).actor = { uid: "admin", fullName: "Admin", role };
    next();
  });
  registerTestAccountAdmin(app);
  return supertest(app);
}
// FieldValue.delete() removes the field, as Firestore does.
function merge(path: string, value: Record<string, unknown>) {
  const next = { ...records.get(path), ...value };
  for (const [key, v] of Object.entries(value))
    if (v && typeof v === "object" && "isEqual" in v) delete next[key];
  records.set(path, next);
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ALLOW_TEST_ACCOUNT_LOGIN", "true");
  records = new Map<string, any>([
    [
      person,
      {
        fullName: "Aarav Mehra",
        mobile: "9876543210",
        role: "presenter",
        registrationStatus: "confirmed",
        isDemo: true,
        accountType: "test",
      },
    ],
    [member, { email: details.email, fullName: "Aarav Mehra" }],
  ]);
  m.doc.mockImplementation((path: string) => ({
    path,
    get: async () => ({
      exists: records.has(path),
      data: () => structuredClone(records.get(path)),
    }),
    update: async (value: any) => merge(path, value),
  }));
  m.runTransaction.mockImplementation((fn: any) =>
    fn({
      get: (ref: any) => ref.get(),
      update: (ref: any, value: any) => merge(ref.path, value),
      set: (ref: any, value: any) => records.set(ref.path, value),
      delete: (ref: any) => records.delete(ref.path),
    }),
  );
  m.collection.mockImplementation((name: string) => ({
    orderBy: () => ({
      get: async () => ({
        docs: [...records]
          .filter(([path]) => path.startsWith(`${name}/`))
          .map(([path, value]) => ({
            id: path.split("/")[1],
            data: () => value,
          })),
      }),
    }),
  }));
  m.getUserByEmail.mockResolvedValue({
    uid: "uid",
    email: details.email,
    disabled: false,
    emailVerified: false,
  });
  m.createCustomToken.mockResolvedValue("firebase-token");
});
afterEach(() => vi.unstubAllEnvs());
describe("test account login", () => {
  it("signs a test account in without an emailed code", async () => {
    const response = await api().post("/api/auth/test-login").send(details);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ token: "firebase-token" });
    expect(m.createCustomToken).toHaveBeenCalledWith(
      "uid",
      expect.objectContaining({
        login_method: "test_account",
        login_audience: "mobile",
      }),
    );
    expect(m.updateUser).toHaveBeenCalledWith("uid", { emailVerified: true });
    expect(records.get(person).emailVerified).toBe(true);
    expect(records.get(member).lastLoginAt).toEqual(expect.any(String));
  });
  it("accepts spacing and +91 like the OTP check", async () => {
    const response = await api()
      .post("/api/auth/test-login")
      .send({ ...details, name: " aarav  MEHRA ", mobile: "+91 98765 43210" });
    expect(response.status).toBe(200);
  });
  it("refuses a registration missing from either record", async () => {
    records.delete(member);
    expect(
      (await api().post("/api/auth/test-login").send(details)).status,
    ).toBe(404);
    records.set(member, { email: details.email });
    delete records.get(person).accountType;
    expect(
      (await api().post("/api/auth/test-login").send(details)).status,
    ).toBe(404);
    expect(m.createCustomToken).not.toHaveBeenCalled();
  });
  it("refuses mismatched details, cancelled or disabled accounts", async () => {
    expect(
      (
        await api()
          .post("/api/auth/test-login")
          .send({ ...details, mobile: "9876543219" })
      ).status,
    ).toBe(404);
    records.get(person).registrationStatus = "cancelled";
    expect(
      (await api().post("/api/auth/test-login").send(details)).status,
    ).toBe(404);
    records.get(person).registrationStatus = "confirmed";
    m.getUserByEmail.mockResolvedValue({ uid: "uid", disabled: true });
    expect(
      (await api().post("/api/auth/test-login").send(details)).status,
    ).toBe(404);
    expect(m.createCustomToken).not.toHaveBeenCalled();
  });
  it("is absent unless ALLOW_TEST_ACCOUNT_LOGIN is true", async () => {
    vi.stubEnv("ALLOW_TEST_ACCOUNT_LOGIN", "false");
    const response = await api().post("/api/auth/test-login").send(details);
    expect(response.status).toBe(404);
    expect(m.doc).not.toHaveBeenCalled();
  });
});
describe("test accounts module", () => {
  it("lists test accounts and the server switch for Super Admin only", async () => {
    const response = await api().get("/api/test-accounts");
    expect(response.status).toBe(200);
    expect(response.body.loginEnabled).toBe(true);
    expect(response.body.rows).toEqual([
      expect.objectContaining({ id: details.email, fullName: "Aarav Mehra" }),
    ]);
    expect((await api("organizer").get("/api/test-accounts")).status).toBe(403);
  });
  it("lets only Super Admin change membership", async () => {
    const response = await api("conference_admin")
      .put("/api/people/presenter@gmail.com/test-account")
      .send({ enabled: true });
    expect(response.status).toBe(403);
  });
  it("removes both records and ends existing sessions", async () => {
    const response = await api()
      .put("/api/people/presenter@gmail.com/test-account")
      .send({ enabled: false });
    expect(response.status).toBe(200);
    expect(records.get(person).accountType).toBeUndefined();
    expect(records.has(member)).toBe(false);
    expect(m.revokeRefreshTokens).toHaveBeenCalledWith("uid");
    expect(m.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "participants.test_account.off" }),
    );
  });
  it("adds both records with who added it", async () => {
    records.delete(member);
    delete records.get(person).accountType;
    const response = await api()
      .put("/api/people/presenter@gmail.com/test-account")
      .send({ enabled: true });
    expect(response.status).toBe(200);
    expect(records.get(person).accountType).toBe("test");
    expect(records.get(member)).toEqual(
      expect.objectContaining({
        email: details.email,
        fullName: "Aarav Mehra",
        mobile: "9876543210",
        role: "presenter",
        addedByName: "Admin",
      }),
    );
    expect(m.revokeRefreshTokens).not.toHaveBeenCalled();
  });
  it("refuses an unknown participant", async () => {
    const response = await api()
      .put("/api/people/nobody@example.org/test-account")
      .send({ enabled: true });
    expect(response.status).toBe(404);
    expect(records.has("testAccounts/nobody@example.org")).toBe(false);
  });
});
