// Reads a conference registration workbook as it arrives from the organisers:
// one sheet per discipline, a title above the header row, slightly different
// header spellings per sheet, and summary/total rows at the bottom. Every
// row keeps its original cell text; only rows that satisfy the mobile app's
// data contract become people records.
import ExcelJS from "exceljs";
import { z } from "zod";
import { conferenceRoles, mobile } from "../shared/schema.js";
import { fieldFor, headerKey as key } from "../shared/registration-columns.js";

export type RowStatus = "ready" | "needs_fix" | "duplicate";
export type WorkbookRow = {
  sheet: string;
  row: number;
  email: string;
  status: RowStatus;
  original: Record<string, string>;
  person: Record<string, unknown> | null;
  errors: string[];
  warnings: string[];
};
export type WorkbookSheet = {
  name: string;
  headerRow: number | null;
  rows: number;
  ready: number;
  needsFix: number;
  skipped: number;
  note?: string;
};
// A summary sheet such as MAIN, kept as Excel lays it out. Firestore cannot
// hold nested arrays, so each row is an object with its cells.
export type SummaryCell = { text: string; colSpan?: number; rowSpan?: number };
export type SummarySheet = {
  sheet: string;
  title: string;
  headerRows: number;
  rows: { cells: SummaryCell[] }[];
};
export const importOptions = z.object({
  defaultRole: z.enum(conferenceRoles).default("presenter"),
  registrationStatus: z.enum(["pending", "confirmed"]).default("pending"),
});
export type ImportOptions = z.infer<typeof importOptions>;

// Merged cells whose master is blank make ExcelJS's cell.text throw.
function rawText(cell: ExcelJS.Cell) {
  try {
    return cell.text ?? "";
  } catch {
    return "";
  }
}
function cellText(cell: ExcelJS.Cell) {
  const value = cell.value;
  const date =
    value instanceof Date
      ? value
      : value &&
          typeof value === "object" &&
          "result" in value &&
          value.result instanceof Date
        ? value.result
        : null;
  if (date && !Number.isNaN(date.getTime()))
    return date.toISOString().slice(0, 10);
  return rawText(cell).replace(/\s+/g, " ").trim().slice(0, 2000);
}

function columnNumber(letters: string) {
  return [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
}
export function readSummarySheet(sheet: ExcelJS.Worksheet): SummarySheet {
  const lastRow = Math.min(sheet.rowCount, 300);
  let lastCol = 0;
  const text = new Map<string, string>();
  for (let r = 1; r <= lastRow; r++)
    sheet.getRow(r).eachCell((cell, c) => {
      if (c > 80) return;
      const value = cellText(cell);
      if (!value) return;
      text.set(`${r}:${c}`, value);
      lastCol = Math.max(lastCol, c);
    });
  const merges = new Map<string, { rows: number[]; cols: number }>();
  const covered = new Set<string>();
  const kept: number[] = [];
  for (let r = 1; r <= lastRow; r++)
    for (let c = 1; c <= lastCol; c++)
      if (text.has(`${r}:${c}`)) {
        kept.push(r);
        break;
      }
  for (const range of (sheet.model as { merges?: string[] }).merges || []) {
    const match = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(range);
    if (!match) continue;
    const [top, bottom] = [Number(match[2]), Number(match[4])];
    const [left, right] = [columnNumber(match[1]), columnNumber(match[3])];
    if (left > lastCol) continue;
    merges.set(`${top}:${left}`, {
      rows: kept.filter((r) => r >= top && r <= bottom),
      cols: Math.min(right, lastCol) - left + 1,
    });
    for (let r = top; r <= bottom; r++)
      for (let c = left; c <= right; c++)
        if (r !== top || c !== left) covered.add(`${r}:${c}`);
  }
  const rows = kept.map((r) => ({
    cells: Array.from({ length: lastCol }, (_, i) => i + 1)
      .filter((c) => !covered.has(`${r}:${c}`))
      .map((c) => {
        const merge = merges.get(`${r}:${c}`);
        const cell: SummaryCell = { text: text.get(`${r}:${c}`) || "" };
        if (merge && merge.cols > 1) cell.colSpan = merge.cols;
        if (merge && merge.rows.length > 1) cell.rowSpan = merge.rows.length;
        return cell;
      }),
  }));
  // A first row that is one wide cell is the sheet's title.
  let title = "";
  if (rows[0]?.cells.filter((c) => c.text).length === 1) {
    title = rows[0].cells.find((c) => c.text)!.text;
    rows.shift();
  }
  // Header rows run until the first row holding a plain number.
  const headerRows = Math.max(
    0,
    rows.findIndex((row) =>
      row.cells.some((c) => /^\d+(\.\d+)?$/.test(c.text)),
    ),
  );
  return { sheet: sheet.name, title, headerRows, rows };
}

function findHeaderRow(sheet: ExcelJS.Worksheet) {
  for (let r = 1; r <= Math.min(10, sheet.rowCount); r++) {
    const keys: string[] = [];
    sheet.getRow(r).eachCell((cell) => keys.push(key(rawText(cell))));
    if (
      keys.some((k) => k.includes("email")) &&
      keys.some((k) => k.startsWith("nameofauthor") || k === "fullname")
    )
      return r;
  }
  return null;
}

const yesNo = (value: string) =>
  /^y(es)?$/i.test(value) ? "Yes" : /^no?$/i.test(value) ? "No" : null;
const roman: Record<string, string> = {
  i: "I",
  ii: "II",
  iii: "III",
  iv: "IV",
};

function normalise(
  fields: Record<string, string>,
  sheetName: string,
  options: ImportOptions,
) {
  const errors: string[] = [];
  const warnings: string[] = [];
  const email = z
    .email()
    .safeParse(fields.email?.toLowerCase().replace(/\s+/g, ""));
  if (!fields.email) errors.push("Email is missing");
  else if (!email.success) errors.push(`Email "${fields.email}" is not valid`);
  const phone = mobile.safeParse(fields.mobile || "");
  if (!fields.mobile) errors.push("Mobile is missing");
  else if (!phone.success)
    errors.push(`Mobile "${fields.mobile}" is not a ten-digit Indian number`);
  const fullName = (fields.fullName || "").trim();
  if (fullName.length < 2) errors.push("Name is missing");
  if (!fields.affiliation) errors.push("Affiliation is missing");

  const category = roman[(fields.category || "").toLowerCase()] ?? "";
  if (fields.category && !category)
    warnings.push(`Category "${fields.category}" not recognised`);
  const presentationType = /^[op]$/i.test(fields.presentationType || "")
    ? fields.presentationType!.toUpperCase()
    : "";
  if (fields.presentationType && !presentationType)
    warnings.push(`O/P value "${fields.presentationType}" not recognised`);
  const digits = (fields.registrationFee || "").replace(/[,\s₹]|rs\.?/gi, "");
  const registrationFee = /^\d+(\.\d+)?$/.test(digits)
    ? Math.round(Number(digits))
    : 0;
  if (fields.registrationFee && !/^\d+(\.\d+)?$/.test(digits))
    warnings.push(
      `Fee "${fields.registrationFee}" is not a number; saved as 0`,
    );
  const flags: Record<string, string> = {};
  for (const field of ["softCopy", "accommodation", "earlierAwardee"]) {
    const value = fields[field] || "";
    flags[field] = yesNo(value) ?? "No";
    if (value && !yesNo(value))
      warnings.push(`${field} "${value}" is not Yes/No; saved as No`);
  }
  if (errors.length) return { person: null, errors, warnings };

  const discipline = fields.discipline || sheetName;
  const optional: Record<string, string> = {};
  for (const field of [
    "workingAs",
    "district",
    "feesReceived",
    "gender",
    "dob",
    "rollNo",
    "remark",
    "travelAssistance",
  ])
    if (fields[field]) optional[field] = fields[field];
  const person: Record<string, unknown> = {
    fullName,
    email: email.data!,
    mobile: phone.data!,
    affiliation: fields.affiliation,
    role: options.defaultRole,
    registrationStatus: options.registrationStatus,
    discipline,
    category,
    presentationType,
    registrationFee,
    ...flags,
    ...optional,
  };
  if (fields.abstractTitle)
    person.paper = {
      title: fields.abstractTitle,
      abstractText: null,
      authors: [
        {
          name: fullName,
          affiliation: fields.affiliation,
          role: "Presenting author",
          isParticipant: true,
        },
      ],
    };
  return { person, errors, warnings };
}

export function parseRegistrationWorkbook(
  workbook: ExcelJS.Workbook,
  input: Partial<ImportOptions> = {},
) {
  const options = importOptions.parse(input);
  const sheets: WorkbookSheet[] = [];
  const rows: WorkbookRow[] = [];
  const summaries: SummarySheet[] = [];
  const firstRowFor = new Map<string, WorkbookRow>();
  workbook.worksheets.forEach((sheet, sheetIndex) => {
    const summary: WorkbookSheet = {
      name: sheet.name,
      headerRow: null,
      rows: 0,
      ready: 0,
      needsFix: 0,
      skipped: 0,
    };
    sheets.push(summary);
    if (!sheet.rowCount) return void (summary.note = "Empty sheet");
    const headerRow = findHeaderRow(sheet);
    if (!headerRow) {
      summaries.push(readSummarySheet(sheet));
      summary.note = "Summary sheet, shown as a table";
      return;
    }
    summary.headerRow = headerRow;
    const headers: Record<number, string> = {};
    sheet.getRow(headerRow).eachCell((cell, col) => {
      headers[col] = cellText(cell);
    });
    for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
      // Every named column is kept, blank or not, so the row reads like Excel.
      const original: Record<string, string> = Object.fromEntries(
        Object.values(headers)
          .filter(Boolean)
          .map((header) => [header, ""]),
      );
      const fields: Record<string, string> = {};
      let formula = false;
      let filled = false;
      sheet.getRow(r).eachCell((cell, col) => {
        const text = cellText(cell);
        if (!text) return;
        filled = true;
        if (cell.type === ExcelJS.ValueType.Formula) formula = true;
        original[headers[col] || `Column ${col}`] = text;
        const field = fieldFor(headers[col] || "");
        if (field && !fields[field]) fields[field] = text;
      });
      // Blank lines and the per-sheet totals ("43", "16") carry no identity.
      const nameIsCount = /^\d+$/.test(fields.fullName || "");
      if ((!fields.fullName || nameIsCount) && !fields.email) {
        if (filled) summary.skipped++;
        continue;
      }
      summary.rows++;
      const { person, errors, warnings } = normalise(
        fields,
        sheet.name,
        options,
      );
      if (formula)
        warnings.push("Formula cells were read as their last calculated value");
      const result: WorkbookRow = {
        sheet: sheet.name,
        row: r,
        email: (fields.email || "").toLowerCase(),
        status: person ? "ready" : "needs_fix",
        original,
        person,
        errors,
        warnings,
      };
      if (person) {
        const paper = person.paper as Record<string, unknown> | undefined;
        if (paper)
          paper.submissionId = `ABS-${sheetIndex + 1}-${fields.srNo || r}`;
        const first = firstRowFor.get(String(person.email));
        if (first) {
          result.status = "duplicate";
          result.warnings.push(
            `Same email as ${first.sheet} row ${first.row}; that row is used for the person record`,
          );
        } else firstRowFor.set(String(person.email), result);
      }
      if (result.status === "needs_fix") summary.needsFix++;
      else if (result.status === "ready") summary.ready++;
      rows.push(result);
    }
  });
  return { sheets, rows, summaries };
}
