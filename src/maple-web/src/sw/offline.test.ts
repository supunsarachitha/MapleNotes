// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import {
  apiKind,
  DATA_CACHE,
  dropOldShells,
  handleApi,
  handleShell,
  isShellRequest,
  MAX_SAVED_READS,
  OFFLINE_HEADER,
  saveShell,
  shellCache,
  type OfflineDeps,
  type Shell,
} from "./offline";

const ORIGIN = "https://notes.example";
const url = (path: string) => new URL(path, ORIGIN).href;

/** Cache Storage as the worker sees it, in memory; keys keep the order entries were last written in. */
class FakeCache {
  readonly entries = new Map<string, { body: ArrayBuffer; status: number; headers: [string, string][] }>();
  private key(request: RequestInfo | URL): string {
    return url(typeof request === "string" ? request : request instanceof URL ? request.href : request.url);
  }
  async match(request: RequestInfo | URL): Promise<Response | undefined> {
    const saved = this.entries.get(this.key(request));
    return saved && new Response(saved.body.byteLength ? saved.body : null, { status: saved.status, headers: saved.headers });
  }
  async put(request: RequestInfo | URL, response: Response): Promise<void> {
    const key = this.key(request);
    const entry = { body: await response.arrayBuffer(), status: response.status, headers: [...response.headers] };
    this.entries.delete(key);
    this.entries.set(key, entry);
  }
  async delete(request: RequestInfo | URL): Promise<boolean> {
    return this.entries.delete(this.key(request));
  }
  async keys(): Promise<Request[]> {
    return [...this.entries.keys()].map((key) => new Request(key));
  }
}

class FakeCaches {
  readonly stores = new Map<string, FakeCache>();
  async open(name: string): Promise<Cache> {
    if (!this.stores.has(name)) this.stores.set(name, new FakeCache());
    return this.stores.get(name) as unknown as Cache;
  }
  async delete(name: string): Promise<boolean> {
    return this.stores.delete(name);
  }
  async keys(): Promise<string[]> {
    return [...this.stores.keys()];
  }
}

/** A server that answers from a table of paths, or is unreachable when `online` is false. */
function setUp() {
  const caches = new FakeCaches();
  const routes = new Map<string, () => Response>();
  const state = { online: true };
  const deps: OfflineDeps = {
    origin: ORIGIN,
    caches,
    fetch: async (request) => {
      if (!state.online) throw new TypeError("Failed to fetch");
      const route = routes.get(`${request.method} ${new URL(request.url).pathname}${new URL(request.url).search}`);
      return route ? route() : new Response(null, { status: 404 });
    },
  };
  const send = async (path: string, init?: RequestInit) => {
    const request = new Request(url(path), init);
    const kind = apiKind(request, ORIGIN);
    if (!kind) throw new Error(`${path} is not handled`);
    return handleApi(request, kind, deps);
  };
  const saved = () => [...(caches.stores.get(DATA_CACHE)?.entries.keys() ?? [])].map((key) => key.slice(ORIGIN.length));
  return { caches, routes, state, deps, send, saved };
}

const user = (id = "u1", encryptionMode = "AtRest") => ({ id, username: "maple", encryptionMode });
const status = (body: object) => () => Response.json({ setupRequired: false, registrationOpen: false, ...body });

describe("offline reading in the service worker", () => {
  let t: ReturnType<typeof setUp>;
  beforeEach(() => {
    t = setUp();
    t.routes.set("GET /api/v1/auth/status", status({ user: user(), sessionPersistent: true }));
    t.routes.set("GET /api/v1/notes?state=active", () => Response.json({ items: [{ id: "n1", content: "hello" }] }));
  });

  it("answers reads from the server, and from the copy it saved once the server cannot be reached", async () => {
    await t.send("/api/v1/auth/status");
    const online = await t.send("/api/v1/notes?state=active");
    expect(online.headers.get(OFFLINE_HEADER)).toBeNull();

    t.state.online = false;
    const offline = await t.send("/api/v1/notes?state=active");
    const offlineStatus = await t.send("/api/v1/auth/status");

    expect(await offline.json()).toEqual({ items: [{ id: "n1", content: "hello" }] });
    expect(offline.headers.get(OFFLINE_HEADER)).toBe("1");
    expect(((await offlineStatus.json()) as { user: { id: string } }).user.id).toBe("u1");
    expect((await t.send("/api/v1/notes?state=archived")).type).toBe("error"); // never read: nothing to show
  });

  it("keeps nothing for a session that ends with the browser", async () => {
    t.routes.set("GET /api/v1/auth/status", status({ user: user(), sessionPersistent: false }));
    await t.send("/api/v1/auth/status");
    await t.send("/api/v1/notes?state=active");

    expect(t.saved()).toEqual([]);
    t.state.online = false;
    expect((await t.send("/api/v1/notes?state=active")).type).toBe("error");
  });

  it.each([
    ["the session has ended", status({ user: null })],
    ["another account signed in", status({ user: user("u2"), sessionPersistent: true })],
    ["the account switched to end-to-end encryption", status({ user: user("u1", "EndToEnd"), sessionPersistent: true })],
    ["the session no longer outlives the browser", status({ user: user(), sessionPersistent: false })],
  ])("deletes what it saved when %s", async (_, next) => {
    await t.send("/api/v1/auth/status");
    await t.send("/api/v1/notes?state=active");
    expect(t.saved()).toContain("/api/v1/notes?state=active");

    t.routes.set("GET /api/v1/auth/status", next);
    await t.send("/api/v1/auth/status");

    expect(t.saved()).not.toContain("/api/v1/notes?state=active");
  });

  it("deletes what it saved when a read gets 401", async () => {
    await t.send("/api/v1/auth/status");
    await t.send("/api/v1/notes?state=active");
    t.routes.set("GET /api/v1/notes?state=active", () => new Response(null, { status: 401 }));

    await t.send("/api/v1/notes?state=active");

    expect(t.saved()).toEqual([]);
  });

  it("deletes what it saved on sign-out, even when the server cannot be reached", async () => {
    await t.send("/api/v1/auth/status");
    await t.send("/api/v1/notes?state=active");
    t.state.online = false;

    await t.send("/api/v1/auth/logout", { method: "POST" }).catch(() => undefined);

    expect(t.caches.stores.has(DATA_CACHE)).toBe(false);
  });

  it("does not save a read that arrives after a sign-out", async () => {
    await t.send("/api/v1/auth/status");
    let answer!: () => void;
    t.routes.set("GET /api/v1/notes?state=trashed", () => Response.json({ items: [] }));
    const slow = t.deps.fetch;
    t.deps.fetch = async (request) => {
      if (new URL(request.url).search === "?state=trashed") await new Promise<void>((resolve) => (answer = resolve));
      return slow(request);
    };

    const reading = t.send("/api/v1/notes?state=trashed");
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.send("/api/v1/auth/logout", { method: "POST" });
    answer();
    await reading;

    expect(t.saved()).toEqual([]);
  });

  it("keeps the password settings of the account it saves for, so the password unlocks offline", async () => {
    t.routes.set("POST /api/v1/auth/prelogin", () => Response.json({ kdf: { salt: "c2FsdA==" }, upgrade: false }));
    t.routes.set("GET /api/v1/account/e2ee", () => Response.json({ wrappedKey: "AQID" }));
    await t.send("/api/v1/auth/status");
    const prelogin = (username: string) =>
      t.send("/api/v1/auth/prelogin", { method: "POST", body: JSON.stringify({ username }), headers: { "Content-Type": "application/json" } });
    await prelogin("someone-else");
    await prelogin("MAPLE");
    await t.send("/api/v1/account/e2ee");

    t.state.online = false;
    expect((await (await prelogin("maple")).json()) as object).toEqual({ kdf: { salt: "c2FsdA==" }, upgrade: false });
    expect((await prelogin("someone-else")).type).toBe("error");
    expect(await (await t.send("/api/v1/account/e2ee")).json()).toEqual({ wrappedKey: "AQID" });
  });

  it("keeps only the most recent reads", async () => {
    await t.send("/api/v1/auth/status");
    for (let i = 0; i < MAX_SAVED_READS + 5; i++) {
      t.routes.set(`GET /api/v1/notes/daily/day-${i}`, () => Response.json({ id: `d${i}` }));
      await t.send(`/api/v1/notes/daily/day-${i}`);
    }

    const reads = t.saved().filter((path) => path.startsWith("/api/v1/notes"));
    expect(reads).toHaveLength(MAX_SAVED_READS);
    expect(reads).not.toContain("/api/v1/notes/daily/day-0");
    expect(t.saved()).toContain("/api/v1/auth/status"); // never pushed out
  });

  it("leaves files, searches, secrets and administration to the network", () => {
    for (const path of [
      "/api/v1/auth/session-key",
      "/api/v1/auth/antiforgery",
      "/api/v1/attachments/0190a5d0-0000-7000-8000-000000000000",
      "/api/v1/notes?state=active&q=secret",
      "/api/v1/admin/users",
      "/api/v1/link-preview?url=https%3A%2F%2Fexample.com",
      "/api/v1/notesextra",
    ]) {
      expect(apiKind(new Request(url(path)), ORIGIN), path).toBeNull();
    }
    expect(apiKind(new Request(url("/api/v1/notes"), { method: "POST" }), ORIGIN)).toBeNull();
    expect(apiKind(new Request("https://elsewhere.example/api/v1/notes"), ORIGIN)).toBeNull();
  });
});

describe("the app's files in the service worker", () => {
  const shell: Shell = { version: "v2", files: ["/assets/index-abc.js", "/favicon.svg"] };
  let t: ReturnType<typeof setUp>;
  const page = () => new Response("<!doctype html><title>Maple Notes</title>", { headers: { "Content-Type": "text/html" } });

  beforeEach(() => {
    t = setUp();
    t.routes.set("GET /", page);
    t.routes.set("GET /assets/index-abc.js", () => new Response("console.log(1)"));
    t.routes.set("GET /favicon.svg", () => new Response("<svg/>"));
  });

  const navigate = (path: string) => {
    const request = new Request(url(path));
    Object.defineProperty(request, "mode", { value: "navigate" }); // Node's Request cannot be built as a navigation
    return request;
  };

  it("opens the app without a connection: any route gets the saved page", async () => {
    await saveShell(shell, t.deps);
    t.state.online = false;

    const response = await handleShell(navigate("/settings/encryption"), shell, t.deps);
    const script = await handleShell(new Request(url("/assets/index-abc.js")), shell, t.deps);

    expect(await response.text()).toContain("<title>Maple Notes</title>");
    expect(await script.text()).toBe("console.log(1)");
  });

  it("saves the lazily loaded pages when it installs, so they open offline without an earlier visit", async () => {
    const split: Shell = { version: "v3", files: ["/assets/index-abc.js", "/assets/SettingsPage-def.js"] };
    t.routes.set("GET /assets/SettingsPage-def.js", () => new Response("export const SettingsPage = 1"));
    await saveShell(split, t.deps);
    t.state.online = false;

    expect(isShellRequest(new Request(url("/assets/SettingsPage-def.js")), ORIGIN, split)).toBe(true);
    const chunk = await handleShell(new Request(url("/assets/SettingsPage-def.js")), split, t.deps);

    expect(await chunk.text()).toBe("export const SettingsPage = 1");
  });

  it("handles navigations and its own files, but never the API or end-to-end files", () => {
    expect(isShellRequest(navigate("/todo"), ORIGIN, shell)).toBe(true);
    expect(isShellRequest(new Request(url("/favicon.svg")), ORIGIN, shell)).toBe(true);
    expect(isShellRequest(navigate("/api/v1/export"), ORIGIN, shell)).toBe(false);
    expect(isShellRequest(navigate("/e2ee/export/abc"), ORIGIN, shell)).toBe(false);
    expect(isShellRequest(new Request(url("/api/v1/branding/icon")), ORIGIN, shell)).toBe(false);
    expect(isShellRequest(navigate("/"), ORIGIN, { version: "dev", files: [] })).toBe(false); // development
  });

  it("keeps the installed version when a file of the new one cannot be fetched, so the app still opens offline", async () => {
    const old: Shell = { version: "v1", files: ["/assets/index-old.js"] };
    t.routes.set("GET /assets/index-old.js", () => new Response("console.log(0)"));
    await saveShell(old, t.deps);
    // The update downloads while the connection drops: the page never arrives.
    t.routes.set("GET /", () => new Response(null, { status: 502 }));

    await expect(saveShell(shell, t.deps)).rejects.toThrow();

    // The install failed, so the browser keeps the old worker; its copy is whole and no partial copy is left behind.
    expect(await t.caches.keys()).toEqual([shellCache(old)]);
    t.state.online = false;
    const response = await handleShell(navigate("/"), old, t.deps);
    expect(await response.text()).toContain("<title>Maple Notes</title>");
  });

  it("does not keep a newer version's page, whose scripts it has not saved, in place of its own", async () => {
    const old: Shell = { version: "v1", files: ["/assets/index-old.js"] };
    const pageOf = (script: string) => () =>
      new Response(`<!doctype html><title>Maple Notes</title><script type="module" src="${script}"></script>`, {
        headers: { "Content-Type": "text/html" },
      });
    t.routes.set("GET /", pageOf("/assets/index-old.js"));
    t.routes.set("GET /assets/index-old.js", () => new Response("console.log(0)"));
    await saveShell(old, t.deps);
    // The server was updated; the old worker still answers the first visit (its successor installs meanwhile).
    t.routes.set("GET /", pageOf("/assets/index-new.js"));
    expect(await (await handleShell(navigate("/"), old, t.deps)).text()).toContain("index-new.js");

    t.state.online = false;
    const offline = await (await handleShell(navigate("/"), old, t.deps)).text();

    expect(offline).toContain("/assets/index-old.js");
    expect(await (await handleShell(new Request(url("/assets/index-old.js")), old, t.deps)).text()).toBe("console.log(0)");
  });

  it("fails the install when the connection goes away while it downloads", async () => {
    t.routes.set("GET /favicon.svg", () => {
      t.state.online = false; // every later request fails
      return new Response("<svg/>");
    });

    await expect(saveShell({ version: "v2", files: ["/favicon.svg", "/assets/index-abc.js"] }, t.deps)).rejects.toThrow();
    expect(await t.caches.keys()).toEqual([]);
  });

  it("tries a dropped request once more before giving up", async () => {
    let calls = 0;
    t.routes.set("GET /assets/index-abc.js", () => {
      calls += 1;
      return calls === 1 ? new Response(null, { status: 503 }) : new Response("console.log(1)");
    });

    await saveShell(shell, t.deps);
    t.state.online = false;

    expect(calls).toBe(2);
    expect(await (await handleShell(new Request(url("/assets/index-abc.js")), shell, t.deps)).text()).toBe("console.log(1)");
  });

  it("does not take a page that is not the app (a proxy's sign-in or error page) as the app's page", async () => {
    t.routes.set("GET /", () => Response.json({ error: "Forbidden" }));

    await expect(saveShell(shell, t.deps)).rejects.toThrow();
    expect(await t.caches.keys()).toEqual([]);
  });

  it("removes the files of earlier versions", async () => {
    await saveShell({ version: "v1", files: ["/favicon.svg"] }, t.deps);
    await saveShell(shell, t.deps);

    await dropOldShells(shell, t.deps);

    expect(await t.caches.keys()).toEqual([shellCache(shell)]);
  });
});
