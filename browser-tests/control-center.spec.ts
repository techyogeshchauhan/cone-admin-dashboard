import { test, expect } from "@playwright/test";
import { runtimeDefaults } from "../shared/control";
test("Super Admin manages custom policies, feature switches, sessions, and queued jobs", async ({
  page,
}) => {
  const email = "superadmin@cone-admin.test",
    uid = "owner";
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const token = `${encode({ alg: "none", typ: "JWT" })}.${encode({ sub: uid, user_id: uid, email, email_verified: true, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, aud: "cone-test", iss: "https://securetoken.google.com/cone-test", firebase: { sign_in_provider: "password" } })}.fixture`;
  const roles = [
    {
      id: "superadmin",
      name: "Super Admin",
      description: "Protected owner",
      active: true,
      permissions: ["*"],
      version: 0,
      builtIn: true,
    },
    {
      id: "organizer",
      name: "Organizer",
      description: "Operations",
      active: true,
      permissions: ["participants:read", "participants:write"],
      version: 0,
      builtIn: true,
    },
  ];
  let runtime = { ...runtimeDefaults };
  let jobStatus = "queued";
  let project = "fixture-project";
  let controlReads = 0;
  const actions: string[] = [];
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
    const endpoint = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (method === "GET" && endpoint.startsWith("/api/control/"))
      controlReads += 1;
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
    if (endpoint === "/api/workspace-settings")
      return route.fulfill({
        json: {
          applicationName: runtime.applicationName,
          announcement: runtime.announcement,
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
    if (endpoint === "/api/control/system")
      return route.fulfill({
        json: {
          counts: {
            dashboardUsers: 2,
            emailJobs: 1,
            importJobs: 0,
            mediaAssets: 0,
          },
          environment: "test",
          node: "v20",
          firebaseProject: project,
          diskFreeBytes: 1024 ** 3,
          security: { mfaRequired: true },
          storageRoot: "./storage",
          uptimeSeconds: 100,
          checkedAt: new Date().toISOString(),
        },
      });
    if (endpoint === "/api/control/roles")
      return route.fulfill({ json: roles });
    if (endpoint === "/api/control/users")
      return route.fulfill({
        json: {
          users: [
            {
              uid: "staff",
              email: "staff@example.org",
              fullName: "Test Staff",
              mobile: "9876543210",
              accessRole: "organizer",
              status: "active",
              version: 1,
              disabled: false,
              emailVerified: true,
              mfaFactors: 0,
              lastSignIn: null,
            },
          ],
          next: null,
        },
      });
    if (endpoint === "/api/control/runtime") {
      if (method === "PUT") {
        const body = route.request().postDataJSON();
        expect(body.importsEnabled).toBe(false);
        runtime = { ...body, version: runtime.version + 1 };
        actions.push("runtime");
        return route.fulfill({ json: { saved: true } });
      }
      return route.fulfill({ json: runtime });
    }
    if (endpoint === "/api/control/jobs")
      return route.fulfill({
        json: {
          email: [
            {
              id: "job-1",
              status: jobStatus,
              recipient: "staff@example.org",
              attempts: 0,
              createdAt: "2026-10-18",
            },
          ],
          imports: [],
        },
      });
    if (endpoint === "/api/control/roles/support_viewer") {
      const value = route.request().postDataJSON();
      expect(value.permissions).toEqual(["participants:read"]);
      roles.push({
        id: "support_viewer",
        ...value,
        version: 1,
        builtIn: false,
      });
      actions.push("role");
      return route.fulfill({ json: { saved: true } });
    }
    if (endpoint === "/api/control/users/staff/action") {
      expect(route.request().postDataJSON().action).toBe("revoke_sessions");
      actions.push("sessions");
      return route.fulfill({ json: { completed: true } });
    }
    if (endpoint === "/api/control/jobs/email/job-1/action") {
      expect(route.request().postDataJSON().action).toBe("cancel");
      jobStatus = "cancelled";
      actions.push("cancel");
      return route.fulfill({ json: { completed: true } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Login as Super Admin", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Control Center", exact: true })
    .click();
  await expect(
    page.getByText("fixture-project", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/^Updated /)).toBeVisible();
  project = "refreshed-project";
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    page.getByText("refreshed-project", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Refresh", exact: true }),
  ).toBeEnabled();
  const readsBeforeKpi = controlReads;
  await page.getByRole("button", { name: /^Dashboard Users: 2\./ }).click();
  await expect(
    page.getByRole("tab", { name: "Users & sessions" }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("staff@example.org").first()).toBeVisible();
  await page.getByRole("tab", { name: "System overview" }).click();
  await page.getByRole("button", { name: /^Email Jobs: 1\./ }).click();
  await expect(
    page.getByRole("tab", { name: "Jobs & recovery" }),
  ).toHaveAttribute("aria-selected", "true");
  expect(controlReads).toBe(readsBeforeKpi);
  await page.getByRole("tab", { name: "Roles & permissions" }).click();
  await page
    .getByRole("button", { name: "Create custom role", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Edit role permissions" });
  await dialog.getByLabel("Role identifier").fill("support_viewer");
  await dialog.getByLabel("Role name").fill("Support Viewer");
  await dialog.getByLabel("Description").fill("Participants read access");
  await dialog.getByLabel("participants read", { exact: true }).check();
  await dialog.getByRole("button", { name: "Save policy" }).click();
  await expect(
    page.getByRole("button", { name: /Support Viewer/ }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Runtime configuration" }).click();
  await page.getByLabel("Enable Excel imports", { exact: true }).uncheck();
  await page
    .getByRole("button", { name: "Save runtime configuration" })
    .click();
  await expect(
    page.getByLabel("Enable Excel imports", { exact: true }),
  ).not.toBeChecked();
  await page.getByRole("tab", { name: "Users & sessions" }).click();
  const readsBeforeSearch = controlReads;
  const userSearch = page.getByRole("searchbox", { name: /^Search users/ });
  await userSearch.fill("nobody-here");
  await expect(
    page.getByText('No loaded users match "nobody-here".'),
  ).toBeVisible();
  await expect(page.getByText("0 of 1 match")).toBeVisible();
  await userSearch.fill("ORGANIZER");
  await expect(page.getByText("staff@example.org")).toBeVisible();
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(userSearch).toHaveValue("");
  await expect(page.getByText("1 loaded")).toBeVisible();
  expect(controlReads).toBe(readsBeforeSearch);
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Revoke sessions", exact: true })
    .click();
  await expect.poll(() => actions.includes("sessions")).toBe(true);
  await page.getByRole("tab", { name: "Jobs & recovery" }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "cancelled", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "System overview" }).click();
  await page.screenshot({
    path: "test-results/superadmin-control-center.png",
    fullPage: true,
  });
  expect(actions).toEqual(["role", "runtime", "sessions", "cancel"]);
});
