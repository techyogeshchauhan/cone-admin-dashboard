import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { readWorkbook } from "../server/workbook.js";
describe("Excel intake", () => {
  it("reads actual xlsx cells and headers", async () => {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet("Participants");
    sheet.addRow(["fullName", "email", "mobile"]);
    sheet.addRow(["Example Name", "person@example.org", "9876543210"]);
    const result = await readWorkbook(
      Buffer.from(await book.xlsx.writeBuffer()),
    );
    expect(result.getWorksheet("Participants")?.getCell("C2").text).toBe(
      "9876543210",
    );
  });
  it("rejects files that are not workbook archives", async () => {
    await expect(readWorkbook(Buffer.from("invalid workbook"))).rejects.toThrow(
      "Invalid Excel ZIP",
    );
  });
  it("rejects oversized row counts before allowing an import", async () => {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet("Too many");
    sheet.getCell("A2002").value = "out of bounds";
    await expect(
      readWorkbook(Buffer.from(await book.xlsx.writeBuffer())),
    ).rejects.toThrow("2,000");
  });
});
