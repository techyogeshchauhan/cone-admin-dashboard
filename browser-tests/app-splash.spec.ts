import { test, expect } from "@playwright/test";
test("signing in shows what the wait is for until the workspace opens", async ({
  page,
}, testInfo) => {
  test.setTimeout(60000);
  const email = "superadmin@cone-admin.test",
    uid = "owner";
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const token = `${encode({ alg: "none", typ: "JWT" })}.${encode({ sub: uid, user_id: uid, email, email_verified: true, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, aud: "cone-test", iss: "https://securetoken.google.com/cone-test", firebase: { sign_in_provider: "password" } })}.fixture`;
  let releaseMe = () => {};
  const meAnswered = new Promise<void>((resolve) => (releaseMe = resolve));
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
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/dev/role-login")
      return route.fulfill({ json: { email, password: "fixture-password" } });
    if (path === "/api/public/conference")
      return route.fulfill({
        json: {
          published: true,
          edition: "21st",
          shortName: "USSTC",
          startDate: "2026-10-23",
          endDate: "2026-10-24",
        },
      });
    if (path === "/api/me") {
      // A slow connection: the account check answers only when released.
      await meAnswered;
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
    }
    if (path === "/api/overview")
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
    return route.fulfill({ json: { rows: [], next: null } });
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Login as Super Admin", exact: true })
    .click();

  const splash = page.locator(".app-splash");
  await expect(splash).toBeVisible();
  await expect(splash).toHaveAttribute("role", "status");
  await expect(splash.locator(".app-splash-name strong")).toHaveText("CONE");
  await expect(splash.locator(".app-splash-name span")).toHaveText(
    "Conference Operations & Networking Environment",
  );
  // The first stage lasts 2.5 s; a slow dev build may already be past it.
  await expect(splash.locator(".app-splash-stage")).toHaveText(
    /^(Checking your sign-in…|Loading your workspace…)$/,
  );
  await expect(splash).toContainText("21st USSTC · 23 – 24 October 2026");
  await page.screenshot({ path: testInfo.outputPath("splash.png") });
  await expect(splash.locator(".app-splash-stage")).toHaveText(
    "Loading your workspace…",
    { timeout: 5000 },
  );
  await expect(splash.locator(".app-splash-stage")).toHaveText(
    /taking longer than usual/,
    { timeout: 12000 },
  );
  await expect(splash.locator(".app-splash-stage")).toHaveClass(/slow/);

  releaseMe();
  await expect(splash).toHaveCount(0);
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).toBeVisible();
});
