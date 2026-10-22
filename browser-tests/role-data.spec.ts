import { expect, test } from "@playwright/test";

for (const policy of [
  "registration_manager",
  "registration_reader",
  "fee_reader",
  "participant",
  "write_only",
]) {
  test(`${policy} sees only its permitted workbook fields and fee actions`, async ({
    page,
  }) => {
    const email = "person@example.org",
      uid = `fields-${policy}`;
    const grants: Record<string, string[] | undefined> = {
      registration_reader: ["participants:read"],
      fee_reader: ["fees:read"],
      write_only: ["sessions:write"],
    };
    const encode = (v: unknown) =>
      Buffer.from(JSON.stringify(v)).toString("base64url");
    const token = `${encode({ alg: "none", typ: "JWT" })}.${encode({
      sub: uid,
      user_id: uid,
      email,
      email_verified: true,
      iat: Date.now() / 1000,
      exp: Date.now() / 1000 + 3600,
      aud: "cone-test",
      iss: "https://securetoken.google.com/cone-test",
      firebase: { sign_in_provider: "password" },
    })}.fixture`;
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
    const person = {
      id: email,
      fullName: "Example Presenter",
      email,
      mobile: "9876543210",
      affiliation: "Example University",
      role: "presenter",
      registrationStatus: "confirmed",
      registrationId: "REG-1",
      discipline: "Chemistry",
      workingAs: "Research Scholar",
      district: "DN",
      dob: "1999-01-02",
      rollNo: "R-3",
      gender: "F",
      category: "I",
      presentationType: "O",
      softCopy: "Yes",
      accommodation: "No",
      earlierAwardee: "No",
      version: 1,
    };
    const fees = { registrationFee: 500, feesReceived: "DD-000123" };
    const requests: string[] = [];
    await page.route("**/api/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      requests.push(path);
      if (path === "/api/me")
        return route.fulfill({
          json: {
            uid,
            email,
            fullName: "Example Member",
            role: policy,
            permissions: grants[policy],
            conferenceId: "main",
            status: "active",
          },
        });
      if (path === "/api/branding")
        return route.fulfill({
          json: { applicationName: "CONE", logoUrl: null, version: 1 },
        });
      if (path === "/api/workspace-settings")
        return route.fulfill({
          json: { applicationName: "CONE", announcement: "" },
        });
      if (path === "/api/public/conference")
        return route.fulfill({ json: { published: false } });
      if (path === "/api/profile")
        return route.fulfill({
          json: {
            profile: { ...person, ...fees, abstractTitle: "Example abstract" },
            schedule: [],
          },
        });
      if (path === "/api/profile/fees")
        return route.fulfill({
          json: {
            rows: [
              {
                id: "fee1",
                amount: 500,
                currency: "INR",
                status: "received",
                reference: "VERIFIED-1",
              },
            ],
            next: null,
          },
        });
      if (path === "/api/overview")
        return route.fulfill({
          json: {
            registrations: 1,
            confirmed: 1,
            presenters: 1,
            mealsServed: 99,
            feeRecords: 1,
            feesReceivedAmount: 500,
            byRole: { presenter: 1 },
            recentImports: [],
          },
        });
      if (path === "/api/records/participants")
        return route.fulfill({
          json: {
            rows: [
              { ...person, ...(policy === "registration_manager" ? fees : {}) },
            ],
            next: null,
          },
        });
      if (path === "/api/fees/workbook")
        return route.fulfill({
          json: {
            rows: [
              {
                id: email,
                fullName: person.fullName,
                email,
                registrationId: "REG-1",
                ...fees,
              },
            ],
            next: null,
          },
        });
      if (path === "/api/records/fees")
        return route.fulfill({
          json: {
            rows: [
              {
                id: "fee1",
                participantEmail: email,
                amount: 500,
                currency: "INR",
                status: "received",
                reference: "VERIFIED-1",
              },
            ],
            next: null,
          },
        });
      return route.fulfill({ json: { rows: [], next: null } });
    });
    await page.goto("/");
    await page.getByLabel("Email address", { exact: true }).fill(email);
    await page
      .getByLabel("Password", { exact: true })
      .fill("fixture-only-password");
    await page.getByRole("button", { name: "Sign in to workspace" }).click();
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    if (policy === "write_only") {
      await expect(
        page.getByRole("heading", { name: "No accessible sections" }),
      ).toBeVisible();
      await expect(nav.getByRole("button")).toHaveCount(0);
      expect(requests.some((p) => p.startsWith("/api/records/"))).toBe(false);
      return;
    }
    if (policy === "participant") {
      await expect(
        page.getByRole("heading", { name: "Your Fee Records" }),
      ).toBeVisible();
      await expect(page.getByText("DD-000123", { exact: true })).toBeVisible();
      await expect(page.getByText("VERIFIED-1", { exact: true })).toBeVisible();
      await expect(
        nav.getByRole("button", { name: "Participants", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Edit", exact: true }),
      ).toHaveCount(0);
      expect(requests).not.toContain("/api/records/fees");
    } else if (policy === "registration_reader") {
      await expect(
        page.getByRole("heading", {
          name: "Participants",
          exact: true,
          level: 1,
        }),
      ).toBeVisible();
      await expect(
        nav.getByRole("button", { name: "Fee records", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Add participant" }),
      ).toHaveCount(0);
      await page
        .getByRole("button", { name: "View details", exact: true })
        .click();
      const dialog = page.getByRole("dialog");
      await expect(
        dialog.getByLabel("Working as", { exact: true }),
      ).toHaveValue("Research Scholar");
      await expect(
        dialog.getByLabel("Working as", { exact: true }),
      ).toHaveAttribute("readonly", "");
      await expect(
        dialog.getByLabel("Date of birth (as recorded)"),
      ).toHaveValue("1999-01-02");
      await expect(dialog.getByLabel("Registration fee (INR)")).toHaveCount(0);
      await expect(
        dialog.getByRole("button", { name: "Save record" }),
      ).toHaveCount(0);
    } else {
      if (policy === "registration_manager") {
        await expect(
          page.getByRole("heading", {
            name: "Overview",
            exact: true,
            level: 1,
          }),
        ).toBeVisible();
        await expect(
          page.getByText("Meals served", { exact: true }),
        ).toHaveCount(0);
        await page
          .getByRole("button", { name: "View fee records", exact: true })
          .click();
      }
      await expect(
        page.getByRole("heading", {
          name: "Fee records",
          exact: true,
          level: 1,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Workbook fee details" }),
      ).toBeVisible();
      await expect(page.getByText("DD-000123", { exact: true })).toBeVisible();
      await expect(page.getByText("VERIFIED-1", { exact: true })).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Add record", exact: true }),
      ).toHaveCount(policy === "fee_reader" ? 0 : 1);
      await expect(
        page.getByRole("button", { name: "Edit", exact: true }),
      ).toHaveCount(policy === "fee_reader" ? 0 : 1);
    }
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        )
        .toBe(true);
      if (width < 980) {
        await expect
          .poll(() =>
            page
              .locator(".sidebar")
              .evaluate((element) => element.getBoundingClientRect().right),
          )
          .toBeLessThanOrEqual(0);
      }
      if (policy === "registration_reader") {
        const bounds = await page.getByRole("dialog").boundingBox();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      }
      if (policy === "participant") {
        expect(
          await page.locator(".record-details > div").evaluateAll((rows) =>
            rows.every((row) => {
              const label = row.querySelector("dt")!.getBoundingClientRect();
              const value = row.querySelector("dd")!.getBoundingClientRect();
              return label.right <= value.left || label.bottom <= value.top;
            }),
          ),
        ).toBe(true);
      }
      await page.screenshot({
        path: `test-results/role-fields-${policy}-${width}.png`,
        fullPage: true,
      });
    }
  });
}
