import { describe, expect, it } from "vitest";
import { readWorkbook } from "../server/workbook.js";
import { parseRegistrationWorkbook } from "../server/registration-workbook.js";
import { registrationWorkbookBuffer } from "./registration-fixture.js";

const registrationWorkbook = async () =>
  readWorkbook(await registrationWorkbookBuffer());

describe("registration workbook intake", () => {
  it("finds each sheet's header row and skips summary, empty and total rows", async () => {
    const { sheets } = parseRegistrationWorkbook(await registrationWorkbook());
    expect(sheets).toEqual([
      expect.objectContaining({
        name: "MAIN",
        headerRow: null,
        rows: 0,
        note: "Summary sheet, shown as a table",
      }),
      expect.objectContaining({ name: "Sheet1", note: "Empty sheet" }),
      expect.objectContaining({
        name: "Chemical Sciences",
        headerRow: 4,
        rows: 4,
        ready: 1,
        needsFix: 2,
        skipped: 1,
      }),
      expect.objectContaining({
        name: "Physical Sciences",
        headerRow: 2,
        rows: 1,
        ready: 1,
      }),
    ]);
  });
  it("keeps the MAIN summary sheet as laid out, with merged cells as spans", async () => {
    const { summaries } = parseRegistrationWorkbook(
      await registrationWorkbook(),
    );
    expect(summaries).toEqual([
      {
        sheet: "MAIN",
        title: "21st Conference — discipline summary",
        headerRows: 2,
        rows: [
          {
            cells: [
              { text: "Sr. No.", rowSpan: 2 },
              { text: "Discipline", rowSpan: 2 },
              { text: "Oral", colSpan: 3 },
              { text: "Total Abstract", colSpan: 2, rowSpan: 2 },
            ],
          },
          { cells: [{ text: "I" }, { text: "II" }, { text: "Total" }] },
          {
            cells: [
              { text: "1" },
              { text: "Chemical Sciences" },
              { text: "3" },
              { text: "1" },
              { text: "4" },
              { text: "4", colSpan: 2 },
            ],
          },
          {
            cells: [
              { text: "TOTAL", colSpan: 2 },
              { text: "" },
              { text: "" },
              { text: "4" },
              { text: "4", colSpan: 2 },
            ],
          },
        ],
      },
    ]);
  });
  it("maps differently spelled headers and normalises values for the mobile app", async () => {
    const { rows } = parseRegistrationWorkbook(await registrationWorkbook());
    expect(rows[0]).toMatchObject({
      sheet: "Chemical Sciences",
      row: 5,
      status: "ready",
      email: "asha@example.org",
      person: {
        fullName: "Asha Rawat",
        email: "asha@example.org",
        mobile: "9876543210",
        affiliation: "Example University",
        role: "presenter",
        registrationStatus: "pending",
        discipline: "Chemical Sciences",
        category: "II",
        presentationType: "P",
        registrationFee: 500,
        softCopy: "Yes",
        accommodation: "No",
        earlierAwardee: "No",
        workingAs: "JRF",
        district: "DN",
        gender: "F",
        dob: "1999-05-06",
        feesReceived: "UPI-0001",
        paper: {
          submissionId: "ABS-3-1",
          title: "Green synthesis of nanoparticles",
          abstractText: null,
          authors: [
            {
              name: "Asha Rawat",
              affiliation: "Example University",
              role: "Presenting author",
              isParticipant: true,
            },
          ],
        },
      },
    });
    const kiran = rows.find((r) => r.email === "kiran@example.org")!;
    expect(kiran.person).toMatchObject({
      discipline: "Physical Sciences",
      category: "III",
      registrationFee: 1000,
      mobile: "9876500002",
      earlierAwardee: "Yes",
      dob: "25/6/1998",
    });
  });
  it("keeps every original cell, including blanks, exactly as written", async () => {
    const { rows } = parseRegistrationWorkbook(await registrationWorkbook());
    expect(rows[0].original).toMatchObject({
      EmailAddress: "Asha@Example.org",
      "Mobile No.": "+91 98765 43210",
      "Soft Copy": "YES",
      "Roll No": "",
      Remark: "",
    });
    expect(Object.keys(rows[0].original)).toHaveLength(20);
  });
  it("marks rows the app cannot use as needing a fix instead of dropping them", async () => {
    const { rows } = parseRegistrationWorkbook(await registrationWorkbook());
    const ravi = rows.find((r) => r.email === "ravi@example.org")!;
    const meera = rows.find(
      (r) => r.original["Name of Author(S)"] === "Meera Joshi",
    )!;
    expect(ravi).toMatchObject({ status: "needs_fix", person: null });
    expect(ravi.errors).toContain("Mobile is missing");
    expect(meera.status).toBe("needs_fix");
    expect(meera.errors[0]).toMatch(/Email "meera-example.org" is not valid/);
  });
  it("flags a repeated email so only its first row becomes the person", async () => {
    const { rows } = parseRegistrationWorkbook(await registrationWorkbook());
    const repeats = rows.filter((r) => r.email === "asha@example.org");
    expect(repeats.map((r) => r.status)).toEqual(["ready", "duplicate"]);
    expect(repeats[1].warnings[0]).toMatch(/Chemical Sciences row 5/);
  });
  it("applies the chosen role and registration status", async () => {
    const { rows } = parseRegistrationWorkbook(await registrationWorkbook(), {
      defaultRole: "attendee",
      registrationStatus: "confirmed",
    });
    expect(rows[0].person).toMatchObject({
      role: "attendee",
      registrationStatus: "confirmed",
    });
  });
});
