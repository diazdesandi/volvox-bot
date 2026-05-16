import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/logger.js', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../src/modules/config.js', () => ({
  getConfig: vi.fn(),
}));

vi.mock('../../src/modules/rateLimit.js', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ limited: false }),
}));

vi.mock('../../src/modules/linkFilter.js', () => ({
  checkLinks: vi.fn().mockResolvedValue({ blocked: false }),
}));

vi.mock('../../src/modules/engagement.js', () => ({
  trackMessage: vi.fn().mockResolvedValue(undefined),
  trackReaction: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/modules/reputation.js', () => ({
  handleXpGain: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/modules/spam.js', () => ({
  isSpam: vi.fn().mockReturnValue(false),
  sendSpamAlert: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/modules/triage.js', () => ({
  accumulateMessage: vi.fn().mockResolvedValue(undefined),
  evaluateNow: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/modules/welcome.js', () => ({
  recordCommunityActivity: vi.fn(),
  sendWelcomeMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/utils/errors.js', () => ({
  getUserFriendlyMessage: vi.fn().mockReturnValue('friendly error'),
}));

vi.mock('../../src/utils/safeSend.js', () => ({
  safeReply: vi.fn((target, payload) => target.reply?.(payload)),
  safeEditReply: vi.fn((target, payload) => target.editReply?.(payload)),
  safeSend: vi.fn((target, payload) => target.send?.(payload)),
}));

vi.mock('../../src/modules/reviewHandler.js', () => ({
  handleReviewClaim: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/modules/starboard.js', () => ({
  handleReactionAdd: vi.fn().mockResolvedValue(undefined),
  handleReactionRemove: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/db.js', () => ({
  getPool: vi.fn(),
}));

import { getConfig } from '../../src/modules/config.js';
import { registerErrorHandlers } from '../../src/modules/events/errors.js';
import { registerReviewClaimHandler } from '../../src/modules/events/interactionCreate.js';
import { registerMessageCreateHandler } from '../../src/modules/events/messageCreate.js';
import { registerReactionHandlers } from '../../src/modules/events/reactions.js';
import { registerReadyHandler } from '../../src/modules/events/ready.js';
import { checkLinks } from '../../src/modules/linkFilter.js';
import { checkRateLimit } from '../../src/modules/rateLimit.js';
import { handleReviewClaim } from '../../src/modules/reviewHandler.js';
import { handleReactionAdd, handleReactionRemove } from '../../src/modules/starboard.js';
import { accumulateMessage, evaluateNow } from '../../src/modules/triage.js';
import { recordCommunityActivity } from '../../src/modules/welcome.js';
import { safeReply } from '../../src/utils/safeSend.js';

function makeInteraction(overrides = {}) {
  return {
    isButton: () => true,
    isModalSubmit: () => false,
    customId: 'id',
    guildId: 'guild-1',
    replied: false,
    deferred: false,
    user: { id: 'u1' },
    reply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('events coverage follow-up', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getConfig.mockReturnValue({
      moderation: { enabled: true },
      ai: { enabled: true, channels: [] },
      review: { enabled: true },
      starboard: { enabled: true },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('covers ready-handler model and starboard branches', () => {
    const once = vi.fn();
    const client = { once, user: { tag: 'Bot#0001' }, guilds: { cache: { size: 2 } } };

    registerReadyHandler(
      client,
      {
        ai: { enabled: true },
        triage: { model: 'claude-sonnet-custom' },
        starboard: { enabled: true, channelId: 'sb-1', threshold: 5 },
      },
      null,
    );

    const cb = once.mock.calls[0][1];
    cb();

    expect(once).toHaveBeenCalledWith('clientReady', expect.any(Function));
  });

  it('covers messageCreate branches for moderation and ai disabled', async () => {
    const handlers = new Map();
    const client = {
      user: { id: 'bot-id' },
      on: (event, fn) => handlers.set(event, fn),
    };

    getConfig.mockReturnValue({
      moderation: { enabled: false },
      ai: { enabled: false },
    });

    registerMessageCreateHandler(client, {}, null);
    const handler = handlers.get('messageCreate');

    const message = {
      author: { id: 'u1', bot: false },
      guild: { id: 'g1' },
      content: 'hello',
      channel: { id: 'c1', sendTyping: vi.fn().mockResolvedValue(undefined) },
      mentions: { has: vi.fn().mockReturnValue(false), repliedUser: null },
      reference: null,
      reply: vi.fn().mockResolvedValue(undefined),
    };

    await handler(message);

    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(checkLinks).not.toHaveBeenCalled();
    expect(evaluateNow).not.toHaveBeenCalled();
    expect(accumulateMessage).not.toHaveBeenCalled();
    expect(recordCommunityActivity).toHaveBeenCalledWith(message, {
      moderation: { enabled: false },
      ai: { enabled: false },
    });
  });

  it('returns early when rate-limit says limited', async () => {
    checkRateLimit.mockResolvedValueOnce({ limited: true });

    const handlers = new Map();
    const client = { user: { id: 'bot-id' }, on: (event, fn) => handlers.set(event, fn) };
    registerMessageCreateHandler(client, {}, null);
    const handler = handlers.get('messageCreate');

    await handler({
      author: { id: 'u1', bot: false },
      guild: { id: 'g1' },
      content: 'hello',
      channel: { id: 'c1', sendTyping: vi.fn().mockResolvedValue(undefined) },
      mentions: { has: vi.fn().mockReturnValue(false), repliedUser: null },
      reference: null,
      reply: vi.fn().mockResolvedValue(undefined),
    });

    expect(checkRateLimit).toHaveBeenCalled();
    expect(checkLinks).not.toHaveBeenCalled();
  });

  it('returns early when link-filter says blocked', async () => {
    checkRateLimit.mockResolvedValueOnce({ limited: false });
    checkLinks.mockResolvedValueOnce({ blocked: true });

    const handlers = new Map();
    const client = { user: { id: 'bot-id' }, on: (event, fn) => handlers.set(event, fn) };
    registerMessageCreateHandler(client, {}, null);
    const handler = handlers.get('messageCreate');

    await handler({
      author: { id: 'u1', bot: false },
      guild: { id: 'g1' },
      content: 'hello',
      channel: { id: 'c1', sendTyping: vi.fn().mockResolvedValue(undefined) },
      mentions: { has: vi.fn().mockReturnValue(false), repliedUser: null },
      reference: null,
      reply: vi.fn().mockResolvedValue(undefined),
    });

    expect(checkLinks).toHaveBeenCalled();
    expect(recordCommunityActivity).not.toHaveBeenCalled();
  });

  it('covers reply-detection fetch branch and channels fallback', async () => {
    getConfig.mockReturnValue({
      moderation: { enabled: true },
      ai: { enabled: true }, // intentionally no channels key for || [] branch
    });

    const handlers = new Map();
    const client = { user: { id: 'bot-id' }, on: (event, fn) => handlers.set(event, fn) };
    registerMessageCreateHandler(client, {}, null);
    const handler = handlers.get('messageCreate');

    const fetch = vi.fn().mockResolvedValue({ author: { id: 'bot-id' } });
    const message = {
      author: { id: 'u1', bot: false },
      guild: { id: 'g1' },
      content: 'replying',
      channel: {
        id: 'c1',
        sendTyping: vi.fn().mockResolvedValue(undefined),
        isThread: vi.fn().mockReturnValue(false),
        messages: { fetch },
      },
      mentions: { has: vi.fn().mockReturnValue(false), repliedUser: { id: 'someone-else' } },
      reference: { messageId: 'm1' },
      reply: vi.fn().mockResolvedValue(undefined),
    };

    await handler(message);

    expect(fetch).toHaveBeenCalledWith('m1');
    expect(evaluateNow).toHaveBeenCalledWith('c1', expect.any(Object), client, null);
  });

  it('covers reaction handler partial and no-guild branches', async () => {
    const handlers = new Map();
    const client = { on: (event, fn) => handlers.set(event, fn) };
    registerReactionHandlers(client, {});

    const addHandler = handlers.get('messageReactionAdd');

    const partialReaction = {
      message: {
        id: 'm1',
        partial: true,
        fetch: vi.fn().mockResolvedValue(undefined),
        guild: { id: 'g1' },
      },
    };
    await addHandler(partialReaction, { id: 'u1', bot: false });
    expect(handleReactionAdd).toHaveBeenCalled();

    const noGuildReaction = {
      message: {
        id: 'm2',
        partial: false,
        guild: null,
      },
    };
    await addHandler(noGuildReaction, { id: 'u2', bot: false });
    expect(handleReactionAdd).toHaveBeenCalledTimes(1);
  });

  it('covers reaction remove bot/partial/starboard-disabled branches', async () => {
    const handlers = new Map();
    const client = { on: (event, fn) => handlers.set(event, fn) };
    registerReactionHandlers(client, {});

    const removeHandler = handlers.get('messageReactionRemove');

    const reaction = {
      message: {
        id: 'm1',
        partial: false,
        guild: { id: 'g1' },
      },
    };

    await removeHandler(reaction, { id: 'bot', bot: true });
    expect(handleReactionRemove).not.toHaveBeenCalled();

    const partialReaction = {
      message: {
        id: 'm2',
        partial: true,
        fetch: vi.fn().mockResolvedValue(undefined),
        guild: { id: 'g1' },
      },
    };
    getConfig.mockReturnValueOnce({ starboard: { enabled: false } });
    await removeHandler(partialReaction, { id: 'u1', bot: false });
    expect(handleReactionRemove).not.toHaveBeenCalled();
  });

  it('covers review claim handler paths', async () => {
    const handlers = new Map();
    const client = { on: (event, fn) => handlers.set(event, fn) };
    registerReviewClaimHandler(client);

    const handler = handlers.get('interactionCreate');

    await handler(makeInteraction({ isButton: () => false }));
    await handler(makeInteraction({ customId: 'not_review_claim' }));

    getConfig.mockReturnValueOnce({ review: { enabled: false } });
    await handler(makeInteraction({ customId: 'review_claim_123' }));
    expect(handleReviewClaim).not.toHaveBeenCalled();

    await handler(makeInteraction({ customId: 'review_claim_123' }));
    expect(handleReviewClaim).toHaveBeenCalledTimes(1);

    handleReviewClaim.mockRejectedValueOnce(new Error('boom'));
    const failing = makeInteraction({ customId: 'review_claim_123' });
    await handler(failing);
    expect(safeReply).toHaveBeenCalledWith(failing, expect.objectContaining({ ephemeral: true }));

    handleReviewClaim.mockRejectedValueOnce(new Error('boom'));
    const alreadyDone = makeInteraction({ customId: 'review_claim_123', replied: true });
    await handler(alreadyDone);
    expect(safeReply).not.toHaveBeenCalledWith(alreadyDone, expect.anything());
  });

  it('covers registerErrorHandlers fallback error-string branch', () => {
    const on = vi.fn();
    const client = { on };
    const processOnSpy = vi.spyOn(process, 'on').mockImplementation(() => process);

    registerErrorHandlers(client);

    const unhandled = processOnSpy.mock.calls.find((c) => c[0] === 'unhandledRejection')?.[1];
    expect(unhandled).toBeTypeOf('function');

    // no .message on purpose, so String(err) branch executes
    unhandled(undefined);

    // second call should skip process.on registration
    registerErrorHandlers(client);

    const unhandledRegCalls = processOnSpy.mock.calls.filter((c) => c[0] === 'unhandledRejection');
    expect(unhandledRegCalls).toHaveLength(1);

    processOnSpy.mockRestore();
  });
});
