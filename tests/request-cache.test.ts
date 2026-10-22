import { beforeEach, describe, expect, it, vi } from "vitest";
import supertest from "supertest";
const m = vi.hoisted(() => {
  process.env.API_CACHE_MS = "30000";
  return {
    verify: vi.fn(),
    reads: [] as string[],
    profiles: {} as Record<string, unknown>,
  };
});
vi.mock("../server/firebase.js", () => ({
  auth: { verifyIdToken: m.verify },
  db: {
    doc: (path: string) => ({
      get: async () => {
        m.reads.push(path);
        return { exists: path in m.profiles, data: () => m.profiles[path] };
      },
    }),
    collection: () => ({ add: async () => ({}) }),
  },
}));
import { app } from "../server/index.js";
import { clearRequestCaches, memo } from "../server/request-cache.js";
const api = supertest(app);
const me = (token = "token-a") =>
  api.get("/api/me").set("Authorization", `Bearer ${token}`);
const decoded = (uid: string, exp = Date.now() / 1000 + 3600) => ({
  uid,
  email: `${uid}@example.org`,
  email_verified: true,
  exp,
  auth_time: Math.floor(Date.now() / 1000),
  firebase: {},
});

describe("request cache", () => {
  it("shares one pending lookup between concurrent callers", async () => {
    const cache = memo<number>();
    const load = vi.fn(async () => 7);
    expect(await Promise.all([cache("k", load), cache("k", load)])).toEqual([
      7, 7,
    ]);
    expect(load).toHaveBeenCalledTimes(1);
  });
  it("never keeps a failure", async () => {
    const cache = memo<number>();
    await expect(
      cache("k", async () => {
        throw new Error("network");
      }),
    ).rejects.toThrow("network");
    await new Promise((resolve) => setTimeout(resolve));
    expect(await cache("k", async () => 1)).toBe(1);
  });
  it("does not keep a value past its own expiry", async () => {
    const cache = memo<number>();
    await cache(
      "k",
      async () => 1,
      () => Date.now() - 1,
    );
    await new Promise((resolve) => setTimeout(resolve));
    expect(await cache("k", async () => 2)).toBe(2);
  });
});

describe("dashboard session lookups", () => {
  beforeEach(() => {
    clearRequestCaches();
    vi.clearAllMocks();
    m.reads.length = 0;
    m.profiles = {
      "adminUsers/user-a": {
        fullName: "A",
        accessRole: "organizer",
        status: "active",
        conferenceId: "main",
      },
    };
    m.verify.mockResolvedValue(decoded("user-a"));
  });
  it("verifies a token and loads the account once for a burst of page requests", async () => {
    const responses = await Promise.all([me(), me(), me(), me()]);
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    expect(responses[0].body).toMatchObject({
      uid: "user-a",
      role: "organizer",
    });
    expect(responses[0].body.expiresAt).toBeUndefined();
    expect(m.verify).toHaveBeenCalledTimes(1);
    expect(m.reads.filter((p) => p === "adminUsers/user-a")).toHaveLength(1);

    await me();
    expect(m.verify).toHaveBeenCalledTimes(1);
  });
  it("keeps sessions on unrelated writes and refuses a disabled account after an access mutation", async () => {
    expect((await me()).status).toBe(200);
    m.profiles["adminUsers/user-a"] = {
      ...(m.profiles["adminUsers/user-a"] as object),
      status: "disabled",
    };
    expect((await me()).status).toBe(200);
    await api
      .post("/api/records/participants")
      .set("Authorization", "Bearer token-a")
      .send({ data: {} });
    expect((await me()).status).toBe(200);
    await api
      .post("/api/control/users/user-a/action")
      .set("Authorization", "Bearer token-a")
      .send({});
    expect((await me()).status).toBe(403);
    expect(m.verify).toHaveBeenCalledTimes(2);
  });
  it("keeps each token separate and never caches a refusal", async () => {
    m.verify.mockImplementation(async (token: string) =>
      token === "token-b" ? decoded("user-b") : decoded("user-a"),
    );
    expect((await me("token-b")).status).toBe(403);
    m.profiles["adminUsers/user-b"] = {
      fullName: "B",
      accessRole: "meal_desk",
      status: "active",
      conferenceId: "main",
    };
    expect((await me("token-b")).body).toMatchObject({ uid: "user-b" });
    expect((await me("token-a")).body).toMatchObject({ uid: "user-a" });
  });
  it("re-verifies a token once it has expired", async () => {
    m.verify.mockResolvedValue(decoded("user-a", Date.now() / 1000 - 1));
    await me();
    await me();
    expect(m.verify).toHaveBeenCalledTimes(2);
  });
  it("reads the maintenance and runtime switches once for a burst of requests", async () => {
    const responses = await Promise.all(
      Array.from({ length: 4 }, () =>
        api
          .get("/api/workspace-settings")
          .set("Authorization", "Bearer token-a"),
      ),
    );
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    expect(
      m.reads.filter((p) => p.startsWith("applicationSettings/")).sort(),
    ).toEqual(["applicationSettings/main", "applicationSettings/runtime"]);
  });
});
