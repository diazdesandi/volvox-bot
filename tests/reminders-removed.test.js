import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { READABLE_CONFIG_KEYS, SAFE_CONFIG_KEYS } from '../src/api/utils/configAllowlist.js';
import { validateSingleValue } from '../src/api/utils/configValidation.js';

const root = process.cwd();

function readRepoFile(path) {
  return readFileSync(resolve(root, path), 'utf8');
}

describe('removed reminders feature', () => {
  it('does not ship reminder command or handler modules', () => {
    expect(existsSync(resolve(root, 'src/commands/remind.js'))).toBe(false);
    expect(existsSync(resolve(root, 'src/modules/reminderHandler.js'))).toBe(false);
    expect(existsSync(resolve(root, 'src/modules/handlers/reminderHandler.js'))).toBe(false);
  });

  it('does not route reminder interactions or scheduler polling', () => {
    expect(readRepoFile('src/modules/events/interactionCreate.js')).not.toMatch(/reminderHandler/i);
    expect(readRepoFile('src/modules/scheduler.js')).not.toMatch(/checkReminders|reminderHandler/i);
  });

  it('does not expose reminders as configurable API state', () => {
    expect(SAFE_CONFIG_KEYS.has('reminders')).toBe(false);
    expect(READABLE_CONFIG_KEYS).not.toContain('reminders');
    expect(validateSingleValue('reminders.maxPerUser', 0)).toEqual([]);
    expect(validateSingleValue('reminders.maxPerUser', 25)).toEqual([]);
  });

  it('does not keep reminder defaults or command permissions', () => {
    const config = JSON.parse(readRepoFile('config.json'));

    expect(config.reminders).toBeUndefined();
    expect(config.permissions?.commands?.remind).toBeUndefined();
  });

  it('does not create reminder tables for fresh installs', () => {
    const initialSchema = readRepoFile('migrations/001_initial-schema.cjs');

    expect(initialSchema).not.toMatch(/CREATE TABLE IF NOT EXISTS reminders/i);
    expect(initialSchema).not.toMatch(/idx_reminders_/i);
  });
});
