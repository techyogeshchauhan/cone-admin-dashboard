import { test, expect } from "@playwright/test";
test("going back from the dashboard asks, signs out, and forward needs a new sign-in", async ({
  page,
}, testInfo) => {
  const email = "superadmin@cone-admin.test",
    uid = "owner";
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const token = `${encode({ alg: "none", typ: "JWT" })}.${encode({ sub: uid, user_id: uid, email, email_verified: true, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, aud: "cone-test", iss: "https://securetoken.google.com/cone-test", firebase: { sign_in_provider: "password" } })}.fixture`;
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
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/dev/role-login")
      return route.fulfill({ json: { email, password: "fixture-password" } });
    if (path === "/api/me")
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

  // The page someone came from, such as a search result.
  await page.goto(
    "data:text/html,<title>Search</title><h1>Search results</h1>",
  );
  await page.goto("/");
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page
    .getByRole("button", { name: "Sign in to workspace", exact: true })
    .click();
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await expect(nav).toBeVisible();
  const dialog = page.getByRole("alertdialog", {
    name: "Leave the dashboard?",
  });

  // Back between dashboard pages works as before, without asking.
  await nav.getByRole("button", { name: "Participants", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Participants", level: 1 }),
  ).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Overview", level: 1 }),
  ).toBeVisible();
  await expect(dialog).toHaveCount(0);

  // Back from the first page asks; staying keeps the session.
  await page.goBack();
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Going back will sign you out of CONE.");
  await page.screenshot({ path: testInfo.outputPath("leave-dialog.png") });
  await expect(
    dialog.getByRole("button", { name: "Stay signed in" }),
  ).toBeFocused();
  await dialog.getByRole("button", { name: "Stay signed in" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(nav).toBeVisible();

  // Asked again and confirmed: signed out and back on the previous site.
  await page.goBack();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Sign out and go back" }).click();
  await expect(
    page.getByRole("heading", { name: "Search results" }),
  ).toBeVisible();

  // Forward returns to CONE, which now asks for a sign-in.
  await page.goForward();
  await expect(
    page.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
  await expect(nav).toHaveCount(0);
});
