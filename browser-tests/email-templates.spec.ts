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
    if (endpoint === "/api/email/jobs") return route.fulfill({ json: [] });
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
  await page
    .getByRole("button", { name: "Login as Super Admin", exact: true })
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
  await expect(page.getByText("Paper: Glacier Lake Monitoring")).toBeVisible();

  await page.getByRole("button", { name: "Queue notifications" }).click();
  await expect(page.getByText("Messages queued.")).toBeVisible();
  expect(queued).toHaveLength(1);
  expect(queued[0]).toMatchObject({
    templateId: "t0",
    recipients: ["kiran@example.org"],
  });
});
