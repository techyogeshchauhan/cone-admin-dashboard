import { test, expect } from "@playwright/test";
import express from "express";
import type { Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import {
  registerDepartmentRecords,
  saveDepartmentSource,
} from "../server/department-records";
import type { Actor } from "../shared/schema";

let server: Server;
let storage: string;
let endpoint: string;
let actor: Actor;
const previousLogDirectory = process.env.LOG_DIR;
test.beforeAll(async () => {
  storage = await mkdtemp(path.join(tmpdir(), "cone-department-browser-"));
  process.env.LOG_DIR = path.join(storage, "logs");
  const workbook = new ExcelJS.Workbook();
  for (const [department, count] of [
    ["Chemical Sciences", 58],
    ["Physical Sciences", 2],
  ] as const) {
    const sheet = workbook.addWorksheet(department);
    sheet.addRow([
      "Sr. No.",
      "Discipline",
      "Name of Author(S)",
      "Email Address",
      "Mobile",
      "Organizational Affiliation",
      "Title of Abstract",
      "Registration Fee",
      "DD Received",
      "DOB",
    ]);
    for (let i = 1; i <= count; i++)
      sheet.addRow([
        i,
        department,
        `${department} Author ${i}`,
        "",
        "",
        "Example University",
        `Research by author ${i}`,
        500,
        "DD-000001",
        "2000-01-01",
      ]);
  }
  await saveDepartmentSource(
    storage,
    Buffer.from(await workbook.xlsx.writeBuffer()),
    "department-test.xlsx",
  );
  const app = express();
  app.use((req, _res, next) => {
    (req as express.Request & { actor?: Actor }).actor = actor;
    next();
  });
  registerDepartmentRecords(app, storage);
  app.use(
    (
      error: any,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => res.status(error.status || 400).json({ error: error.message }),
  );
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(async () => {
  if (previousLogDirectory === undefined) delete process.env.LOG_DIR;
  else process.env.LOG_DIR = previousLogDirectory;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  if (
    path.dirname(path.resolve(storage)) !== path.resolve(tmpdir()) ||
    !path.basename(storage).startsWith("cone-department-browser-")
  )
    throw new Error("Unexpected temporary directory");
  await rm(storage, { recursive: true, force: true });
});

for (const role of ["superadmin", "registration_reader"]) {
  test(`${role} browses departments, source author records and permitted downloads`, async ({
    page,
  }) => {
    const uid = `department-${role}`,
      email = "staff@example.org";
    actor = {
      uid,
      email,
      fullName: "Conference Staff",
      conferenceId: "main",
      status: "active",
      role,
      ...(role === "registration_reader"
        ? { permissions: ["participants:read"] }
        : {}),
    };
    const encode = (v: unknown) =>
      Buffer.from(JSON.stringify(v)).toString("base64url");
    const token = `${encode({ alg: "none", typ: "JWT" })}.${encode({ sub: uid, user_id: uid, email, email_verified: true, iat: Date.now() / 1000, exp: Date.now() / 1000 + 3600, aud: "cone-test", iss: "https://securetoken.google.com/cone-test", firebase: { sign_in_provider: "password" } })}.fixture`;
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
      if (
        url.pathname.startsWith("/api/department-records") ||
        url.pathname === "/api/reports/department-records"
      ) {
        const response = await route.fetch({
          url: `${endpoint}${url.pathname}${url.search}`,
        });
        return route.fulfill({ response });
      }
      if (url.pathname === "/api/me") return route.fulfill({ json: actor });
      if (url.pathname === "/api/branding")
        return route.fulfill({
          json: { applicationName: "CONE", logoUrl: null, version: 1 },
        });
      if (url.pathname === "/api/public/conference")
        return route.fulfill({ json: { published: false } });
      if (url.pathname === "/api/overview")
        return route.fulfill({
          json: {
            registrations: 0,
            confirmed: 0,
            presenters: 0,
            byRole: {},
            recentImports: [],
          },
        });
      return route.fulfill({ json: { rows: [], next: null } });
    });
    await page.goto("/");
    expect(
      (await page.request.get("/storage/department-source.json")).status(),
    ).toBe(403);
    await page.getByLabel("Email address", { exact: true }).fill(email);
    await page
      .getByLabel("Password", { exact: true })
      .fill("fixture-only-password");
    await page.getByRole("button", { name: "Sign in to workspace" }).click();
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("button", { name: "Participants", exact: true })
      .click();
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("button", { name: "Department records", exact: true })
      .click();
    const dialog = page.getByRole("region", {
      name: "Department records workspace",
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "Department records",
        exact: true,
        level: 1,
      }),
    ).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      page
        .getByRole("navigation", { name: "Main navigation" })
        .getByRole("button", { name: "Department records", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      dialog.getByText(/2 departments · 60 author records/),
    ).toBeVisible();
    const select = dialog.getByLabel("Department / Discipline", {
      exact: true,
    });
    await expect(select).toHaveValue("Chemical Sciences");
    const rows = dialog.locator("tbody tr");
    await expect(rows).toHaveCount(50);
    await dialog
      .getByRole("navigation", { name: "Department author pagination" })
      .getByRole("button", { name: "Next" })
      .click();
    await expect(rows).toHaveCount(8);
    await expect(rows.first()).toContainText("Chemical Sciences Author 51");
    const search = dialog.getByLabel("Find author in department");
    await search.fill("Author 58");
    await expect(rows).toHaveCount(1);
    if (role === "superadmin") {
      const downloaded = page.waitForEvent("download");
      await dialog
        .getByRole("button", { name: "Download department", exact: true })
        .click();
      const download = await downloaded;
      expect(download.suggestedFilename()).toBe(
        "Chemical-Sciences-records.xlsx",
      );
      const file = new ExcelJS.Workbook();
      await file.xlsx.readFile((await download.path())!);
      expect(file.worksheets[0].rowCount).toBe(59);
      expect(file.worksheets[0].getRow(1).values).toContain(
        "Payment / DD Reference (source)",
      );
    } else {
      await expect(
        dialog.getByRole("button", {
          name: "Download department",
          exact: true,
        }),
      ).toHaveCount(0);
      await expect(
        dialog.getByRole("button", { name: "Choose Excel", exact: true }),
      ).toHaveCount(0);
    }
    await dialog
      .getByRole("button", {
        name: "View record for Chemical Sciences Author 58",
        exact: true,
      })
      .click();
    const record = dialog.getByRole("article", { name: "Author record" });
    await expect(
      record.getByRole("heading", {
        name: "Chemical Sciences Author 58",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      record.getByText("Research by author 58", { exact: true }),
    ).toBeVisible();
    await expect(record.getByText("2000-01-01", { exact: true })).toBeVisible();
    await expect(record.getByText("DD-000001", { exact: true })).toHaveCount(
      role === "superadmin" ? 1 : 0,
    );
    await select.selectOption("Physical Sciences");
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText("Physical Sciences Author 1");
    await expect(
      dialog.getByRole("article", { name: "Author record" }),
    ).toHaveCount(0);
    await page.screenshot({
      path: `test-results/departments-${role}-desktop.png`,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() =>
        page
          .locator(".sidebar")
          .evaluate((el) => el.getBoundingClientRect().right),
      )
      .toBeLessThanOrEqual(0);
    const bounds = await dialog.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
    await dialog
      .getByRole("button", {
        name: "View record for Physical Sciences Author 1",
        exact: true,
      })
      .click();
    await expect(
      dialog.getByRole("article", { name: "Author record" }),
    ).toBeVisible();
    await page.screenshot({
      path: `test-results/departments-${role}-mobile.png`,
    });
    await page
      .getByRole("button", { name: "Toggle navigation", exact: true })
      .click();
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("button", { name: "Participants", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Participants",
        level: 1,
        exact: true,
      }),
    ).toBeVisible();
    await expect(dialog).toHaveCount(0);
  });
}
