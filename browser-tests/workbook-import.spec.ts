import { test, expect } from "@playwright/test";
test("rows to fix show missing and invalid values in red", async ({
  page,
}, testInfo) => {
  const email = "superadmin@cone-admin.test",
    uid = "owner";
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const token = `${encode({ alg: "none", typ: "JWT" })}.${encode({ sub: uid, user_id: uid, email, email_verified: true, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, aud: "cone-test", iss: "https://securetoken.google.com/cone-test", firebase: { sign_in_provider: "password" } })}.fixture`;
  const original = (values: Record<string, string>) => ({
    "Sr. No.": "",
    "Name of Author(S)": "",
    "Organizational Affiliation": "Example University",
    EmailAddress: "",
    "Mobile No.": "",
    ...values,
  });
  await page.route("https://identitytoolkit.googleapis.com/**", (route) =>
    route.fulfill({
      json: route.request().url().includes("accounts:lookup")
        ? {
            users: [
              {
                localId: uid,
                email,
                emailVerified: true,
                providerUserInfo: [
                  { providerId: "password", email, federatedId: email },
                ],
              },
            ],
          }
        : {
            localId: uid,
            email,
            idToken: token,
            refreshToken: "fixture-refresh",
            expiresIn: "3600",
            registered: true,
          },
    }),
  );
  await page.route("**/api/**", (route) => {
    const endpoint = new URL(route.request().url()).pathname;
    if (endpoint === "/api/dev/role-login")
      return route.fulfill({ json: { email, password: "fixture-password" } });
    if (endpoint === "/api/me")
      return route.fulfill({
        json: {
          uid,
          email,
          fullName: "Test Super Admin",
          role: "superadmin",
          conferenceId: "main",
          status: "active",
          permissions: ["*"],
        },
      });
    if (endpoint === "/api/overview")
      return route.fulfill({
        json: {
          registrations: 0,
          confirmed: 0,
          presenters: 0,
          mealsServed: 0,
          byRole: {},
          recentImports: [],
        },
      });
    if (endpoint === "/api/imports")
      return route.fulfill({
        json: {
          next: null,
          rows: [
            {
              id: "job-1",
              kind: "registrationWorkbook",
              fileName: "registrations.xlsx",
              status: "completed",
              total: 4,
              createdAt: "2026-10-20T10:00:00.000Z",
            },
          ],
        },
      });
    if (endpoint === "/api/imports/workbook/job-1/report")
      return route.fulfill({
        json: {
          job: {
            id: "job-1",
            fileName: "registrations.xlsx",
            status: "completed",
            createdAt: "2026-10-20T10:00:00.000Z",
            completedAt: "2026-10-20T10:05:00.000Z",
            total: 4,
            created: 2,
            loginReady: 2,
          },
          summaries: [],
          rowsToFix: [
            {
              sheet: "Chemical Sciences",
              row: 6,
              email: "ravi@example.org",
              status: "needs_fix",
              problems: ["Mobile is missing"],
              invalidFields: ["mobile"],
              invalidColumns: ["Mobile No."],
              original: original({
                "Sr. No.": "2",
                "Name of Author(S)": "Ravi Negi",
                EmailAddress: "ravi@example.org",
              }),
            },
            {
              sheet: "Chemical Sciences",
              row: 7,
              email: "meera-example.org",
              status: "needs_fix",
              problems: ['Email "meera-example.org" is not valid'],
              invalidFields: ["email"],
              invalidColumns: ["EmailAddress"],
              original: original({
                "Sr. No.": "3",
                "Name of Author(S)": "Meera Joshi",
                EmailAddress: "meera-example.org",
                "Mobile No.": "9876500001",
              }),
            },
          ],
        },
      });
    return route.fulfill({ json: [] });
  });
  await page.goto("/");
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page
    .getByRole("button", { name: "Sign in to workspace", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Excel imports", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Rows to fix (2)" }),
  ).toBeVisible();

  const ravi = page.getByRole("row", { name: /Ravi Negi/ });
  const meera = page.getByRole("row", { name: /Meera Joshi/ });
  // Only the missing or invalid value is red.
  await expect(ravi.locator("td.cell-invalid")).toHaveText(["Missing"]);
  await expect(meera.locator("td.cell-invalid")).toHaveText([
    "meera-example.org",
  ]);
  await expect(
    ravi.getByRole("cell", { name: "ravi@example.org" }),
  ).not.toHaveClass(/cell-invalid/);
  await expect(meera.getByRole("cell", { name: "9876500001" })).not.toHaveClass(
    /cell-invalid/,
  );
  // The same column is red inside the original Excel data.
  await ravi.getByText("View").click();
  await expect(ravi.locator("dl div.cell-invalid")).toHaveText([
    "Mobile No.Missing",
  ]);
  await expect(ravi.locator("dl div.cell-invalid dd")).toHaveCSS(
    "color",
    "rgb(180, 35, 24)",
  );
  await page.screenshot({
    path: testInfo.outputPath("rows-to-fix.png"),
    fullPage: true,
  });
});
