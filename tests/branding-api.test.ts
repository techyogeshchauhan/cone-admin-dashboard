import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import supertest from "supertest";
const m = vi.hoisted(() => ({
  verifyIdToken: vi.fn(),
  doc: vi.fn(),
  collection: vi.fn(),
  runTransaction: vi.fn(),
}));
vi.mock("../server/firebase.js", () => ({ auth: m, db: m }));
import { app } from "../server/index.js";
function fixture(role: string, age = 0) {
  m.verifyIdToken.mockResolvedValue({
    uid: "actor",
    email: "actor@example.org",
    email_verified: true,
    auth_time: Math.floor(Date.now() / 1000) - age,
    firebase: { sign_in_second_factor: "phone" },
  });
  m.doc.mockImplementation((path: string) => ({
    get: async () => ({
      data: () =>
        path === "adminUsers/actor"
          ? {
              fullName: "Actor",
              accessRole: role,
              status: "active",
              conferenceId: "main",
            }
          : path === "applicationSettings/runtime"
            ? { applicationName: "Aurora", version: 3 }
            : path === "conference/branding"
              ? { logoId: null, secret: "never-public" }
              : {},
    }),
  }));
}
describe("application branding API permissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fixture("superadmin");
  });
  afterEach(() => vi.unstubAllEnvs());
  it("publishes only safe branding before login", async () => {
    const response = await supertest(app).get("/api/branding");
    expect(response.status).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe("*");
    expect(response.body).toEqual({
      applicationName: "Aurora",
      logoId: null,
      logoUrl: null,
      version: 3,
    });
    expect(m.verifyIdToken).not.toHaveBeenCalled();
  });
  it("requires authentication for saves", async () => {
    expect((await supertest(app).post("/api/settings/branding")).status).toBe(
      401,
    );
  });
  for (const role of [
    "conference_admin",
    "organizer",
    "registration_manager",
    "programme_manager",
    "meal_desk",
    "participant",
  ])
    it(`prevents ${role} branding changes before processing files`, async () => {
      fixture(role);
      const response = await supertest(app)
        .post("/api/settings/branding")
        .set("Authorization", "Bearer token")
        .field("applicationName", "Unauthorized")
        .field("version", "3");
      expect(response.status).toBe(403);
      expect(m.runTransaction).not.toHaveBeenCalled();
    });
  it("requires recent Super Admin authentication", async () => {
    fixture("superadmin", 600);
    const response = await supertest(app)
      .post("/api/settings/branding")
      .set("Authorization", "Bearer token")
      .field("applicationName", "New name")
      .field("version", "3");
    expect(response.status).toBe(403);
    expect(response.body.error).toContain("Sign in again");
  });
  it("rejects malformed image bytes before any settings write", async () => {
    const response = await supertest(app)
      .post("/api/settings/branding")
      .set("Authorization", "Bearer token")
      .field("applicationName", "New name")
      .field("version", "3")
      .attach("logo", Buffer.from("not an image"), {
        filename: "fake.png",
        contentType: "image/png",
      });
    expect(response.status).toBe(400);
    expect(m.runTransaction).not.toHaveBeenCalled();
  });
  it("rejects oversized uploads before any settings write", async () => {
    const response = await supertest(app)
      .post("/api/settings/branding")
      .set("Authorization", "Bearer token")
      .field("applicationName", "New name")
      .field("version", "3")
      .attach("logo", Buffer.alloc(2 * 1024 * 1024 + 1), {
        filename: "large.png",
        contentType: "image/png",
      });
    expect(response.status).toBe(400);
    expect(response.body.error).toContain("2 MB");
    expect(m.runTransaction).not.toHaveBeenCalled();
  });
});
