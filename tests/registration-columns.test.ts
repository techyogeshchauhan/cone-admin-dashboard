import { describe, expect, it } from "vitest";
import {
  fieldFor,
  problemColumns,
  problemFields,
} from "../shared/registration-columns.js";

describe("registration columns", () => {
  it("maps the header spellings used across discipline sheets", () => {
    expect(
      [
        "EmailAddress",
        "Email Address",
        "Mobile No.",
        "Mobile ",
        "Name of Author(S) ",
      ].map(fieldFor),
    ).toEqual(["email", "email", "mobile", "mobile", "fullName"]);
  });
  it("reads which fields a row's errors are about", () => {
    expect(
      problemFields([
        'Email "meera-example.org" is not valid',
        "Mobile is missing",
        "Affiliation is missing",
      ]),
    ).toEqual(["email", "mobile", "affiliation"]);
    expect(problemFields(["Name is missing"])).toEqual(["fullName"]);
    expect(problemFields([])).toEqual([]);
  });
  it("points at the original columns to highlight, whatever they are called", () => {
    const original = {
      "Name of Author(S)": "Meera Joshi",
      EmailAddress: "meera-example.org",
      "Mobile No.": "",
      "Organizational Affiliation": "Example College",
    };
    expect(
      problemColumns(original, [
        'Email "meera-example.org" is not valid',
        "Mobile is missing",
      ]),
    ).toEqual(["EmailAddress", "Mobile No."]);
  });
});
