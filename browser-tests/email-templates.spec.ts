import { test, expect } from "@playwright/test";
import { roleTemplates } from "../shared/email-templates";
test("Super Admin adds role templates and queues a presenter email to active presenters", async ({
  page,
}) => {
  const email = "superadmin@cone-admin.test",
    uid = "owner";
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const token = `${encode({ alg: "none", typ: "JWT" })}.${encode({ sub: uid, user_id: uid, email, email_verified: true, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, aud: "cone-test", iss: "https://securetoken.google.com/cone-test", firebase: { sign_in_provider: "password" } })}.fixture`;
  let templates: Record<string, unknown>[] = [];
  const queued: unknown[] = [];
  const presenterQueries: string[] = [];
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
    const url = new URL(route.request().url());
    const endpoint = url.pathname;
    const method = route.request().method();
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
          byRole: { attendee: 0 },
          recentImports: [],
        },
      });
    if (endpoint === "/api/email/templates")
      return route.fulfill({ json: templates });
    if (endpoint === "/api/email/templates/defaults" && method === "POST") {
      templates = roleTemplates.map((t, i) => ({
        id: `t${i}`,
        ...t,
        role: t.role || "all",
      }));
      return route.fulfill({ json: { added: templates.length } });
    }
    if (endpoint === "/api/email/jobs")
      return route.fulfill({ json: { rows: [], next: null } });
    if (endpoint === "/api/settings/smtp")
      return route.fulfill({ json: { host: "smtp.example.org" } });
    if (endpoint === "/api/records/participants") {
      presenterQueries.push(url.search);
      return route.fulfill({
        json: {
          rows: [
            {
              id: "kiran@example.org",
              email: "kiran@example.org",
              fullName: "Kiran Joshi",
              role: "presenter",
              registrationStatus: "confirmed",
              paper: { title: "Glacier Lake Monitoring" },
            },
            {
              id: "old@example.org",
              email: "old@example.org",
              fullName: "Old Entry",
              role: "presenter",
              registrationStatus: "cancelled",
            },
            {
              id: "presenter@gmail.com",
              email: "presenter@gmail.com",
              fullName: "Demo Presenter",
              role: "presenter",
              registrationStatus: "confirmed",
              isDemo: true,
            },
          ],
          next: null,
        },
      });
    }
    if (endpoint === "/api/email/queue" && method === "POST") {
      queued.push(route.request().postDataJSON());
      return route.fulfill({ json: { queued: 1 } });
    }
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
    .getByRole("button", { name: "Email / SMTP", exact: true })
    .click();
  await page.getByRole("button", { name: "Add role-based templates" }).click();
  await expect(page.getByText("Added 7 role-based templates.")).toBeVisible();

  await page
    .getByRole("combobox", { name: /^Template/ })
    .selectOption({ label: "Presenter - presentation details" });
  await expect(page.getByLabel("Recipients by role")).toHaveValue("presenter");
  await page.getByRole("button", { name: "Add recipients" }).click();
  await expect(page.getByLabel("Recipient emails")).toHaveValue(
    "kiran@example.org",
  );
  expect(presenterQueries.at(-1)).toContain("role=presenter");
  expect(presenterQueries.at(-1)).toContain("excludeDemo=true");
  await expect(page.getByText("Preview for Kiran Joshi")).toBeVisible();
  const preview = page.frameLocator('iframe[title="Email design preview"]');
  await expect(
    preview.getByText("Glacier Lake Monitoring", { exact: true }),
  ).toBeVisible();
  await expect(preview.getByRole("heading", { level: 1 })).toContainText(
    "presentation at",
  );
  await page.getByText("Sign-in code email preview", { exact: true }).click();
  const otp = page.frameLocator('iframe[title="Sign-in code email preview"]');
  await expect(otp.getByText("123456", { exact: true })).toBeVisible();
  await expect(
    otp.getByText("Keep this code private.", { exact: false }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  for (const title of ["Email design preview", "Sign-in code email preview"]) {
    const frame = page.frameLocator(`iframe[title="${title}"]`);
    await expect(frame.locator("body")).toBeVisible();
    expect(
      await frame
        .locator("html")
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
  }

  await page.getByRole("button", { name: "Queue notifications" }).click();
  await expect(page.getByText("Messages queued.")).toBeVisible();
  expect(queued).toHaveLength(1);
  expect(queued[0]).toMatchObject({
    templateId: "t0",
    recipients: ["kiran@example.org"],
  });
});
