import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import supertest from "supertest";
const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  doc: vi.fn(),
  collection: vi.fn(),
}));
vi.mock("../server/firebase.js", () => ({
  auth: { verifyIdToken: mocks.verify },
  db: { doc: mocks.doc, collection: mocks.collection },
}));
import { app } from "../server/index.js";
const api = supertest(app);
describe("API authorization before administrative writes", () => {
  beforeEach(() => {
    mocks.verify.mockResolvedValue({
      uid: "organizer-uid",
      email: "organizer@example.org",
      email_verified: true,
      firebase: {},
    });
    mocks.doc.mockImplementation((path: string) => ({
      get: vi.fn().mockResolvedValue({
        data: () =>
          path.startsWith("adminUsers/")
            ? {
                fullName: "Organizer",
                accessRole: "organizer",
                status: "active",
                conferenceId: "main",
              }
            : { maintenanceMode: false },
      }),
    }));
  });
  afterEach(() => vi.clearAllMocks());
  it("lets the built dashboard reach Firebase Auth and reCAPTCHA but nothing else", async () => {
    const csp = (await api.get("/api/health")).headers[
      "content-security-policy"
    ];
    const connect = /connect-src ([^;]+)/.exec(csp)![1].split(" ");
    expect(connect).toEqual([
      "'self'",
      "https://identitytoolkit.googleapis.com",
      "https://securetoken.googleapis.com",
      "https://www.google.com/recaptcha/",
    ]);
    expect(csp).toContain(
      "script-src 'self' https://www.google.com/recaptcha/",
    );
    expect(csp).toContain("object-src 'none'");
  });
  it("reports a used-up Firebase quota on any page instead of a generic error", async () => {
    mocks.doc.mockImplementation(() => ({
      get: vi.fn().mockRejectedValue(
        Object.assign(new Error("8 RESOURCE_EXHAUSTED: Quota exceeded."), {
          code: 8,
        }),
      ),
    }));
    const response = await api
      .get("/api/me")
      .set("Authorization", "Bearer token");
    expect(response.status).toBe(503);
    expect(response.body.error).toMatch(/daily quota is used up/);
  });
  it("permits a basic liveness check without Firebase credentials", async () => {
    expect((await api.get("/api/health")).status).toBe(200);
    expect(mocks.verify).not.toHaveBeenCalled();
  });
  it("does not allow a mobile OTP session to bypass dashboard authentication", async () => {
    mocks.verify.mockResolvedValue({
      uid: "uid",
      email_verified: true,
      login_audience: "mobile",
    });
    expect(
      (await api.get("/api/me").set("Authorization", "Bearer token")).status,
    ).toBe(403);
    expect(mocks.doc).not.toHaveBeenCalled();
  });
  it("requires a bearer token for all administrative data", async () => {
    expect((await api.get("/api/records/participants")).status).toBe(401);
    expect(mocks.doc).not.toHaveBeenCalled();
  });
  it("verifies revocation with the Firebase Admin SDK", async () => {
    expect(
      (await api.get("/api/me").set("Authorization", "Bearer example-token"))
        .status,
    ).toBe(200);
    expect(mocks.verify).toHaveBeenCalledWith("example-token", true);
  });
  it("rejects unverified identities before looking up their permissions", async () => {
    mocks.verify.mockResolvedValue({ uid: "uid", email_verified: false });
    expect(
      (await api.get("/api/me").set("Authorization", "Bearer token")).status,
    ).toBe(403);
    expect(mocks.doc).not.toHaveBeenCalled();
  });
  it("prevents organizers from assigning Super Admin", async () => {
    const response = await api
      .post("/api/records/users")
      .set("Authorization", "Bearer token")
      .send({ data: { accessRole: "superadmin" } });
    expect(response.status).toBe(403);
    expect(mocks.collection).not.toHaveBeenCalled();
  });
  it("rejects malformed participant data before touching a collection", async () => {
    const response = await api
      .post("/api/records/participants")
      .set("Authorization", "Bearer token")
      .send({ data: { fullName: "", email: "bad", mobile: "invalid" } });
    expect(response.status).toBe(400);
    expect(mocks.collection).not.toHaveBeenCalled();
  });
  it("does not allow unknown modules", async () => {
    expect(
      (
        await api
          .get("/api/records/privateSecrets")
          .set("Authorization", "Bearer token")
      ).status,
    ).toBe(400);
    expect(mocks.collection).not.toHaveBeenCalled();
  });
  it("blocks inactive administrators even with a valid token", async () => {
    mocks.doc.mockReturnValue({
      get: vi.fn().mockResolvedValue({
        data: () => ({ status: "disabled", accessRole: "superadmin" }),
      }),
    });
    expect(
      (await api.get("/api/me").set("Authorization", "Bearer token")).status,
    ).toBe(403);
  });
  it("requires a second factor for Super Admin by default", async () => {
    mocks.doc.mockReturnValue({
      get: vi.fn().mockResolvedValue({
        data: () => ({ status: "active", accessRole: "superadmin" }),
      }),
    });
    expect(
      (await api.get("/api/me").set("Authorization", "Bearer token")).status,
    ).toBe(403);
  });
});
