import type { ProblemDetails } from "./types";

/** An API error with the server's problem details (title, field errors). */
export class ApiError extends Error {
  readonly status: number;
  readonly problem: ProblemDetails;

  constructor(status: number, problem: ProblemDetails) {
    super(problem.title ?? (status === 0 ? "Cannot reach the server." : `Request failed (${status}).`));
    this.name = "ApiError";
    this.status = status;
    this.problem = problem;
  }

  /** The first error message for a request field (camelCase), if any. */
  fieldError(field: string): string | undefined {
    return this.problem.errors?.[field]?.[0];
  }
}
