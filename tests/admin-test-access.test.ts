import { afterEach, describe, expect, it } from "vitest";
import { allowAdminTestLogin } from "../server/admin-test-access.js";
const saved = {
  app: process.env.APP_ENV,
  enabled: process.env.ENABLE_ADMIN_TEST_ACCOUNTS,
};
afterEach(() => {
  if (saved.app === undefined) delete process.env.APP_ENV;
  else process.env.APP_ENV = saved.app;
  if (saved.enabled === undefined)
    delete process.env.ENABLE_ADMIN_TEST_ACCOUNTS;
  else process.env.ENABLE_ADMIN_TEST_ACCOUNTS = saved.enabled;
});
describe("Dedicated dashboard test accounts", () => {
  const account = { isTestAccount: true, email: "superadmin@cone-admin.test" };
  const token = { coneDashboardTest: true, email: account.email };
  it("only exempts explicitly enabled marked test identities in development", () => {
    process.env.APP_ENV = "development";
    process.env.ENABLE_ADMIN_TEST_ACCOUNTS = "true";
    expect(allowAdminTestLogin(account, token)).toBe(true);
    expect(
      allowAdminTestLogin({ ...account, isTestAccount: false }, token),
    ).toBe(false);
    expect(
      allowAdminTestLogin(account, { ...token, coneDashboardTest: false }),
    ).toBe(false);
  });
  it("never permits test identities in production", () => {
    process.env.APP_ENV = "production";
    process.env.ENABLE_ADMIN_TEST_ACCOUNTS = "true";
    expect(allowAdminTestLogin(account, token)).toBe(false);
  });
  it("requires the development flag and matching reserved address", () => {
    process.env.APP_ENV = "development";
    process.env.ENABLE_ADMIN_TEST_ACCOUNTS = "false";
    expect(allowAdminTestLogin(account, token)).toBe(false);
    process.env.ENABLE_ADMIN_TEST_ACCOUNTS = "true";
    expect(
      allowAdminTestLogin(account, { ...token, email: "other@example.org" }),
    ).toBe(false);
  });
});
