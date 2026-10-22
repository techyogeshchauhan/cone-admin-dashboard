// Labels follow the supplied registration workbook. Values remain source text.
export const departmentColumns = [
  ["srNo", "Sr. No."],
  ["discipline", "Department / Discipline"],
  ["category", "Category (CT.)"],
  ["gender", "Gender (M/F)"],
  ["presentationType", "Presentation (O/P)"],
  ["abstractTitle", "Title of Abstract"],
  ["fullName", "Name of Author(s)"],
  ["affiliation", "Organizational Affiliation"],
  ["email", "Email Address"],
  ["registrationFee", "Registration Fee / Amount"],
  ["workingAs", "Working as"],
  ["softCopy", "Soft Copy"],
  ["district", "District"],
  ["accommodation", "Accommodation"],
  ["travelAssistance", "TA required"],
  ["dob", "Date of Birth"],
  ["rollNo", "Roll No."],
  ["feesReceived", "Payment / DD Reference (source)"],
  ["mobile", "Mobile"],
  ["earlierAwardee", "Earlier Awardee"],
  ["remark", "Remark"],
  ["sourceSheet", "Source Sheet"],
  ["sourceRow", "Excel Row"],
] as const;
export type DepartmentRow = Record<string, string> & {
  id: string;
  discipline: string;
  fullName: string;
};
export type DepartmentCatalog = {
  fileName: string;
  revision: string;
  departments: { name: string; count: number }[];
  total: number;
};
export const departmentKey = (value: string) =>
  value.trim().replace(/\s+/g, " ").toLowerCase();
