import type { ProblemDetails } from "./types";

/** HTTP 507: the change does not fit in the account's storage limit. */
export const STORAGE_FULL = 507;

/** An API error with the server's problem details (title, field errors). */
export class ApiError extends Error {
  readonly status: number;
  readonly problem: ProblemDetails;

  constructor(status: number, problem: ProblemDetails) {
    super(
      status === STORAGE_FULL
        ? [problem.title ?? "There is not enough room in your storage.", problem.detail].filter(Boolean).join(" ")
        : (problem.title ?? (status === 0 ? "Cannot reach the server." : `Request failed (${status}).`)),
    );
    this.name = "ApiError";
    this.status = status;
    this.problem = problem;
  }

  /** The first error message for a request field (camelCase), if any. */
  fieldError(field: string): string | undefined {
    return this.problem.errors?.[field]?.[0];
  }
}

/** Whether a request failed because the account's storage limit leaves no room for it. */
export function isStorageFull(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === STORAGE_FULL;
}

/** What to tell the user when a save fails: why, when the storage is full, or the fallback for anything else. */
export function saveErrorMessage(error: unknown, fallback: string): string {
  return isStorageFull(error) ? error.message : fallback;
}
