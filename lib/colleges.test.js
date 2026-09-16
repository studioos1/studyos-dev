import { describe, it, expect } from "vitest";
import { generateAcronym, searchColleges } from "./colleges";

const mk = (names) => names.map(name => ({ name, acronym: generateAcronym(name) }));

describe("generateAcronym", () => {
  it("uses every word's first letter, dropping stopwords", () => {
    expect(generateAcronym("University of California, San Diego")).toBe("ucsd");
  });
  it("handles a name with no stopwords", () => {
    expect(generateAcronym("Ohio State University")).toBe("osu");
  });
});

describe("searchColleges", () => {
  const indexed = mk([
    "University of California, San Diego",
    "University of California, San Francisco",
    "University of California, Santa Barbara",
    "University of California, Santa Cruz",
    "University of California, Los Angeles",
    "Tucson University",
    "Harvard University",
  ]);

  it("a partial acronym matches every school whose acronym starts with it — real reported bug (was exact-match only)", () => {
    const names = searchColleges(indexed, "ucs").map(c => c.name);
    expect(names).toContain("University of California, San Diego");
    expect(names).toContain("University of California, San Francisco");
    expect(names).toContain("University of California, Santa Barbara");
    expect(names).toContain("University of California, Santa Cruz");
  });

  it("acronym-prefix matches rank above a plain substring match", () => {
    const names = searchColleges(indexed, "ucs").map(c => c.name);
    const firstSubstringOnlyIndex = names.indexOf("Tucson University");
    const lastAcronymIndex = Math.max(...["San Diego", "San Francisco", "Santa Barbara", "Santa Cruz"]
      .map(s => names.findIndex(n => n.includes(s))));
    expect(firstSubstringOnlyIndex).toBeGreaterThan(lastAcronymIndex);
  });

  it("the complete acronym still matches exactly one school", () => {
    expect(searchColleges(indexed, "ucsb").map(c => c.name)).toEqual(["University of California, Santa Barbara"]);
  });

  it("a school not in the acronym-prefix or name-prefix tiers still matches via substring", () => {
    expect(searchColleges(indexed, "tucson").map(c => c.name)).toEqual(["Tucson University"]);
  });

  it("empty query returns nothing", () => {
    expect(searchColleges(indexed, "")).toEqual([]);
    expect(searchColleges(indexed, "   ")).toEqual([]);
  });

  it("respects the limit", () => {
    expect(searchColleges(indexed, "university of california", 2).length).toBe(2);
  });
});
