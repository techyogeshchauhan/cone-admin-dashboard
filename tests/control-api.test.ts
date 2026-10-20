import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
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
const recent = () => Math.floor(Date.now() / 1000);
function fixture(
  role = "organizer",
  grants?: string[],
  runtime: Record<string, unknown> = {},
) {
  mocks.verify.mockResolvedValue({
    uid: "uid",
    email: "user@example.org",
    email_verified: true,
    auth_time: recent(),
    firebase: { sign_in_second_factor: "phone" },
  });
  mocks.doc.mockImplementation((path: string) => ({
    get: vi.fn().mockResolvedValue({
      data: () =>
        path.startsWith("adminUsers/")
          ? {
              fullName: "Account",
              accessRole: role,
              status: "active",
              conferenceId: "main",
            }
          : path === "applicationSettings/runtime"
            ? runtime
            : path.startsWith("roleDefinitions/") && grants
              ? {
                  name: "Policy",
                  description: "",
                  version: 1,
                  managedRole: true,
                  active: true,
                  permissions: grants,
                }
              : {},
    }),
  }));
}
describe("Control Center HTTP protection", () => {
  it("denies deleting users without Super Admin privileges", async () => {
    fixture("organizer");
    const response = await api
      .post("/api/control/users/target/delete")
      .set("Authorization", "Bearer token")
      .send({ version: 1 });
    expect(response.status).toBe(403);
  });
  it("keeps development email verification disabled", async () => {
    fixture("superadmin");
    vi.stubEnv("APP_ENV", "test");
    vi.stubEnv("TEST_IN_APP_EMAIL_VERIFICATION", "true");
    try {
      const response = await api
        .post("/api/control/users/some-user/action")
        .set("Authorization", "Bearer token")
        .send({ action: "verification_email" });
      expect(response.status).toBe(400);
      expect(response.body.error).toContain("disabled during development");
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("allows participant profile reads only for the signed-in person", async () => {
    fixture("participant");
    const response = await api
      .get("/api/profile")
      .set("Authorization", "Bearer token");
    expect(response.status).toBe(200);
    expect(mocks.doc).toHaveBeenCalledWith("people/user@example.org");
    expect(response.body.schedule).toEqual([]);
  });
  beforeEach(() => fixture());
  afterEach(() => vi.clearAllMocks());
  it("requires Super Admin for control endpoints", async () => {
    expect(
      (
        await api
          .get("/api/control/runtime")
          .set("Authorization", "Bearer token")
      ).status,
    ).toBe(403);
    expect(mocks.collection).not.toHaveBeenCalled();
  });
  it("returns runtime defaults to authenticated Super Admin", async () => {
    fixture("superadmin");
    const result = await api
      .get("/api/control/runtime")
      .set("Authorization", "Bearer token");
    expect(result.status).toBe(200);
    expect(result.body.sessionMaxAgeMinutes).toBe(480);
  });
  it("requires recent authentication for control writes", async () => {
    fixture("superadmin");
    mocks.verify.mockResolvedValue({
      uid: "uid",
      email: "user@example.org",
      email_verified: true,
      auth_time: recent() - 600,
      firebase: { sign_in_second_factor: "phone" },
    });
    expect(
      (
        await api
          .put("/api/control/roles/support")
          .set("Authorization", "Bearer token")
          .send({})
      ).status,
    ).toBe(403);
    expect(mocks.collection).not.toHaveBeenCalled();
  });
  it("does not allow editing the protected Super Admin policy", async () => {
    fixture("superadmin");
    const result = await api
      .put("/api/control/roles/superadmin")
      .set("Authorization", "Bearer token")
      .send({});
    expect(result.status).toBe(400);
    expect(result.body.error).toContain("protected");
  });
  it("blocks writes from a read-only role before the collection is accessed", async () => {
    fixture("organizer", ["participants:read"]);
    expect(
      (
        await api
          .post("/api/records/participants")
          .set("Authorization", "Bearer token")
          .send({ data: {} })
      ).status,
    ).toBe(403);
    expect(mocks.collection).not.toHaveBeenCalled();
  });
  it("applies the write pause before participant mutations", async () => {
    fixture("organizer", undefined, { writesPaused: true });
    expect(
      (
        await api
          .post("/api/records/participants")
          .set("Authorization", "Bearer token")
          .send({ data: {} })
      ).status,
    ).toBe(503);
    expect(mocks.collection).not.toHaveBeenCalled();
  });
  it("enforces import and email feature switches before writes", async () => {
    fixture("organizer", undefined, {
      importsEnabled: false,
      emailEnabled: false,
    });
    expect(
      (
        await api
          .post("/api/imports/preview")
          .set("Authorization", "Bearer token")
      ).status,
    ).toBe(503);
    expect(
      (await api.post("/api/email/queue").set("Authorization", "Bearer token"))
        .status,
    ).toBe(503);
  });
  it("does not expose secret configuration through workspace settings", async () => {
    fixture();
    const result = await api
      .get("/api/workspace-settings")
      .set("Authorization", "Bearer token");
    expect(result.status).toBe(200);
    expect(Object.keys(result.body).sort()).toEqual([
      "announcement",
      "applicationName",
    ]);
  });
});
