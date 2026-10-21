// Shared by the workbook parser and the screens that show its results, so
// both agree on which Excel column holds which field.
export const headerKey = (header: string) =>
  header.toLowerCase().replace(/[^a-z]/g, "");

// Header spellings seen across discipline sheets, keyed by letters only.
export function fieldFor(header: string) {
  const k = headerKey(header);
  if (!k) return null;
  if (k === "srno") return "srNo";
  if (k === "discipline") return "discipline";
  if (k === "ct" || k === "category") return "category";
  if (k === "mf" || k === "gender") return "gender";
  if (k === "op") return "presentationType";
  if (k.startsWith("titleofabstract")) return "abstractTitle";
  if (k.startsWith("nameofauthor")) return "fullName";
  if (k.startsWith("organizationalaffiliation") || k === "affiliation")
    return "affiliation";
  if (k === "emailaddress" || k === "email") return "email";
  if (
    k === "registrationfee" ||
    k.endsWith("amountreceived") ||
    k === "ammountreceived"
  )
    return "registrationFee";
  if (k === "workingas") return "workingAs";
  if (k === "softcopy") return "softCopy";
  if (k === "district") return "district";
  if (k.startsWith("acc")) return "accommodation";
  if (k === "dob") return "dob";
  if (k === "rollno") return "rollNo";
  if (k === "feesreceived" || k === "ddreceived") return "feesReceived";
  if (k.startsWith("mobile")) return "mobile";
  if (k === "awardee" || (k.startsWith("ear") && k.includes("aw")))
    return "earlierAwardee";
  if (k === "remark" || k === "remarks") return "remark";
  return null;
}

// The fields a row's errors are about, read from the parser's messages
// ("Mobile is missing", "Email \"x\" is not valid", ...). Rows saved before
// this existed carry only the messages, so they are the source.
const subjects: [string, string][] = [
  ["Email", "email"],
  ["Mobile", "mobile"],
  ["Name", "fullName"],
  ["Affiliation", "affiliation"],
];
export function problemFields(errors: string[]) {
  return subjects
    .filter(([word]) => errors.some((e) => e.startsWith(`${word} `)))
    .map(([, field]) => field);
}

// Original column headers holding a problem field.
export function problemColumns(
  original: Record<string, string>,
  errors: string[],
) {
  const fields = problemFields(errors);
  return Object.keys(original).filter((header) =>
    fields.includes(fieldFor(header) || ""),
  );
}
