export function allowAdminTestLogin(
  account: { isTestAccount?: boolean; email?: string },
  token: { coneDashboardTest?: unknown; email?: string },
) {
  return (
    account.isTestAccount === true &&
    token.coneDashboardTest === true &&
    account.email === token.email &&
    account.email?.endsWith("@cone-admin.test") === true &&
    process.env.NODE_ENV !== "production" &&
    ["development", "test"].includes(process.env.APP_ENV || "") &&
    process.env.ENABLE_ADMIN_TEST_ACCOUNTS === "true"
  );
}
