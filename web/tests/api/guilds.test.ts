import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { expectJsonErrorContaining, expectJsonResponse, expectStatus } from "./test-utils";

// Mock next-auth/providers/discord
vi.mock("next-auth/providers/discord", () => ({
  default: vi.fn((config: Record<string, unknown>) => ({
    id: "discord",
    name: "Discord",
    type: "oauth",
    ...config,
  })),
}));

// Mock getToken from next-auth/jwt (used in the new API route)
const mockGetToken = vi.fn();
vi.mock("next-auth/jwt", () => ({
  getToken: (...args: unknown[]) => mockGetToken(...args),
}));

// Mock discord server lib
const mockGetMutualGuilds = vi.fn();
vi.mock("@/lib/discord.server", () => ({
  BOT_GUILD_ACCESS_FALLBACK_TIMEOUT_MS: 2_500,
  getMutualGuilds: (...args: unknown[]) => mockGetMutualGuilds(...args),
  USER_GUILDS_REQUEST_TIMEOUT_MS: 10_000,
}));
const mockGetBotApiBaseUrl = vi.fn();
vi.mock("@/lib/bot-api", () => ({
  getBotApiBaseUrl: () => mockGetBotApiBaseUrl(),
}));

import { GET } from "@/app/api/guilds/route";

function createMockRequest(url = "http://localhost:3000/api/guilds"): NextRequest {
  return new NextRequest(new URL(url));
}

describe("GET /api/guilds", () => {
  const originalSecret = process.env.NEXTAUTH_SECRET;
  const originalBotApiUrl = process.env.BOT_API_URL;
  const originalBotApiSecret = process.env.BOT_API_SECRET;
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXTAUTH_SECRET = "a-valid-secret-that-is-at-least-32-characters-long";
    delete process.env.BOT_API_URL;
    delete process.env.BOT_API_SECRET;
    mockGetBotApiBaseUrl.mockReturnValue(null);
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    if (originalBotApiUrl === undefined) {
      delete process.env.BOT_API_URL;
    } else {
      process.env.BOT_API_URL = originalBotApiUrl;
    }
    if (originalBotApiSecret === undefined) {
      delete process.env.BOT_API_SECRET;
    } else {
      process.env.BOT_API_SECRET = originalBotApiSecret;
    }
    if (originalSecret === undefined) {
      delete process.env.NEXTAUTH_SECRET;
    } else {
      process.env.NEXTAUTH_SECRET = originalSecret;
    }
  });

  it("returns 401 when no token exists", async () => {
    mockGetToken.mockResolvedValue(null);

    const response = await GET(createMockRequest());

    await expectJsonResponse(response, 401, { error: "Unauthorized" });
  });

  it("returns 401 when token has no access token", async () => {
    mockGetToken.mockResolvedValue({
      sub: "123",
      id: "user-123",
      // No accessToken
    });

    const response = await GET(createMockRequest());

    expectStatus(response, 401);
  });

  it("returns guilds when authenticated with valid token", async () => {
    const mockGuilds = [
      { id: "1", name: "Server 1", icon: null, botPresent: true },
    ];

    mockGetToken.mockResolvedValue({
      sub: "123",
      accessToken: "valid-discord-token",
      refreshToken: "refresh-token",
      accessTokenExpires: Date.now() + 60_000,
      id: "discord-user-123",
    });
    mockGetMutualGuilds.mockResolvedValue(mockGuilds);

    const response = await GET(createMockRequest());

    await expectJsonResponse(response, 200, mockGuilds);
    expect(mockGetMutualGuilds).toHaveBeenCalledWith(
      "valid-discord-token",
      expect.any(AbortSignal),
      { userId: "discord-user-123" },
    );
  });

  it("sets a route timeout budget that leaves room for bot-backed fallback", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    const mockGuilds = [{ id: "1", name: "Server 1", icon: null, botPresent: true }];

    mockGetToken.mockResolvedValue({
      sub: "123",
      accessToken: "valid-discord-token",
      id: "discord-user-123",
    });
    mockGetMutualGuilds.mockResolvedValue(mockGuilds);

    try {
      const response = await GET(createMockRequest());

      await expectJsonResponse(response, 200, mockGuilds);
      expect(timeoutSpy).toHaveBeenCalledWith(13_500);
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  it("returns 401 when token has RefreshTokenError", async () => {
    mockGetToken.mockResolvedValue({
      sub: "123",
      accessToken: "stale-token",
      id: "discord-user-123",
      error: "RefreshTokenError",
    });

    const response = await GET(createMockRequest());

    await expectJsonErrorContaining(response, 401, /sign in/i);
    expect(mockGetMutualGuilds).not.toHaveBeenCalled();
  });

  it("returns 500 on discord API error", async () => {
    mockGetToken.mockResolvedValue({
      sub: "123",
      accessToken: "valid-discord-token",
      refreshToken: "refresh-token",
      accessTokenExpires: Date.now() + 60_000,
      id: "discord-user-123",
    });
    mockGetMutualGuilds.mockRejectedValue(new Error("Discord API error"));

    const response = await GET(createMockRequest());

    await expectJsonResponse(response, 500, { error: "Failed to fetch guilds" });
  });

  it("returns access levels already resolved by getMutualGuilds", async () => {
    globalThis.fetch = vi.fn();

    mockGetToken.mockResolvedValue({
      sub: "123",
      id: "discord-user-123",
      accessToken: "valid-discord-token",
    });
    mockGetMutualGuilds.mockResolvedValue([
      {
        id: "1",
        name: "Server 1",
        icon: null,
        owner: false,
        permissions: "0",
        features: [],
        botPresent: true,
        access: "moderator",
      },
    ]);

    const response = await GET(createMockRequest());

    await expectJsonResponse(response, 200, [
      expect.objectContaining({
        id: "1",
        access: "moderator",
      }),
    ]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("does not perform a redundant route-level access lookup", async () => {
    process.env.BOT_API_SECRET = "bot-secret";
    mockGetBotApiBaseUrl.mockReturnValue("http://bot.internal/api/v1");
    globalThis.fetch = vi.fn();

    mockGetToken.mockResolvedValue({
      sub: "123",
      id: "discord-user-123",
      accessToken: "valid-discord-token",
    });
    mockGetMutualGuilds.mockResolvedValue([
      {
        id: "1",
        name: "Server 1",
        icon: null,
        owner: false,
        permissions: "0",
        features: [],
        botPresent: true,
      },
    ]);

    const response = await GET(createMockRequest());

    await expectJsonResponse(response, 200, [
      expect.objectContaining({
        id: "1",
        botPresent: true,
      }),
    ]);
    expect(mockGetMutualGuilds).toHaveBeenCalledWith(
      "valid-discord-token",
      expect.any(AbortSignal),
      { userId: "discord-user-123" },
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("skips bot api access lookup when guilds list is empty", async () => {
    process.env.BOT_API_SECRET = "bot-secret";
    mockGetBotApiBaseUrl.mockReturnValue("http://bot.internal/api/v1");
    globalThis.fetch = vi.fn();

    mockGetToken.mockResolvedValue({
      sub: "123",
      id: "discord-user-123",
      accessToken: "valid-discord-token",
    });
    mockGetMutualGuilds.mockResolvedValue([]);

    const response = await GET(createMockRequest());

    await expectJsonResponse(response, 200, []);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("skips bot api access lookup when no guilds have botPresent set", async () => {
    process.env.BOT_API_SECRET = "bot-secret";
    mockGetBotApiBaseUrl.mockReturnValue("http://bot.internal/api/v1");
    globalThis.fetch = vi.fn();

    mockGetToken.mockResolvedValue({
      sub: "123",
      id: "discord-user-123",
      accessToken: "valid-discord-token",
    });
    mockGetMutualGuilds.mockResolvedValue([
      {
        id: "1",
        name: "User-only Server",
        icon: null,
        owner: false,
        permissions: "0",
        features: [],
        botPresent: false,
      },
    ]);

    const response = await GET(createMockRequest());

    expectStatus(response, 200);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("falls back to original guilds when bot api returns non-array JSON", async () => {
    process.env.BOT_API_SECRET = "bot-secret";
    mockGetBotApiBaseUrl.mockReturnValue("http://bot.internal/api/v1");

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ error: "unexpected shape" }),
      status: 200,
      statusText: "OK",
    } as Response);

    mockGetToken.mockResolvedValue({
      sub: "123",
      id: "discord-user-123",
      accessToken: "valid-discord-token",
    });
    const guild = {
      id: "1",
      name: "Server 1",
      icon: null,
      owner: false,
      permissions: "0",
      features: [],
      botPresent: true,
      access: "viewer" as const,
    };
    mockGetMutualGuilds.mockResolvedValue([guild]);

    const response = await GET(createMockRequest());

    await expectJsonResponse(response, 200, [expect.objectContaining({ id: "1", access: "viewer" })]);
  });

  it("falls back to original guilds when bot api returns non-ok response", async () => {
    process.env.BOT_API_SECRET = "bot-secret";
    mockGetBotApiBaseUrl.mockReturnValue("http://bot.internal/api/v1");

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
    } as Response);

    mockGetToken.mockResolvedValue({
      sub: "123",
      id: "discord-user-123",
      accessToken: "valid-discord-token",
    });
    const guild = {
      id: "1",
      name: "Server 1",
      icon: null,
      owner: false,
      permissions: "0",
      features: [],
      botPresent: true,
      access: "viewer" as const,
    };
    mockGetMutualGuilds.mockResolvedValue([guild]);

    const response = await GET(createMockRequest());

    await expectJsonResponse(response, 200, [expect.objectContaining({ id: "1", access: "viewer" })]);
  });

  it("falls back to original guilds when bot api fetch throws", async () => {
    process.env.BOT_API_SECRET = "bot-secret";
    mockGetBotApiBaseUrl.mockReturnValue("http://bot.internal/api/v1");

    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network failure"));

    mockGetToken.mockResolvedValue({
      sub: "123",
      id: "discord-user-123",
      accessToken: "valid-discord-token",
    });
    const guild = {
      id: "1",
      name: "Server 1",
      icon: null,
      owner: false,
      permissions: "0",
      features: [],
      botPresent: true,
      access: "admin" as const,
    };
    mockGetMutualGuilds.mockResolvedValue([guild]);

    const response = await GET(createMockRequest());

    await expectJsonResponse(response, 200, [expect.objectContaining({ id: "1", access: "admin" })]);
  });

  it("skips bot api access lookup when BOT_API_SECRET is not configured", async () => {
    delete process.env.BOT_API_SECRET;
    mockGetBotApiBaseUrl.mockReturnValue("http://bot.internal/api/v1");
    globalThis.fetch = vi.fn();

    mockGetToken.mockResolvedValue({
      sub: "123",
      id: "discord-user-123",
      accessToken: "valid-discord-token",
    });
    const guild = {
      id: "1",
      name: "Server 1",
      icon: null,
      owner: false,
      permissions: "0",
      features: [],
      botPresent: true,
      access: "moderator" as const,
    };
    mockGetMutualGuilds.mockResolvedValue([guild]);

    const response = await GET(createMockRequest());

    await expectJsonResponse(response, 200, [expect.objectContaining({ id: "1", access: "moderator" })]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("uses token.sub as userId fallback when token.id is absent", async () => {
    process.env.BOT_API_SECRET = "bot-secret";
    mockGetBotApiBaseUrl.mockReturnValue("http://bot.internal/api/v1");

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ id: "1", access: "admin" }],
      status: 200,
      statusText: "OK",
    } as Response);

    // token has sub but not id
    mockGetToken.mockResolvedValue({
      sub: "discord-sub-456",
      accessToken: "valid-discord-token",
    });
    mockGetMutualGuilds.mockResolvedValue([
      {
        id: "1",
        name: "Server 1",
        icon: null,
        owner: false,
        permissions: "0",
        features: [],
        botPresent: true,
      },
    ]);

    const response = await GET(createMockRequest());

    await expectJsonResponse(response, 200, [expect.objectContaining({ id: "1" })]);
    expect(mockGetMutualGuilds).toHaveBeenCalledWith(
      "valid-discord-token",
      expect.any(AbortSignal),
      { userId: "discord-sub-456" },
    );
  });

  it("skips bot api access lookup when userId cannot be determined from token", async () => {
    process.env.BOT_API_SECRET = "bot-secret";
    mockGetBotApiBaseUrl.mockReturnValue("http://bot.internal/api/v1");
    globalThis.fetch = vi.fn();

    // token has neither id nor sub
    mockGetToken.mockResolvedValue({
      accessToken: "valid-discord-token",
    });
    const guild = {
      id: "1",
      name: "Server 1",
      icon: null,
      owner: false,
      permissions: "0",
      features: [],
      botPresent: true,
      access: "viewer" as const,
    };
    mockGetMutualGuilds.mockResolvedValue([guild]);

    const response = await GET(createMockRequest());

    // Returns guilds unchanged since userId is empty
    await expectJsonResponse(response, 200, [expect.objectContaining({ id: "1", access: "viewer" })]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
