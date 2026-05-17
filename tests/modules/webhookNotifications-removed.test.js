import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('removed webhook notification runtime', () => {
  it('does not ship the outbound webhook notifier module', () => {
    expect(existsSync(resolve(process.cwd(), 'src/modules/webhookNotifier.js'))).toBe(false);
    expect(existsSync(resolve(process.cwd(), 'src/api/utils/webhook.js'))).toBe(false);
    expect(existsSync(resolve(process.cwd(), 'src/modules/actions/webhook.js'))).toBe(false);
  });

  it('does not import the outbound notifier from runtime or API entrypoints', () => {
    const sourceFiles = [
      'src/api/index.js',
      'src/api/routes/config.js',
      'src/api/routes/guilds.js',
      'src/config-listeners.js',
      'src/modules/levelUpActions.js',
      'src/modules/moderation.js',
      'web/src/components/dashboard/xp-level-actions-editor.tsx',
      'web/src/types/config.ts',
    ];

    for (const file of sourceFiles) {
      const source = readFileSync(resolve(process.cwd(), file), 'utf8');

      expect(source).not.toContain('webhookNotifier');
      expect(source).not.toContain('fireEvent');
      expect(source).not.toContain('fireAndForgetWebhook');
      expect(source).not.toContain('CONFIG_CHANGE_WEBHOOK_URL');
      expect(source).not.toContain('DASHBOARD_WEBHOOK_URL');
      expect(source).not.toContain('notificationsRouter');
      expect(source).not.toContain("registerAction('webhook'");
      expect(source).not.toContain('Run Webhook');
      expect(source).not.toContain("type: 'webhook'");
    }
  });
});
