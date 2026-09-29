import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, refreshAntiforgeryToken, request } from "./api";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("api client", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValueOnce(json({ token: "token-1", headerName: "X-XSRF-TOKEN" }));
    await refreshAntiforgeryToken();
    fetchMock.mockClear();
  });

  it("sends the antiforgery token with state-changing requests but not with reads", async () => {
    fetchMock.mockResolvedValueOnce(json({ items: [], nextCursor: null }));
    fetchMock.mockResolvedValueOnce(json({ id: "n1", content: "hello", tags: [], attachments: [] }, 201));

    await api.listNotes({ state: "feed" });
    await api.createNote("hello", []);

    const [, readInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const [, writeInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(readInit.headers).not.toHaveProperty("X-XSRF-TOKEN");
    expect(writeInit.headers).toHaveProperty("X-XSRF-TOKEN", "token-1");
  });

  it("builds list queries without empty parameters", async () => {
    fetchMock.mockResolvedValueOnce(json({ items: [], nextCursor: null }));

    await api.listNotes({ state: "active", tag: "work", q: undefined, cursor: undefined, limit: 20 });

    const url = new URL(fetchMock.mock.calls[0]?.[0] as string, "http://localhost");
    expect(url.pathname).toBe("/api/v1/notes");
    expect(Object.fromEntries(url.searchParams)).toEqual({ state: "active", tag: "work", limit: "20" });
  });

  it("refreshes a stale antiforgery token once and retries", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ title: "Missing or invalid antiforgery token." }, 400))
      .mockResolvedValueOnce(json({ token: "token-2", headerName: "X-XSRF-TOKEN" }))
      .mockResolvedValueOnce(json({ id: "n1" }, 201));

    await request("POST", "/api/v1/notes", { content: "x" });

    const [, retryInit] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(retryInit.headers).toHaveProperty("X-XSRF-TOKEN", "token-2");
  });

  it("turns problem details into an ApiError with field errors", async () => {
    fetchMock.mockResolvedValueOnce(json({ title: "Invalid", errors: { content: ["Write something or attach a file."] } }, 400));

    const error = await request("POST", "/api/v1/notes", { content: "" }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(400);
    expect((error as ApiError).fieldError("content")).toBe("Write something or attach a file.");
  });

  it("reports network failures clearly", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const error = await api.status().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(0);
    expect((error as ApiError).message).toMatch(/cannot reach the server/i);
  });
});
