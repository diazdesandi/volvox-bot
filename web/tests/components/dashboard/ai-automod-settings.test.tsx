import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { GuildConfig } from '@/components/dashboard/config-editor-utils';
import type { AiAutoModDmNotificationAction } from '@/types/config';

vi.mock('@/components/ui/select', () => import('../../helpers/mock-select'));

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

vi.mock('@/components/ui/channel-selector', () => ({
  ChannelSelector: ({ id }: { id?: string }) => (
    <div data-testid={id ? `channel-selector-${id}` : 'channel-selector'} />
  ),
}));

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

import {
  AiAutoModSettings,
  toggleAiAutoModCategoryAction,
} from '@/components/dashboard/config-categories/ai-automod-settings';

type AiAutoModSettingsProps = Parameters<typeof AiAutoModSettings>[0];
type AiAutoModActions = NonNullable<NonNullable<GuildConfig['aiAutoMod']>['actions']>;

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

function renderAiAutoModSettings(
  draftConfig: GuildConfig = createDraftConfig(),
  props: {
    saving?: boolean;
    guildId?: string;
    modelValue?: string;
    onFieldChange?: ReturnType<typeof vi.fn<AiAutoModSettingsProps['onFieldChange']>>;
    onActionChange?: ReturnType<typeof vi.fn<AiAutoModSettingsProps['onActionChange']>>;
    onDmNotificationChange?: ReturnType<
      typeof vi.fn<AiAutoModSettingsProps['onDmNotificationChange']>
    >;
  } = {},
) {
  const {
    saving = false,
    guildId = 'guild-1',
    modelValue = 'minimax:MiniMax-M2.7',
    onFieldChange = vi.fn<AiAutoModSettingsProps['onFieldChange']>(),
    onActionChange = vi.fn<AiAutoModSettingsProps['onActionChange']>(),
    onDmNotificationChange = vi.fn<AiAutoModSettingsProps['onDmNotificationChange']>(),
  } = props;

  render(
    <AiAutoModSettings
      draftConfig={draftConfig}
      saving={saving}
      guildId={guildId}
      modelValue={modelValue}
      onFieldChange={onFieldChange as AiAutoModSettingsProps['onFieldChange']}
      onActionChange={onActionChange}
      onDmNotificationChange={onDmNotificationChange}
    />,
  );

  return { onFieldChange, onActionChange, onDmNotificationChange };
}

describe('AiAutoModSettings', () => {
  describe('rendering', () => {
    it('renders core moderation section heading and subheading', () => {
      renderAiAutoModSettings();

      expect(screen.getByText('Core Moderation Settings')).toBeInTheDocument();
      expect(screen.getByText('Incident reporting and enforcements')).toBeInTheDocument();
    });

    it('renders sensitivity and actions section', () => {
      renderAiAutoModSettings();

      expect(screen.getByText('Sensitivity & Actions')).toBeInTheDocument();
      expect(screen.getByText('Confidence thresholds and response matrix')).toBeInTheDocument();
    });

    it('renders all AI auto-moderation categories', () => {
      renderAiAutoModSettings();

      expect(screen.getByText('Toxicity')).toBeInTheDocument();
      expect(screen.getByText('Spam')).toBeInTheDocument();
      expect(screen.getByText('Harassment')).toBeInTheDocument();
      expect(screen.getByText('Hate Speech')).toBeInTheDocument();
      expect(screen.getByText('Sexual Content')).toBeInTheDocument();
      expect(screen.getByText('Violence')).toBeInTheDocument();
      expect(screen.getByText('Self-Harm')).toBeInTheDocument();
    });

    it('renders category thresholds scaled to 0-100 percent', () => {
      renderAiAutoModSettings();

      expect(screen.getByLabelText('Toxicity Threshold')).toHaveValue(70);
      expect(screen.getByLabelText('Violence Threshold')).toHaveValue(85);
      expect(screen.getByLabelText('Spam Threshold')).toHaveValue(80);
    });

    it('renders checked action checkboxes for configured actions', () => {
      renderAiAutoModSettings();

      expect(screen.getByLabelText('Violence Permanent Ban')).toBeChecked();
      expect(screen.getByLabelText('Toxicity Flag & Log')).toBeChecked();
      expect(screen.getByLabelText('Harassment Issue Warning')).toBeChecked();
      expect(screen.getByLabelText('Violence Flag & Log')).not.toBeChecked();
    });

    it('shows "No response actions" placeholder when a category has no actions', () => {
      const draftConfig = createDraftConfig({
        aiAutoMod: {
          actions: { toxicity: [] } as unknown as NonNullable<GuildConfig['aiAutoMod']>['actions'],
        } as NonNullable<GuildConfig['aiAutoMod']>,
      });

      renderAiAutoModSettings(draftConfig);

      expect(screen.getByText('No response actions')).toBeInTheDocument();
    });

    it('renders User DM Notifications section with "One DM per incident" badge', () => {
      renderAiAutoModSettings();

      expect(screen.getByText('User DM Notifications')).toBeInTheDocument();
      expect(screen.getByText('One DM per incident')).toBeInTheDocument();
    });

    it('renders all four DM notification options with descriptions', () => {
      renderAiAutoModSettings();

      expect(screen.getByLabelText('DM notifications for Warnings')).toBeInTheDocument();
      expect(screen.getByLabelText('DM notifications for Timeouts')).toBeInTheDocument();
      expect(screen.getByLabelText('DM notifications for Kicks')).toBeInTheDocument();
      expect(screen.getByLabelText('DM notifications for Bans')).toBeInTheDocument();

      expect(screen.getByText('DM when AI AutoMod issues a warning.')).toBeInTheDocument();
      expect(screen.getByText('DM when AI AutoMod applies a timeout.')).toBeInTheDocument();
      expect(screen.getByText('DM when AI AutoMod removes a member.')).toBeInTheDocument();
      expect(screen.getByText('DM when AI AutoMod bans a member.')).toBeInTheDocument();
    });

    it('renders DM notification checkboxes as checked when dmNotifications are all true', () => {
      renderAiAutoModSettings();

      expect(screen.getByLabelText('DM notifications for Warnings')).toBeChecked();
      expect(screen.getByLabelText('DM notifications for Timeouts')).toBeChecked();
      expect(screen.getByLabelText('DM notifications for Kicks')).toBeChecked();
      expect(screen.getByLabelText('DM notifications for Bans')).toBeChecked();
    });

    it('renders DM notification checkboxes reflecting false settings', () => {
      const draftConfig = createDraftConfig({
        aiAutoMod: {
          ...(createDraftConfig().aiAutoMod as NonNullable<GuildConfig['aiAutoMod']>),
          dmNotifications: { warn: false, timeout: false, kick: true, ban: false },
        },
      });

      renderAiAutoModSettings(draftConfig);

      expect(screen.getByLabelText('DM notifications for Warnings')).not.toBeChecked();
      expect(screen.getByLabelText('DM notifications for Timeouts')).not.toBeChecked();
      expect(screen.getByLabelText('DM notifications for Kicks')).toBeChecked();
      expect(screen.getByLabelText('DM notifications for Bans')).not.toBeChecked();
    });

    it('renders the auto-delete toggle switch', () => {
      renderAiAutoModSettings();

      expect(screen.getByRole('button', { name: 'Auto-delete' })).toBeInTheDocument();
    });

    it('reflects autoDelete=false on the Instant Enforcement toggle', () => {
      const draftConfig = createDraftConfig({
        aiAutoMod: {
          ...(createDraftConfig().aiAutoMod as NonNullable<GuildConfig['aiAutoMod']>),
          autoDelete: false,
        },
      });

      renderAiAutoModSettings(draftConfig);

      expect(screen.getByRole('button', { name: 'Auto-delete' })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    });
  });

  describe('DM notification fallback to legacy moderation settings', () => {
    it('falls back to moderation.dmNotifications when aiAutoMod.dmNotifications is absent', () => {
      const draftConfig: GuildConfig = {
        moderation: {
          dmNotifications: { warn: false, timeout: false, kick: true, ban: false },
        },
        aiAutoMod: {
          enabled: true,
          dmNotifications: undefined,
        } as unknown as NonNullable<GuildConfig['aiAutoMod']>,
      };

      renderAiAutoModSettings(draftConfig);

      expect(screen.getByLabelText('DM notifications for Warnings')).not.toBeChecked();
      expect(screen.getByLabelText('DM notifications for Timeouts')).not.toBeChecked();
      expect(screen.getByLabelText('DM notifications for Kicks')).toBeChecked();
      expect(screen.getByLabelText('DM notifications for Bans')).not.toBeChecked();
    });

    it('gives aiAutoMod.dmNotifications precedence over moderation.dmNotifications', () => {
      const draftConfig: GuildConfig = {
        moderation: {
          dmNotifications: { warn: false, timeout: false, kick: false, ban: false },
        },
        aiAutoMod: {
          enabled: true,
          dmNotifications: { warn: true, timeout: false, kick: false, ban: true },
        } as NonNullable<GuildConfig['aiAutoMod']>,
      };

      renderAiAutoModSettings(draftConfig);

      expect(screen.getByLabelText('DM notifications for Warnings')).toBeChecked();
      expect(screen.getByLabelText('DM notifications for Timeouts')).not.toBeChecked();
      expect(screen.getByLabelText('DM notifications for Kicks')).not.toBeChecked();
      expect(screen.getByLabelText('DM notifications for Bans')).toBeChecked();
    });

    it('defaults DM notifications to enabled when both aiAutoMod and moderation are absent', () => {
      const draftConfig: GuildConfig = {
        aiAutoMod: {
          enabled: true,
          dmNotifications: undefined,
        } as unknown as NonNullable<GuildConfig['aiAutoMod']>,
      };

      renderAiAutoModSettings(draftConfig);

      expect(screen.getByLabelText('DM notifications for Warnings')).toBeChecked();
      expect(screen.getByLabelText('DM notifications for Timeouts')).toBeChecked();
      expect(screen.getByLabelText('DM notifications for Kicks')).toBeChecked();
      expect(screen.getByLabelText('DM notifications for Bans')).toBeChecked();
    });
  });

  describe('interaction handlers', () => {
    it('calls onFieldChange with "model" when the model selector changes', () => {
      const { onFieldChange } = renderAiAutoModSettings();

      fireEvent.change(screen.getByLabelText('Detection Model'), {
        target: { value: 'moonshot:kimi-k2.6' },
      });

      expect(onFieldChange).toHaveBeenCalledWith('model', 'moonshot:kimi-k2.6');
    });

    it('calls onFieldChange with "autoDelete" when Instant Enforcement toggle is clicked', () => {
      const { onFieldChange } = renderAiAutoModSettings();

      fireEvent.click(screen.getByRole('button', { name: 'Auto-delete' }));

      expect(onFieldChange).toHaveBeenCalledWith('autoDelete', false);
    });

    it('calls onFieldChange with "thresholds" updater when a threshold input changes', () => {
      const { onFieldChange } = renderAiAutoModSettings();

      fireEvent.change(screen.getByLabelText('Toxicity Threshold'), {
        target: { value: '55' },
      });

      expect(onFieldChange).toHaveBeenCalledTimes(1);
      const [field, updater] = onFieldChange.mock.calls[0] as [
        string,
        (prev: Record<string, number>) => Record<string, number>,
      ];
      expect(field).toBe('thresholds');
      expect(typeof updater).toBe('function');
      const result = updater({ toxicity: 0.7 });
      expect(result.toxicity).toBeCloseTo(0.55);
    });

    it('clamps threshold values above 100 to 1.0', () => {
      const { onFieldChange } = renderAiAutoModSettings();

      fireEvent.change(screen.getByLabelText('Toxicity Threshold'), {
        target: { value: '150' },
      });

      const updater = onFieldChange.mock.calls[0]?.[1] as (
        prev: Record<string, number>,
      ) => Record<string, number>;
      expect(updater({}).toxicity).toBe(1);
    });

    it('clamps threshold values below 0 to 0.0', () => {
      const { onFieldChange } = renderAiAutoModSettings();

      fireEvent.change(screen.getByLabelText('Toxicity Threshold'), {
        target: { value: '-10' },
      });

      const updater = onFieldChange.mock.calls[0]?.[1] as (
        prev: Record<string, number>,
      ) => Record<string, number>;
      expect(updater({}).toxicity).toBe(0);
    });

    it('calls onActionChange when an action checkbox is toggled', () => {
      const { onActionChange } = renderAiAutoModSettings();

      fireEvent.click(screen.getByLabelText('Toxicity Issue Warning'));

      expect(onActionChange).toHaveBeenCalledWith(
        'toxicity',
        ['flag'],
        'warn',
        true,
      );
    });

    it('calls onDmNotificationChange with action and false when a checked DM toggle is unchecked', () => {
      const { onDmNotificationChange } = renderAiAutoModSettings();

      fireEvent.click(screen.getByLabelText('DM notifications for Warnings'));

      expect(onDmNotificationChange).toHaveBeenCalledWith('warn', false);
    });

    it('calls onDmNotificationChange with action and true when an unchecked DM toggle is checked', () => {
      const draftConfig = createDraftConfig({
        aiAutoMod: {
          ...(createDraftConfig().aiAutoMod as NonNullable<GuildConfig['aiAutoMod']>),
          dmNotifications: { warn: false, timeout: true, kick: true, ban: true },
        },
      });
      const { onDmNotificationChange } = renderAiAutoModSettings(draftConfig);

      fireEvent.click(screen.getByLabelText('DM notifications for Warnings'));

      expect(onDmNotificationChange).toHaveBeenCalledWith('warn', true);
    });

    it.each<[AiAutoModDmNotificationAction, string]>([
      ['warn', 'Warnings'],
      ['timeout', 'Timeouts'],
      ['kick', 'Kicks'],
      ['ban', 'Bans'],
    ])(
      'calls onDmNotificationChange with "%s" when the %s checkbox is clicked',
      (action, label) => {
        const draftConfig = createDraftConfig({
          aiAutoMod: {
            ...(createDraftConfig().aiAutoMod as NonNullable<GuildConfig['aiAutoMod']>),
            dmNotifications: { warn: true, timeout: true, kick: true, ban: true },
          },
        });
        const { onDmNotificationChange } = renderAiAutoModSettings(draftConfig);

        fireEvent.click(screen.getByLabelText(`DM notifications for ${label}`));

        expect(onDmNotificationChange).toHaveBeenCalledWith(action, false);
      },
    );
  });

  describe('disabled state', () => {
    it('disables all threshold inputs when saving=true', () => {
      renderAiAutoModSettings(createDraftConfig(), { saving: true });

      for (const input of screen.getAllByRole('spinbutton')) {
        expect(input).toBeDisabled();
      }
    });

    it('disables all action checkboxes when saving=true', () => {
      renderAiAutoModSettings(createDraftConfig(), { saving: true });

      for (const checkbox of screen.getAllByRole('checkbox')) {
        expect(checkbox).toBeDisabled();
      }
    });

    it('disables auto-delete toggle button when saving=true', () => {
      renderAiAutoModSettings(createDraftConfig(), { saving: true });

      expect(screen.getByRole('button', { name: 'Auto-delete' })).toBeDisabled();
    });
  });
});

describe('toggleAiAutoModCategoryAction', () => {
  it('adds an action to an empty category', () => {
    const result = toggleAiAutoModCategoryAction({}, 'toxicity', ['flag'], 'warn', true);
    expect(result.toxicity).toEqual(['warn']);
  });

  it('adds an action while preserving existing actions in correct order', () => {
    const result = toggleAiAutoModCategoryAction(
      { toxicity: ['flag'] },
      'toxicity',
      ['flag'],
      'warn',
      true,
    );
    expect(result.toxicity).toEqual(['flag', 'warn']);
  });

  it('respects canonical action order when adding actions', () => {
    const result = toggleAiAutoModCategoryAction(
      { toxicity: ['warn'] },
      'toxicity',
      ['warn'],
      'flag',
      true,
    );
    // 'flag' comes before 'warn' in action order
    expect(result.toxicity).toEqual(['flag', 'warn']);
  });

  it('removes an action when checked=false', () => {
    const result = toggleAiAutoModCategoryAction(
      { toxicity: ['flag', 'warn'] },
      'toxicity',
      ['flag'],
      'warn',
      false,
    );
    expect(result.toxicity).toEqual(['flag']);
  });

  it('returns empty array when removing the last action', () => {
    const result = toggleAiAutoModCategoryAction(
      { toxicity: ['flag'] },
      'toxicity',
      ['flag'],
      'flag',
      false,
    );
    expect(result.toxicity).toEqual([]);
  });

  it('preserves actions for other categories', () => {
    const previousActions: AiAutoModActions = {
      toxicity: ['flag'],
      spam: ['delete'],
      harassment: ['warn'],
    };
    const result = toggleAiAutoModCategoryAction(
      previousActions,
      'toxicity',
      ['flag'],
      'ban',
      true,
    );
    expect(result.spam).toEqual(['delete']);
    expect(result.harassment).toEqual(['warn']);
  });

  it('handles undefined previousActions as an empty map', () => {
    const result = toggleAiAutoModCategoryAction(undefined, 'toxicity', ['flag'], 'warn', true);
    expect(result.toxicity).toEqual(['warn']);
  });

  it('normalizes a legacy string action before toggling', () => {
    const previousActions = {
      toxicity: 'flag',
    } as unknown as NonNullable<NonNullable<GuildConfig['aiAutoMod']>['actions']>;
    const result = toggleAiAutoModCategoryAction(
      previousActions,
      'toxicity',
      ['flag'],
      'warn',
      true,
    );
    expect(result.toxicity).toEqual(['flag', 'warn']);
  });

  it('normalizes a "none" string action to empty before adding', () => {
    const previousActions = {
      toxicity: 'none',
    } as unknown as NonNullable<NonNullable<GuildConfig['aiAutoMod']>['actions']>;
    const result = toggleAiAutoModCategoryAction(
      previousActions,
      'toxicity',
      ['flag'],
      'warn',
      true,
    );
    expect(result.toxicity).toEqual(['warn']);
  });

  it('does not duplicate an action that is already present', () => {
    const result = toggleAiAutoModCategoryAction(
      { toxicity: ['flag', 'warn'] },
      'toxicity',
      ['flag'],
      'flag',
      true,
    );
    expect(result.toxicity).toEqual(['flag', 'warn']);
  });

  it('uses fallback actions when category key is absent from previousActions', () => {
    const result = toggleAiAutoModCategoryAction(
      { spam: ['delete'] },
      'toxicity',
      ['flag'],
      'warn',
      true,
    );
    // toxicity was absent, so fallback ['flag'] is used, then 'warn' added
    expect(result.toxicity).toEqual(['flag', 'warn']);
  });
});
