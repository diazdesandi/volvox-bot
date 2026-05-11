import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getBotInviteUrl, getGuildIconUrl } from "@/lib/discord";
import {
  fetchUserGuilds,
  fetchBotGuilds,
  getMutualGuilds,
  fetchWithRateLimit,
  BOT_GUILD_ACCESS_FALLBACK_TIMEOUT_MS,
  USER_GUILDS_REQUEST_TIMEOUT_MS,
} from "@/lib/discord.server";

const MANAGE_CHANNELS_PERMISSION = 1n << 4n;

function getTestFilePath(importMetaUrl: string): string {
  const url = new URL(importMetaUrl);

  if (url.pathname.startsWith("/@fs/")) {
    return fileURLToPath(new URL(`file://${url.pathname.slice("/@fs".length)}`));
  }

  return fileURLToPath(url);
}

const repoRoot = resolve(dirname(getTestFilePath(import.meta.url)), "../../..");
const gettingStartedDocPath = resolve(repoRoot, "docs/getting-started.mdx");

function getPermissionsFromInviteUrl(inviteUrl: string): bigint {
  const permissions = new URL(inviteUrl).searchParams.get("permissions");
  if (!permissions) throw new Error("Invite URL is missing permissions");

  return BigInt(permissions);
}

describe("getGuildIconUrl", () => {
  it("returns null when no icon hash is provided", () => {
    const url = getGuildIconUrl("123", null);
    expect(url).toBeNull();
  });

  it("returns null for all guilds without an icon hash", () => {
    const url0 = getGuildIconUrl("0", null);
    const url1 = getGuildIconUrl("1", null);
    const url4 = getGuildIconUrl("4", null);
    expect(url0).toBeNull();
    expect(url1).toBeNull();
    expect(url4).toBeNull();
  });

  it("returns webp icon for non-animated hash", () => {
    const url = getGuildIconUrl("123", "abc123", 128);
    expect(url).toBe(
      "https://cdn.discordapp.com/icons/123/abc123.webp?size=128",
    );
  });

  it("returns gif icon for animated hash", () => {
    const url = getGuildIconUrl("123", "a_abc123", 64);
    expect(url).toBe(
      "https://cdn.discordapp.com/icons/123/a_abc123.gif?size=64",
    );
  });

  it("defaults to size 128", () => {
    const url = getGuildIconUrl("123", "abc123");
    expect(url).toContain("size=128");
  });
});

describe("getBotInviteUrl", () => {
  const originalClientId = process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID;

  afterEach(() => {
    if (originalClientId === undefined) {
      delete process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID;
      return;
    }

    process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID = originalClientId;
  });

  it("requests Manage Channels so channel-mode tickets can create channels", () => {
    process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID = "test-client-id";

    const inviteUrl = getBotInviteUrl();

    expect(inviteUrl).not.toBeNull();
    expect(getPermissionsFromInviteUrl(inviteUrl ?? "") & MANAGE_CHANNELS_PERMISSION).toBe(
      MANAGE_CHANNELS_PERMISSION,
    );
  });

  it("keeps the getting started invite link in sync with the generated permission mask", () => {
    process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID = "test-client-id";

    const inviteUrl = getBotInviteUrl();
    const permissions = inviteUrl ? new URL(inviteUrl).searchParams.get("permissions") : null;
    const gettingStartedDoc = readFileSync(gettingStartedDocPath, "utf8");

    expect(permissions).not.toBeNull();
    expect(gettingStartedDoc).toContain(`permissions=${permissions}`);
  });

  it("returns null when NEXT_PUBLIC_DISCORD_CLIENT_ID is not set", () => {
    delete process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID;

    const inviteUrl = getBotInviteUrl();

    expect(inviteUrl).toBeNull();
  });

  it("embeds the client ID in the generated URL", () => {
    process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID = "my-unique-client-99";

    const inviteUrl = getBotInviteUrl();

    expect(inviteUrl).not.toBeNull();
    expect(new URL(inviteUrl!).searchParams.get("client_id")).toBe("my-unique-client-99");
  });

  it("includes bot and applications.commands in the scope", () => {
    process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID = "test-client-id";

    const inviteUrl = getBotInviteUrl();

    expect(inviteUrl).not.toBeNull();
    const scope = new URL(inviteUrl!).searchParams.get("scope");
    expect(scope).toContain("bot");
    expect(scope).toContain("applications.commands");
  });

  it("encodes the exact permission value 1099511704598 (regression guard for permission mask)", () => {
    process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID = "test-client-id";

    const inviteUrl = getBotInviteUrl();

    expect(inviteUrl).not.toBeNull();
    const permissions = getPermissionsFromInviteUrl(inviteUrl!);
    expect(permissions).toBe(1099511704598n);
  });

  it("includes all required individual permissions in the mask", () => {
    process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID = "test-client-id";

    const inviteUrl = getBotInviteUrl();
    expect(inviteUrl).not.toBeNull();

    const permissions = getPermissionsFromInviteUrl(inviteUrl!);

    const KICK_MEMBERS      = 1n << 1n;   //           2
    const BAN_MEMBERS       = 1n << 2n;   //           4
    const MANAGE_CHANNELS   = 1n << 4n;   //          16
    const VIEW_CHANNELS     = 1n << 10n;  //       1,024
    const SEND_MESSAGES     = 1n << 11n;  //       2,048
    const MANAGE_MESSAGES   = 1n << 13n;  //       8,192
    const READ_MSG_HISTORY  = 1n << 16n;  //      65,536
    const MODERATE_MEMBERS  = 1n << 40n;  // 1,099,511,627,776

    for (const [name, bit] of [
      ["Kick Members", KICK_MEMBERS],
      ["Ban Members", BAN_MEMBERS],
      ["Manage Channels", MANAGE_CHANNELS],
      ["View Channels", VIEW_CHANNELS],
      ["Send Messages", SEND_MESSAGES],
      ["Manage Messages", MANAGE_MESSAGES],
      ["Read Message History", READ_MSG_HISTORY],
      ["Moderate Members", MODERATE_MEMBERS],
    ] as [string, bigint][]) {
      expect(permissions & bit, `Expected ${name} bit to be set`).toBe(bit);
    }
  });

  it("uses the discord.com OAuth2 authorize endpoint", () => {
    process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID = "test-client-id";

    const inviteUrl = getBotInviteUrl();

    expect(inviteUrl).not.toBeNull();
    const url = new URL(inviteUrl!);
    expect(url.hostname).toBe("discord.com");
    expect(url.pathname).toBe("/api/oauth2/authorize");
  });
});

describe("fetchWithRateLimit", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchSpy = vi.spyOn(global, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    vi.useRealTimers();
  });

  it("returns response directly when not rate limited", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: "ok" }),
    } as Response);

    const response = await fetchWithRateLimit("https://example.com/api");
    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("retries on 429 with retry-after header", async () => {
    const headers = new Map([["retry-after", "0.01"]]);
    let callCount = 0;
    fetchSpy.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          status: 429,
          headers: { get: (key: string) => headers.get(key) ?? null },
        } as unknown as Response);
      }
      return Promise.resolve({ ok: true, status: 200 } as Response);
    });

    const promise = fetchWithRateLimit("https://example.com/api");
    // Advance timers to allow retries
    await vi.advanceTimersByTimeAsync(100);
    const response = await promise;
    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("parses retry-after header as seconds and waits", async () => {
    const headers = new Map([["retry-after", "0.001"]]); // 1ms
    let callCount = 0;
    fetchSpy.mockImplementation(() => {
      callCount++;
      if (callCount <= 2) {
        return Promise.resolve({
          status: 429,
          headers: { get: (key: string) => headers.get(key) ?? null },
        } as unknown as Response);
      }
      return Promise.resolve({ ok: true, status: 200 } as Response);
    });

    const promise = fetchWithRateLimit("https://example.com/api");
    await vi.advanceTimersByTimeAsync(100);
    const response = await promise;
    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("returns 429 after exhausting max retries", async () => {
    const headers = new Map([["retry-after", "0.001"]]);
    fetchSpy.mockResolvedValue({
      status: 429,
      headers: { get: (key: string) => headers.get(key) ?? null },
    } as unknown as Response);

    const promise = fetchWithRateLimit("https://example.com/api");
    await vi.advanceTimersByTimeAsync(100);
    const response = await promise;
    expect(response.status).toBe(429);
    // 1 initial + 3 retries = 4 total calls
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });

  it("does not retry when retry-after exceeds the allowed delay cap", async () => {
    const headers = new Map([["retry-after", "728"]]);
    fetchSpy.mockResolvedValue({
      status: 429,
      headers: { get: (key: string) => headers.get(key) ?? null },
    } as unknown as Response);

    const response = await fetchWithRateLimit("https://example.com/api");
    expect(response.status).toBe(429);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("does not retry when the next wait would exceed the remaining retry budget", async () => {
    const headers = new Map([["retry-after", "1.5"]]);
    let callCount = 0;
    fetchSpy.mockImplementation(() => {
      callCount++;
      if (callCount <= 2) {
        return Promise.resolve({
          status: 429,
          headers: { get: (key: string) => headers.get(key) ?? null },
        } as unknown as Response);
      }
      return Promise.resolve({ ok: true, status: 200 } as Response);
    });

    const promise = fetchWithRateLimit("https://example.com/api", {
      rateLimit: {
        maxRetries: 3,
        maxRetryDelayMs: 2_000,
        totalRetryBudgetMs: 2_000,
      },
    });

    await vi.advanceTimersByTimeAsync(1_600);
    const response = await promise;
    expect(response.status).toBe(429);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("aborts sleep when signal fires during rate-limit wait", async () => {
    const controller = new AbortController();
    const headers = new Map([["retry-after", "30"]]); // 30 seconds
    let callCount = 0;
    fetchSpy.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          status: 429,
          headers: { get: (key: string) => headers.get(key) ?? null },
        } as unknown as Response);
      }
      return Promise.resolve({ ok: true, status: 200 } as Response);
    });

    const promise = fetchWithRateLimit("https://example.com/api", {
      signal: controller.signal,
      rateLimit: {
        maxRetryDelayMs: 60_000,
        totalRetryBudgetMs: 60_000,
      },
    });

    // Advance a little, then abort (well before the 30s retry-after)
    await vi.advanceTimersByTimeAsync(100);
    controller.abort(new DOMException("Timed out", "TimeoutError"));

    await expect(promise).rejects.toThrow();
    // Should only have made 1 fetch call (the initial 429), not retried
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("throws immediately if signal already aborted before sleep", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("Already aborted", "AbortError"));

    const headers = new Map([["retry-after", "1"]]);
    fetchSpy.mockResolvedValue({
      status: 429,
      headers: { get: (key: string) => headers.get(key) ?? null },
    } as unknown as Response);

    // Attach rejection handler immediately — no timer advance needed since
    // the signal is already aborted and the throw is synchronous.
    await expect(
      fetchWithRateLimit("https://example.com/api", {
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("cleans up abort listener after rate-limit sleep resolves normally", async () => {
    const controller = new AbortController();
    const removeListenerSpy = vi.spyOn(controller.signal, "removeEventListener");

    const headers = new Map([["retry-after", "0.001"]]);
    let callCount = 0;
    fetchSpy.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          status: 429,
          headers: { get: (key: string) => headers.get(key) ?? null },
        } as unknown as Response);
      }
      return Promise.resolve({ ok: true, status: 200 } as Response);
    });

    const promise = fetchWithRateLimit("https://example.com/api", {
      signal: controller.signal,
    });
    await vi.advanceTimersByTimeAsync(100);
    const response = await promise;
    expect(response.status).toBe(200);
    // The abort listener should have been removed after the sleep resolved
    expect(removeListenerSpy).toHaveBeenCalledWith("abort", expect.any(Function));
    removeListenerSpy.mockRestore();
  });

  it("uses 1000ms default when no retry-after header", async () => {
    let callCount = 0;
    fetchSpy.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          status: 429,
          headers: { get: () => null },
        } as unknown as Response);
      }
      return Promise.resolve({ ok: true, status: 200 } as Response);
    });

    const promise = fetchWithRateLimit("https://example.com/api");
    // Advance past the 1s default wait
    await vi.advanceTimersByTimeAsync(1100);
    const response = await promise;
    expect(response.status).toBe(200);
  });

  it("falls back to x-ratelimit-reset-after when retry-after is malformed", async () => {
    const headers = new Map([
      ["retry-after", "nope"],
      ["x-ratelimit-reset-after", "0.001"],
    ]);
    let callCount = 0;
    fetchSpy.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          status: 429,
          headers: { get: (key: string) => headers.get(key) ?? null },
        } as unknown as Response);
      }
      return Promise.resolve({ ok: true, status: 200 } as Response);
    });

    const promise = fetchWithRateLimit("https://example.com/api");
    await vi.advanceTimersByTimeAsync(100);
    const response = await promise;
    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe("fetchUserGuilds", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("fetches guilds with correct authorization header", async () => {
    const mockGuilds = [
      { id: "1", name: "Test Server", icon: null, owner: true, permissions: "8", features: [] },
    ];

    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockGuilds),
    } as Response);

    const guilds = await fetchUserGuilds("test-token");
    expect(guilds).toEqual(mockGuilds);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/users/@me/guilds"),
      expect.objectContaining({
        headers: {
          Authorization: "Bearer test-token",
        },
      }),
    );
  });

  it("throws on non-OK response", async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    } as Response);

    let thrown: unknown;
    try {
      await fetchUserGuilds("bad-token");
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain("Failed to fetch user guilds");
  });

  it("paginates through multiple pages using after param", async () => {
    // Create 200 guilds for page 1 (triggers pagination)
    const page1 = Array.from({ length: 200 }, (_, i) => ({
      id: String(i + 1),
      name: `Server ${i + 1}`,
      icon: null,
      owner: false,
      permissions: "0",
      features: [],
    }));
    const page2 = [
      { id: "201", name: "Server 201", icon: null, owner: false, permissions: "0", features: [] },
    ];

    let callCount = 0;
    fetchSpy.mockImplementation((url: string | URL | Request) => {
      callCount++;
      const urlStr = url.toString();
      if (callCount === 1) {
        // First call — no "after" param
        expect(urlStr).not.toContain("after=");
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(page1),
        } as Response);
      }
      // Second call — should have "after=200"
      expect(urlStr).toContain("after=200");
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(page2),
      } as Response);
    });

    const guilds = await fetchUserGuilds("test-token");
    expect(guilds).toHaveLength(201);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("supports AbortSignal", async () => {
    const controller = new AbortController();
    controller.abort();

    fetchSpy.mockRejectedValue(new DOMException("Aborted", "AbortError"));

    await expect(fetchUserGuilds("test-token", controller.signal)).rejects.toThrow();
  });

  it("uses a dedicated timeout signal for the shared in-flight guild fetch", async () => {
    vi.useFakeTimers();
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");

    try {
      let sharedSignal: AbortSignal | undefined;
      fetchSpy.mockImplementation((_url: string | URL | Request, init?: RequestInit) => {
        const signal = init?.signal;
        if (!(signal instanceof AbortSignal)) {
          return Promise.reject(
            new Error("Expected shared guild fetch to receive an abort signal"),
          );
        }

        sharedSignal = signal;
        return new Promise<Response>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      });

      const timedOutRequest = fetchUserGuilds("shared-timeout-token");

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(sharedSignal).toBeInstanceOf(AbortSignal);
      expect(sharedSignal?.aborted).toBe(false);

      const timeoutExpectation = expect(timedOutRequest).rejects.toThrow("Timed out");
      await vi.advanceTimersByTimeAsync(10_000);
      await timeoutExpectation;

      expect(sharedSignal?.aborted).toBe(true);
      expect(clearTimeoutSpy).toHaveBeenCalled();

      const mockGuilds = [
        {
          id: "1",
          name: "Retried Server",
          icon: null,
          owner: true,
          permissions: "8",
          features: [],
        },
      ];

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockGuilds),
      } as Response);

      await expect(fetchUserGuilds("shared-timeout-token")).resolves.toEqual(mockGuilds);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    } finally {
      clearTimeoutSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("deduplicates concurrent guild fetches for the same access token", async () => {
    const mockGuilds = [
      { id: "1", name: "Shared Server", icon: null, owner: true, permissions: "8", features: [] },
    ];

    let resolveFetch: ((response: Response) => void) | null = null;
    fetchSpy.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const firstRequest = fetchUserGuilds("shared-token");
    const secondRequest = fetchUserGuilds("shared-token");

    expect(fetchSpy).toHaveBeenCalledTimes(1);

    (resolveFetch as ((response: Response) => void) | null)?.({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockGuilds),
    } as Response);

    await expect(Promise.all([firstRequest, secondRequest])).resolves.toEqual([
      mockGuilds,
      mockGuilds,
    ]);
  });

  it("keeps a shared in-flight guild fetch alive when one caller aborts", async () => {
    const mockGuilds = [
      { id: "1", name: "Shared Server", icon: null, owner: true, permissions: "8", features: [] },
    ];
    const controller = new AbortController();

    let resolveFetch: ((response: Response) => void) | null = null;
    let sharedSignal: AbortSignal | undefined;
    fetchSpy.mockImplementation((_url: string | URL | Request, init?: RequestInit) => {
      const signal = init?.signal;
      sharedSignal = signal instanceof AbortSignal ? signal : undefined;
      return new Promise<Response>((resolve, reject) => {
        resolveFetch = resolve;
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    });

    const abortingRequest = fetchUserGuilds("shared-token-abort", controller.signal);
    const sharedRequest = fetchUserGuilds("shared-token-abort");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(sharedSignal).toBeInstanceOf(AbortSignal);
    expect(sharedSignal).not.toBe(controller.signal);

    const abortExpectation = expect(abortingRequest).rejects.toThrow("Timed out");
    controller.abort(new DOMException("Timed out", "TimeoutError"));
    await abortExpectation;
    expect(sharedSignal?.aborted).toBe(false);

    (resolveFetch as ((response: Response) => void) | null)?.({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockGuilds),
    } as Response);

    await expect(sharedRequest).resolves.toEqual(mockGuilds);
  });
});

describe("fetchBotGuilds", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let savedBotApiUrl: string | undefined;
  let savedBotApiSecret: string | undefined;

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, "fetch");
    savedBotApiUrl = process.env.BOT_API_URL;
    savedBotApiSecret = process.env.BOT_API_SECRET;
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    // Restore env vars to prevent pollution
    if (savedBotApiUrl !== undefined) {
      process.env.BOT_API_URL = savedBotApiUrl;
    } else {
      delete process.env.BOT_API_URL;
    }
    if (savedBotApiSecret !== undefined) {
      process.env.BOT_API_SECRET = savedBotApiSecret;
    } else {
      delete process.env.BOT_API_SECRET;
    }
  });

  it("returns unavailable result when BOT_API_URL is not set", async () => {
    delete process.env.BOT_API_URL;

    const result = await fetchBotGuilds();
    expect(result).toEqual({ available: false, guilds: [] });
  });

  it("returns unavailable result when BOT_API_SECRET is missing", async () => {
    process.env.BOT_API_URL = "http://localhost:3001";
    delete process.env.BOT_API_SECRET;

    const result = await fetchBotGuilds();
    expect(result).toEqual({ available: false, guilds: [] });
  });

  it("returns unavailable result when bot API returns non-OK response", async () => {
    process.env.BOT_API_URL = "http://localhost:3001";
    process.env.BOT_API_SECRET = "test-secret";

    fetchSpy.mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
    } as Response);

    const result = await fetchBotGuilds();
    expect(result).toEqual({ available: false, guilds: [] });
  });

  it("returns unavailable result when bot API is unreachable", async () => {
    process.env.BOT_API_URL = "http://localhost:3001";
    process.env.BOT_API_SECRET = "test-secret";

    fetchSpy.mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await fetchBotGuilds();
    expect(result).toEqual({ available: false, guilds: [] });
  });

  it("forwards AbortSignal to the underlying fetch", async () => {
    process.env.BOT_API_URL = "http://localhost:3001";
    process.env.BOT_API_SECRET = "test-secret";

    const controller = new AbortController();
    controller.abort(new DOMException("Aborted", "AbortError"));

    fetchSpy.mockRejectedValue(new DOMException("Aborted", "AbortError"));

    // fetchBotGuilds catches errors internally and returns unavailable
    const result = await fetchBotGuilds(controller.signal);
    expect(result).toEqual({ available: false, guilds: [] });

    // Verify signal was forwarded to fetch
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:3001/api/v1/guilds",
      expect.objectContaining({
        signal: controller.signal,
      }),
    );
  });

  it("sends x-api-secret header with BOT_API_SECRET", async () => {
    process.env.BOT_API_URL = "http://localhost:3001";
    process.env.BOT_API_SECRET = "my-secret";

    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    } as Response);

    const result = await fetchBotGuilds();
    expect(result).toEqual({ available: true, guilds: [] });

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:3001/api/v1/guilds",
      expect.objectContaining({
        headers: { "x-api-secret": "my-secret" },
      }),
    );
  });

  it("fails fast when bot API retry-after is too large", async () => {
    vi.useFakeTimers();
    try {
      process.env.BOT_API_URL = "http://localhost:3001";
      process.env.BOT_API_SECRET = "test-secret";

      const headers = new Map([["retry-after", "1"]]);
      fetchSpy.mockResolvedValue({
        status: 429,
        ok: false,
        statusText: "Too Many Requests",
        headers: { get: (key: string) => headers.get(key) ?? null },
      } as unknown as Response);

      const result = await fetchBotGuilds();
      expect(result).toEqual({ available: false, guilds: [] });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("getMutualGuilds", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let savedBotApiUrl: string | undefined;
  let savedBotApiSecret: string | undefined;

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, "fetch");
    savedBotApiUrl = process.env.BOT_API_URL;
    savedBotApiSecret = process.env.BOT_API_SECRET;
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    if (savedBotApiUrl !== undefined) {
      process.env.BOT_API_URL = savedBotApiUrl;
    } else {
      delete process.env.BOT_API_URL;
    }
    if (savedBotApiSecret !== undefined) {
      process.env.BOT_API_SECRET = savedBotApiSecret;
    } else {
      delete process.env.BOT_API_SECRET;
    }
  });

  it("returns only guilds where bot is present", async () => {
    const userGuilds = [
      { id: "1", name: "Server 1", icon: "user-icon-hash", owner: true, permissions: "8", features: [] },
      { id: "2", name: "Server 2", icon: null, owner: false, permissions: "0", features: [] },
      { id: "3", name: "Server 3", icon: null, owner: false, permissions: "0", features: [] },
    ];
    const botGuilds = [
      {
        id: "1",
        name: "Server 1",
        icon: "https://cdn.example.com/server-1.webp",
        iconHash: "bot-icon-hash",
        config: { communityHubs: { enabled: true } },
      },
      { id: "3", name: "Server 3", icon: null },
    ];

    process.env.BOT_API_URL = "http://localhost:3001";
    process.env.BOT_API_SECRET = "test-secret";

    fetchSpy.mockImplementation((url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("/users/@me/guilds")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(userGuilds) } as Response);
      }
      if (urlStr.includes("/api/v1/guilds")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(botGuilds) } as Response);
      }
      return Promise.reject(new Error(`Unexpected fetch URL: ${urlStr}`));
    });

    const mutualGuilds = await getMutualGuilds("test-token");

    expect(mutualGuilds).toHaveLength(2);
    expect(mutualGuilds[0].id).toBe("1");
    expect(mutualGuilds[1].id).toBe("3");
    expect(mutualGuilds[0].botPresent).toBe(true);
    expect(mutualGuilds[0].icon).toBe("https://cdn.example.com/server-1.webp");
    expect(mutualGuilds[0].iconHash).toBe("bot-icon-hash");
    expect(mutualGuilds[0].config).toEqual({ communityHubs: { enabled: true } });
  });

  it("looks up bot access only for healthy mutual guild IDs", async () => {
    const userGuilds = [
      { id: "1", name: "Server 1", icon: null, owner: true, permissions: "8", features: [] },
      { id: "2", name: "User Only", icon: null, owner: false, permissions: "0", features: [] },
      { id: "3", name: "Server 3", icon: null, owner: false, permissions: "32", features: [] },
    ];
    const botGuilds = [
      { id: "1", name: "Server 1", icon: null },
      { id: "3", name: "Server 3", icon: null },
      { id: "4", name: "Bot Only", icon: null },
    ];
    let accessGuildIds: string[] | null = null;

    process.env.BOT_API_URL = "http://localhost:3001";
    process.env.BOT_API_SECRET = "test-secret";

    fetchSpy.mockImplementation((url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("/users/@me/guilds")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(userGuilds) } as Response);
      }
      if (urlStr.includes("/api/v1/guilds/access")) {
        accessGuildIds = new URL(urlStr).searchParams.get("guildIds")?.split(",") ?? [];
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve([
              { id: "1", access: "admin", present: true },
              { id: "3", access: "admin", present: false },
            ]),
        } as Response);
      }
      if (urlStr.endsWith("/api/v1/guilds")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(botGuilds) } as Response);
      }
      return Promise.reject(new Error(`Unexpected fetch URL: ${urlStr}`));
    });

    const mutualGuilds = await getMutualGuilds("test-token", undefined, { userId: "user-1" });

    expect(accessGuildIds).toEqual(["1", "3"]);
    expect(mutualGuilds).toEqual([
      expect.objectContaining({ id: "1", access: "admin" }),
      expect.objectContaining({ id: "3", access: "moderator" }),
    ]);
  });

  it("uses a fresh bounded signal for happy-path bot access lookups", async () => {
    vi.useFakeTimers();

    try {
      const userGuilds = [
        { id: "1", name: "Server 1", icon: null, owner: true, permissions: "8", features: [] },
      ];
      const botGuilds = [{ id: "1", name: "Server 1", icon: null }];
      const controller = new AbortController();
      let accessSignal: AbortSignal | null = null;

      process.env.BOT_API_URL = "http://localhost:3001";
      process.env.BOT_API_SECRET = "test-secret";

      fetchSpy.mockImplementation((url: string | URL | Request, init?: RequestInit) => {
        const urlStr = url.toString();
        if (urlStr.includes("/users/@me/guilds")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(userGuilds),
          } as Response);
        }
        if (urlStr.includes("/api/v1/guilds/access")) {
          accessSignal = init?.signal instanceof AbortSignal ? init.signal : null;
          controller.abort(new DOMException("Route budget expired", "TimeoutError"));

          return new Promise<Response>((_, reject) => {
            const signal = accessSignal;
            const abortReason = () =>
              signal?.reason ?? new DOMException("The operation was aborted.", "AbortError");
            if (signal?.aborted) {
              reject(abortReason());
              return;
            }
            signal?.addEventListener("abort", () => reject(abortReason()), { once: true });
          });
        }
        if (urlStr.endsWith("/api/v1/guilds")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(botGuilds),
          } as Response);
        }
        return Promise.reject(new Error(`Unexpected fetch URL: ${urlStr}`));
      });

      const guildsPromise = getMutualGuilds("happy-path-timeout-token", controller.signal, {
        userId: "user-1",
      });

      await vi.advanceTimersByTimeAsync(0);

      const lookupSignal = accessSignal as AbortSignal | null;
      expect(controller.signal.aborted).toBe(true);
      expect(lookupSignal).toBeInstanceOf(AbortSignal);
      expect(lookupSignal).not.toBe(controller.signal);
      expect(lookupSignal?.aborted).toBe(false);

      await vi.advanceTimersByTimeAsync(BOT_GUILD_ACCESS_FALLBACK_TIMEOUT_MS);

      await expect(guildsPromise).resolves.toEqual([
        expect.objectContaining({ id: "1", access: "owner", botPresent: true }),
      ]);
      expect(lookupSignal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns all user guilds unfiltered when bot API fails", async () => {
    const userGuilds = [
      { id: "1", name: "Server 1", icon: null, owner: true, permissions: "8", features: [] },
      { id: "2", name: "Server 2", icon: null, owner: false, permissions: "0", features: [] },
    ];

    process.env.BOT_API_URL = "http://localhost:3001";
    process.env.BOT_API_SECRET = "test-secret";

    fetchSpy.mockImplementation((url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("/users/@me/guilds")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(userGuilds) } as Response);
      }
      if (urlStr.includes("/api/v1/guilds")) {
        return Promise.resolve({ ok: false, status: 500, statusText: "Internal Server Error" } as Response);
      }
      return Promise.reject(new Error(`Unexpected fetch URL: ${urlStr}`));
    });

    const mutualGuilds = await getMutualGuilds("test-token");

    expect(mutualGuilds).toHaveLength(2);
    expect(mutualGuilds[0].botPresent).toBe(false);
    expect(mutualGuilds[1].botPresent).toBe(false);
  });

  it("returns all user guilds when no BOT_API_URL is set", async () => {
    const userGuilds = [
      { id: "1", name: "Server 1", icon: null, owner: true, permissions: "8", features: [] },
    ];

    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(userGuilds),
    } as Response);

    delete process.env.BOT_API_URL;

    const mutualGuilds = await getMutualGuilds("test-token");

    expect(mutualGuilds).toHaveLength(1);
    expect(mutualGuilds[0].botPresent).toBe(false);
  });

  it("falls back to bot guild access when Discord user guilds fail with transient 408", async () => {
    process.env.BOT_API_URL = "http://localhost:3001";
    process.env.BOT_API_SECRET = "test-secret";

    const botGuilds = [
      { id: "1", name: "Admin Server", icon: null, iconHash: "admin-icon-hash" },
      {
        id: "2",
        name: "Viewer Hub",
        icon: "https://cdn.example.com/viewer.webp",
        config: { communityHubs: { enabled: true } },
      },
      { id: "3", name: "Not A Member", icon: null },
    ];

    fetchSpy.mockImplementation((url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("/users/@me/guilds")) {
        return Promise.resolve({
          ok: false,
          status: 408,
          statusText: "Request Timeout",
        } as Response);
      }
      if (urlStr.endsWith("/api/v1/guilds")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(botGuilds),
        } as Response);
      }
      if (urlStr.includes("/api/v1/guilds/access")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve([
              { id: "1", access: "admin", present: true },
              { id: "2", access: "viewer", present: true },
              { id: "3", access: "admin", present: false },
            ]),
        } as Response);
      }
      return Promise.reject(new Error(`Unexpected fetch URL: ${urlStr}`));
    });

    const mutualGuilds = await getMutualGuilds("test-token", undefined, { userId: "user-1" });

    expect(mutualGuilds).toEqual([
      expect.objectContaining({
        id: "1",
        name: "Admin Server",
        access: "admin",
        botPresent: true,
        owner: false,
        permissions: "0",
        icon: "https://cdn.discordapp.com/icons/1/admin-icon-hash.webp?size=128",
        iconHash: "admin-icon-hash",
      }),
      expect.objectContaining({
        id: "2",
        name: "Viewer Hub",
        access: "viewer",
        botPresent: true,
        config: { communityHubs: { enabled: true } },
      }),
    ]);
  });

  it("does not use bot guild access fallback when the caller signal aborts", async () => {
    vi.useFakeTimers();

    try {
      process.env.BOT_API_URL = "http://localhost:3001";
      process.env.BOT_API_SECRET = "test-secret";

      const controller = new AbortController();
      const abortReason = new DOMException("Client disconnected", "AbortError");
      let accessLookupCount = 0;

      fetchSpy.mockImplementation((url: string | URL | Request, init?: RequestInit) => {
        const urlStr = url.toString();
        if (urlStr.includes("/users/@me/guilds")) {
          const signal = init?.signal;
          return new Promise<Response>((_, reject) => {
            const timeoutReason = () =>
              signal?.reason ?? new DOMException("The operation was aborted.", "AbortError");
            if (signal?.aborted) {
              reject(timeoutReason());
              return;
            }

            signal?.addEventListener("abort", () => reject(timeoutReason()), { once: true });
          });
        }
        if (urlStr.endsWith("/api/v1/guilds")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve([{ id: "1", name: "Recovered Server", icon: null }]),
          } as Response);
        }
        if (urlStr.includes("/api/v1/guilds/access")) {
          accessLookupCount++;
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve([{ id: "1", access: "admin", present: true }]),
          } as Response);
        }
        return Promise.reject(new Error(`Unexpected fetch URL: ${urlStr}`));
      });

      const guildsPromise = getMutualGuilds("caller-abort-token", controller.signal, {
        userId: "user-1",
      });

      await vi.advanceTimersByTimeAsync(0);
      controller.abort(abortReason);

      await expect(guildsPromise).rejects.toBe(abortReason);
      expect(accessLookupCount).toBe(0);

      await vi.advanceTimersByTimeAsync(USER_GUILDS_REQUEST_TIMEOUT_MS);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses a fresh bot guild access fallback signal when Discord user guilds time out", async () => {
    vi.useFakeTimers();

    try {
      process.env.BOT_API_URL = "http://localhost:3001";
      process.env.BOT_API_SECRET = "test-secret";

      const controller = new AbortController();
      let accessSignal: AbortSignal | null = null;

      fetchSpy.mockImplementation((url: string | URL | Request, init?: RequestInit) => {
        const urlStr = url.toString();
        if (urlStr.includes("/users/@me/guilds")) {
          const signal = init?.signal;
          return new Promise<Response>((_, reject) => {
            const abortReason = () =>
              signal?.reason ?? new DOMException("The operation was aborted.", "AbortError");
            if (signal?.aborted) {
              reject(abortReason());
              return;
            }

            signal?.addEventListener("abort", () => reject(abortReason()), { once: true });
          });
        }
        if (urlStr.endsWith("/api/v1/guilds")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve([{ id: "1", name: "Recovered Server", icon: null }]),
          } as Response);
        }
        if (urlStr.includes("/api/v1/guilds/access")) {
          accessSignal = init?.signal instanceof AbortSignal ? init.signal : null;
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve([{ id: "1", access: "admin", present: true }]),
          } as Response);
        }
        return Promise.reject(new Error(`Unexpected fetch URL: ${urlStr}`));
      });

      const guildsPromise = getMutualGuilds("timeout-token", controller.signal, {
        userId: "user-1",
      });

      await vi.advanceTimersByTimeAsync(USER_GUILDS_REQUEST_TIMEOUT_MS);

      await expect(guildsPromise).resolves.toEqual([
        expect.objectContaining({
          id: "1",
          name: "Recovered Server",
          access: "admin",
          botPresent: true,
        }),
      ]);
      const recoverySignal = accessSignal as AbortSignal | null;
      expect(controller.signal.aborted).toBe(false);
      expect(recoverySignal).toBeInstanceOf(AbortSignal);
      expect(recoverySignal).not.toBe(controller.signal);
      expect(recoverySignal?.aborted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([401, 403])(
    "does not use bot guild access fallback for Discord auth failure %s",
    async (status) => {
      process.env.BOT_API_URL = "http://localhost:3001";
      process.env.BOT_API_SECRET = "test-secret";

      let accessLookupCount = 0;

      fetchSpy.mockImplementation((url: string | URL | Request) => {
        const urlStr = url.toString();
        if (urlStr.includes("/users/@me/guilds")) {
          return Promise.resolve({
            ok: false,
            status,
            statusText: status === 401 ? "Unauthorized" : "Forbidden",
          } as Response);
        }
        if (urlStr.endsWith("/api/v1/guilds")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve([{ id: "1", name: "Bot Server", icon: null }]),
          } as Response);
        }
        if (urlStr.includes("/api/v1/guilds/access")) {
          accessLookupCount++;
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve([{ id: "1", access: "admin", present: true }]),
          } as Response);
        }
        return Promise.reject(new Error(`Unexpected fetch URL: ${urlStr}`));
      });

      await expect(
        getMutualGuilds("bad-token", undefined, { userId: "user-1" }),
      ).rejects.toThrow(`Failed to fetch user guilds: ${status}`);
      expect(accessLookupCount).toBe(0);
    },
  );

  it("skips bot guild access fallback when the bot guild list is too large", async () => {
    process.env.BOT_API_URL = "http://localhost:3001";
    process.env.BOT_API_SECRET = "test-secret";

    let accessLookupCount = 0;
    const botGuilds = Array.from({ length: 101 }, (_, index) => ({
      id: String(index + 1),
      name: `Bot Server ${index + 1}`,
      icon: null,
    }));

    fetchSpy.mockImplementation((url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("/users/@me/guilds")) {
        return Promise.resolve({
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
        } as Response);
      }
      if (urlStr.endsWith("/api/v1/guilds")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(botGuilds),
        } as Response);
      }
      if (urlStr.includes("/api/v1/guilds/access")) {
        accessLookupCount++;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve([{ id: "1", access: "admin", present: true }]),
        } as Response);
      }
      return Promise.reject(new Error(`Unexpected fetch URL: ${urlStr}`));
    });

    await expect(
      getMutualGuilds("temporary-failure-token", undefined, { userId: "user-1" }),
    ).rejects.toThrow("Failed to fetch user guilds: 500");
    expect(accessLookupCount).toBe(0);
  });

  it("generates icon URL from bot guild iconHash when bot guild has no direct icon URL", async () => {
    const userGuilds = [
      { id: "1", name: "Server 1", icon: "user-hash", owner: true, permissions: "8", features: [] },
    ];
    const botGuilds = [
      { id: "1", name: "Server 1", icon: null, iconHash: "server-hash" },
    ];

    process.env.BOT_API_URL = "http://localhost:3001";
    process.env.BOT_API_SECRET = "test-secret";

    fetchSpy.mockImplementation((url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("/users/@me/guilds")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(userGuilds) } as Response);
      }
      if (urlStr.includes("/api/v1/guilds")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(botGuilds) } as Response);
      }
      return Promise.reject(new Error(`Unexpected fetch URL: ${urlStr}`));
    });

    const mutualGuilds = await getMutualGuilds("test-token");

    expect(mutualGuilds).toHaveLength(1);
    // icon should be generated from bot iconHash
    expect(mutualGuilds[0].icon).toBe("https://cdn.discordapp.com/icons/1/server-hash.webp?size=128");
    expect(mutualGuilds[0].iconHash).toBe("server-hash");
  });

  it("falls back to user guild icon hash when bot guild has neither icon nor iconHash", async () => {
    const userGuilds = [
      { id: "1", name: "Server 1", icon: "user-hash", owner: true, permissions: "8", features: [] },
    ];
    const botGuilds = [
      { id: "1", name: "Server 1", icon: null },
    ];

    process.env.BOT_API_URL = "http://localhost:3001";
    process.env.BOT_API_SECRET = "test-secret";

    fetchSpy.mockImplementation((url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("/users/@me/guilds")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(userGuilds) } as Response);
      }
      if (urlStr.includes("/api/v1/guilds")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(botGuilds) } as Response);
      }
      return Promise.reject(new Error(`Unexpected fetch URL: ${urlStr}`));
    });

    const mutualGuilds = await getMutualGuilds("test-token");

    expect(mutualGuilds).toHaveLength(1);
    // falls back to generating URL from user guild icon hash
    expect(mutualGuilds[0].iconHash).toBe("user-hash");
    expect(mutualGuilds[0].icon).toBe("https://cdn.discordapp.com/icons/1/user-hash.webp?size=128");
  });

  it("generates a gif URL when bot guild iconHash is animated (a_ prefix)", async () => {
    const userGuilds = [
      { id: "1", name: "Server 1", icon: null, owner: true, permissions: "8", features: [] },
    ];
    const botGuilds = [
      { id: "1", name: "Server 1", icon: null, iconHash: "a_animated123" },
    ];

    process.env.BOT_API_URL = "http://localhost:3001";
    process.env.BOT_API_SECRET = "test-secret";

    fetchSpy.mockImplementation((url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("/users/@me/guilds")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(userGuilds) } as Response);
      }
      if (urlStr.includes("/api/v1/guilds")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(botGuilds) } as Response);
      }
      return Promise.reject(new Error(`Unexpected fetch URL: ${urlStr}`));
    });

    const mutualGuilds = await getMutualGuilds("test-token");

    expect(mutualGuilds).toHaveLength(1);
    expect(mutualGuilds[0].iconHash).toBe("a_animated123");
    expect(mutualGuilds[0].icon).toBe("https://cdn.discordapp.com/icons/1/a_animated123.gif?size=128");
  });

  it("when bot API unavailable, generates icon URL from user guild icon hash", async () => {
    const userGuilds = [
      { id: "1", name: "Server 1", icon: "user-static-hash", owner: true, permissions: "8", features: [] },
    ];

    delete process.env.BOT_API_URL;

    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(userGuilds),
    } as Response);

    const mutualGuilds = await getMutualGuilds("test-token");

    expect(mutualGuilds).toHaveLength(1);
    expect(mutualGuilds[0].botPresent).toBe(false);
    // icon is mapped from user guild's icon hash
    expect(mutualGuilds[0].iconHash).toBe("user-static-hash");
    expect(mutualGuilds[0].icon).toBe("https://cdn.discordapp.com/icons/1/user-static-hash.webp?size=128");
  });
});
