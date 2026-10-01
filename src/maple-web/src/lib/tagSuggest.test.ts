import { describe, expect, it } from "vitest";
import { insertTag, suggestTags, tagQueryAt } from "./tagSuggest";

const tags = [
  { name: "groceries", noteCount: 4 },
  { name: "garden", noteCount: 9 },
  { name: "work/meetings", noteCount: 2 },
  { name: "work", noteCount: 7 },
  { name: "meetup", noteCount: 1 },
];

describe("tag suggestions", () => {
  it("finds the tag being typed just before the caret", () => {
    expect(tagQueryAt("Buy #Gro", 8)).toEqual({ start: 4, text: "gro" });
    expect(tagQueryAt("#", 1)).toEqual({ start: 0, text: "" });
    expect(tagQueryAt("see #work/me", 12)).toEqual({ start: 4, text: "work/me" });
  });

  it("offers nothing where a # does not start a tag, or the caret is not at its end", () => {
    expect(tagQueryAt("issue#12", 8)).toBeNull(); // after a letter
    expect(tagQueryAt("## Heading", 2)).toBeNull(); // after another #
    expect(tagQueryAt("#gro ", 5)).toBeNull(); // finished with a space
    expect(tagQueryAt("#groceries", 3)).toBeNull(); // inside the word
    expect(tagQueryAt("plain text", 5)).toBeNull();
  });

  it("ranks tags that start with what was typed, then nested parts that do, each by use", () => {
    expect(suggestTags(tags, "").map((t) => t.name)).toEqual(["garden", "work", "groceries", "work/meetings", "meetup"]);
    expect(suggestTags(tags, "g").map((t) => t.name)).toEqual(["garden", "groceries"]);
    expect(suggestTags(tags, "mee").map((t) => t.name)).toEqual(["meetup", "work/meetings"]);
    expect(suggestTags(tags, "", 2)).toHaveLength(2);
  });

  it("has nothing to add once the whole tag is typed", () => {
    expect(suggestTags(tags, "garden")).toEqual([]);
    expect(suggestTags(tags, "work").map((t) => t.name)).toEqual(["work", "work/meetings"]);
  });

  it("puts the whole tag in with a space after it, and the caret after that", () => {
    expect(insertTag("Buy #gro", { start: 4, text: "gro" }, 8, "groceries")).toEqual({ text: "Buy #groceries ", caret: 15 });
    // A space already follows: none is added, and the caret goes past it.
    expect(insertTag("#ga now", { start: 0, text: "ga" }, 3, "garden")).toEqual({ text: "#garden now", caret: 8 });
  });
});
