import { test, expect } from "@playwright/test";
test("participants load a page at a time and are searched on the server", async ({
  page,
}) => {
  const email = "superadmin@cone-admin.test",
    uid = "owner";
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const token = `${encode({ alg: "none", typ: "JWT" })}.${encode({ sub: uid, user_id: uid, email, email_verified: true, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, aud: "cone-test", iss: "https://securetoken.google.com/cone-test", firebase: { sign_in_provider: "password" } })}.fixture`;
  const people = Array.from({ length: 40 }, (_, i) => ({
    id: `person${String(i).padStart(2, "0")}@example.org`,
    fullName: `Person ${String(i).padStart(2, "0")}`,
    email: `person${String(i).padStart(2, "0")}@example.org`,
    role: "attendee",
    registrationStatus: "pending",
    version: 1,
  }));
  const requests: string[] = [];
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
    const url = new URL(route.request().url());
    if (url.pathname === "/api/dev/role-login")
      return route.fulfill({ json: { email, password: "fixture-password" } });
    if (url.pathname === "/api/me")
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
    if (url.pathname === "/api/records/participants") {
      requests.push(url.search);
      const q = url.searchParams.get("q");
      if (q)
        return route.fulfill({
          json: {
            rows:
              q === "ravi"
                ? [
                    {
                      ...people[0],
                      id: "ravi@example.org",
                      fullName: "Ravi Negi",
                      email: "ravi@example.org",
                    },
                  ]
                : [],
            next: null,
          },
        });
      const after = url.searchParams.get("after");
      const start = after ? people.findIndex((p) => p.id === after) + 1 : 0;
      const rows = people.slice(start, start + 25);
      return route.fulfill({
        json: {
          rows,
          next: start + 25 < people.length ? rows.at(-1)!.id : null,
        },
      });
    }
    if (url.pathname === "/api/overview")
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
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page
    .getByRole("button", { name: "Sign in to workspace", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Participants", exact: true })
    .click();

  const rows = page.locator("tbody tr");
  await expect(rows).toHaveCount(25);
  await expect(page.getByText("25+ shown")).toBeVisible();
  // The dev server's React StrictMode repeats a first load; production
  // builds do not, so only distinct requests are compared.
  expect([...new Set(requests)]).toEqual([""]);

  // Reaching the end of the list loads the next page by itself.
  await page
    .getByRole("button", { name: "Load more" })
    .scrollIntoViewIfNeeded();
  await expect(rows).toHaveCount(40);
  await expect(page.getByText("40 shown")).toBeVisible();
  await expect(page.getByRole("button", { name: "Load more" })).toHaveCount(0);
  expect([...new Set(requests)]).toEqual(["", "?after=person24%40example.org"]);

  // Typing asks the server once, after the typing stops.
  await page
    .getByRole("textbox", { name: /Search participants/ })
    .pressSequentially("ravi", { delay: 40 });
  await expect(rows).toHaveCount(1);
  await expect(page.getByText("Ravi Negi")).toBeVisible();
  await expect(page.getByText("1 found")).toBeVisible();
  expect(requests.filter((r) => r.includes("q="))).toEqual(["?q=ravi"]);
});
