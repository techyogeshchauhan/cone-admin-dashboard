import { expect, test } from "@playwright/test";
test("signs in, navigates the dashboard, and submits validated participant fields", async ({
  page,
}) => {
  page.on("pageerror", (error) =>
    console.error("Browser runtime error:", error.message),
  );
  const uid = "test-superadmin";
  const email = "admin@example.org";
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const token = `${encode({ alg: "none", typ: "JWT" })}.${encode({ sub: uid, user_id: uid, email, email_verified: true, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, aud: "cone-test", iss: "https://securetoken.google.com/cone-test", auth_time: Math.floor(Date.now() / 1000), firebase: { sign_in_provider: "password" } })}.test`;
  await page.route("https://identitytoolkit.googleapis.com/**", (route) => {
    if (route.request().url().includes("accounts:lookup"))
      return route.fulfill({
        json: {
          users: [
            {
              localId: uid,
              email,
              emailVerified: true,
              passwordHash: "test",
              providerUserInfo: [
                { providerId: "password", email, federatedId: email },
              ],
            },
          ],
        },
      });
    return route.fulfill({
      json: {
        localId: uid,
        email,
        idToken: token,
        refreshToken: "test-refresh-token",
        expiresIn: "3600",
        registered: true,
      },
    });
  });
  const rows: Record<string, unknown>[] = [];
  let branding = {
    applicationName: "CONE",
    logoId: null as string | null,
    logoUrl: null as string | null,
    version: 0,
  };
  const logoPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDasAAAAASUVORK5CYII=",
    "base64",
  );
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/branding")
      return route.fulfill({ json: branding });
    if (url.pathname.startsWith("/api/branding/logo/"))
      return route.fulfill({ contentType: "image/png", body: logoPng });
    if (url.pathname === "/api/settings/branding") {
      const body = route.request().postData() || "";
      expect(body).toContain("Aurora Workspace");
      expect(body).toContain("branding-logo.png");
      branding = {
        applicationName: "Aurora Workspace",
        logoId: "12345678-1234-4234-8234-123456789abc",
        logoUrl: "/api/branding/logo/12345678-1234-4234-8234-123456789abc",
        version: 1,
      };
      return route.fulfill({ json: branding });
    }
    if (url.pathname === "/api/settings")
      return route.fulfill({
        json: { maintenanceMode: false, registrationOpen: false },
      });
    if (url.pathname === "/api/me")
      return route.fulfill({
        json: {
          uid,
          email,
          fullName: "Test Administrator",
          role: "superadmin",
          conferenceId: "main",
          status: "active",
        },
      });
    if (url.pathname === "/api/overview")
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
          recentActivity: [
            {
              id: "audit-1",
              action: "participants.create",
              actorName: "Test Administrator",
              target: "participant@example.org",
              createdAt: "2026-10-19T04:30:00.000Z",
            },
          ],
        },
      });
    if (url.pathname === "/api/records/participants") {
      if (route.request().method() === "POST") {
        const payload = route.request().postDataJSON();
        expect(payload.data.mobile).toBe("9876543210");
        expect(payload.data.fullName).toBe("Example Participant");
        rows.push({ id: payload.data.email, ...payload.data });
        return route.fulfill({ json: { id: payload.data.email } });
      }
      return route.fulfill({ json: { rows, next: null } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("password-for-browser-test");
  await page.getByRole("button", { name: "Sign in to workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Total registrations", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Recent activity", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".activity-list")).toContainText(
    "participants create",
  );
  await expect(page.locator(".activity-list")).toContainText(
    "Test Administrator",
  );
  const mainNav = page.getByRole("navigation", { name: "Main navigation" });
  for (const [name, query] of [
    ["View total registrations", "excludeDemo=true"],
    ["View confirmed participants", "status=confirmed"],
    ["View presenters", "role=presenter"],
  ]) {
    const response = page.waitForResponse(
      (r) =>
        r.url().includes("/api/records/participants?") &&
        r.url().includes(query),
    );
    await page.getByRole("button", { name, exact: true }).click();
    await response;
    await expect(
      page.getByRole("button", { name: "Clear filters" }),
    ).toBeVisible();
    await mainNav
      .getByRole("button", { name: "Overview", exact: true })
      .click();
  }
  for (const role of [
    "presenter",
    "attendee",
    "speaker",
    "vip",
    "organizer",
    "volunteer",
  ]) {
    const databaseRole = role === "organizer" ? "organiser" : role;
    const response = page.waitForResponse((r) =>
      r.url().includes(`/api/records/participants?role=${databaseRole}`),
    );
    await page
      .getByRole("button", { name: `View ${role} participants`, exact: true })
      .click();
    await response;
    await mainNav
      .getByRole("button", { name: "Overview", exact: true })
      .click();
  }
  const redemptions = page.waitForResponse((r) =>
    r.url().includes("/api/redemptions"),
  );
  await page
    .getByRole("button", { name: "View meals served", exact: true })
    .click();
  await redemptions;
  await mainNav.getByRole("button", { name: "Overview", exact: true }).click();
  await page
    .locator(".activity-list")
    .getByRole("button", { name: "Open", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Participants", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await mainNav.getByRole("button", { name: "Overview", exact: true }).click();
  await page.screenshot({
    path: "test-results/dashboard-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Participants", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add participant", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Full name").fill("Example Participant");
  await dialog.getByLabel("Email address").fill("participant@example.org");
  await dialog.getByLabel("Mobile number").fill("9876543210");
  await dialog.getByLabel("Affiliation").fill("Example University");
  await expect(dialog.getByText(/password/i)).toHaveCount(0);
  const saved = page.waitForRequest(
    (r) =>
      r.method() === "POST" && r.url().endsWith("/api/records/participants"),
  );
  await dialog.getByRole("button", { name: "Save record" }).click();
  expect((await saved).postDataJSON()).not.toHaveProperty("password");
  await expect(
    page.getByText("Example Participant", { exact: true }),
  ).toBeVisible();
  await mainNav
    .getByRole("button", { name: "Application settings", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "App Branding", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Application name", { exact: true })
    .fill("Aurora Workspace");
  await page.getByLabel("Application logo", { exact: true }).setInputFiles({
    name: "branding-logo.png",
    mimeType: "image/png",
    buffer: logoPng,
  });
  await expect(
    page.getByRole("img", { name: "Application logo preview", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Save branding", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Branding saved");
  await expect(page).toHaveTitle(
    "Aurora Workspace - Conference administration",
  );
  await expect(page.locator(".sidebar .brand")).toContainText(
    "Aurora Workspace",
  );
  await expect(
    page
      .locator(".sidebar .brand")
      .getByRole("img", { name: "Aurora Workspace logo" }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator(".sidebar .brand")).toContainText(
    "Aurora Workspace",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Toggle navigation" }).click();
  await expect(
    page.getByRole("button", { name: "Application settings", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/dashboard-mobile.png",
    fullPage: true,
  });
});
