import { describe, expect, it } from 'vitest';
import type { GuildConfig } from '@/lib/config-utils';
import {
  updateSectionEnabled,
  updateSectionField,
  updateNestedField,
  updateArrayItem,
  removeArrayItem,
  appendArrayItem,
} from '@/lib/config-updates';

describe('config-updates', () => {
  const baseConfig: GuildConfig = {
    ai: { enabled: false, systemPrompt: '' },
    welcome: {
      enabled: true,
      message: 'Hello!',
      dmSequence: { enabled: true, steps: ['Option 1', 'Option 2'] },
    },
    moderation: {
      enabled: false,
      rateLimit: {
        enabled: true,
        maxMessages: 10,
      },
    },
  };

  describe('updateSectionEnabled', () => {
    it('updates section enabled flag', () => {
      const result = updateSectionEnabled(baseConfig, 'ai', true);
      expect(result.ai?.enabled).toBe(true);
    });

    it('preserves other section fields', () => {
      const result = updateSectionEnabled(baseConfig, 'ai', true);
      expect(result.ai?.systemPrompt).toBe('');
    });

    it('creates section if it does not exist', () => {
      const config: GuildConfig = {};
      const result = updateSectionEnabled(config, 'starboard', true);
      expect(result.starboard?.enabled).toBe(true);
    });

    it('does not mutate original config', () => {
      const original = { ...baseConfig };
      updateSectionEnabled(baseConfig, 'ai', true);
      expect(baseConfig.ai?.enabled).toBe(original.ai?.enabled);
    });
  });

  describe('updateSectionField', () => {
    it('updates a field within a section', () => {
      const result = updateSectionField(baseConfig, 'welcome', 'message', 'New message');
      expect(result.welcome?.message).toBe('New message');
    });

    it('preserves other fields in the section', () => {
      const result = updateSectionField(baseConfig, 'welcome', 'message', 'New message');
      expect(result.welcome?.enabled).toBe(true);
    });

    it('creates section if it does not exist', () => {
      const config: GuildConfig = {};
      const result = updateSectionField(config, 'permissions', 'adminRoleId', '123');
      expect(result.permissions?.adminRoleId).toBe('123');
    });
  });

  describe('updateNestedField', () => {
    it('updates a nested field', () => {
      const result = updateNestedField(baseConfig, 'moderation', 'rateLimit', 'maxMessages', 20);
      expect(result.moderation?.rateLimit?.maxMessages).toBe(20);
    });

    it('preserves sibling nested fields', () => {
      const result = updateNestedField(baseConfig, 'moderation', 'rateLimit', 'maxMessages', 20);
      expect(result.moderation?.rateLimit?.enabled).toBe(true);
    });

    it('creates nested object if it does not exist', () => {
      const config: GuildConfig = { moderation: { enabled: true } };
      const result = updateNestedField(config, 'moderation', 'linkFilter', 'enabled', true);
      expect(result.moderation?.linkFilter?.enabled).toBe(true);
    });
  });

  describe('updateArrayItem', () => {
    it('updates an item at specified index', () => {
      const newOption = 'Updated';
      const result = updateArrayItem(baseConfig, 'welcome', ['dmSequence', 'steps'], 0, newOption);
      expect(result.welcome?.dmSequence?.steps?.[0]).toEqual(newOption);
    });

    it('preserves other array items', () => {
      const newOption = 'Updated';
      const result = updateArrayItem(baseConfig, 'welcome', ['dmSequence', 'steps'], 0, newOption);
      expect(result.welcome?.dmSequence?.steps?.[1]).toEqual(
        baseConfig.welcome?.dmSequence?.steps?.[1],
      );
    });

    it('creates array if it does not exist', () => {
      const config: GuildConfig = { welcome: { enabled: true } };
      const newOption = 'New';
      const result = updateArrayItem(config, 'welcome', ['dmSequence', 'steps'], 0, newOption);
      expect(result.welcome?.dmSequence?.steps).toHaveLength(1);
      expect(result.welcome?.dmSequence?.steps?.[0]).toEqual(newOption);
    });
  });

  describe('removeArrayItem', () => {
    it('removes item at specified index', () => {
      const result = removeArrayItem(baseConfig, 'welcome', ['dmSequence', 'steps'], 0);
      expect(result.welcome?.dmSequence?.steps).toHaveLength(1);
      expect(result.welcome?.dmSequence?.steps?.[0]).toBe('Option 2');
    });

    it('handles removing last item', () => {
      const config: GuildConfig = {
        welcome: {
          dmSequence: { steps: ['Only'] },
        },
      };
      const result = removeArrayItem(config, 'welcome', ['dmSequence', 'steps'], 0);
      expect(result.welcome?.dmSequence?.steps).toHaveLength(0);
    });

    it('handles empty array gracefully', () => {
      const config: GuildConfig = { welcome: { dmSequence: { steps: [] } } };
      const result = removeArrayItem(config, 'welcome', ['dmSequence', 'steps'], 0);
      expect(result.welcome?.dmSequence?.steps).toHaveLength(0);
    });
  });

  describe('appendArrayItem', () => {
    it('appends item to array', () => {
      const newOption = 'Option 3';
      const result = appendArrayItem(baseConfig, 'welcome', ['dmSequence', 'steps'], newOption);
      expect(result.welcome?.dmSequence?.steps).toHaveLength(3);
      expect(result.welcome?.dmSequence?.steps?.[2]).toEqual(newOption);
    });

    it('creates array if it does not exist', () => {
      const config: GuildConfig = { welcome: { enabled: true } };
      const newOption = 'First';
      const result = appendArrayItem(config, 'welcome', ['dmSequence', 'steps'], newOption);
      expect(result.welcome?.dmSequence?.steps).toHaveLength(1);
      expect(result.welcome?.dmSequence?.steps?.[0]).toEqual(newOption);
    });

    it('preserves existing items', () => {
      const newOption = 'Option 3';
      const result = appendArrayItem(baseConfig, 'welcome', ['dmSequence', 'steps'], newOption);
      expect(result.welcome?.dmSequence?.steps?.[0]).toEqual(
        baseConfig.welcome?.dmSequence?.steps?.[0],
      );
      expect(result.welcome?.dmSequence?.steps?.[1]).toEqual(
        baseConfig.welcome?.dmSequence?.steps?.[1],
      );
    });
  });
});
