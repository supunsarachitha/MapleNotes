import { describe, expect, it } from "vitest";
import { MENU_ITEMS, menuOrder, moveItem, saveMenuOrder } from "./menu";

describe("menu order", () => {
  it("is the default order when nothing was chosen", () => {
    expect(menuOrder("")).toEqual([...MENU_ITEMS]);
  });

  it("puts the chosen items first and the rest after them in their usual order", () => {
    expect(menuOrder("help,todo")).toEqual(["help", "todo", "home", "quick", "habits", "tags", "archive", "settings"]);
  });

  it("ignores unknown and repeated names, so an older or newer saved order still works", () => {
    expect(menuOrder("inbox,todo,todo,,home")).toEqual(["todo", "home", "quick", "habits", "tags", "archive", "settings", "help"]);
  });

  it("saves the usual order as nothing, so later additions keep their default place", () => {
    expect(saveMenuOrder([...MENU_ITEMS])).toBe("");
    expect(saveMenuOrder(moveItem([...MENU_ITEMS], 1, 0))).toBe("todo,home,quick,habits,tags,archive,settings,help");
  });

  it("moves one item and leaves the list alone for moves out of range", () => {
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    const items = ["a", "b"];
    expect(moveItem(items, 0, 2)).toBe(items);
    expect(moveItem(items, -1, 0)).toBe(items);
  });
});
