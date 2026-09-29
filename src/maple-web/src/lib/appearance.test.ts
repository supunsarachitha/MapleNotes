import { afterEach, describe, expect, it } from "vitest";
import { applyAppearance, applySavedAppearance } from "./appearance";

afterEach(() => {
  localStorage.clear();
  applyAppearance("System", "Maple");
});

describe("appearance", () => {
  it("marks a chosen theme and accent on the page, and leaves System to the device", () => {
    const root = document.documentElement;

    applyAppearance("Dark", "Forest");
    expect([root.classList.contains("dark"), root.classList.contains("light"), root.dataset.accent]).toEqual([true, false, "forest"]);

    applyAppearance("Light", "Ocean");
    expect([root.classList.contains("dark"), root.classList.contains("light"), root.dataset.accent]).toEqual([false, true, "ocean"]);

    applyAppearance("System", "Maple");
    expect([root.classList.contains("dark"), root.classList.contains("light"), root.dataset.accent]).toEqual([false, false, undefined]);
  });

  it("starts with the appearance remembered on this device, ignoring anything unknown", () => {
    localStorage.setItem("maple-notes:appearance", JSON.stringify({ theme: "Dark", accent: "Plum" }));
    applySavedAppearance();
    expect([document.documentElement.classList.contains("dark"), document.documentElement.dataset.accent]).toEqual([true, "plum"]);

    localStorage.setItem("maple-notes:appearance", JSON.stringify({ theme: "Dark", accent: "Neon" }));
    applySavedAppearance();
    expect(document.documentElement.dataset.accent).toBeUndefined();

    localStorage.setItem("maple-notes:appearance", "not json");
    applySavedAppearance();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
