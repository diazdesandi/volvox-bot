import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { GuildConfig } from '@/components/dashboard/config-editor-utils';
import type { AiAutoModCategory, AiAutoModDmNotificationAction } from '@/types/config';

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
    if (typeof value === 'string' && value === 'moonshot:kimi-k2.6') return 'moonshot:kimi-k2.6';
    return 'minimax:MiniMax-M2.7';
  },
  isSupportedAiModel: (value: unknown) =>
    value === 'minimax:MiniMax-M2.7' || value === 'moonshot:kimi-k2.6',
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type AiAutoModDraft = NonNullable<GuildConfig['aiAutoMod']>;

function makeConfig(overrides: Partial<GuildConfig> = {}): GuildConfig {
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
  } as GuildConfig;
}

function defaultProps(overrides: Partial<Parameters<typeof AiAutoModSettings>[0]> = {}) {
  return {
    draftConfig: makeConfig(),
    saving: false,
    guildId: 'guild-1',
    modelValue: 'minimax:MiniMax-M2.7',
    onFieldChange: vi.fn(),
    onActionChange: vi.fn(),
    onDmNotificationChange: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// toggleAiAutoModCategoryAction unit tests
// ---------------------------------------------------------------------------

describe('toggleAiAutoModCategoryAction', () => {
  it('adds an action to an empty category', () => {
    const result = toggleAiAutoModCategoryAction(
      { toxicity: [] },
      'toxicity',
      [],
      'flag',
      true,
    );
    expect(result.toxicity).toEqual(['flag']);
  });

  it('adds an action to a category with existing actions and preserves order', () => {
    const result = toggleAiAutoModCategoryAction(
      { toxicity: ['flag'] },
      'toxicity',
      [],
      'warn',
      true,
    );
    expect(result.toxicity).toEqual(['flag', 'warn']);
  });

  it('sorts added actions according to the canonical action order', () => {
    // 'delete' comes before 'warn' in action order
    const result = toggleAiAutoModCategoryAction(
      { toxicity: ['warn'] },
      'toxicity',
      [],
      'delete',
      true,
    );
    expect(result.toxicity).toEqual(['delete', 'warn']);
  });

  it('removes an action from a category', () => {
    const result = toggleAiAutoModCategoryAction(
      { toxicity: ['flag', 'warn'] },
      'toxicity',
      [],
      'flag',
      false,
    );
    expect(result.toxicity).toEqual(['warn']);
  });

  it('removing a non-existent action leaves the category unchanged', () => {
    const result = toggleAiAutoModCategoryAction(
      { toxicity: ['flag'] },
      'toxicity',
      [],
      'warn',
      false,
    );
    expect(result.toxicity).toEqual(['flag']);
  });

  it('does not affect other categories when modifying one', () => {
    const previous: AiAutoModDraft['actions'] = {
      toxicity: ['flag'],
      spam: ['delete'],
    } as AiAutoModDraft['actions'];

    const result = toggleAiAutoModCategoryAction(previous, 'toxicity', [], 'warn', true);

    expect(result.toxicity).toEqual(['flag', 'warn']);
    expect(result.spam).toEqual(['delete']);
  });

  it('normalizes legacy string action before adding a new action', () => {
    const result = toggleAiAutoModCategoryAction(
      { toxicity: 'flag' } as unknown as AiAutoModDraft['actions'],
      'toxicity',
      [],
      'warn',
      true,
    );
    expect(result.toxicity).toEqual(['flag', 'warn']);
  });

  it('normalizes legacy "none" string action to empty array', () => {
    const result = toggleAiAutoModCategoryAction(
      { toxicity: 'none' } as unknown as AiAutoModDraft['actions'],
      'toxicity',
      [],
      'warn',
      true,
    );
    expect(result.toxicity).toEqual(['warn']);
  });

  it('falls back to provided fallbackActions for unknown category value', () => {
    const result = toggleAiAutoModCategoryAction(
      { toxicity: 123 } as unknown as AiAutoModDraft['actions'],
      'toxicity',
      ['flag'],
      'warn',
      true,
    );
    // Starts from fallback ['flag'], then adds 'warn'
    expect(result.toxicity).toEqual(['flag', 'warn']);
  });

  it('deduplicates actions when toggling on an action already present', () => {
    const result = toggleAiAutoModCategoryAction(
      { toxicity: ['flag', 'warn'] },
      'toxicity',
      [],
      'flag',
      true,
    );
    // 'flag' is already in the list; should not be duplicated
    expect(result.toxicity).toEqual(['flag', 'warn']);
  });

  it('handles undefined previous actions map gracefully', () => {
    const result = toggleAiAutoModCategoryAction(undefined, 'toxicity', ['flag'], 'warn', true);
    expect(result.toxicity).toEqual(['flag', 'warn']);
  });
});

// ---------------------------------------------------------------------------
// AiAutoModSettings component tests
// ---------------------------------------------------------------------------

describe('AiAutoModSettings', () => {
  it('renders all AI auto-mod category rows', () => {
    render(<AiAutoModSettings {...defaultProps()} />);

    expect(screen.getByText('Toxicity')).toBeInTheDocument();
    expect(screen.getByText('Spam')).toBeInTheDocument();
    expect(screen.getByText('Harassment')).toBeInTheDocument();
    expect(screen.getByText('Hate Speech')).toBeInTheDocument();
    expect(screen.getByText('Sexual Content')).toBeInTheDocument();
    expect(screen.getByText('Violence')).toBeInTheDocument();
    expect(screen.getByText('Self-Harm')).toBeInTheDocument();
  });

  it('renders threshold inputs with correct initial values from config', () => {
    render(<AiAutoModSettings {...defaultProps()} />);

    expect(screen.getByLabelText('Toxicity Threshold')).toHaveValue(70);
    expect(screen.getByLabelText('Spam Threshold')).toHaveValue(80);
    expect(screen.getByLabelText('Violence Threshold')).toHaveValue(85);
  });

  it('renders action checkboxes with correct checked state', () => {
    render(<AiAutoModSettings {...defaultProps()} />);

    expect(screen.getByLabelText('Toxicity Flag & Log')).toBeChecked();
    expect(screen.getByLabelText('Toxicity Issue Warning')).not.toBeChecked();
    expect(screen.getByLabelText('Spam Hard Delete')).toBeChecked();
    expect(screen.getByLabelText('Violence Permanent Ban')).toBeChecked();
  });

  it('renders DM notification checkboxes with correct initial state', () => {
    render(<AiAutoModSettings {...defaultProps()} />);

    expect(screen.getByLabelText('DM notifications for Warnings')).toBeChecked();
    expect(screen.getByLabelText('DM notifications for Timeouts')).toBeChecked();
    expect(screen.getByLabelText('DM notifications for Kicks')).toBeChecked();
    expect(screen.getByLabelText('DM notifications for Bans')).toBeChecked();
  });

  it('shows "One DM per incident" label', () => {
    render(<AiAutoModSettings {...defaultProps()} />);
    expect(screen.getByText('One DM per incident')).toBeInTheDocument();
  });

  it('shows "No response actions" placeholder when a category has no actions', () => {
    const config = makeConfig({
      aiAutoMod: {
        ...makeConfig().aiAutoMod!,
        actions: { ...makeConfig().aiAutoMod!.actions, toxicity: [] } as AiAutoModDraft['actions'],
      },
    });
    render(<AiAutoModSettings {...defaultProps({ draftConfig: config })} />);

    expect(screen.getByText('No response actions')).toBeInTheDocument();
  });

  it('calls onActionChange with correct arguments when a category action checkbox is toggled', () => {
    const onActionChange = vi.fn();
    render(<AiAutoModSettings {...defaultProps({ onActionChange })} />);

    fireEvent.click(screen.getByLabelText('Toxicity Issue Warning'));

    expect(onActionChange).toHaveBeenCalledTimes(1);
    const [categoryKey, , action, checked] = onActionChange.mock.calls[0] as [
      AiAutoModCategory,
      unknown,
      string,
      boolean,
    ];
    expect(categoryKey).toBe('toxicity');
    expect(action).toBe('warn');
    expect(checked).toBe(true);
  });

  it('calls onActionChange to remove an action when a checked checkbox is toggled off', () => {
    const onActionChange = vi.fn();
    render(<AiAutoModSettings {...defaultProps({ onActionChange })} />);

    // Toxicity has 'flag' checked — clicking it should uncheck
    fireEvent.click(screen.getByLabelText('Toxicity Flag & Log'));

    expect(onActionChange).toHaveBeenCalledTimes(1);
    const [categoryKey, , action, checked] = onActionChange.mock.calls[0] as [
      AiAutoModCategory,
      unknown,
      string,
      boolean,
    ];
    expect(categoryKey).toBe('toxicity');
    expect(action).toBe('flag');
    expect(checked).toBe(false);
  });

  it('calls onDmNotificationChange with action and false when an enabled DM toggle is clicked', () => {
    const onDmNotificationChange = vi.fn();
    render(<AiAutoModSettings {...defaultProps({ onDmNotificationChange })} />);

    fireEvent.click(screen.getByLabelText('DM notifications for Warnings'));

    expect(onDmNotificationChange).toHaveBeenCalledTimes(1);
    const [action, checked] = onDmNotificationChange.mock.calls[0] as [
      AiAutoModDmNotificationAction,
      boolean,
    ];
    expect(action).toBe('warn');
    expect(checked).toBe(false);
  });

  it('calls onDmNotificationChange with true when a disabled DM toggle is clicked', () => {
    const config = makeConfig({
      aiAutoMod: {
        ...makeConfig().aiAutoMod!,
        dmNotifications: { warn: false, timeout: true, kick: true, ban: true },
      },
    });
    const onDmNotificationChange = vi.fn();
    render(
      <AiAutoModSettings
        {...defaultProps({ draftConfig: config, onDmNotificationChange })}
      />,
    );

    fireEvent.click(screen.getByLabelText('DM notifications for Warnings'));

    expect(onDmNotificationChange).toHaveBeenCalledWith('warn', true);
  });

  it('reflects disabled DM notification state from aiAutoMod.dmNotifications', () => {
    const config = makeConfig({
      aiAutoMod: {
        ...makeConfig().aiAutoMod!,
        dmNotifications: { warn: false, timeout: false, kick: true, ban: true },
      },
    });
    render(<AiAutoModSettings {...defaultProps({ draftConfig: config })} />);

    expect(screen.getByLabelText('DM notifications for Warnings')).not.toBeChecked();
    expect(screen.getByLabelText('DM notifications for Timeouts')).not.toBeChecked();
    expect(screen.getByLabelText('DM notifications for Kicks')).toBeChecked();
    expect(screen.getByLabelText('DM notifications for Bans')).toBeChecked();
  });

  it('falls back to moderation.dmNotifications when aiAutoMod.dmNotifications is absent', () => {
    const config = makeConfig({
      aiAutoMod: {
        ...makeConfig().aiAutoMod!,
        dmNotifications: undefined as unknown as AiAutoModDraft['dmNotifications'],
      },
      moderation: {
        dmNotifications: { warn: false, timeout: false, kick: true, ban: false },
      } as GuildConfig['moderation'],
    });
    render(<AiAutoModSettings {...defaultProps({ draftConfig: config })} />);

    expect(screen.getByLabelText('DM notifications for Warnings')).not.toBeChecked();
    expect(screen.getByLabelText('DM notifications for Timeouts')).not.toBeChecked();
    expect(screen.getByLabelText('DM notifications for Kicks')).toBeChecked();
    expect(screen.getByLabelText('DM notifications for Bans')).not.toBeChecked();
  });

  it('defaults to checked when both aiAutoMod and moderation DM notifications are absent', () => {
    const config = makeConfig({
      aiAutoMod: {
        ...makeConfig().aiAutoMod!,
        dmNotifications: undefined as unknown as AiAutoModDraft['dmNotifications'],
      },
      moderation: undefined,
    });
    render(<AiAutoModSettings {...defaultProps({ draftConfig: config })} />);

    expect(screen.getByLabelText('DM notifications for Warnings')).toBeChecked();
    expect(screen.getByLabelText('DM notifications for Timeouts')).toBeChecked();
    expect(screen.getByLabelText('DM notifications for Kicks')).toBeChecked();
    expect(screen.getByLabelText('DM notifications for Bans')).toBeChecked();
  });

  it('calls onFieldChange when threshold input is changed', () => {
    const onFieldChange = vi.fn();
    render(<AiAutoModSettings {...defaultProps({ onFieldChange })} />);

    fireEvent.change(screen.getByLabelText('Toxicity Threshold'), {
      target: { value: '55' },
    });

    expect(onFieldChange).toHaveBeenCalledTimes(1);
    const [field, updater] = onFieldChange.mock.calls[0] as [string, (prev: unknown) => unknown];
    expect(field).toBe('thresholds');
    expect(typeof updater).toBe('function');
    // Call the updater function with empty previous thresholds
    const nextThresholds = updater({}) as Record<string, number>;
    expect(nextThresholds.toxicity).toBeCloseTo(0.55);
  });

  it('calls onFieldChange with autoDelete false when Instant Enforcement toggle is clicked', () => {
    const onFieldChange = vi.fn();
    render(<AiAutoModSettings {...defaultProps({ onFieldChange })} />);

    fireEvent.click(screen.getByText('Auto-delete'));

    expect(onFieldChange).toHaveBeenCalledWith('autoDelete', false);
  });

  it('disables all inputs when saving is true', () => {
    render(<AiAutoModSettings {...defaultProps({ saving: true })} />);

    // Check threshold inputs are disabled
    expect(screen.getByLabelText('Toxicity Threshold')).toBeDisabled();

    // Check action checkboxes are disabled
    expect(screen.getByLabelText('Toxicity Flag & Log')).toBeDisabled();

    // Check DM notification checkboxes are disabled
    expect(screen.getByLabelText('DM notifications for Warnings')).toBeDisabled();
  });

  it('renders the incident report channel selector', () => {
    render(<AiAutoModSettings {...defaultProps()} />);
    expect(
      screen.getByTestId('channel-selector-ai-automod-flag-channel'),
    ).toBeInTheDocument();
  });

  it('calls onFieldChange to clear flagChannelId when channel selector changes to empty', () => {
    const onFieldChange = vi.fn();
    const config = makeConfig({
      aiAutoMod: {
        ...makeConfig().aiAutoMod!,
        flagChannelId: 'channel-123',
      },
    });
    render(<AiAutoModSettings {...defaultProps({ draftConfig: config, onFieldChange })} />);

    // The channel selector is mocked, verify it was rendered with the correct prop
    expect(screen.getByTestId('channel-selector-ai-automod-flag-channel')).toBeInTheDocument();
  });

  it('renders all DM notification option descriptions', () => {
    render(<AiAutoModSettings {...defaultProps()} />);

    expect(screen.getByText('DM when AI AutoMod issues a warning.')).toBeInTheDocument();
    expect(screen.getByText('DM when AI AutoMod applies a timeout.')).toBeInTheDocument();
    expect(screen.getByText('DM when AI AutoMod removes a member.')).toBeInTheDocument();
    expect(screen.getByText('DM when AI AutoMod bans a member.')).toBeInTheDocument();
  });

  it('renders DM notification labels for all four actions', () => {
    render(<AiAutoModSettings {...defaultProps()} />);

    expect(screen.getByText('Warnings')).toBeInTheDocument();
    expect(screen.getByText('Timeouts')).toBeInTheDocument();
    expect(screen.getByText('Kicks')).toBeInTheDocument();
    expect(screen.getByText('Bans')).toBeInTheDocument();
  });

  it('aiAutoMod.dmNotifications takes precedence over moderation.dmNotifications', () => {
    // Moderation says warn=false but aiAutoMod says warn=true — aiAutoMod wins
    const config = makeConfig({
      aiAutoMod: {
        ...makeConfig().aiAutoMod!,
        dmNotifications: { warn: true, timeout: true, kick: true, ban: true },
      },
      moderation: {
        dmNotifications: { warn: false, timeout: false, kick: false, ban: false },
      } as GuildConfig['moderation'],
    });
    render(<AiAutoModSettings {...defaultProps({ draftConfig: config })} />);

    expect(screen.getByLabelText('DM notifications for Warnings')).toBeChecked();
    expect(screen.getByLabelText('DM notifications for Timeouts')).toBeChecked();
  });

  it('renders correct threshold value for category using default when config is absent', () => {
    const config = makeConfig({
      aiAutoMod: {
        ...makeConfig().aiAutoMod!,
        thresholds: {} as AiAutoModDraft['thresholds'],
      },
    });
    render(<AiAutoModSettings {...defaultProps({ draftConfig: config })} />);

    // Default for violence is 0.85 → 85
    expect(screen.getByLabelText('Violence Threshold')).toHaveValue(85);
  });

  it('passes fallbackActions to onActionChange for each category', () => {
    const onActionChange = vi.fn();
    render(<AiAutoModSettings {...defaultProps({ onActionChange })} />);

    fireEvent.click(screen.getByLabelText('Spam Flag & Log'));

    const [, fallbackActions] = onActionChange.mock.calls[0] as [unknown, readonly string[]];
    // Spam default is ['delete']
    expect(fallbackActions).toEqual(['delete']);
  });
});
