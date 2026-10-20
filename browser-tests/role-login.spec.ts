import { expect, test } from "@playwright/test";
import { dashboardTestRoles } from "../shared/dashboard-test-roles";
for (const { role, label } of dashboardTestRoles) {
  test(`one click opens the ${label} dashboard`, async ({ page }) => {
    const uid = `test-${role}`,
      email = `${role.replaceAll("_", "-")}@cone-admin.test`;
    const encode = (value: unknown) =>
      Buffer.from(JSON.stringify(value)).toString("base64url");
    const token = `${encode({ alg: "none", typ: "JWT" })}.${encode({ sub: uid, user_id: uid, email, email_verified: true, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, aud: "cone-test", iss: "https://securetoken.google.com/cone-test", firebase: { sign_in_provider: "password" } })}.test`;
    await page.route("https://identitytoolkit.googleapis.com/**", (route) => {
      if (route.request().url().includes("accounts:lookup"))
        return route.fulfill({
          json: {
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
          },
        });
      expect(route.request().postDataJSON().email).toBe(email);
      expect(route.request().postDataJSON().password).toBe(
        "fixture-only-password",
      );
      return route.fulfill({
        json: {
          localId: uid,
          email,
          idToken: token,
          refreshToken: "fixture-refresh-token",
          expiresIn: "3600",
          registered: true,
        },
      });
    });
    await page.route("**/api/**", (route) => {
      const endpoint = new URL(route.request().url()).pathname;
      if (endpoint === "/api/branding")
        return route.fulfill({
          json: {
            applicationName: "Summit Workspace",
            logoId: null,
            logoUrl: null,
            version: 1,
          },
        });
      if (endpoint === "/api/dev/role-login") {
        expect(route.request().postDataJSON()).toEqual({ role });
        return route.fulfill({
          json: { email, password: "fixture-only-password" },
        });
      }
      if (endpoint === "/api/me")
        return route.fulfill({
          json: {
            uid,
            email,
            fullName: `Test ${label}`,
            role,
            conferenceId: "main",
            status: "active",
          },
        });
      if (endpoint === "/api/overview")
        return route.fulfill({
          json: {
            registrations: 0,
            confirmed: 0,
            presenters: 0,
            mealsServed: 0,
            byRole: {
              presenter: 0,
              attendee: 0,
              speaker: 0,
              vip: 0,
              organiser: 0,
              volunteer: 0,
            },
            recentImports: [],
          },
        });
      if (endpoint.startsWith("/api/records/"))
        return route.fulfill({ json: { rows: [], next: null } });
      return route.fulfill({ json: [] });
    });
    await page.goto("/");
    await expect(page.getByLabel("Email address", { exact: true })).toHaveValue(
      "",
    );
    await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");
    for (const other of dashboardTestRoles)
      await expect(
        page.getByRole("button", {
          name: `Login as ${other.label}`,
          exact: true,
        }),
      ).toBeVisible();
    if (role === "superadmin")
      await page.screenshot({
        path: "test-results/development-role-login.png",
        fullPage: true,
      });
    await page
      .getByRole("button", { name: `Login as ${label}`, exact: true })
      .click();
    const heading =
      role === "programme_manager"
        ? "Programme"
        : role === "meal_desk"
          ? "Meal desk"
          : role === "participant"
            ? "My account"
            : "Overview";
    await expect(
      page.getByRole("heading", { name: heading, exact: true, level: 1 }),
    ).toBeVisible();
    if (role !== "superadmin")
      await expect(
        page.getByRole("button", { name: "Application settings", exact: true }),
      ).toHaveCount(0);
    await expect(page).toHaveTitle(
      "Summit Workspace - Conference administration",
    );
    await expect(page.locator(".sidebar .brand")).toContainText(
      "Summit Workspace",
    );
    for (const viewport of [
      { width: 1440, height: 1000 },
      { width: 834, height: 1112 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await expect(
        page.getByRole("heading", { name: heading, exact: true, level: 1 }),
      ).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        )
        .toBe(true);
      if (viewport.width < 980) {
        await page
          .getByRole("button", { name: "Toggle navigation", exact: true })
          .click();
        await expect(
          page.getByRole("button", { name: "Toggle navigation", exact: true }),
        ).toHaveAttribute("aria-expanded", "true");
        await page
          .getByRole("textbox", { name: "Find a feature" })
          .fill("no-such-feature");
        await expect(
          page.getByText("No matching features. Try a different name."),
        ).toBeVisible();
        await page
          .getByRole("button", { name: "Clear navigation search" })
          .click();
        await page.keyboard.press("Escape");
        await expect(
          page.getByRole("button", { name: "Toggle navigation", exact: true }),
        ).toHaveAttribute("aria-expanded", "false");
        await expect
          .poll(() =>
            page
              .locator("#dashboard-navigation")
              .evaluate((element) => element.getBoundingClientRect().right),
          )
          .toBeLessThanOrEqual(0);
      }
      await page.screenshot({
        path: `test-results/${role}-${viewport.width}.png`,
        fullPage: true,
      });
    }
  });
}
test("production frontend omits development role login buttons", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:3011");
  await expect(
    page.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
  await expect(page.getByLabel("Email address", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Login as / })).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Choose a dashboard to test" }),
  ).toHaveCount(0);
});
