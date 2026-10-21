import { beforeEach, describe, expect, it, vi } from "vitest";
import supertest from "supertest";
import sharp from "sharp";
import { fakeFirestore } from "./fake-firestore.js";
import { conferenceSchema } from "../shared/schema.js";
const m = vi.hoisted(() => {
  process.env.API_CACHE_MS = "30000";
  process.env.STORAGE_ROOT = `${process.env.TEMP || process.env.TMPDIR || "/tmp"}/cone-conference-test`;
  return { fake: null as any, verify: vi.fn() };
});
vi.mock("../server/firebase.js", () => ({
  get db() {
    return m.fake.db;
  },
  auth: { verifyIdToken: m.verify },
}));
import { app } from "../server/index.js";
import { clearRequestCaches } from "../server/request-cache.js";
const api = supertest(app);
const conference = {
  name: "21st Uttarakhand State Science & Technology Conference",
  shortName: "USSTC",
  edition: "21st",
  theme: "Skill Enhancement for Science-based Knowledge Generation",
  startDate: "2026-10-23",
  endDate: "2026-10-24",
  venue: "Dehradun, Uttarakhand",
  organizer: "UCOST",
  organizerAddress: "Vigyan Dham, Jhajra, Dehradun – 248015",
  website: "https://www.ucost.uk.gov.in",
  highlights: ["Keynote Sessions", "Expert Talks"],
  logos: [{ src: "/partners/ucost.webp", label: "UCOST" }],
  contactEmail: "office@example.org",
  publicationStatus: "draft",
};

describe("conference details for the sign-in screen", () => {
  beforeEach(() => {
    clearRequestCaches();
    m.fake = fakeFirestore();
    m.fake.store.set("adminUsers/owner", {
      fullName: "Owner",
      accessRole: "superadmin",
      status: "active",
      conferenceId: "main",
    });
    m.fake.store.set("conference/main", {
      ...conference,
      schedule: [{ title: "Opening" }],
      notInWorkbook: [],
    });
    m.verify.mockResolvedValue({
      uid: "owner",
      email: "owner@example.org",
      email_verified: true,
      auth_time: Math.floor(Date.now() / 1000),
      exp: Date.now() / 1000 + 3600,
      firebase: { sign_in_second_factor: "phone" },
    });
  });

  it("accepts the new fields and refuses logos or websites from elsewhere", () => {
    expect(conferenceSchema.safeParse(conference).success).toBe(true);
    for (const src of [
      "https://evil.example/logo.png",
      "/partners/../.env",
      "/api/public/conference-logo/not-a-uuid",
    ])
      expect(
        conferenceSchema.safeParse({
          ...conference,
          logos: [{ src, label: "x" }],
        }).success,
      ).toBe(false);
    expect(
      conferenceSchema.safeParse({
        ...conference,
        website: "javascript:alert(1)",
      }).success,
    ).toBe(false);
  });

  it("shows nothing before the details are published", async () => {
    const response = await api.get("/api/public/conference");
    expect(response.body).toEqual({ published: false });
  });

  it("shows only public fields once published, updated as soon as they are saved", async () => {
    m.fake.store.set("conference/main", {
      ...m.fake.store.get("conference/main"),
      publicationStatus: "published",
    });
    const first = await api.get("/api/public/conference");
    expect(first.body).toMatchObject({
      published: true,
      edition: "21st",
      venue: "Dehradun, Uttarakhand",
      highlights: ["Keynote Sessions", "Expert Talks"],
      logos: [{ src: "/partners/ucost.webp", label: "UCOST" }],
    });
    for (const key of ["contactEmail", "schedule", "notInWorkbook"])
      expect(first.body[key]).toBeUndefined();

    const saved = await api
      .put("/api/conference")
      .set("Authorization", "Bearer token")
      .send({
        ...conference,
        venue: "Doon University",
        publicationStatus: "published",
      });
    expect(saved.status).toBe(200);
    expect((await api.get("/api/public/conference")).body.venue).toBe(
      "Doon University",
    );
    expect(m.fake.store.get("conference/main").schedule).toEqual([
      { title: "Opening" },
    ]);
  });

  it("stores an uploaded logo and serves it publicly", async () => {
    const png = await sharp({
      create: { width: 40, height: 40, channels: 3, background: "#19e3dc" },
    })
      .png()
      .toBuffer();
    const uploaded = await api
      .post("/api/conference/logos")
      .set("Authorization", "Bearer token")
      .attach("logo", png, "logo.png");
    expect(uploaded.status).toBe(200);
    expect(uploaded.body.src).toMatch(
      /^\/api\/public\/conference-logo\/[0-9a-f-]{36}$/,
    );
    const served = await api.get(uploaded.body.src);
    expect(served.status).toBe(200);
    expect(served.headers["content-type"]).toContain("image/webp");
    const refused = await api
      .post("/api/conference/logos")
      .set("Authorization", "Bearer token")
      .attach("logo", Buffer.from("not an image"), "logo.png");
    expect(refused.status).toBe(400);
  });
});
