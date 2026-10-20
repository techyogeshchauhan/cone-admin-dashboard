import { test, expect } from "@playwright/test";
test("Super Admin deletes a user from Users & access after confirming", async ({
  page,
}) => {
  const email = "superadmin@cone-admin.test",
    uid = "owner";
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const token = `${encode({ alg: "none", typ: "JWT" })}.${encode({ sub: uid, user_id: uid, email, email_verified: true, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, aud: "cone-test", iss: "https://securetoken.google.com/cone-test", firebase: { sign_in_provider: "password" } })}.fixture`;
  let users = [
    {
      id: uid,
      fullName: "Test Super Admin",
      email,
      accessRole: "superadmin",
      status: "active",
      version: 1,
    },
    {
      id: "staff",
      fullName: "Test Staff",
      email: "staff@example.org",
      accessRole: "organizer",
      status: "active",
      version: 3,
    },
  ];
  const deletes: unknown[] = [];
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
    if (endpoint === "/api/records/users")
      return route.fulfill({ json: { rows: users, next: null } });
    if (endpoint === "/api/control/users/staff/delete") {
      deletes.push(route.request().postDataJSON());
      users = users.filter((u) => u.id !== "staff");
      return route.fulfill({ json: { deleted: true } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Login as Super Admin", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Users & access", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Delete Test Super Admin" }),
  ).toBeDisabled();
  const target = page.getByRole("button", { name: "Delete Test Staff" });
  page.once("dialog", (dialog) => dialog.dismiss());
  await target.click();
  await expect(target).toBeVisible();
  expect(deletes).toEqual([]);
  page.once("dialog", (dialog) => {
    expect(dialog.message()).toContain("staff@example.org");
    void dialog.accept();
  });
  await target.click();
  await expect(
    page.getByText("User login and dashboard access deleted."),
  ).toBeVisible();
  await expect(page.getByText("staff@example.org")).toHaveCount(0);
  expect(deletes).toEqual([{ version: 3 }]);
});
