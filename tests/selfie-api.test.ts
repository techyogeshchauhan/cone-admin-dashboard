import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import supertest from "supertest";
import sharp from "sharp";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const root = await mkdtemp(path.join(tmpdir(), "cone-selfie-"));
vi.stubEnv("STORAGE_ROOT", root);
const m = vi.hoisted(() => ({
  verifyIdToken: vi.fn(),
  doc: vi.fn(),
  update: vi.fn(),
  people: {} as Record<string, unknown>,
}));
vi.mock("../server/firebase.js", () => ({ auth: m, db: m }));
const { app } = await import("../server/index.js");
const api = supertest(app);
const file = path.join(root, "selfies", "phone-uid.jpg");
const photo = await sharp({
  create: { width: 2000, height: 1500, channels: 3, background: "#3366aa" },
})
  .jpeg()
  .withMetadata({ exif: { IFD0: { Make: "TestPhone" } } })
  .toBuffer();

describe("mobile selfie upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.verifyIdToken.mockResolvedValue({
      uid: "phone-uid",
      email: "Person@Example.org",
      email_verified: true,
      login_audience: "mobile",
    });
    m.people = {
      "people/person@example.org": { registrationStatus: "confirmed" },
    };
    m.doc.mockImplementation((p: string) => ({
      get: async () => ({ data: () => m.people[p] }),
      update: m.update,
    }));
  });
  afterAll(() => rm(root, { recursive: true, force: true }));

  it("requires a signed-in participant before reading the upload", async () => {
    const response = await api
      .post("/api/mobile/selfie")
      .attach("selfie", photo, "selfie.jpg");
    expect(response.status).toBe(401);
    expect(m.verifyIdToken).not.toHaveBeenCalled();
  });

  it("rejects accounts without an active registration", async () => {
    m.people = {};
    const response = await api
      .post("/api/mobile/selfie")
      .set("Authorization", "Bearer token")
      .attach("selfie", photo, "selfie.jpg");
    expect(response.status).toBe(403);
    expect(m.update).not.toHaveBeenCalled();
  });

  it("rejects files that are not images", async () => {
    const response = await api
      .post("/api/mobile/selfie")
      .set("Authorization", "Bearer token")
      .attach("selfie", Buffer.from("not an image"), "selfie.jpg");
    expect(response.status).toBe(400);
  });

  it("stores a resized, metadata-free JPEG for the signed-in user", async () => {
    const response = await api
      .post("/api/mobile/selfie")
      .set("Authorization", "Bearer token")
      .attach("selfie", photo, "selfie.jpg");
    expect(response.status).toBe(201);
    expect(m.verifyIdToken).toHaveBeenCalledWith("token", true);
    const meta = await sharp(await readFile(file)).metadata();
    expect(meta).toMatchObject({ format: "jpeg", width: 1024, height: 768 });
    expect(meta.exif).toBeUndefined();
    expect(m.doc).toHaveBeenCalledWith("people/person@example.org");
    expect(m.update).toHaveBeenCalledWith(
      expect.objectContaining({ selfieKey: "selfies/phone-uid.jpg" }),
    );

    const own = await api
      .get("/api/mobile/selfie")
      .set("Authorization", "Bearer token");
    expect(own.status).toBe(200);
    expect(own.headers["content-type"]).toBe("image/jpeg");

    expect(
      (await api.delete("/api/mobile/selfie").set("Authorization", "Bearer token"))
        .status,
    ).toBe(200);
    await expect(stat(file)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
