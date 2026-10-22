import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import supertest from "supertest";
import { fakeFirestore } from "./fake-firestore.js";
import { personSearchKeys } from "../shared/search.js";
const m = vi.hoisted(() => {
  process.env.API_CACHE_MS = "30000";
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
import { appendLog } from "../server/activity-log.js";
const api = supertest(app);
const get = (path: string) =>
  api.get(path).set("Authorization", "Bearer token");
const person = (name: string, extra: Record<string, unknown> = {}) => {
  const email = `${name.toLowerCase().replace(" ", ".")}@example.org`;
  const record = {
    fullName: name,
    email,
    mobile: "9876543210",
    role: "attendee",
    registrationStatus: "pending",
    isDemo: false,
    ...extra,
  };
  m.fake.store.set(`people/${email}`, {
    ...record,
    searchKeys: personSearchKeys(record),
  });
};
const readsOf = (collection: string) =>
  m.fake.reads
    .filter((r: { collection: string }) => r.collection === collection)
    .reduce((sum: number, r: { documents: number }) => sum + r.documents, 0);

describe("paged lists", () => {
  beforeEach(() => {
    clearRequestCaches();
    m.fake = fakeFirestore();
    m.fake.store.set("adminUsers/owner", {
      fullName: "Owner",
      accessRole: "superadmin",
      status: "active",
      conferenceId: "main",
    });
    m.verify.mockResolvedValue({
      uid: "owner",
      email: "owner@example.org",
      email_verified: true,
      exp: Date.now() / 1000 + 3600,
      firebase: { sign_in_second_factor: "phone" },
    });
    for (let i = 0; i < 40; i++)
      person(`Person ${String(i).padStart(2, "0")}`, {
        role: i % 4 ? "attendee" : "presenter",
      });
    person("Ravi Negi", { role: "presenter" });
    person("Ravina Rawat");
    person("Ravi Archived", { archivedAt: "2026-10-01" });
    person("Ravi Demo", { isDemo: true });
  });

  it("serves participants 25 at a time with a cursor for the next page", async () => {
    const first = await get("/api/records/participants");
    expect(first.body.rows).toHaveLength(25);
    expect(first.body.next).toBe(first.body.rows[24].id);
    expect(first.body.rows[0].searchKeys).toBeUndefined();
    const rest = await get(
      `/api/records/participants?limit=100&after=${encodeURIComponent(first.body.next)}`,
    );
    // 44 stored; the archived one is never listed.
    expect(rest.body.rows).toHaveLength(18);
    expect(rest.body.next).toBeNull();
  });

  it("searches every participant on the server, reading only matches", async () => {
    m.fake.reads.length = 0;
    const found = await get("/api/records/participants?q=rav");
    expect(
      found.body.rows.map((r: { fullName: string }) => r.fullName),
    ).toEqual(["Ravi Demo", "Ravi Negi", "Ravina Rawat"]);
    expect(readsOf("people")).toBe(4);
    const exact = await get("/api/records/participants?q=ravi%20neg");
    expect(
      exact.body.rows.map((r: { fullName: string }) => r.fullName),
    ).toEqual(["Ravi Negi"]);
  });

  it("combines a search with role and demo filters", async () => {
    const found = await get(
      "/api/records/participants?q=ravi&role=presenter&excludeDemo=true",
    );
    expect(
      found.body.rows.map((r: { fullName: string }) => r.fullName),
    ).toEqual(["Ravi Negi"]);
    const presenters = await get(
      "/api/records/participants?role=presenter&limit=100",
    );
    expect(presenters.body.rows).toHaveLength(11);
  });

  it("matches small modules by any field while reading them", async () => {
    m.fake.store.set("venues/a", { name: "Main Hall", location: "Block A" });
    m.fake.store.set("venues/b", { name: "Seminar Room", location: "Block B" });
    const found = await get("/api/records/venues?q=seminar");
    expect(found.body.rows.map((r: { name: string }) => r.name)).toEqual([
      "Seminar Room",
    ]);
  });

  it("lists activity newest first, a page at a time", async () => {
    const temporaryRoot = path.resolve(tmpdir());
    const logDirectory = await mkdtemp(
      path.join(temporaryRoot, "cone-list-api-"),
    );
    vi.stubEnv("LOG_DIR", logDirectory);
    try {
      for (let i = 1; i <= 30; i++)
        await appendLog("audit", {
          action: `step ${i}`,
          createdAt: `2026-10-20T10:${String(i).padStart(2, "0")}:00.000Z`,
        });
      const first = await get("/api/audit");
      expect(first.body.rows[0].action).toBe("step 30");
      expect(first.body.rows).toHaveLength(25);
      const second = await get(`/api/audit?after=${first.body.next}`);
      expect(second.body.rows.map((r: { action: string }) => r.action)).toEqual(
        ["step 5", "step 4", "step 3", "step 2", "step 1"],
      );
      expect(second.body.next).toBeNull();
    } finally {
      vi.unstubAllEnvs();
      if (
        !path.resolve(logDirectory).startsWith(`${temporaryRoot}${path.sep}`) ||
        !path.basename(logDirectory).startsWith("cone-list-api-")
      )
        throw new Error("Refusing to remove an unexpected temporary directory");
      await rm(logDirectory, { recursive: true, force: true });
    }
  });

  it("sends only the delivery columns of queued emails, not their bodies", async () => {
    m.fake.store.set("emailJobs/j1", {
      recipient: "a@example.org",
      status: "sent",
      attempts: 1,
      createdAt: "2026-10-20",
      body: "private message",
    });
    const jobs = await get("/api/email/jobs");
    expect(jobs.body.rows).toEqual([
      {
        id: "j1",
        recipient: "a@example.org",
        status: "sent",
        attempts: 1,
        createdAt: "2026-10-20",
      },
    ]);
  });

  it("counts the overview once, until something changes", async () => {
    const first = await get("/api/overview");
    expect(first.body).toMatchObject({ registrations: 42, presenters: 11 });
    const before = readsOf("people");
    await get("/api/overview");
    expect(readsOf("people")).toBe(before);
    await api
      .post("/api/records/venues")
      .set("Authorization", "Bearer token")
      .send({ data: {} });
    await get("/api/overview");
    expect(readsOf("people")).toBeGreaterThan(before);
  });
});
