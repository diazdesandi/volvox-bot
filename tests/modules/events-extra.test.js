/**
 * Additional tests for src/modules/events.js — handler branches not covered by events.test.js.
 * Covers: registerReviewClaimHandler plus edge-case branches in existing handlers.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────────
vi.mock('../../src/utils/safeSend.js', () => ({
  safeSend: (ch, opts) => ch.send(opts),
  safeReply: (t, opts) => t.reply(opts),
  safeFollowUp: (t, opts) => t.followUp(opts),
  safeEditReply: (t, opts) => t.editReply(opts),
}));
vi.mock('../../src/logger.js', () => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));
vi.mock('../../src/modules/triage.js', () => ({
  accumulateMessage: vi.fn(),
  evaluateNow: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/modules/spam.js', () => ({
  isSpam: vi.fn().mockReturnValue(false),
  sendSpamAlert: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/modules/welcome.js', () => ({
  sendWelcomeMessage: vi.fn().mockResolvedValue(undefined),
  recordCommunityActivity: vi.fn(),
}));
vi.mock('../../src/utils/errors.js', () => ({
  getUserFriendlyMessage: vi.fn().mockReturnValue('Something went wrong. Try again!'),
}));
vi.mock('../../src/modules/starboard.js', () => ({
  handleReactionAdd: vi.fn().mockResolvedValue(undefined),
  handleReactionRemove: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/modules/pollHandler.js', () => ({
  handlePollVote: vi.fn().mockResolvedValue(undefined),
  createPoll: vi.fn(),
}));
vi.mock('../../src/modules/config.js', () => ({
  getConfig: vi.fn().mockReturnValue({}),
}));
vi.mock('../../src/modules/reviewHandler.js', () => ({
  handleReviewClaim: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/db.js', () => ({
  getPool: vi.fn().mockReturnValue({ query: vi.fn() }),
}));
vi.mock('../../src/modules/engagement.js', () => ({
  trackMessage: vi.fn().mockResolvedValue(undefined),
  trackReaction: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/modules/linkFilter.js', () => ({
  checkLinks: vi.fn().mockResolvedValue({ blocked: false }),
}));
vi.mock('../../src/modules/rateLimit.js', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ limited: false }),
}));
vi.mock('../../src/modules/reputation.js', () => ({
  handleXpGain: vi.fn().mockResolvedValue(undefined),
}));

import { getConfig } from '../../src/modules/config.js';
import { registerMessageCreateHandler } from '../../src/modules/events/messageCreate.js';
import { registerReactionHandlers } from '../../src/modules/events/reactions.js';
import { registerReadyHandler } from '../../src/modules/events/ready.js';
import { handleReviewButton } from '../../src/modules/handlers/reviewHandler.js';
import { checkLinks } from '../../src/modules/linkFilter.js';
import { checkRateLimit } from '../../src/modules/rateLimit.js';
import { handleReviewClaim } from '../../src/modules/reviewHandler.js';
import { handleReactionAdd, handleReactionRemove } from '../../src/modules/starboard.js';
import { accumulateMessage, evaluateNow } from '../../src/modules/triage.js';
import { recordCommunityActivity } from '../../src/modules/welcome.js';

afterEach(() => {
  vi.clearAllMocks();
});

// ── handleReviewButton ───────────────────────────────────────────────

describe('handleReviewButton', () => {
  it('should ignore non-button interactions', async () => {
    expect(await handleReviewButton({ isButton: () => false })).toBe(false);
    expect(handleReviewClaim).not.toHaveBeenCalled();
  });

  it('should ignore buttons with non-review customId', async () => {
    expect(await handleReviewButton({ isButton: () => true, customId: 'other' })).toBe(false);
    expect(handleReviewClaim).not.toHaveBeenCalled();
  });

  it('should skip when review feature is disabled', async () => {
    getConfig.mockReturnValue({ review: { enabled: false } });
    expect(
      await handleReviewButton({
        isButton: () => true,
        customId: 'review_claim_123',
        guildId: 'g1',
      }),
    ).toBe(true);
    expect(handleReviewClaim).not.toHaveBeenCalled();
  });

  it('should skip when review config is absent', async () => {
    getConfig.mockReturnValue({});
    expect(
      await handleReviewButton({
        isButton: () => true,
        customId: 'review_claim_123',
        guildId: 'g1',
      }),
    ).toBe(true);
    expect(handleReviewClaim).not.toHaveBeenCalled();
  });

  it('should call handleReviewClaim for review_claim_ buttons', async () => {
    getConfig.mockReturnValue({ review: { enabled: true } });
    const interaction = {
      isButton: () => true,
      customId: 'review_claim_123',
      guildId: 'g1',
      user: { id: 'u1' },
    };
    await handleReviewButton(interaction);
    expect(handleReviewClaim).toHaveBeenCalledWith(interaction);
  });

  it('should handle errors and reply with ephemeral error', async () => {
    getConfig.mockReturnValue({ review: { enabled: true } });
    handleReviewClaim.mockRejectedValueOnce(new Error('boom'));
    const reply = vi.fn().mockResolvedValue(undefined);
    await handleReviewButton({
      isButton: () => true,
      customId: 'review_claim_123',
      guildId: 'g1',
      user: { id: 'u1' },
      replied: false,
      deferred: false,
      reply,
    });
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ ephemeral: true }));
  });

  it('should skip reply when already replied', async () => {
    getConfig.mockReturnValue({ review: { enabled: true } });
    handleReviewClaim.mockRejectedValueOnce(new Error('boom'));
    const reply = vi.fn();
    await handleReviewButton({
      isButton: () => true,
      customId: 'review_claim_456',
      guildId: 'g1',
      user: { id: 'u1' },
      replied: true,
      deferred: false,
      reply,
    });
    expect(reply).not.toHaveBeenCalled();
  });

  it('should swallow inner safeReply error', async () => {
    getConfig.mockReturnValue({ review: { enabled: true } });
    handleReviewClaim.mockRejectedValueOnce(new Error('boom'));
    const reply = vi.fn().mockRejectedValue(new Error('reply also failed'));
    await expect(
      handleReviewButton({
        isButton: () => true,
        customId: 'review_claim_789',
        guildId: 'g1',
        user: { id: 'u1' },
        replied: false,
        deferred: false,
        reply,
      }),
    ).resolves.toBe(true);
  });
});

// ── registerReadyHandler — additional branches ─────────────────────

describe('registerReadyHandler — extra branches', () => {
  it('should log starboard info when starboard is enabled', () => {
    const once = vi.fn();
    const client = { once, user: { tag: 'Bot#1234' }, guilds: { cache: { size: 2 } } };
    const config = { starboard: { enabled: true, channelId: 'sb-ch', threshold: 5 } };
    registerReadyHandler(client, config, null);
    once.mock.calls[0][1]();
  });

  it('should resolve respondModel from triage.model string', () => {
    const once = vi.fn();
    const client = { once, user: { tag: 'Bot#1234' }, guilds: { cache: { size: 1 } } };
    const config = { ai: { enabled: true }, triage: { model: 'gpt-4' } };
    registerReadyHandler(client, config, null);
    once.mock.calls[0][1]();
  });

  it('should resolve respondModel from triage.models.default', () => {
    const once = vi.fn();
    const client = { once, user: { tag: 'Bot#1234' }, guilds: { cache: { size: 1 } } };
    const config = { ai: { enabled: true }, triage: { models: { default: 'custom-model' } } };
    registerReadyHandler(client, config, null);
    once.mock.calls[0][1]();
  });

  it('should resolve respondModel from explicit triage.respondModel', () => {
    const once = vi.fn();
    const client = { once, user: { tag: 'Bot#1234' }, guilds: { cache: { size: 1 } } };
    const config = {
      ai: { enabled: true },
      triage: { respondModel: 'explicit-model', classifyModel: 'cls' },
    };
    registerReadyHandler(client, config, null);
    once.mock.calls[0][1]();
  });
});

// ── registerMessageCreateHandler — extra branches ──────────────────

describe('registerMessageCreateHandler — extra branches', () => {
  let onCallbacks;
  let client;

  function setup(configOverrides = {}) {
    onCallbacks = {};
    client = {
      on: vi.fn((event, cb) => {
        onCallbacks[event] = cb;
      }),
      user: { id: 'bot-user-id' },
    };
    const config = {
      ai: { enabled: true, channels: [] },
      moderation: { enabled: true },
      ...configOverrides,
    };
    getConfig.mockReturnValue(config);
    registerMessageCreateHandler(client, config, null);
  }

  it('should handle rate limit check errors gracefully', async () => {
    setup();
    checkRateLimit.mockRejectedValueOnce(new Error('rl boom'));
    await onCallbacks.messageCreate({
      author: { bot: false, username: 'user', id: 'u1' },
      guild: { id: 'g1' },
      content: 'hello',
      channel: { id: 'c1', sendTyping: vi.fn(), send: vi.fn() },
      mentions: { has: vi.fn().mockReturnValue(false), repliedUser: null },
      reference: null,
    });
    // Should not throw, should continue to recordCommunityActivity
    expect(recordCommunityActivity).toHaveBeenCalled();
  });

  it('should return early when rate limited', async () => {
    setup();
    checkRateLimit.mockResolvedValueOnce({ limited: true });
    await onCallbacks.messageCreate({
      author: { bot: false, username: 'user', id: 'u1' },
      guild: { id: 'g1' },
      content: 'hello',
      channel: { id: 'c1', sendTyping: vi.fn(), send: vi.fn() },
      mentions: { has: vi.fn().mockReturnValue(false), repliedUser: null },
      reference: null,
    });
    expect(recordCommunityActivity).not.toHaveBeenCalled();
  });

  it('should handle link filter errors gracefully', async () => {
    setup();
    checkLinks.mockRejectedValueOnce(new Error('link filter boom'));
    await onCallbacks.messageCreate({
      author: { bot: false, username: 'user', id: 'u1' },
      guild: { id: 'g1' },
      content: 'hello',
      channel: { id: 'c1', sendTyping: vi.fn(), send: vi.fn() },
      mentions: { has: vi.fn().mockReturnValue(false), repliedUser: null },
      reference: null,
    });
    expect(recordCommunityActivity).toHaveBeenCalled();
  });

  it('should return early when link is blocked', async () => {
    setup();
    checkLinks.mockResolvedValueOnce({ blocked: true });
    await onCallbacks.messageCreate({
      author: { bot: false, username: 'user', id: 'u1' },
      guild: { id: 'g1' },
      content: 'http://evil.com',
      channel: { id: 'c1', sendTyping: vi.fn(), send: vi.fn() },
      mentions: { has: vi.fn().mockReturnValue(false), repliedUser: null },
      reference: null,
    });
    expect(recordCommunityActivity).not.toHaveBeenCalled();
  });

  it('should fall back to fetching ref msg when repliedUser is someone else', async () => {
    setup();
    const fetchedRef = { author: { id: 'bot-user-id' } };
    await onCallbacks.messageCreate({
      author: { bot: false, username: 'user', id: 'u1' },
      guild: { id: 'g1' },
      content: 'follow up',
      channel: {
        id: 'c1',
        sendTyping: vi.fn().mockResolvedValue(undefined),
        send: vi.fn(),
        isThread: vi.fn().mockReturnValue(false),
        messages: { fetch: vi.fn().mockResolvedValue(fetchedRef) },
      },
      mentions: { has: vi.fn().mockReturnValue(false), repliedUser: { id: 'other-user' } },
      reference: { messageId: 'ref-msg-id' },
      reply: vi.fn().mockResolvedValue(undefined),
    });
    expect(evaluateNow).toHaveBeenCalled();
  });

  it('should handle ref message fetch failure gracefully', async () => {
    setup();
    await onCallbacks.messageCreate({
      author: { bot: false, username: 'user', id: 'u1' },
      guild: { id: 'g1' },
      content: 'follow up',
      channel: {
        id: 'c1',
        sendTyping: vi.fn().mockResolvedValue(undefined),
        send: vi.fn(),
        isThread: vi.fn().mockReturnValue(false),
        messages: { fetch: vi.fn().mockRejectedValue(new Error('not found')) },
      },
      mentions: { has: vi.fn().mockReturnValue(false), repliedUser: { id: 'other-user' } },
      reference: { messageId: 'ref-msg-id' },
      reply: vi.fn().mockResolvedValue(undefined),
    });
    // Not a reply to bot, so evaluateNow should not be called
    expect(evaluateNow).not.toHaveBeenCalled();
  });

  it('should handle safeReply failure when evaluateNow fails', async () => {
    setup();
    evaluateNow.mockRejectedValueOnce(new Error('triage failed'));
    await onCallbacks.messageCreate({
      author: { bot: false, username: 'user', id: 'u1' },
      guild: { id: 'g1' },
      content: '<@bot-user-id> hello',
      channel: {
        id: 'c1',
        sendTyping: vi.fn().mockResolvedValue(undefined),
        send: vi.fn(),
        isThread: vi.fn().mockReturnValue(false),
      },
      mentions: { has: vi.fn().mockReturnValue(true), repliedUser: null },
      reference: null,
      reply: vi.fn().mockRejectedValue(new Error('reply failed too')),
    });
    // Should not throw
  });

  it('should not accumulate when ai is disabled', async () => {
    setup({ ai: { enabled: false }, moderation: { enabled: false } });
    await onCallbacks.messageCreate({
      author: { bot: false, username: 'user' },
      guild: { id: 'g1' },
      content: 'regular message',
      channel: { id: 'c1', sendTyping: vi.fn(), send: vi.fn() },
      mentions: { has: vi.fn().mockReturnValue(false), repliedUser: null },
      reference: null,
    });
    expect(accumulateMessage).not.toHaveBeenCalled();
  });

  it('should handle accumulateMessage returning a rejecting promise', async () => {
    // Use vibe mode so non-mention messages reach accumulateMessage
    setup({ ai: { enabled: true, channels: [], defaultChannelMode: 'vibe' } });
    accumulateMessage.mockReturnValueOnce(Promise.reject(new Error('buf fail')));
    await onCallbacks.messageCreate({
      author: { bot: false, username: 'user' },
      guild: { id: 'g1' },
      content: 'regular message',
      channel: {
        id: 'c1',
        sendTyping: vi.fn(),
        send: vi.fn(),
        isThread: vi.fn().mockReturnValue(false),
      },
      mentions: { has: vi.fn().mockReturnValue(false), repliedUser: null },
      reference: null,
    });
    // Should not throw; error is swallowed in the fire-and-forget wrapper
  });
});

// ── registerReactionHandlers — partial fetch edge cases ──────────────

describe('registerReactionHandlers — partial fetch', () => {
  let onCallbacks;
  let client;

  function setup() {
    onCallbacks = {};
    client = {
      on: vi.fn((event, cb) => {
        if (!onCallbacks[event]) onCallbacks[event] = [];
        onCallbacks[event].push(cb);
      }),
    };
    getConfig.mockReturnValue({ starboard: { enabled: true } });
    registerReactionHandlers(client, {});
  }

  it('should fetch partial messages on reaction add', async () => {
    setup();
    const fetch = vi.fn().mockResolvedValue(undefined);
    const reaction = { message: { guild: { id: 'g1' }, partial: true, id: 'msg1', fetch } };
    await onCallbacks.messageReactionAdd[0](reaction, { bot: false, id: 'u1' });
    expect(fetch).toHaveBeenCalled();
  });

  it('should return early if partial fetch fails on reaction add', async () => {
    setup();
    const reaction = {
      message: {
        guild: { id: 'g1' },
        partial: true,
        id: 'msg1',
        fetch: vi.fn().mockRejectedValue(new Error('fail')),
      },
    };
    await onCallbacks.messageReactionAdd[0](reaction, { bot: false, id: 'u1' });
    expect(handleReactionAdd).not.toHaveBeenCalled();
  });

  it('should return early if no guild on reaction add', async () => {
    setup();
    const reaction = { message: { guild: null, partial: false, id: 'msg1' } };
    await onCallbacks.messageReactionAdd[0](reaction, { bot: false, id: 'u1' });
    expect(handleReactionAdd).not.toHaveBeenCalled();
  });

  it('should return early if partial fetch fails on reaction remove', async () => {
    setup();
    const reaction = {
      message: {
        guild: { id: 'g1' },
        partial: true,
        id: 'msg1',
        fetch: vi.fn().mockRejectedValue(new Error('fail')),
      },
    };
    await onCallbacks.messageReactionRemove[0](reaction, { bot: false, id: 'u1' });
    expect(handleReactionRemove).not.toHaveBeenCalled();
  });

  it('should return early if no guild on reaction remove', async () => {
    setup();
    const reaction = { message: { guild: null, partial: false, id: 'msg1' } };
    await onCallbacks.messageReactionRemove[0](reaction, { bot: false, id: 'u1' });
    expect(handleReactionRemove).not.toHaveBeenCalled();
  });

  it('should ignore bot on reaction remove', async () => {
    setup();
    const reaction = { message: { guild: { id: 'g1' }, partial: false, id: 'msg1' } };
    await onCallbacks.messageReactionRemove[0](reaction, { bot: true, id: 'bot1' });
    expect(handleReactionRemove).not.toHaveBeenCalled();
  });
});
