import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import supertest from "supertest";
const mocks = vi.hoisted(() => ({ generate: vi.fn(), verify: vi.fn(), doc: vi.fn(), update: vi.fn(), user: vi.fn(), custom: vi.fn(), updateUser: vi.fn() }));
vi.mock("../server/firebase.js", () => ({
  auth: { generateSignInWithEmailLink: mocks.generate, verifyIdToken: mocks.verify, getUserByEmail: mocks.user, createCustomToken: mocks.custom, updateUser: mocks.updateUser },
  db: { doc: mocks.doc },
}));
import { registerTestingVerification } from "../server/testing-verification.js";
function api(enabled = true, production = false) {
  process.env.TEST_IN_APP_EMAIL_VERIFICATION = String(enabled);
  process.env.APP_ENV = production ? "production" : "test";
  const app = express(); app.use(express.json());
  registerTestingVerification(app);
  return supertest(app);
}
afterEach(() => { vi.clearAllMocks(); delete process.env.TEST_IN_APP_EMAIL_VERIFICATION; delete process.env.APP_ENV; });
describe("in-app email verification", () => {
  it("is absent by default and refuses production", async () => {
    expect((await api(false).post("/api/testing/email-link")).status).toBe(404);
    expect(() => api(true, true)).toThrow("production");
  });
  for (const role of ["participant", "attendee", "volunteer", "organizer"]) {
    it(`generates a Firebase link without mail delivery for ${role}`, async () => {
      const email = `${role}1@${role}.com`;
      mocks.doc.mockReturnValue({ get: async () => ({ data: () => ({ fullName: "Test User", mobile: "9000000001" }) }) });
      mocks.generate.mockResolvedValue("https://example.test/?oobCode=test");
      const response = await api().post("/api/testing/email-link").send({ email, name: "Test User", mobile: "+91 9000000001" });
      expect(response.status).toBe(200);
      expect(response.body.link).toContain("oobCode");
      expect(mocks.generate).toHaveBeenCalledWith(email, expect.objectContaining({ handleCodeInApp: true }));
    });
  }
  it("Continue verifies the existing account and returns a session without generating links", async () => {
    mocks.doc.mockReturnValue({ get: async () => ({ data: () => ({ fullName: "Test User", mobile: "9000000001" }) }), update: mocks.update });
    mocks.user.mockResolvedValue({ uid: "original-uid", disabled: false });
    mocks.custom.mockResolvedValue("custom-token");
    const response = await api().post("/api/testing/continue").send({ email: "presenter@gmail.com", name: "Test User", mobile: "9000000001" });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ token: "custom-token", status: "Verified" });
    expect(mocks.custom).toHaveBeenCalledWith("original-uid");
    expect(mocks.updateUser).toHaveBeenCalledWith("original-uid", { emailVerified: true });
    expect(mocks.update).toHaveBeenCalledWith({ emailVerified: true, emailVerificationStatus: "Verified" });
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("does not verify or send links when signing credentials are unavailable", async () => {
    mocks.doc.mockReturnValue({ get: async () => ({ data: () => ({ fullName: "Test User", mobile: "9000000001" }) }), update: mocks.update });
    mocks.user.mockResolvedValue({ uid: "original-uid", disabled: false });
    mocks.custom.mockRejectedValueOnce(new Error("signBlob denied"));
    const response = await api().post("/api/testing/continue").send({ email: "presenter@gmail.com", name: "Test User", mobile: "9000000001" });
    expect(response.status).toBe(503);
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("Continue rejects incorrect details without marking the email verified", async () => {
    mocks.doc.mockReturnValue({ get: async () => ({ data: () => ({ fullName: "Test User", mobile: "9000000001" }) }), update: mocks.update });
    expect((await api().post("/api/testing/continue").send({ email: "presenter@gmail.com", name: "Test User", mobile: "9000000002" })).status).toBe(400);
    expect(mocks.custom).not.toHaveBeenCalled();
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("allows six complete verification flows within the rate limit", async () => {
    const client = api();
    mocks.generate.mockResolvedValue("https://example.test/?oobCode=test");
    mocks.verify.mockResolvedValue({ email: "presenter@gmail.com", email_verified: true });
    mocks.doc.mockReturnValue({
      get: async () => ({ exists: true, data: () => ({ fullName: "Test User", mobile: "9000000001" }) }),
      update: mocks.update,
    });
    for (let i = 0; i < 6; i++) {
      expect((await client.post("/api/testing/email-link").send({ email: "presenter@gmail.com", name: "Test User", mobile: "9000000001" })).status).toBe(200);
      expect((await client.post("/api/testing/email-verified").set("Authorization", "Bearer token")).status).toBe(200);
    }
  });
  it("rejects the testing flag without an explicit test environment", () => {
    process.env.TEST_IN_APP_EMAIL_VERIFICATION = "true";
    delete process.env.APP_ENV;
    expect(() => registerTestingVerification(express())).toThrow("APP_ENV=test or development");
  });
  it("rejects mismatching registration details before generating a link", async () => {
    mocks.doc.mockReturnValue({ get: async () => ({ data: () => ({ fullName: "Test User", mobile: "9000000001" }) }) });
    expect((await api().post("/api/testing/email-link").send({ email: "test@example.com", name: "Test User", mobile: "9000000002" })).status).toBe(400);
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("saves Verified only after Firebase confirms email ownership", async () => {
    mocks.verify.mockResolvedValue({ email: "participant1@participant.com", email_verified: true });
    mocks.doc.mockReturnValue({ get: async () => ({ exists: true }), update: mocks.update });
    expect((await api().post("/api/testing/email-verified").set("Authorization", "Bearer token")).body.status).toBe("Verified");
    expect(mocks.update).toHaveBeenCalledWith({ emailVerified: true, emailVerificationStatus: "Verified" });
    mocks.verify.mockResolvedValue({ email: "participant1@participant.com", email_verified: false });
    mocks.update.mockClear();
    expect((await api().post("/api/testing/email-verified").set("Authorization", "Bearer token")).status).toBe(403);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
