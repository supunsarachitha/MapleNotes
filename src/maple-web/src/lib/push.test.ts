import { describe, expect, it } from "vitest";
import { notificationFor, openUrl, readPayload } from "../sw/notify";
import { deviceName } from "./push";
import { presets } from "./reminders";

describe("notifications", () => {
  it("names devices from the browser", () => {
    expect(deviceName("Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36")).toBe("Chrome on Android");
    expect(deviceName("Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1")).toBe("Safari on iPhone");
    expect(deviceName("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 Edg/141.0")).toBe("Edge on Windows");
    expect(deviceName("Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0")).toBe("Firefox on Linux");
  });

  it("shows what the server sends, opens the note on a tap, and never shows nothing", () => {
    const id = "01933b5e-6f00-7000-8000-000000000001";
    const shown = notificationFor(readPayload(JSON.stringify({ title: "Reminder", body: "Buy maple syrup", noteId: id, tag: `reminder-${id}` })));
    expect(shown.title).toBe("Reminder");
    expect(shown.options).toMatchObject({ body: "Buy maple syrup", tag: `reminder-${id}`, data: { url: `/reminders?note=${id}` } });
    expect(readPayload("not json")).toEqual({ title: "Maple Notes", body: "You have a reminder." });
    expect(openUrl("../../evil")).toBe("/reminders");
  });

  it("offers quick reminder times in the chosen time zone", () => {
    // Saturday 7 November 2026, 13:00 in Colombo (07:30 UTC).
    const choices = presets(new Date("2026-11-07T07:30:00Z"), "Asia/Colombo");
    expect(choices).toEqual([
      { label: "Later today, 16:00", at: "2026-11-07T16:00" },
      { label: "Tomorrow, 09:00", at: "2026-11-08T09:00" },
      { label: "Next Monday, 09:00", at: "2026-11-09T09:00" },
    ]);
    // Late in the evening there is no "later today"; at the end of a month "tomorrow" is the 1st.
    expect(presets(new Date("2026-11-30T20:00:00Z"), "UTC").map((c) => c.at)).toEqual(["2026-12-01T09:00", "2026-12-07T09:00"]);
  });
});
