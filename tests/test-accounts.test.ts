import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  doc: vi.fn(),
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
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ALLOW_TEST_ACCOUNT_LOGIN", "true");
  records = new Map([
    [
      "people/presenter@gmail.com",
      {
        fullName: "Aarav Mehra",
        mobile: "9876543210",
        registrationStatus: "confirmed",
        isDemo: true,
        accountType: "test",
      },
    ],
  ]);
  m.doc.mockImplementation((path: string) => ({
    get: async () => ({
      exists: records.has(path),
      data: () => structuredClone(records.get(path)),
    }),
    update: async (value: any) => {
      const next = { ...records.get(path), ...value };
      for (const [key, v] of Object.entries(value))
        if (v && typeof v === "object" && "isEqual" in v) delete next[key];
      records.set(path, next);
    },
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
  it("signs a flagged account in without an emailed code", async () => {
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
    expect(records.get("people/presenter@gmail.com").emailVerified).toBe(true);
  });
  it("accepts spacing and +91 like the OTP check", async () => {
    const response = await api()
      .post("/api/auth/test-login")
      .send({ ...details, name: " aarav  MEHRA ", mobile: "+91 98765 43210" });
    expect(response.status).toBe(200);
  });
  it("refuses an unflagged registration so the app uses OTP", async () => {
    delete records.get("people/presenter@gmail.com").accountType;
    const response = await api().post("/api/auth/test-login").send(details);
    expect(response.status).toBe(404);
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
    records.get("people/presenter@gmail.com").registrationStatus = "cancelled";
    expect(
      (await api().post("/api/auth/test-login").send(details)).status,
    ).toBe(404);
    records.get("people/presenter@gmail.com").registrationStatus = "confirmed";
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
describe("test account flag", () => {
  it("lets only Super Admin change it", async () => {
    const response = await api("conference_admin")
      .put("/api/people/presenter@gmail.com/test-account")
      .send({ enabled: true });
    expect(response.status).toBe(403);
  });
  it("turns the flag off and ends existing sessions", async () => {
    const response = await api()
      .put("/api/people/presenter@gmail.com/test-account")
      .send({ enabled: false });
    expect(response.status).toBe(200);
    expect(
      records.get("people/presenter@gmail.com").accountType,
    ).toBeUndefined();
    expect(m.revokeRefreshTokens).toHaveBeenCalledWith("uid");
    expect(m.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "participants.test_account.off" }),
    );
  });
  it("turns the flag on", async () => {
    delete records.get("people/presenter@gmail.com").accountType;
    const response = await api()
      .put("/api/people/presenter@gmail.com/test-account")
      .send({ enabled: true });
    expect(response.status).toBe(200);
    expect(records.get("people/presenter@gmail.com").accountType).toBe("test");
    expect(m.revokeRefreshTokens).not.toHaveBeenCalled();
  });
});
