import { describe, expect, it } from "vitest";
import {
  matchesTerms,
  personSearchKeys,
  searchTerms,
} from "../shared/search.js";

describe("search keys", () => {
  const keys = personSearchKeys({
    fullName: "Ravi Negi",
    email: "ravi.negi@example.org",
    mobile: "9876543210",
  });
  it("hold the prefixes of each word of name, email and mobile", () => {
    for (const key of [
      "ra",
      "rav",
      "ravi",
      "ne",
      "negi",
      "example",
      "98",
      "9876543210",
    ])
      expect(keys).toContain(key);
    expect(keys).not.toContain("r");
    expect(keys).not.toContain("avi");
  });
  it("match what someone types, in any order and case", () => {
    expect(matchesTerms(keys, searchTerms("NEG rav"))).toBe(true);
    expect(matchesTerms(keys, searchTerms("ravi.negi@ex"))).toBe(true);
    expect(matchesTerms(keys, searchTerms("98765"))).toBe(true);
    expect(matchesTerms(keys, searchTerms("ravi joshi"))).toBe(false);
    expect(matchesTerms(undefined, searchTerms("ravi"))).toBe(false);
  });
  it("ignore single letters and repeated words in a query", () => {
    expect(searchTerms("R  ravi Ravi")).toEqual(["ravi"]);
  });
  it("cover names written in other scripts", () => {
    expect(personSearchKeys({ fullName: "रश्मि पांडे" })).toContain("रश्मि");
  });
});
