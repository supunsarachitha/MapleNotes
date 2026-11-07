import { describe, expect, it } from "vitest";
import { addItem, parseItems, parseTodo, serializeItems, serializeTodo, toggleItem } from "./todo";

describe("todo lists", () => {
  it("reads the title and the items", () => {
    expect(parseTodo("# Groceries\n\n- [ ] maple syrup\n- [x] oats\n* [X] flour #baking")).toEqual({
      title: "Groceries",
      items: [
        { text: "maple syrup", done: false },
        { text: "oats", done: true },
        { text: "flour #baking", done: true },
      ],
    });
  });

  it("turns other lines into open items and skips empty ones", () => {
    expect(parseTodo("# Packing\n\n- tent\nsleeping bag\n\n- [ ]   \n- [x] stove")).toEqual({
      title: "Packing",
      items: [
        { text: "tent", done: false },
        { text: "sleeping bag", done: false },
        { text: "stove", done: true },
      ],
    });
  });

  it("writes Markdown that reads back the same", () => {
    const list = { title: "  Weekend  ", items: [{ text: "hike   the trail", done: true }, { text: "  ", done: false }, { text: "call Sam", done: false }] };

    const markdown = serializeTodo(list);

    expect(markdown).toBe("# Weekend\n\n- [x] hike the trail\n- [ ] call Sam");
    expect(serializeTodo(parseTodo(markdown))).toBe(markdown);
    expect(serializeTodo({ title: "", items: [] })).toBe("# Untitled list");
  });

  it("reads and writes the items alone, for editing them all at once", () => {
    const items = parseItems("- [x] tent\r\nsleeping bag\n\n  * [ ] stove  ");

    expect(items).toEqual([
      { text: "tent", done: true },
      { text: "sleeping bag", done: false },
      { text: "stove", done: false },
    ]);
    expect(serializeItems(items)).toBe("- [x] tent\n- [ ] sleeping bag\n- [ ] stove");
    expect(serializeItems([])).toBe("");
  });

  it("moves a ticked item to the bottom and an unticked one back above the ticked items", () => {
    const items = parseItems("- [ ] tent\n- [ ] stove\n- [ ] map\n- [x] torch");

    const ticked = toggleItem(items, 0);
    expect(serializeItems(ticked)).toBe("- [ ] stove\n- [ ] map\n- [x] torch\n- [x] tent");

    const unticked = toggleItem(ticked, 3);
    expect(serializeItems(unticked)).toBe("- [ ] stove\n- [ ] map\n- [ ] tent\n- [x] torch");

    expect(serializeItems(toggleItem(parseItems("- [x] torch\n- [x] tent"), 1))).toBe("- [ ] tent\n- [x] torch");
    expect(toggleItem(items, 9)).toBe(items);
  });

  it("adds a new item after the open items, above the ticked ones", () => {
    expect(serializeItems(addItem(parseItems("- [ ] tent\n- [x] torch"), "stove"))).toBe("- [ ] tent\n- [ ] stove\n- [x] torch");
    expect(serializeItems(addItem(parseItems("- [x] torch"), "stove"))).toBe("- [ ] stove\n- [x] torch");
    expect(serializeItems(addItem([], "stove"))).toBe("- [ ] stove");
  });
});
