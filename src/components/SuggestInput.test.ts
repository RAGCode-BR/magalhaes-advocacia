import { describe, expect, it } from "vitest";
import { filterSuggestions } from "./SuggestInput";

describe("filterSuggestions", () => {
  const suppliers = [
    "Tribunal Regional Federal",
    "OAB MT",
    "Distribuidora Triunfo",
    "Gesso Betel",
    "OAB MT",
  ];

  it("ignores accents and case and puts names starting with the text first", () => {
    expect(filterSuggestions(suppliers, "tri")).toEqual([
      "Tribunal Regional Federal",
      "Distribuidora Triunfo",
    ]);
    expect(filterSuggestions(["Fábrica De Vasos Rocha"], "fabrica")).toEqual([
      "Fábrica De Vasos Rocha",
    ]);
  });

  it("lists each name once, in order, and caps the list", () => {
    expect(filterSuggestions(suppliers, "")).toEqual([
      "Distribuidora Triunfo",
      "Gesso Betel",
      "OAB MT",
      "Tribunal Regional Federal",
    ]);
    expect(filterSuggestions(suppliers, "", 2)).toHaveLength(2);
  });
});
