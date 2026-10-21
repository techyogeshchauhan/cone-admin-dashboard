import ExcelJS from "exceljs";

// Mirrors the organisers' workbook: a summary sheet, an empty sheet, and
// discipline sheets whose title, header row and header spellings differ.
export async function registrationWorkbookBuffer() {
  const book = new ExcelJS.Workbook();
  // MAIN: a title, two merged header rows, data, a merged TOTAL row.
  const main = book.addWorksheet("MAIN");
  main.addRow(["21st Conference — discipline summary"]);
  main.addRow([]);
  main.addRow(["Sr. No.", "Discipline", "Oral", null, null, "Total Abstract"]);
  main.addRow([null, null, "I", "II", "Total"]);
  main.addRow([1, "Chemical Sciences", 3, 1, 4, 4]);
  main.addRow(["TOTAL", null, null, null, 4, 4]);
  for (const range of ["A1:G1", "A3:A4", "B3:B4", "C3:E3", "F3:G4"])
    main.mergeCells(range);
  for (const range of ["F5:G5", "A6:B6", "F6:G6"]) main.mergeCells(range);
  book.addWorksheet("Sheet1");
  const chem = book.addWorksheet("Chemical Sciences");
  chem.addRow(["Chemical Sciences"]);
  chem.mergeCells("A1:F1");
  chem.mergeCells("A2:F2"); // a blank merged row, as in the real workbook
  chem.addRow([]);
  chem.addRow([
    "Sr. No.",
    "Discipline ",
    "CT.",
    "M/F",
    "O/P",
    "Title of Abstract",
    "Name of Author(S) ",
    "Organizational Affiliation ",
    "EmailAddress",
    "Registration Fee",
    "Working as",
    "Soft Copy",
    "District",
    "Accom",
    "DOB",
    "Roll No",
    "DD Received",
    "Mobile No.",
    "Earler Awardee",
    "Remark",
  ]);
  const row = (values: Record<number, unknown>) =>
    chem.addRow(Array.from({ length: 20 }, (_, i) => values[i + 1] ?? null));
  row({
    1: 1,
    2: "Chemical Sciences",
    3: "ii",
    4: "F",
    5: "p",
    6: "Green synthesis of nanoparticles",
    7: "Asha Rawat",
    8: "Example University",
    9: " Asha@Example.org ",
    10: 500,
    11: "JRF",
    12: "YES",
    13: "DN",
    14: "NO",
    15: new Date(Date.UTC(1999, 4, 6)),
    17: "UPI-0001",
    18: "+91 98765 43210",
    19: "no",
  });
  row({ 1: 2, 7: "Ravi Negi", 8: "Example Institute", 9: "ravi@example.org" });
  row({
    1: 3,
    7: "Meera Joshi",
    8: "Example College",
    9: "meera-example.org",
    18: "9876500001",
  });
  row({
    1: 4,
    6: "A second abstract",
    7: "Asha Rawat",
    8: "Example University",
    9: "asha@example.org",
    18: "9876543210",
  });
  row({ 7: 43, 10: 2000 });
  const physics = book.addWorksheet("Physical Sciences");
  physics.addRow(["Physical Sciences"]);
  physics.addRow([
    "Sr. No.",
    "Discipline ",
    "CT.",
    "M/F",
    "O/P",
    "Title of Abstract",
    "Name of Author(S) ",
    "Organizational Affiliation ",
    "Email Address",
    "Ammount  Received ",
    "Working as",
    "Soft Copy",
    "District",
    "Acco",
    "DOB",
    "Roll No",
    "Fees Received",
    "Mobile",
    "Earlier Awardee",
  ]);
  physics.addRow([
    1,
    "",
    "III",
    "M",
    "O",
    "Optical behaviour of thin films",
    "Kiran Bisht",
    "Example Institute of Technology",
    "kiran@example.org",
    "1,000",
    "Ph.D Scholar",
    "No",
    "NT",
    "",
    "25/6/1998",
    "",
    "UPI-0002",
    "09876500002",
    "Yes",
  ]);
  return Buffer.from(await book.xlsx.writeBuffer());
}
