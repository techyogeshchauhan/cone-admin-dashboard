import express from "express";
import supertest from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../server/firebase.js", () => ({ auth: {}, db: {} }));
import { registerDevRoleLogin } from "../server/dev-role-login.js";
const keys = [
  "NODE_ENV",
  "APP_ENV",
  "ENABLE_ADMIN_TEST_ACCOUNTS",
  "ENABLE_DASHBOARD_ROLE_LOGIN",
] as const;
const initial = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
describe("Dashboard development login endpoint", () => {
  const read = vi.fn(),
    verify = vi.fn();
  const app = express();
  app.use(express.json());
  registerDevRoleLogin(app, { readCredentials: read, verifyAccount: verify });
  const api = supertest(app);
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    process.env.APP_ENV = "development";
    process.env.ENABLE_ADMIN_TEST_ACCOUNTS = "true";
    process.env.ENABLE_DASHBOARD_ROLE_LOGIN = "true";
    read.mockResolvedValue({
      accounts: [
        {
          role: "superadmin",
          email: "superadmin@cone-admin.test",
          password: "fixture-only-password",
        },
      ],
    });
    verify.mockResolvedValue(true);
  });
  afterEach(() => {
    vi.clearAllMocks();
    for (const key of keys) {
      if (initial[key] === undefined) delete process.env[key];
      else process.env[key] = initial[key];
    }
  });
  it("returns the matching existing fixture for loopback UI requests", async () => {
    const result = await api
      .post("/api/dev/role-login")
      .set("Origin", "http://localhost:3000")
      .send({ role: "superadmin" });
    expect(result.status).toBe(200);
    expect(result.body.email).toBe("superadmin@cone-admin.test");
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(verify).toHaveBeenCalledOnce();
  });
  it("also supports an explicitly enabled local testing environment", async () => {
    process.env.APP_ENV = "test";
    expect(
      (
        await api
          .post("/api/dev/role-login")
          .set("Origin", "http://localhost:3000")
          .send({ role: "superadmin" })
      ).status,
    ).toBe(200);
  });
  it.each(["APP_ENV", "NODE_ENV"])(
    "never exposes credentials when %s is production",
    async (key) => {
      process.env[key] = "production";
      const result = await api
        .post("/api/dev/role-login")
        .set("Origin", "http://localhost:3000")
        .send({ role: "superadmin" });
      expect(result.status).toBe(404);
      expect(read).not.toHaveBeenCalled();
      expect(JSON.stringify(result.body)).not.toContain("password");
    },
  );
  it.each(["ENABLE_ADMIN_TEST_ACCOUNTS", "ENABLE_DASHBOARD_ROLE_LOGIN"])(
    "can be disabled with %s",
    async (key) => {
      process.env[key] = "false";
      expect(
        (
          await api
            .post("/api/dev/role-login")
            .set("Origin", "http://localhost:3000")
            .send({ role: "superadmin" })
        ).status,
      ).toBe(404);
      expect(read).not.toHaveBeenCalled();
    },
  );
  it.each(["https://external.example", "null", ""])(
    "rejects non-local or missing origins: %s",
    async (origin) => {
      expect(
        (
          await api
            .post("/api/dev/role-login")
            .set("Origin", origin)
            .send({ role: "superadmin" })
        ).status,
      ).toBe(403);
      expect(read).not.toHaveBeenCalled();
    },
  );
  it("rejects forwarded requests", async () => {
    expect(
      (
        await api
          .post("/api/dev/role-login")
          .set("Origin", "http://localhost:3000")
          .set("X-Forwarded-For", "203.0.113.1")
          .send({ role: "superadmin" })
      ).status,
    ).toBe(403);
  });
  it("rejects unsupported roles without reading credentials", async () => {
    expect(
      (
        await api
          .post("/api/dev/role-login")
          .set("Origin", "http://localhost:3000")
          .send({ role: "owner" })
      ).status,
    ).toBe(400);
    expect(read).not.toHaveBeenCalled();
  });
  it("refuses stale or non-test Firebase profiles", async () => {
    verify.mockResolvedValue(false);
    const result = await api
      .post("/api/dev/role-login")
      .set("Origin", "http://localhost:3000")
      .send({ role: "superadmin" });
    expect(result.status).toBe(503);
    expect(result.body.password).toBeUndefined();
  });
});
