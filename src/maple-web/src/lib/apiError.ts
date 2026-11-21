import { CONFIRMATION_REQUIRED, SECOND_FACTOR_ENROLMENT_REQUIRED, type ProblemDetails } from "./types";

/** HTTP 507: the change does not fit in the account's storage limit. */
export const STORAGE_FULL = 507;

/** The title ASP.NET gives every validation problem; it says nothing, so the first field error is shown instead. */
export const GENERIC_VALIDATION_TITLE = "One or more validation errors occurred.";

/** The first message among the problem's field errors, if any. */
function firstFieldError(problem: ProblemDetails): string | undefined {
  return Object.values(problem.errors ?? {}).find((messages) => messages?.length)?.[0];
}

function messageOf(status: number, problem: ProblemDetails): string {
  if (status === STORAGE_FULL) {
    return [problem.title ?? "There is not enough room in your storage.", problem.detail].filter(Boolean).join(" ");
  }
  if (!problem.title || problem.title === GENERIC_VALIDATION_TITLE) {
    const field = firstFieldError(problem);
    if (field) return field;
  }
  return problem.title ?? (status === 0 ? "Cannot reach the server." : `Request failed (${status}).`);
}

/** An API error with the server's problem details (title, field errors). */
export class ApiError extends Error {
  readonly status: number;
  readonly problem: ProblemDetails;

  constructor(status: number, problem: ProblemDetails) {
    super(messageOf(status, problem));
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

/** Whether sign-in (or a reset with the recovery key) needs a two-factor code: none was sent, or it was wrong. */
export function isTwoFactorRequired(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 401 && error.problem.twoFactorRequired === true;
}

/** Whether a request was refused because the account must set up two-factor sign-in or a passkey first. */
export function isEnrolmentRequired(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 403 && error.problem.code === SECOND_FACTOR_ENROLMENT_REQUIRED;
}

/** Whether a request was refused because this session must confirm it is its owner first (lib/confirmation.ts). */
export function isConfirmationRequired(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 403 && error.problem.code === CONFIRMATION_REQUIRED;
}
