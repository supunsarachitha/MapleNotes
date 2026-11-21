import { describe, expect, it } from "vitest";
import { ApiError, GENERIC_VALIDATION_TITLE, STORAGE_FULL } from "./apiError";

describe("ApiError message", () => {
  it("shows the first field error instead of the generic validation title", () => {
    const error = new ApiError(400, {
      title: GENERIC_VALIDATION_TITLE,
      errors: { passkey: ["This passkey has already been added."] },
    });
    expect(error.message).toBe("This passkey has already been added.");
    expect(error.fieldError("passkey")).toBe("This passkey has already been added.");
  });

  it("skips fields without messages", () => {
    const error = new ApiError(400, { title: GENERIC_VALIDATION_TITLE, errors: { name: [], passkey: ["Expired."] } });
    expect(error.message).toBe("Expired.");
  });

  it("uses a field error when there is no title", () => {
    expect(new ApiError(400, { errors: { credential: ["The passkey is missing."] } }).message).toBe("The passkey is missing.");
  });

  it("keeps a specific title", () => {
    const error = new ApiError(401, { title: "This passkey could not sign you in.", errors: { x: ["other"] } });
    expect(error.message).toBe("This passkey could not sign you in.");
  });

  it("keeps the generic title when there are no field errors", () => {
    expect(new ApiError(400, { title: GENERIC_VALIDATION_TITLE }).message).toBe(GENERIC_VALIDATION_TITLE);
  });

  it("falls back for status 0 and unknown failures", () => {
    expect(new ApiError(0, {}).message).toBe("Cannot reach the server.");
    expect(new ApiError(500, {}).message).toBe("Request failed (500).");
  });

  it("keeps the storage-full wording", () => {
    expect(new ApiError(STORAGE_FULL, { detail: "Delete something." }).message).toBe(
      "There is not enough room in your storage. Delete something.",
    );
  });
});
