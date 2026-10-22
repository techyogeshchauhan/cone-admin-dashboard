import type { Express, Request } from "express";
import multer from "multer";
import ExcelJS from "exceljs";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { can, type Actor } from "../shared/schema.js";
import { financialFields, pickFields } from "../shared/role-fields.js";
import { fieldFor } from "../shared/registration-columns.js";
import {
  departmentColumns,
  departmentKey,
  type DepartmentRow,
  type DepartmentCatalog,
} from "../shared/department-records.js";
import { readWorkbook } from "./workbook.js";
import { parseRegistrationWorkbook } from "./registration-workbook.js";
import { recordAudit } from "./activity-log.js";

type Source = { fileName: string; revision: string; rows: DepartmentRow[] };
const sourcePath = (storage: string) =>
  path.join(storage, "department-source.json");
function fail(message: string, status: number): never {
  throw Object.assign(new Error(message), { status });
}

export async function saveDepartmentSource(
  storage: string,
  buffer: Buffer,
  fileName: string,
) {
  const parsed = parseRegistrationWorkbook(await readWorkbook(buffer));
  const allowed = new Set<string>(departmentColumns.map(([key]) => key));
  const rows: DepartmentRow[] = parsed.rows.map((row, index) => {
    const fields: Record<string, string> = {};
    for (const [header, value] of Object.entries(row.original)) {
      const key = fieldFor(header);
      if (key && allowed.has(key) && !fields[key]) fields[key] = value;
    }
    return {
      ...fields,
      id: String(index + 1),
      discipline: (fields.discipline || row.sheet).trim().replace(/\s+/g, " "),
      fullName: fields.fullName || "",
      sourceSheet: row.sheet,
      sourceRow: String(row.row),
    };
  });
  if (!rows.length)
    fail(
      "No author records found. Use a registration workbook with author and email column headers.",
      400,
    );
  const source: Source = {
    fileName: path.basename(fileName.replace(/\\/g, "/")).slice(0, 200),
    revision: randomUUID(),
    rows,
  };
  await mkdir(storage, { recursive: true });
  const temporary = path.join(storage, `department-source-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify(source), { mode: 0o600 });
    await rename(temporary, sourcePath(storage));
  } finally {
    await unlink(temporary).catch(() => {});
  }
  return catalog(source);
}

async function loadSource(storage: string): Promise<Source> {
  try {
    return JSON.parse(await readFile(sourcePath(storage), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { fileName: "", revision: "", rows: [] };
    throw error;
  }
}
function catalog(source: Source): DepartmentCatalog {
  const groups = new Map<string, { name: string; count: number }>();
  for (const row of source.rows) {
    const key = departmentKey(row.discipline);
    const group = groups.get(key) || { name: row.discipline, count: 0 };
    group.count++;
    groups.set(key, group);
  }
  return {
    fileName: source.fileName,
    revision: source.revision,
    total: source.rows.length,
    departments: [...groups.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    ),
  };
}
function actorFor(
  req: Request,
  resource: string,
  action: "read" | "write" = "read",
) {
  const actor = (req as Request & { actor?: Actor }).actor;
  if (!actor) fail("Sign in to continue", 401);
  if (!can(actor, resource, action))
    fail("You do not have permission for this action", 403);
  return actor;
}
function columnsFor(actor: Actor) {
  return departmentColumns.filter(
    ([key]) =>
      can(actor, "fees", "read") ||
      !financialFields.includes(key as (typeof financialFields)[number]),
  );
}
function selectedRows(source: Source, req: Request) {
  const department = z
    .string()
    .trim()
    .min(1)
    .max(1000)
    .parse(req.query.department);
  const revision = z.string().optional().parse(req.query.revision);
  if (revision && revision !== source.revision)
    fail(
      "The workbook changed. Close and reopen Department records to refresh it.",
      409,
    );
  const rows = source.rows.filter(
    (row) => departmentKey(row.discipline) === departmentKey(department),
  );
  if (!rows.length) fail("Department not found in the source workbook", 404);
  return rows;
}

export function registerDepartmentRecords(app: Express, storage: string) {
  app.get("/api/department-records", async (req, res) => {
    actorFor(req, "participants");
    res.setHeader("Cache-Control", "no-store");
    res.json(catalog(await loadSource(storage)));
  });
  app.get("/api/department-records/rows", async (req, res) => {
    const actor = actorFor(req, "participants");
    let rows = selectedRows(await loadSource(storage), req);
    const q = z
      .string()
      .max(200)
      .optional()
      .parse(req.query.q)
      ?.trim()
      .toLowerCase();
    if (q)
      rows = rows.filter((row) =>
        [row.fullName, row.email, row.affiliation, row.abstractTitle].some(
          (value) =>
            String(value || "")
              .toLowerCase()
              .includes(q),
        ),
      );
    const after = z.string().max(100).optional().parse(req.query.after);
    const index = after ? rows.findIndex((row) => row.id === after) : -1;
    if (after && index < 0)
      fail("This list changed. Reload the selected department.", 400);
    const requestedLimit = Number(req.query.limit);
    const limit =
      Number.isInteger(requestedLimit) && requestedLimit > 0
        ? Math.min(requestedLimit, 100)
        : 50;
    const page = rows.slice(index + 1, index + 1 + limit);
    const keys = ["id", ...columnsFor(actor).map(([key]) => key)];
    res.setHeader("Cache-Control", "no-store");
    res.json({
      rows: page.map((row) => pickFields(row, keys)),
      next: index + 1 + limit < rows.length ? page.at(-1)!.id : null,
    });
  });
  app.get("/api/reports/department-records", async (req, res) => {
    const actor = actorFor(req, "participants");
    actorFor(req, "reports");
    const source = await loadSource(storage);
    const rows = selectedRows(source, req);
    const columns = columnsFor(actor);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Department records");
    sheet.columns = columns.map(([key, header]) => ({
      key,
      header,
      width:
        key === "abstractTitle"
          ? 70
          : key === "discipline" || key === "affiliation"
            ? 45
            : 25,
    }));
    for (const row of rows)
      sheet.addRow(columns.map(([key]) => row[key] ?? ""));
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: columns.length },
    };
    await recordAudit({
      actorUid: actor.uid,
      actorName: actor.fullName,
      action: "report.department-export",
      target: rows[0].discipline,
    });
    res.setHeader("Cache-Control", "no-store");
    res
      .type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .attachment("cone-department-records.xlsx");
    await workbook.xlsx.write(res);
    res.end();
  });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  });
  app.post(
    "/api/imports/department-source",
    (req, _res, next) => {
      actorFor(req, "imports", "write");
      actorFor(req, "imports");
      actorFor(req, "participants");
      actorFor(req, "fees");
      actorFor(req, "participants", "write");
      actorFor(req, "fees", "write");
      next();
    },
    upload.single("file"),
    async (req, res) => {
      const actor = actorFor(req, "imports", "write");
      if (!req.file?.originalname.toLowerCase().endsWith(".xlsx"))
        fail("Choose an .xlsx workbook", 400);
      const result = await saveDepartmentSource(
        storage,
        req.file.buffer,
        req.file.originalname,
      );
      await recordAudit({
        actorUid: actor.uid,
        actorName: actor.fullName,
        action: "import.department-source",
        target: result.fileName,
      });
      res.json(result);
    },
  );
}
