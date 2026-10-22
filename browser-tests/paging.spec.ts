import { test, expect } from "@playwright/test";
for (const module of ["participants", "users"]) {
  test(`${module} show 50 rows per page with next, previous and search reset`, async ({
    page,
  }) => {
    const email = "superadmin@cone-admin.test",
      uid = "owner";
    const encode = (value: unknown) =>
      Buffer.from(JSON.stringify(value)).toString("base64url");
    const token = `${encode({ alg: "none", typ: "JWT" })}.${encode({ sub: uid, user_id: uid, email, email_verified: true, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, aud: "cone-test", iss: "https://securetoken.google.com/cone-test", firebase: { sign_in_provider: "password" } })}.fixture`;
    const discipline =
      "Computer Sciences including Artificial Intelligence, STEM, Cyber Physical Sciences, robotics, Block Chain, Cyber Security, STI, Quantum and Cloud computing";
    const people = Array.from({ length: 121 }, (_, i) => ({
      id: `person${String(i).padStart(2, "0")}@example.org`,
      fullName: `Person ${String(i).padStart(2, "0")}`,
      email: `person${String(i).padStart(2, "0")}@example.org`,
      role: "attendee",
      registrationStatus: "pending",
      version: 1,
      discipline,
      accessRole: "registration_manager",
      status: "active",
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
      if (url.pathname === `/api/records/${module}`) {
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
        expect(url.searchParams.get("limit")).toBe("50");
        const rows = people.slice(start, start + 50);
        return route.fulfill({
          json: {
            rows,
            next: start + 50 < people.length ? rows.at(-1)!.id : null,
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
      .getByRole("button", {
        name: module === "users" ? "Users & access" : "Participants",
        exact: true,
      })
      .click();

    const rows = page.locator("tbody tr");
    await expect(rows).toHaveCount(50);
    await expect(page.getByText("50 shown · 50 per page")).toBeVisible();
    // The dev server's React StrictMode repeats a first load; production
    // builds do not, so only distinct requests are compared.
    expect([...new Set(requests)]).toEqual(["?limit=50"]);

    const table = page.getByRole("region", {
      name: /Participant records, scroll horizontally/,
    });
    const pager = page.getByRole("navigation", {
      name: module === "users" ? "User pagination" : "Participant pagination",
    });
    await expect(
      pager.getByRole("button", { name: "Previous" }),
    ).toBeDisabled();
    await expect(page.getByRole("button", { name: "Load more" })).toHaveCount(
      0,
    );
    const view = page.getByRole("button", {
      name: "View discipline for Person 00",
      exact: true,
    });
    const dialog = page.getByRole("dialog", {
      name: "Discipline",
      exact: true,
    });
    if (module === "participants") {
      await expect(
        page.getByRole("slider", {
          name: "Horizontal scroll for participant columns",
        }),
      ).toHaveCount(0);
      expect(
        await table.evaluate((el) => el.scrollWidth > el.clientWidth),
      ).toBe(true);
      expect(
        await rows.first().evaluate((el) => el.getBoundingClientRect().height),
      ).toBeLessThan(100);
      await table.evaluate((el) => {
        el.scrollLeft = el.scrollWidth;
      });
      expect(await table.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
      await table.evaluate((el) => {
        el.scrollLeft = 0;
      });
      await view.click();
      await expect(dialog.getByText(discipline, { exact: true })).toBeVisible();
      await expect(
        dialog.getByText("Person 00", { exact: true }),
      ).toBeVisible();
      await page.screenshot({
        path: "test-results/participant-discipline-modal.png",
      });
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(view).toBeFocused();
    }
    await pager.getByRole("button", { name: "Next" }).click();
    await expect(rows).toHaveCount(50);
    await expect(rows.first()).toContainText("Person 50");
    await expect(pager).toContainText("Page 2");
    await pager.getByRole("button", { name: "Next" }).click();
    await expect(rows).toHaveCount(21);
    await expect(rows.first()).toContainText("Person 100");
    await expect(pager.getByRole("button", { name: "Next" })).toBeDisabled();
    await pager.getByRole("button", { name: "Previous" }).click();
    await expect(rows).toHaveCount(50);
    await expect(rows.first()).toContainText("Person 50");
    expect([...new Set(requests)]).toEqual([
      "?limit=50",
      "?limit=50&after=person49%40example.org",
      "?limit=50&after=person99%40example.org",
    ]);

    // Typing asks the server once, after the typing stops.
    const search = page.getByRole("textbox", {
      name: module === "users" ? "Search records" : /Search participants/,
    });
    await search.pressSequentially("ravi", { delay: 40 });
    await expect(rows).toHaveCount(1);
    await expect(page.getByText("Ravi Negi")).toBeVisible();
    await expect(page.getByText("1 found · 50 per page")).toBeVisible();
    await expect(pager).toContainText("Page 1");
    await expect(
      pager.getByRole("button", { name: "Previous" }),
    ).toBeDisabled();
    await expect(pager.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(requests.filter((r) => r.includes("q="))).toEqual([
      "?limit=50&q=ravi",
    ]);
    await search.fill("");
    await expect(rows).toHaveCount(50);
    await expect(rows.first()).toContainText("Person 00");
    await page.screenshot({
      path: `test-results/${module}-50-rows.png`,
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() =>
        page
          .locator(".sidebar")
          .evaluate((el) => el.getBoundingClientRect().right),
      )
      .toBeLessThanOrEqual(0);
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
    if (module === "participants") {
      expect(
        await table.evaluate((el) => el.scrollWidth > el.clientWidth),
      ).toBe(true);
      await view.click();
      await expect(dialog.getByText(discipline, { exact: true })).toBeVisible();
      const bounds = await dialog.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
      await dialog.getByRole("button", { name: "Close details" }).click();
      await expect(dialog).toHaveCount(0);
    }
  });
}
