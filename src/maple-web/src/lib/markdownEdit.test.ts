import { describe, expect, it } from "vitest";
import { applyEdit, formatEdit, type Format } from "./markdownEdit";

// Formats `text` where [ and ] mark the selection; returns the result with the new selection marked the same way.
function run(format: Format, marked: string): string {
  const start = marked.indexOf("[");
  const end = marked.indexOf("]") - 1;
  const text = marked.replace("[", "").replace("]", "");
  const edit = formatEdit(format, text, start, end);
  const result = applyEdit(text, edit);
  return result.slice(0, edit.selectStart) + "[" + result.slice(edit.selectStart, edit.selectEnd) + "]" + result.slice(edit.selectEnd);
}

describe("formatting", () => {
  it("wraps and unwraps the selection", () => {
    expect(run("bold", "Buy [maple] syrup")).toBe("Buy **[maple]** syrup");
    expect(run("bold", "Buy **[maple]** syrup")).toBe("Buy [maple] syrup");
    expect(run("bold", "Buy [**maple**] syrup")).toBe("Buy [maple] syrup");
    expect(run("italic", "a [b] c")).toBe("a *[b]* c");
    expect(run("code", "run [npm test] now")).toBe("run `[npm test]` now");
  });

  it("inserts a placeholder to type over when nothing is selected", () => {
    expect(run("bold", "Hello []")).toBe("Hello **[bold text]**");
    expect(run("link", "See []")).toBe("See [link text]([https://])"); // the address is selected to type over
    expect(run("link", "See [the docs]")).toBe("See [the docs]([https://])"); // the selection becomes the link text
  });

  it("makes a code block from several lines", () => {
    expect(run("code", "[a\nb]")).toBe("```\n[a\nb]\n```");
  });

  it("adds and removes line prefixes, keeping the cursor in place", () => {
    expect(run("heading", "Title[]")).toBe("## Title[]");
    expect(run("heading", "## Tit[]le")).toBe("Tit[]le");
    expect(run("bullets", "one\n[two\nthree]")).toBe("one\n[- two\n- three]");
    expect(run("bullets", "[- two\n- three]")).toBe("[two\nthree]");
    expect(run("checklist", "- mi[]lk")).toBe("- [ ] mi[]lk"); // a bullet becomes a checklist item
    expect(run("quote", "[x\n> y]")).toBe("[> x\n> y]");
  });
});
