import { describe, expect, it, vi } from "vitest";
import { mutationCaches } from "../server/cache-policy.js";
import { clearRequestCaches, memo } from "../server/request-cache.js";
describe("cache dependencies", () => {
  it.each([
    ["/records/participants", ["overview"]],
    ["/records/fees/a/archive", ["overview"]],
    ["/records/venues", []],
    ["/media", []],
    ["/email/queue", []],
    ["/control/users/a/action", ["sessions", "overview"]],
    ["/control/roles/custom", ["sessions"]],
    ["/settings/smtp", ["smtp"]],
    ["/settings", ["switches"]],
    ["/records/users", ["sessions", "overview"]],
    ["/records/staff", []],
    ["/settings/branding", ["switches", "branding"]],
    ["/control/runtime", ["switches", "branding"]],
    ["/people/a@test.org/test-account", ["sessions", "overview"]],
    ["/imports/inspect", []],
    ["/imports/preview", ["overview"]],
    ["/imports/workbook/preview", ["overview"]],
    ["/imports/job-id/commit", ["sessions", "overview"]],
    ["/imports/workbook/job-id/commit", ["sessions", "overview"]],
  ])("invalidates dependencies of %s", (path, tags) => {
    expect(mutationCaches(path as string).sort()).toEqual(
      (tags as string[]).sort(),
    );
  });
  it("retains sessions and branding when overview data is invalidated", async () => {
    const sessions = memo<number>({ tags: ["sessions"], ttl: 30000 });
    const metrics = memo<number>({ tags: ["overview"], ttl: 30000 });
    const session = vi.fn(async () => 1),
      metric = vi.fn(async () => 2);
    await sessions("user", session);
    await metrics("all", metric);
    clearRequestCaches(["overview"]);
    await sessions("user", session);
    await metrics("all", metric);
    expect(session).toHaveBeenCalledTimes(1);
    expect(metric).toHaveBeenCalledTimes(2);
  });
  it("shares quota failures during backoff without caching auth failures", async () => {
    const cached = memo<number>({ ttl: 30000 });
    const quota = vi.fn(async () => {
      throw { code: 8 };
    });
    await expect(cached("quota", quota)).rejects.toMatchObject({ code: 8 });
    await expect(cached("quota", quota)).rejects.toMatchObject({ code: 8 });
    expect(quota).toHaveBeenCalledTimes(1);
    const auth = vi.fn(async () => {
      throw { code: "auth/id-token-revoked" };
    });
    await expect(cached("auth", auth)).rejects.toBeDefined();
    await expect(cached("auth", auth)).rejects.toBeDefined();
    expect(auth).toHaveBeenCalledTimes(2);
  });
});
