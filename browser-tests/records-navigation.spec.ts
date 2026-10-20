import { test, expect } from "@playwright/test";
test("Super Admin deletes records beside Edit, searches logs, and moves back and forward", async ({
  page,
}) => {
  const email = "superadmin@cone-admin.test",
    uid = "owner";
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const token = `${encode({ alg: "none", typ: "JWT" })}.${encode({ sub: uid, user_id: uid, email, email_verified: true, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, aud: "cone-test", iss: "https://securetoken.google.com/cone-test", firebase: { sign_in_provider: "password" } })}.fixture`;
  let participants = [
    {
      id: "asha@example.org",
      fullName: "Asha Rawat",
      email: "asha@example.org",
      role: "attendee",
      registrationStatus: "confirmed",
      version: 1,
    },
    {
      id: "kiran@example.org",
      fullName: "Kiran Joshi",
      email: "kiran@example.org",
      role: "presenter",
      registrationStatus: "confirmed",
      version: 1,
    },
  ];
  const archived: string[] = [];
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
    if (endpoint === "/api/dev/role-login")
      return route.fulfill({ json: { email, password: "fixture-password" } });
    if (endpoint === "/api/me") {
      // A slow account check used to send an early page click back home.
      await new Promise((resolve) => setTimeout(resolve, 400));
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
    if (endpoint === "/api/records/participants")
      return route.fulfill({ json: { rows: participants, next: null } });
    if (endpoint === "/api/records/staff")
      return route.fulfill({
        json: {
          rows: [
            { id: "duty-1", staffEmail: "kiran@example.org", duty: "Hall A" },
          ],
          next: null,
        },
      });
    const archive = endpoint.match(
      /^\/api\/records\/participants\/(.+)\/archive$/,
    );
    if (archive) {
      const id = decodeURIComponent(archive[1]);
      archived.push(id);
      participants = participants.filter((p) => p.id !== id);
      return route.fulfill({ json: { archived: true } });
    }
    if (endpoint === "/api/audit")
      return route.fulfill({
        json: [
          {
            id: "a1",
            actorName: "Test Super Admin",
            action: "user.delete",
            target: "staff",
            createdAt: "2026-10-19",
          },
          {
            id: "a2",
            actorName: "Test Super Admin",
            action: "settings.update",
            target: "main",
            createdAt: "2026-10-19",
          },
        ],
      });
    return route.fulfill({ json: [] });
  });
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  const back = page.getByRole("button", { name: "Go back" });
  const forward = page.getByRole("button", { name: "Go forward" });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Login as Super Admin", exact: true })
    .click();
  await expect(back).toBeDisabled();
  await expect(forward).toBeDisabled();

  await nav.getByRole("button", { name: "Participants", exact: true }).click();
  await page.waitForTimeout(1500);
  await expect(
    page.getByRole("heading", { name: "Participants", level: 1 }),
  ).toBeVisible();
  const remove = page.getByRole("button", { name: "Delete Asha Rawat" });
  page.once("dialog", (dialog) => {
    expect(dialog.message()).toContain("Asha Rawat");
    void dialog.accept();
  });
  await remove.click();
  await expect(page.getByText("Asha Rawat deleted.")).toBeVisible();
  await expect(remove).toHaveCount(0);
  expect(archived).toEqual(["asha@example.org"]);

  await nav
    .getByRole("button", { name: "Staff & VIP hosts", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /^Delete / }).first(),
  ).toBeDisabled();

  await nav.getByRole("button", { name: "Audit log", exact: true }).click();
  const search = page.getByRole("searchbox", { name: /^Search activity/ });
  await search.fill("settings");
  await expect(page.getByText("1 of 2 match")).toBeVisible();
  await expect(page.getByText("user.delete")).toHaveCount(0);

  await back.click();
  await expect(
    page.getByRole("heading", { name: "Staff & VIP hosts" }),
  ).toBeVisible();
  await back.click();
  await expect(
    page.getByRole("heading", { name: "Participants" }),
  ).toBeVisible();
  await forward.click();
  await expect(
    page.getByRole("heading", { name: "Staff & VIP hosts" }),
  ).toBeVisible();
  await page.goForward();
  await expect(page.getByRole("heading", { name: "Audit log" })).toBeVisible();
  await expect(forward).toBeDisabled();
});
