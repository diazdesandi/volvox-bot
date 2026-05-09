import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { GuildConfig } from '@/components/dashboard/config-editor-utils';

vi.mock('@/components/ui/select', () => import('../../helpers/mock-select'));

vi.mock('@/components/dashboard/toggle-switch', () => ({
  ToggleSwitch: ({
    checked,
    disabled,
    label,
    onChange,
  }: {
    checked: boolean;
    disabled?: boolean;
    label: string;
    onChange: (checked: boolean) => void;
  }) => (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={checked}
      onClick={() => {
        if (!disabled) onChange(!checked);
      }}
    >
      {label}
    </button>
  ),
}));

vi.mock('@/components/ui/channel-selector', () => ({
  ChannelSelector: ({ id }: { id?: string }) => (
    <div data-testid={id ? `channel-selector-${id}` : 'channel-selector'} />
  ),
}));

vi.mock('@/lib/provider-model-options', () => ({
  DEFAULT_AI_MODEL: 'minimax:MiniMax-M2.7',
  VISIBLE_PROVIDER_MODEL_OPTION_GROUPS: [
    {
      providerName: 'minimax',
      providerDisplayName: 'MiniMax',
      options: [
        {
          value: 'minimax:MiniMax-M2.7',
          label: 'MiniMax M2.7',
          providerName: 'minimax',
          providerDisplayName: 'MiniMax',
          modelName: 'MiniMax-M2.7',
          modelDisplayName: 'MiniMax M2.7',
        },
      ],
    },
    {
      providerName: 'moonshot',
      providerDisplayName: 'Moonshot',
      options: [
        {
          value: 'moonshot:kimi-k2.6',
          label: 'Kimi K2.6',
          providerName: 'moonshot',
          providerDisplayName: 'Moonshot',
          modelName: 'kimi-k2.6',
          modelDisplayName: 'Kimi K2.6',
        },
      ],
    },
  ],
  VISIBLE_PROVIDER_MODEL_OPTIONS: [
    {
      value: 'minimax:MiniMax-M2.7',
      label: 'MiniMax M2.7',
      providerName: 'minimax',
      providerDisplayName: 'MiniMax',
      modelName: 'MiniMax-M2.7',
      modelDisplayName: 'MiniMax M2.7',
    },
    {
      value: 'moonshot:kimi-k2.6',
      label: 'Kimi K2.6',
      providerName: 'moonshot',
      providerDisplayName: 'Moonshot',
      modelName: 'kimi-k2.6',
      modelDisplayName: 'Kimi K2.6',
    },
  ],
  getVisibleProviderModelValue: (value: string | null | undefined) => {
    if (typeof value === 'string' && value) return value;
    return 'minimax:MiniMax-M2.7';
  },
}));

import {
  AiAutoModSettings,
  toggleAiAutoModCategoryAction,
} from '@/components/dashboard/config-categories/ai-automod-settings';

function createDraftConfig(overrides: Partial<GuildConfig> = {}): GuildConfig {
  return {
    aiAutoMod: {
      enabled: true,
      model: 'minimax:MiniMax-M2.7',
      thresholds: {
        toxicity: 0.7,
        spam: 0.8,
        harassment: 0.7,
        hateSpeech: 0.8,
        sexualContent: 0.8,
        violence: 0.85,
        selfHarm: 0.7,
      },
      actions: {
        toxicity: ['flag'],
        spam: ['delete'],
        harassment: ['warn'],
        hateSpeech: ['timeout'],
        sexualContent: ['delete'],
        violence: ['ban'],
        selfHarm: ['flag'],
      },
      timeoutDurationMs: 300000,
      flagChannelId: null,
      autoDelete: true,
      exemptRoleIds: [],
      dmNotifications: {
        warn: true,
        timeout: true,
        kick: true,
        ban: true,
      },
    },
    ...overrides,
  };
}

function renderAiAutoModSettings({
  draftConfig = createDraftConfig(),
  saving = false,
  guildId = 'guild-1',
  modelValue = 'minimax:MiniMax-M2.7',
  onFieldChange = vi.fn(),
  onActionChange = vi.fn(),
  onDmNotificationChange = vi.fn(),
}: Partial<React.ComponentProps<typeof AiAutoModSettings>> = {}) {
  return render(
    <AiAutoModSettings
      draftConfig={draftConfig}
      saving={saving}
      guildId={guildId}
      modelValue={modelValue}
      onFieldChange={onFieldChange}
      onActionChange={onActionChange}
      onDmNotificationChange={onDmNotificationChange}
    />,
  );
}

describe('AiAutoModSettings', () => {
  describe('Core Moderation Settings', () => {
    it('renders the detection model selector with the provided model value', () => {
      renderAiAutoModSettings({ modelValue: 'minimax:MiniMax-M2.7' });

      expect(screen.getByLabelText('Detection Model')).toHaveValue('minimax:MiniMax-M2.7');
    });

    it('calls onFieldChange with new model when detection model is changed', () => {
      const onFieldChange = vi.fn();
      renderAiAutoModSettings({ onFieldChange, modelValue: 'minimax:MiniMax-M2.7' });

      fireEvent.change(screen.getByLabelText('Detection Model'), {
        target: { value: 'moonshot:kimi-k2.6' },
      });

      expect(onFieldChange).toHaveBeenCalledWith('model', 'moonshot:kimi-k2.6');
    });

    it('renders the incident report channel selector', () => {
      renderAiAutoModSettings();

      expect(screen.getByTestId('channel-selector-ai-automod-flag-channel')).toBeInTheDocument();
    });

    it('renders the auto-delete instant enforcement toggle as enabled when autoDelete is true', () => {
      renderAiAutoModSettings({ draftConfig: createDraftConfig({ aiAutoMod: { autoDelete: true } }) });

      expect(screen.getByRole('button', { name: 'Auto-delete' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });

    it('renders the auto-delete toggle as disabled when autoDelete is false', () => {
      renderAiAutoModSettings({ draftConfig: createDraftConfig({ aiAutoMod: { autoDelete: false } }) });

      expect(screen.getByRole('button', { name: 'Auto-delete' })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    });

    it('defaults auto-delete toggle to enabled when autoDelete field is absent', () => {
      const config = createDraftConfig();
      if (config.aiAutoMod) delete (config.aiAutoMod as { autoDelete?: boolean }).autoDelete;
      renderAiAutoModSettings({ draftConfig: config });

      expect(screen.getByRole('button', { name: 'Auto-delete' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });

    it('calls onFieldChange with toggled value when auto-delete button is clicked', () => {
      const onFieldChange = vi.fn();
      renderAiAutoModSettings({
        draftConfig: createDraftConfig({ aiAutoMod: { autoDelete: true } }),
        onFieldChange,
      });

      fireEvent.click(screen.getByRole('button', { name: 'Auto-delete' }));

      expect(onFieldChange).toHaveBeenCalledWith('autoDelete', false);
    });

    it('disables all interactive controls when saving is true', () => {
      renderAiAutoModSettings({ saving: true });

      expect(screen.getByLabelText('Detection Model')).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Auto-delete' })).toBeDisabled();
      expect(screen.getByLabelText('Toxicity Threshold')).toBeDisabled();
    });
  });

  describe('Sensitivity matrix', () => {
    it('renders threshold inputs for all categories', () => {
      renderAiAutoModSettings();

      expect(screen.getByLabelText('Toxicity Threshold')).toBeInTheDocument();
      expect(screen.getByLabelText('Spam Threshold')).toBeInTheDocument();
      expect(screen.getByLabelText('Harassment Threshold')).toBeInTheDocument();
      expect(screen.getByLabelText('Hate Speech Threshold')).toBeInTheDocument();
      expect(screen.getByLabelText('Sexual Content Threshold')).toBeInTheDocument();
      expect(screen.getByLabelText('Violence Threshold')).toBeInTheDocument();
      expect(screen.getByLabelText('Self-Harm Threshold')).toBeInTheDocument();
    });

    it('shows threshold values as percentages (0–100)', () => {
      renderAiAutoModSettings();

      // toxicity default is 0.7, displayed as 70
      expect(screen.getByLabelText('Toxicity Threshold')).toHaveValue(70);
      // violence default is 0.85, displayed as 85
      expect(screen.getByLabelText('Violence Threshold')).toHaveValue(85);
    });

    it('calls onFieldChange with fractional threshold when user edits a threshold input', () => {
      const onFieldChange = vi.fn();
      renderAiAutoModSettings({ onFieldChange });

      fireEvent.change(screen.getByLabelText('Toxicity Threshold'), {
        target: { value: '60' },
      });

      // The updater function is called with previous thresholds
      expect(onFieldChange).toHaveBeenCalledWith('thresholds', expect.any(Function));
      const thresholdsUpdater = onFieldChange.mock.calls[0][1] as (prev: object) => object;
      const result = thresholdsUpdater({ spam: 0.8 });
      expect((result as Record<string, number>).toxicity).toBeCloseTo(0.6);
      expect((result as Record<string, number>).spam).toBe(0.8);
    });

    it('clamps threshold values to 0–1 range (0% → 0, >100% → 1)', () => {
      const onFieldChange = vi.fn();
      renderAiAutoModSettings({ onFieldChange });

      fireEvent.change(screen.getByLabelText('Toxicity Threshold'), {
        target: { value: '150' },
      });

      const updater = onFieldChange.mock.calls[0][1] as (prev: object) => object;
      const result = updater({});
      expect((result as Record<string, number>).toxicity).toBe(1);
    });

    it('renders action checkboxes for each category', () => {
      renderAiAutoModSettings();

      expect(screen.getByLabelText('Toxicity Flag & Log')).toBeInTheDocument();
      expect(screen.getByLabelText('Toxicity Issue Warning')).toBeInTheDocument();
      expect(screen.getByLabelText('Violence Permanent Ban')).toBeInTheDocument();
    });

    it('shows checked action checkboxes based on current actions', () => {
      renderAiAutoModSettings();

      expect(screen.getByLabelText('Toxicity Flag & Log')).toBeChecked();
      expect(screen.getByLabelText('Toxicity Issue Warning')).not.toBeChecked();
      expect(screen.getByLabelText('Violence Permanent Ban')).toBeChecked();
    });

    it('calls onActionChange when an action checkbox is toggled', () => {
      const onActionChange = vi.fn();
      renderAiAutoModSettings({ onActionChange });

      fireEvent.click(screen.getByLabelText('Toxicity Issue Warning'));

      expect(onActionChange).toHaveBeenCalledWith(
        'toxicity',
        expect.any(Array), // fallback actions
        'warn',
        true,
      );
    });

    it('displays "No response actions" placeholder when a category has no actions', () => {
      const draftConfig = createDraftConfig({
        aiAutoMod: {
          actions: {
            toxicity: [],
            spam: ['delete'],
            harassment: ['warn'],
            hateSpeech: ['timeout'],
            sexualContent: ['delete'],
            violence: ['ban'],
            selfHarm: ['flag'],
          },
        },
      });
      renderAiAutoModSettings({ draftConfig });

      expect(screen.getByText('No response actions')).toBeInTheDocument();
    });

    it('normalizes legacy "none" action strings to empty action sets', () => {
      const draftConfig = createDraftConfig({
        aiAutoMod: {
          actions: {
            toxicity: 'none' as unknown as string[],
          },
        },
      });
      renderAiAutoModSettings({ draftConfig });

      expect(screen.getByLabelText('Toxicity Flag & Log')).not.toBeChecked();
      expect(screen.getByText('No response actions')).toBeInTheDocument();
    });
  });

  describe('User DM Notifications', () => {
    it('renders DM notification toggles for all notification action types', () => {
      renderAiAutoModSettings();

      expect(screen.getByLabelText('DM notifications for Warnings')).toBeInTheDocument();
      expect(screen.getByLabelText('DM notifications for Timeouts')).toBeInTheDocument();
      expect(screen.getByLabelText('DM notifications for Kicks')).toBeInTheDocument();
      expect(screen.getByLabelText('DM notifications for Bans')).toBeInTheDocument();
    });

    it('shows all DM notification toggles as checked when dmNotifications are all true', () => {
      renderAiAutoModSettings({
        draftConfig: createDraftConfig({
          aiAutoMod: {
            dmNotifications: { warn: true, timeout: true, kick: true, ban: true },
          },
        }),
      });

      expect(screen.getByLabelText('DM notifications for Warnings')).toBeChecked();
      expect(screen.getByLabelText('DM notifications for Timeouts')).toBeChecked();
      expect(screen.getByLabelText('DM notifications for Kicks')).toBeChecked();
      expect(screen.getByLabelText('DM notifications for Bans')).toBeChecked();
    });

    it('reflects individual DM notification settings per action type', () => {
      renderAiAutoModSettings({
        draftConfig: createDraftConfig({
          aiAutoMod: {
            dmNotifications: { warn: true, timeout: false, kick: false, ban: true },
          },
        }),
      });

      expect(screen.getByLabelText('DM notifications for Warnings')).toBeChecked();
      expect(screen.getByLabelText('DM notifications for Timeouts')).not.toBeChecked();
      expect(screen.getByLabelText('DM notifications for Kicks')).not.toBeChecked();
      expect(screen.getByLabelText('DM notifications for Bans')).toBeChecked();
    });

    it('falls back to moderation dmNotifications when aiAutoMod dmNotifications are absent', () => {
      const draftConfig = createDraftConfig({
        moderation: {
          dmNotifications: { warn: false, timeout: false, kick: true, ban: false },
        },
        aiAutoMod: {
          dmNotifications: undefined,
        },
      });
      renderAiAutoModSettings({ draftConfig });

      expect(screen.getByLabelText('DM notifications for Warnings')).not.toBeChecked();
      expect(screen.getByLabelText('DM notifications for Timeouts')).not.toBeChecked();
      expect(screen.getByLabelText('DM notifications for Kicks')).toBeChecked();
      expect(screen.getByLabelText('DM notifications for Bans')).not.toBeChecked();
    });

    it('defaults to true when neither aiAutoMod nor moderation DM notifications are set', () => {
      const draftConfig: GuildConfig = {
        aiAutoMod: {
          enabled: true,
          dmNotifications: undefined,
        },
      };
      renderAiAutoModSettings({ draftConfig });

      expect(screen.getByLabelText('DM notifications for Warnings')).toBeChecked();
      expect(screen.getByLabelText('DM notifications for Bans')).toBeChecked();
    });

    it('calls onDmNotificationChange with action and new checked state when toggled', () => {
      const onDmNotificationChange = vi.fn();
      renderAiAutoModSettings({
        draftConfig: createDraftConfig({
          aiAutoMod: { dmNotifications: { warn: true, timeout: true, kick: true, ban: true } },
        }),
        onDmNotificationChange,
      });

      fireEvent.click(screen.getByLabelText('DM notifications for Timeouts'));

      expect(onDmNotificationChange).toHaveBeenCalledWith('timeout', false);
    });

    it('calls onDmNotificationChange with true when an unchecked toggle is clicked', () => {
      const onDmNotificationChange = vi.fn();
      renderAiAutoModSettings({
        draftConfig: createDraftConfig({
          aiAutoMod: { dmNotifications: { warn: false, timeout: false, kick: false, ban: false } },
        }),
        onDmNotificationChange,
      });

      fireEvent.click(screen.getByLabelText('DM notifications for Warnings'));

      expect(onDmNotificationChange).toHaveBeenCalledWith('warn', true);
    });

    it('disables all DM notification checkboxes when saving is true', () => {
      renderAiAutoModSettings({ saving: true });

      expect(screen.getByLabelText('DM notifications for Warnings')).toBeDisabled();
      expect(screen.getByLabelText('DM notifications for Timeouts')).toBeDisabled();
      expect(screen.getByLabelText('DM notifications for Kicks')).toBeDisabled();
      expect(screen.getByLabelText('DM notifications for Bans')).toBeDisabled();
    });

    it('renders the "One DM per incident" badge', () => {
      renderAiAutoModSettings();

      expect(screen.getByText('One DM per incident')).toBeInTheDocument();
    });

    it('aiAutoMod dmNotifications take precedence over moderation fallback', () => {
      renderAiAutoModSettings({
        draftConfig: createDraftConfig({
          moderation: {
            dmNotifications: { warn: false, timeout: false, kick: false, ban: false },
          },
          aiAutoMod: {
            dmNotifications: { warn: true, timeout: true, kick: true, ban: true },
          },
        }),
      });

      expect(screen.getByLabelText('DM notifications for Warnings')).toBeChecked();
      expect(screen.getByLabelText('DM notifications for Timeouts')).toBeChecked();
    });
  });
});

describe('toggleAiAutoModCategoryAction', () => {
  it('adds an action to an empty category', () => {
    const result = toggleAiAutoModCategoryAction(
      { toxicity: [] },
      'toxicity',
      ['flag'],
      'warn',
      true,
    );

    expect(result.toxicity).toEqual(['warn']);
  });

  it('removes an action from an existing set', () => {
    const result = toggleAiAutoModCategoryAction(
      { toxicity: ['flag', 'warn'] },
      'toxicity',
      ['flag'],
      'flag',
      false,
    );

    expect(result.toxicity).toEqual(['warn']);
  });

  it('preserves order based on action priority when adding', () => {
    // Action order from catalog: flag, delete, warn, timeout, kick, ban
    const result = toggleAiAutoModCategoryAction(
      { toxicity: ['ban'] },
      'toxicity',
      ['flag'],
      'flag',
      true,
    );

    expect(result.toxicity).toEqual(['flag', 'ban']);
  });

  it('uses fallback actions when the category has no previous value', () => {
    const result = toggleAiAutoModCategoryAction(
      {},
      'spam',
      ['delete', 'flag'],
      'warn',
      true,
    );

    // Started from fallback ['delete', 'flag'], added 'warn'
    expect(result.spam).toContain('warn');
    expect(result.spam).toContain('delete');
    expect(result.spam).toContain('flag');
  });

  it('preserves actions for other categories not being modified', () => {
    const previousActions = {
      toxicity: ['flag'],
      spam: ['delete'],
    };
    const result = toggleAiAutoModCategoryAction(
      previousActions,
      'toxicity',
      ['flag'],
      'warn',
      true,
    );

    expect(result.spam).toEqual(['delete']);
    expect(result.toxicity).toEqual(['flag', 'warn']);
  });

  it('does not add duplicate actions', () => {
    const result = toggleAiAutoModCategoryAction(
      { toxicity: ['flag', 'warn'] },
      'toxicity',
      ['flag'],
      'warn',
      true,
    );

    expect(result.toxicity).toEqual(['flag', 'warn']);
    expect(result.toxicity.filter((a) => a === 'warn')).toHaveLength(1);
  });

  it('handles null/undefined previousActions gracefully', () => {
    const result = toggleAiAutoModCategoryAction(
      undefined,
      'toxicity',
      ['flag'],
      'warn',
      true,
    );

    // From fallback ['flag'], add 'warn'
    expect(result.toxicity).toContain('warn');
    expect(result.toxicity).toContain('flag');
  });
});