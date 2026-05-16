import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { SAFE_CONFIG_KEYS } from '../src/api/utils/configAllowlist.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = join(__dirname, '..', 'config.json');
const DISCORD_SNOWFLAKE_PATTERN = /^\d{17,20}$/;
const SERVER_SPECIFIC_ID_PATTERN = /(?:channels?|roles?|channelids?|roleids?)$/i;

function getServerSpecificKey(path) {
  return String(path.findLast((part) => typeof part !== 'number') ?? '');
}

function collectServerSpecificDefaults(value, path = []) {
  if (typeof value === 'string') {
    const key = getServerSpecificKey(path);
    return SERVER_SPECIFIC_ID_PATTERN.test(key) && DISCORD_SNOWFLAKE_PATTERN.test(value)
      ? [path.join('.')]
      : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectServerSpecificDefaults(item, [...path, index]));
  }

  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) =>
      collectServerSpecificDefaults(item, [...path, key]),
    );
  }

  return [];
}

describe('config.json', () => {
  let config;

  beforeAll(() => {
    const raw = readFileSync(configPath, 'utf-8');
    config = JSON.parse(raw);
  });

  it('should be valid JSON', () => {
    expect(typeof config).toBe('object');
    expect(config).not.toBeNull();
  });

  it('should have an ai section', () => {
    expect(config).toHaveProperty('ai');
    expect(typeof config.ai.enabled).toBe('boolean');
    expect(typeof config.ai.systemPrompt).toBe('string');
    expect(Array.isArray(config.ai.channels)).toBe(true);
  });

  it('should have a triage section', () => {
    expect(config).toHaveProperty('triage');
    expect(typeof config.triage.enabled).toBe('boolean');
    expect(typeof config.triage.defaultInterval).toBe('number');
    expect(typeof config.triage.maxBufferSize).toBe('number');
    expect(typeof config.triage.classifyModel).toBe('string');
    expect(typeof config.triage.classifyBudget).toBe('number');
    expect(typeof config.triage.respondModel).toBe('string');
    expect(typeof config.triage.respondBudget).toBe('number');
    expect(typeof config.triage.timeout).toBe('number');
    expect(typeof config.triage.moderationResponse).toBe('boolean');
    expect(config.triage.moderationLogChannel).toBeNull();
    expect(Array.isArray(config.triage.triggerWords)).toBe(true);
    expect(Array.isArray(config.triage.moderationKeywords)).toBe(true);
  });

  it('should have a welcome section', () => {
    expect(config).toHaveProperty('welcome');
    expect(typeof config.welcome.enabled).toBe('boolean');
    expect(config.welcome.channelId).toBeNull();
    expect(config.welcome).not.toHaveProperty('roleMenuChannel');
    expect(config.welcome).not.toHaveProperty('roleMenu');
    expect(config.welcome.returningMessage).toBe(
      'Welcome back, {{user}}! Glad to see you again. Jump back in whenever you are ready.',
    );
  });

  it('should have a moderation section', () => {
    expect(config).toHaveProperty('moderation');
    expect(typeof config.moderation.enabled).toBe('boolean');
    expect(config.moderation.alertChannelId).toBeNull();
  });

  it('should not seed server-specific channel or role IDs', () => {
    expect(collectServerSpecificDefaults(config)).toEqual([]);
  });

  it('should detect server-specific channel and role IDs inside arrays', () => {
    expect(
      collectServerSpecificDefaults({
        ai: {
          blockedChannelIds: ['123456789012345678'],
        },
        triage: {
          channels: ['234567890123456789'],
        },
        permissions: {
          adminRoleIds: ['345678901234567890'],
          allowedRoles: ['456789012345678901'],
        },
      }),
    ).toEqual([
      'ai.blockedChannelIds.0',
      'triage.channels.0',
      'permissions.adminRoleIds.0',
      'permissions.allowedRoles.0',
    ]);
  });

  it('should have a permissions section', () => {
    expect(config).toHaveProperty('permissions');
    expect(typeof config.permissions.enabled).toBe('boolean');
    expect(config.permissions).toHaveProperty('allowedCommands');
  });

  it('should enable engagement and AI summary defaults without AFK config', () => {
    expect(config).toHaveProperty('engagement');
    expect(config.engagement.enabled).toBe(true);
    expect(config.engagement.trackMessages).toBe(true);
    expect(config.engagement.trackReactions).toBe(true);
    expect(config.reputation.enabled).toBe(true);
    expect(config.tldr.enabled).toBe(true);
    expect(config).not.toHaveProperty('afk');
    expect(SAFE_CONFIG_KEYS.has('afk')).toBe(false);
  });

  it('should have a logging section', () => {
    expect(config).toHaveProperty('logging');
    expect(typeof config.logging.level).toBe('string');
  });
});
