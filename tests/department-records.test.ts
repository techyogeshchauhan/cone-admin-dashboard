import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import express from "express";
import supertest from "supertest";
import ExcelJS from "exceljs";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import type { Actor } from "../shared/schema.js";
vi.mock("../server/activity-log.js", () => ({
  recordAudit: vi.fn().mockResolvedValue({}),
}));
import {
  registerDepartmentRecords,
  saveDepartmentSource,
} from "../server/department-records.js";

let storage: string;
let api: ReturnType<typeof supertest>;
let currentActor: Actor | undefined;
let source: Awaited<ReturnType<typeof saveDepartmentSource>>;
const owner: Actor = {
  uid: "staff",
  email: "staff@example.org",
  fullName: "Staff",
  conferenceId: "main",
  status: "active",
  role: "superadmin",
};
async function workbookBuffer(name = "Chemistry") {
  const workbook = new ExcelJS.Workbook();
  for (const [department, count] of [
    [name, 65],
    ["Biotechnology", 3],
  ] as const) {
    const sheet = workbook.addWorksheet(department);
    sheet.addRow([department]);
    sheet.addRow([
      "Sr. No.",
      "Discipline",
      "CT.",
      "Name of Author(S)",
      "Email Address",
      "Mobile",
      "Organizational Affiliation",
      "Title of Abstract",
      "Registration Fee",
      "DD Received",
      "TA required",
    ]);
    for (let i = 0; i < count; i++)
      sheet.addRow([
        i + 1,
        department,
        "ii",
        `Author ${department} ${i + 1}`,
        i ? `author${i}@example.org` : "",
        "",
        "Example Institute",
        i ? "Example research" : "=Not a formula",
        500,
        "0000123",
        "Yes",
      ]);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
beforeAll(async () => {
  storage = await mkdtemp(path.join(tmpdir(), "cone-departments-"));
  const app = express();
  app.use((req, _res, next) => {
    (req as express.Request & { actor?: Actor }).actor = currentActor;
    next();
  });
  registerDepartmentRecords(app, storage);
  app.use(
    (
      error: any,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) =>
      res
        .status(error instanceof z.ZodError ? 400 : error.status || 500)
        .json({ error: error.message }),
  );
  api = supertest(app);
});
beforeEach(async () => {
  currentActor = { ...owner };
  source = await saveDepartmentSource(
    storage,
    await workbookBuffer(),
    "conference.xlsx",
  );
});
afterAll(async () => {
  if (
    path.dirname(path.resolve(storage)) !== path.resolve(tmpdir()) ||
    !path.basename(storage).startsWith("cone-departments-")
  )
    throw new Error("Unexpected temporary source path");
  await rm(storage, { recursive: true, force: true });
});
describe("Department source records", () => {
  it("groups all source authors, including incomplete and repeated identities", async () => {
    const response = await api.get("/api/department-records");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      fileName: "conference.xlsx",
      total: 68,
      departments: [
        { name: "Biotechnology", count: 3 },
        { name: "Chemistry", count: 65 },
      ],
    });
    expect(response.body).not.toHaveProperty("rows");
    const first = await api
      .get("/api/department-records/rows")
      .query({ department: "Chemistry", revision: source.revision });
    expect(first.body.rows).toHaveLength(50);
    expect(first.body.rows[0]).toMatchObject({
      fullName: "Author Chemistry 1",
      email: "",
      mobile: "",
      feesReceived: "0000123",
      abstractTitle: "=Not a formula",
      travelAssistance: "Yes",
      sourceRow: "3",
    });
    const second = await api
      .get("/api/department-records/rows")
      .query({ department: " chemistry ", after: first.body.next });
    expect(second.body.rows).toHaveLength(15);
    expect(second.body.next).toBeNull();
    expect(
      second.body.rows.every((row: any) => row.discipline === "Chemistry"),
    ).toBe(true);
    const other = await api
      .get("/api/department-records/rows")
      .query({ department: "Biotechnology" });
    expect(other.body.rows).toHaveLength(3);
  });
  it("searches only inside the selected department", async () => {
    expect(
      (
        await api
          .get("/api/department-records/rows")
          .query({ department: "Chemistry", q: "Biotechnology" })
      ).body.rows,
    ).toEqual([]);
    const found = await api
      .get("/api/department-records/rows")
      .query({ department: "Chemistry", q: "Chemistry 65" });
    expect(found.body.rows.map((row: any) => row.fullName)).toEqual([
      "Author Chemistry 65",
    ]);
  });
  it.each(["participant", "programme_manager", "meal_desk"])(
    "denies source access to %s",
    async (role) => {
      currentActor = { ...owner, role };
      expect((await api.get("/api/department-records")).status).toBe(403);
      expect(
        (
          await api
            .get("/api/department-records/rows")
            .query({ department: "Chemistry" })
        ).status,
      ).toBe(403);
      expect(
        (
          await api
            .get("/api/reports/department-records")
            .query({ department: "Chemistry" })
        ).status,
      ).toBe(403);
    },
  );
  it("requires sign-in and read permission; exports additionally require reports", async () => {
    currentActor = undefined;
    expect((await api.get("/api/department-records")).status).toBe(401);
    currentActor = {
      ...owner,
      role: "custom",
      permissions: ["participants:write"],
    };
    expect((await api.get("/api/department-records")).status).toBe(403);
    currentActor.permissions = ["participants:read"];
    expect(
      (
        await api
          .get("/api/reports/department-records")
          .query({ department: "Chemistry" })
      ).status,
    ).toBe(403);
  });
  it("redacts fee fields in both record views and the complete department export", async () => {
    currentActor = {
      ...owner,
      role: "custom",
      permissions: ["participants:read", "reports:read"],
    };
    const viewed = await api
      .get("/api/department-records/rows")
      .query({ department: "Chemistry" });
    expect(viewed.body.rows[0]).not.toHaveProperty("registrationFee");
    expect(viewed.body.rows[0]).not.toHaveProperty("feesReceived");
    const response = await api
      .get("/api/reports/department-records")
      .query({ department: "Chemistry", q: "Chemistry 1", limit: "1" })
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      });
    expect(response.status).toBe(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(response.body);
    const sheet = workbook.worksheets[0];
    expect(sheet.rowCount).toBe(66);
    expect(sheet.getRow(1).values).not.toContain("Registration Fee / Amount");
    expect(sheet.getRow(1).values).not.toContain(
      "Payment / DD Reference (source)",
    );
    sheet.eachRow((row, index) => {
      if (index > 1) expect(row.getCell(2).text).toBe("Chemistry");
    });
    expect(sheet.getCell("F2").value).toBe("=Not a formula");
    expect(sheet.getCell("F2").type).toBe(ExcelJS.ValueType.String);
  });
  it("rejects stale sources, unknown departments and invalid cursors", async () => {
    expect(
      (
        await api
          .get("/api/department-records/rows")
          .query({ department: "Chemistry", revision: "old" })
      ).status,
    ).toBe(409);
    expect(
      (
        await api
          .get("/api/department-records/rows")
          .query({ department: "Missing" })
      ).status,
    ).toBe(404);
    expect(
      (
        await api
          .get("/api/department-records/rows")
          .query({ department: "Chemistry", after: "other-department-row" })
      ).status,
    ).toBe(400);
  });
  it("validates an upload before replacing the source and preserves it on failure", async () => {
    const previous = await readFile(
      path.join(storage, "department-source.json"),
      "utf8",
    );
    expect(
      (
        await api
          .post("/api/imports/department-source")
          .attach("file", Buffer.from("not excel"), "broken.xlsx")
      ).status,
    ).toBe(400);
    expect(
      await readFile(path.join(storage, "department-source.json"), "utf8"),
    ).toBe(previous);
    const replaced = await api
      .post("/api/imports/department-source")
      .attach(
        "file",
        await workbookBuffer("Physical Sciences"),
        "updated.xlsx",
      );
    expect(replaced.status).toBe(200);
    expect(replaced.body.fileName).toBe("updated.xlsx");
    expect(replaced.body.revision).not.toBe(source.revision);
    expect(
      (
        await api
          .get("/api/department-records/rows")
          .query({ department: "Chemistry" })
      ).status,
    ).toBe(404);
  });
  it("does not let registration-only readers replace the workbook", async () => {
    currentActor = {
      ...owner,
      role: "custom",
      permissions: ["participants:read"],
    };
    expect((await api.post("/api/imports/department-source")).status).toBe(403);
    currentActor.permissions = [
      "participants:read",
      "fees:read",
      "imports:read",
      "imports:write",
    ];
    expect((await api.post("/api/imports/department-source")).status).toBe(403);
  });
});
