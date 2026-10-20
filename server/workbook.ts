import ExcelJS from "exceljs";
import yauzl from "yauzl";
export async function readWorkbook(buffer: Buffer) {
  await new Promise<void>((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zip) => {
      if (error || !zip)
        return reject(
          Object.assign(new Error("Invalid Excel ZIP container"), {
            status: 400,
          }),
        );
      let total = 0,
        count = 0,
        failed = false;
      const fail = (message: string) => {
        if (failed) return;
        failed = true;
        zip.close();
        reject(Object.assign(new Error(message), { status: 400 }));
      };
      zip.on("error", () => fail("Invalid workbook archive"));
      zip.on("entry", (entry) => {
        count++;
        total += entry.uncompressedSize;
        if (
          count > 1500 ||
          total > 32 * 1024 * 1024 ||
          entry.uncompressedSize > 16 * 1024 * 1024
        )
          return fail("Workbook expands beyond the permitted limit");
        if (
          entry.fileName.includes("..") ||
          /vbaProject|externalLinks/i.test(entry.fileName)
        )
          return fail("Macros and external workbook links are not accepted");
        zip.readEntry();
      });
      zip.on("end", () => {
        if (!failed) resolve();
      });
      zip.readEntry();
    });
  });
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as never);
  } catch {
    throw Object.assign(new Error("The workbook could not be read"), {
      status: 400,
    });
  }
  if (
    workbook.worksheets.length > 30 ||
    workbook.worksheets.some((s) => s.rowCount > 2001)
  )
    throw Object.assign(
      new Error("Maximum 30 sheets and 2,000 data rows per sheet"),
      { status: 400 },
    );
  return workbook;
}
