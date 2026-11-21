// @vitest-environment node
import { describe, expect, it } from "vitest";
import { applyEdit, formatEdit, toggleTask, type Format } from "./markdownEdit";

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
    expect(run("heading2", "Title[]")).toBe("## Title[]");
    expect(run("heading2", "## Tit[]le")).toBe("Tit[]le");
    expect(run("heading1", "Title[]")).toBe("# Title[]");
    expect(run("heading3", "## Title[]")).toBe("### Title[]");
    expect(run("heading1", "### Title[]")).toBe("# Title[]");
    expect(run("bullets", "one\n[two\nthree]")).toBe("one\n[- two\n- three]");
    expect(run("bullets", "[- two\n- three]")).toBe("[two\nthree]");
    expect(run("checklist", "- mi[]lk")).toBe("- [ ] mi[]lk"); // a bullet becomes a checklist item
    expect(run("quote", "[x\n> y]")).toBe("[> x\n> y]");
  });
});

describe("task lists", () => {
  const text = "Plan\n\n- [ ] one\n- [x] two\n  * [X] nested\n\n> 3. [ ] quoted";

  it("ticks and unticks the item that starts at an offset", () => {
    expect(toggleTask(text, text.indexOf("- [ ] one"))).toBe(text.replace("- [ ] one", "- [x] one"));
    expect(toggleTask(text, text.indexOf("- [x] two"))).toBe(text.replace("- [x] two", "- [ ] two"));
    expect(toggleTask(text, text.indexOf("* [X]"))).toBe(text.replace("* [X]", "* [ ]"));
    expect(toggleTask(text, text.indexOf("3. [ ]"))).toBe(text.replace("3. [ ]", "3. [x]"));
  });

  it("changes nothing where no item starts", () => {
    expect(toggleTask(text, 0)).toBeNull();
    expect(toggleTask(text, text.indexOf("[ ] one"))).toBeNull();
    expect(toggleTask("- plain item", 0)).toBeNull();
  });
});

describe("more formatting tools", () => {
  it("strikes text through, and takes it off again", () => {
    expect(run("strike", "a [word] b")).toBe("a ~~[word]~~ b");
    expect(run("strike", "a ~~[word]~~ b")).toBe("a [word] b");
    expect(run("strike", "[]")).toBe("~~[struck text]~~");
  });

  it("numbers lines 1, 2, 3, replacing bullets, and takes the numbers off", () => {
    expect(run("numbered", "[one\ntwo\nthree]")).toBe("[1. one\n2. two\n3. three]");
    expect(run("numbered", "[- one\n- two]")).toBe("[1. one\n2. two]");
    expect(run("numbered", "[1. one\n2. two]")).toBe("[one\ntwo]");
    expect(run("numbered", "Item[]")).toBe("1. Item[]");
    expect(run("bullets", "[1. one\n2. two]")).toBe("[- one\n- two]");
  });

  it("puts a divider on its own line after a blank line, so the text above stays a paragraph", () => {
    expect(run("divider", "Text[]")).toBe("Text\n\n---\n[]");
    expect(run("divider", "[]")).toBe("---\n[]");
    expect(run("divider", "Text\n\n[]")).toBe("Text\n\n---\n[]");
    expect(run("divider", "One[]\nTwo")).toBe("One\n\n---\n[]\nTwo");
  });

  it("inserts a starter table after the selection with the first header selected", () => {
    expect(run("table", "Intro[]")).toBe("Intro\n\n| [Column 1] | Column 2 |\n| --- | --- |\n|  |  |\n");
    expect(run("table", "[]")).toBe("| [Column 1] | Column 2 |\n| --- | --- |\n|  |  |\n");
  });
});
