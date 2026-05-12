import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { GuildConfig } from '@/components/dashboard/config-editor-utils';

const { visibleModelOptions } = vi.hoisted(() => ({
  visibleModelOptions: [
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
}));

vi.mock('@/components/ui/select', () => import('../../../helpers/mock-select'));

vi.mock('@/lib/provider-model-options', () => ({
  DEFAULT_AI_MODEL: 'minimax:MiniMax-M2.7',
  VISIBLE_PROVIDER_MODEL_OPTION_GROUPS: [
    {
      providerName: 'minimax',
      providerDisplayName: 'MiniMax',
      options: [visibleModelOptions[0]],
    },
    {
      providerName: 'moonshot',
      providerDisplayName: 'Moonshot',
      options: [visibleModelOptions[1]],
    },
  ],
  VISIBLE_PROVIDER_MODEL_OPTIONS: visibleModelOptions,
  getVisibleProviderModelValue: (value: string | null | undefined) => {
    if (typeof value === 'string' && value) {
      const match = visibleModelOptions.find(
        (option) => option.value.toLowerCase() === value.toLowerCase(),
      );
      if (match) return match.value;
      return value;
    }
    return visibleModelOptions[0].value;
  },
}));

vi.mock('@/components/ui/channel-selector', () => ({
  ChannelSelector: ({ id }: { id?: string }) => (
    <div data-testid={id ? `channel-selector-${id}` : 'channel-selector'} />
  ),
}));

vi.mock('@/components/ui/role-selector', () => ({
  RoleSelector: ({ id }: { id?: string }) => (
    <div data-testid={id ?? 'role-selector'} />
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

import { AiTriageSettings } from '@/components/dashboard/config-categories/ai-triage-settings';

type AiTriageSettingsProps = Parameters<typeof AiTriageSettings>[0];

function createTriageDraftConfig(overrides: Partial<GuildConfig> = {}): GuildConfig {
  return {
    triage: {
      enabled: true,
      classifyModel: 'minimax:MiniMax-M2.7',
      respondModel: 'minimax:MiniMax-M2.7',
      moderationLogChannel: null,
      allowedRoles: [],
      excludedRoles: [],
      classifyBudget: 0,
      respondBudget: 0,
      moderationResponse: false,
      debugFooter: false,
      statusReactions: false,
      directMentionFastPath: false,
    },
    ...overrides,
  };
}

function renderTriageSettings(
  draftConfig: GuildConfig = createTriageDraftConfig(),
  props: {
    saving?: boolean;
    guildId?: string;
    classifyModelValue?: string;
    respondModelValue?: string;
    onFieldChange?: ReturnType<typeof vi.fn<AiTriageSettingsProps['onFieldChange']>>;
  } = {},
) {
  const {
    saving = false,
    guildId = 'guild-1',
    classifyModelValue = 'minimax:MiniMax-M2.7',
    respondModelValue = 'minimax:MiniMax-M2.7',
    onFieldChange = vi.fn<AiTriageSettingsProps['onFieldChange']>(),
  } = props;

  render(
    <AiTriageSettings
      draftConfig={draftConfig}
      saving={saving}
      guildId={guildId}
      classifyModelValue={classifyModelValue}
      respondModelValue={respondModelValue}
      onFieldChange={onFieldChange}
    />,
  );

  return { onFieldChange };
}

describe('AiTriageSettings', () => {
  describe('rendering', () => {
    it('renders Engine Setup section heading', () => {
      renderTriageSettings();

      expect(screen.getByText('Engine Setup')).toBeInTheDocument();
      expect(screen.getByText('Model selection and log destination')).toBeInTheDocument();
    });

    it('renders Classifier Engine and Response Engine selectors', () => {
      renderTriageSettings();

      expect(screen.getByLabelText('Classifier Engine')).toBeInTheDocument();
      expect(screen.getByLabelText('Response Engine')).toBeInTheDocument();
    });

    it('reflects the classifyModelValue in the Classifier Engine selector', () => {
      renderTriageSettings(createTriageDraftConfig(), {
        classifyModelValue: 'moonshot:kimi-k2.6',
      });

      expect(screen.getByLabelText('Classifier Engine')).toHaveValue('moonshot:kimi-k2.6');
    });

    it('reflects the respondModelValue in the Response Engine selector', () => {
      renderTriageSettings(createTriageDraftConfig(), {
        respondModelValue: 'moonshot:kimi-k2.6',
      });

      expect(screen.getByLabelText('Response Engine')).toHaveValue('moonshot:kimi-k2.6');
    });

    it('renders the Triage Audit Log channel selector', () => {
      renderTriageSettings();

      expect(screen.getByTestId('channel-selector-moderation-log-channel')).toBeInTheDocument();
    });

    it('renders Role Filtering section', () => {
      renderTriageSettings();

      expect(screen.getByText('Role Filtering')).toBeInTheDocument();
      expect(screen.getByTestId('triage-allowed-roles')).toBeInTheDocument();
      expect(screen.getByTestId('triage-excluded-roles')).toBeInTheDocument();
    });

    it('renders Daily Limits section with classify and respond budget inputs', () => {
      renderTriageSettings();

      expect(screen.getByText('Daily Limits')).toBeInTheDocument();
      expect(screen.getByLabelText('Classify Budget ($)')).toHaveValue(0);
      expect(screen.getByLabelText('Response Budget ($)')).toHaveValue(0);
    });

    it('renders Performance section with latency tuning inputs', () => {
      renderTriageSettings();

      expect(screen.getByText('Performance')).toBeInTheDocument();
      expect(screen.getByLabelText('Memory Timeout (ms)')).toHaveValue(2000);
      expect(screen.getByLabelText('Response Cooldown (ms)')).toHaveValue(0);
      expect(screen.getByLabelText('Triage Debounce (ms)')).toHaveValue(500);
    });

    it('renders configured latency values from draftConfig', () => {
      renderTriageSettings({
        triage: {
          enabled: true,
          memoryTimeoutMs: 5000,
          responseCooldownMs: 15000,
          triageDebounceMs: 1000,
        },
      });

      expect(screen.getByLabelText('Memory Timeout (ms)')).toHaveValue(5000);
      expect(screen.getByLabelText('Response Cooldown (ms)')).toHaveValue(15000);
      expect(screen.getByLabelText('Triage Debounce (ms)')).toHaveValue(1000);
    });

    it('reflects directMentionFastPath=true on the Fast Direct Replies toggle', () => {
      renderTriageSettings({ triage: { enabled: true, directMentionFastPath: true } });

      expect(screen.getByRole('button', { name: 'Fast Direct Replies' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });

    it('reflects directMentionFastPath=false on the Fast Direct Replies toggle', () => {
      renderTriageSettings(createTriageDraftConfig());

      expect(screen.getByRole('button', { name: 'Fast Direct Replies' })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    });

    it('renders latency inputs with correct html attributes (min, max, step)', () => {
      renderTriageSettings();

      const memInput = screen.getByLabelText('Memory Timeout (ms)');
      expect(memInput).toHaveAttribute('min', '500');
      expect(memInput).toHaveAttribute('max', '30000');
      expect(memInput).toHaveAttribute('step', '100');

      const cooldownInput = screen.getByLabelText('Response Cooldown (ms)');
      expect(cooldownInput).toHaveAttribute('min', '0');
      expect(cooldownInput).toHaveAttribute('max', '60000');
      expect(cooldownInput).toHaveAttribute('step', '500');

      const debounceInput = screen.getByLabelText('Triage Debounce (ms)');
      expect(debounceInput).toHaveAttribute('min', '0');
      expect(debounceInput).toHaveAttribute('max', '2000');
      expect(debounceInput).toHaveAttribute('step', '50');
    });

    it('renders configured budget values', () => {
      renderTriageSettings({
        triage: {
          enabled: true,
          classifyBudget: 1.5,
          respondBudget: 2.0,
        },
      });

      expect(screen.getByLabelText('Classify Budget ($)')).toHaveValue(1.5);
      expect(screen.getByLabelText('Response Budget ($)')).toHaveValue(2);
    });

    it('renders Operational Modes section with behavior toggles', () => {
      renderTriageSettings();

      expect(screen.getByText('Operational Modes')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Enforce Safety Guardrails' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Show Debug Metadata' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Visual Status Feedback' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Fast Direct Replies' })).toBeInTheDocument();
    });

    it('reflects moderationResponse=true on the Enforce Safety Guardrails toggle', () => {
      renderTriageSettings({ triage: { enabled: true, moderationResponse: true } });

      expect(
        screen.getByRole('button', { name: 'Enforce Safety Guardrails' }),
      ).toHaveAttribute('aria-pressed', 'true');
    });

    it('uses default values for toggles when unset', () => {
      renderTriageSettings({ triage: { enabled: true } });

      expect(
        screen.getByRole('button', { name: 'Enforce Safety Guardrails' }),
      ).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('button', { name: 'Visual Status Feedback' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      expect(screen.getByRole('button', { name: 'Fast Direct Replies' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      expect(screen.getByRole('button', { name: 'Show Debug Metadata' })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    });

    it('reflects moderationResponse=false when explicitly disabled', () => {
      renderTriageSettings();

      expect(
        screen.getByRole('button', { name: 'Enforce Safety Guardrails' }),
      ).toHaveAttribute('aria-pressed', 'false');
    });
  });

  describe('interaction handlers', () => {
    it('calls onFieldChange with "classifyModel" when Classifier Engine changes', () => {
      const { onFieldChange } = renderTriageSettings();

      fireEvent.change(screen.getByLabelText('Classifier Engine'), {
        target: { value: 'moonshot:kimi-k2.6' },
      });

      expect(onFieldChange).toHaveBeenCalledWith('classifyModel', 'moonshot:kimi-k2.6');
    });

    it('calls onFieldChange with "respondModel" when Response Engine changes', () => {
      const { onFieldChange } = renderTriageSettings();

      fireEvent.change(screen.getByLabelText('Response Engine'), {
        target: { value: 'moonshot:kimi-k2.6' },
      });

      expect(onFieldChange).toHaveBeenCalledWith('respondModel', 'moonshot:kimi-k2.6');
    });

    it('calls onFieldChange with "classifyBudget" and numeric value', () => {
      const { onFieldChange } = renderTriageSettings();

      fireEvent.change(screen.getByLabelText('Classify Budget ($)'), {
        target: { value: '1.5' },
      });

      expect(onFieldChange).toHaveBeenCalledWith('classifyBudget', 1.5);
    });

    it('calls onFieldChange with "respondBudget" and numeric value', () => {
      const { onFieldChange } = renderTriageSettings();

      fireEvent.change(screen.getByLabelText('Response Budget ($)'), {
        target: { value: '2.5' },
      });

      expect(onFieldChange).toHaveBeenCalledWith('respondBudget', 2.5);
    });

    it('calls onFieldChange with latency fields and numeric values', () => {
      const { onFieldChange } = renderTriageSettings();

      fireEvent.change(screen.getByLabelText('Memory Timeout (ms)'), {
        target: { value: '2500' },
      });
      fireEvent.change(screen.getByLabelText('Response Cooldown (ms)'), {
        target: { value: '7500' },
      });
      fireEvent.change(screen.getByLabelText('Triage Debounce (ms)'), {
        target: { value: '750' },
      });

      expect(onFieldChange).toHaveBeenCalledWith('memoryTimeoutMs', 2500);
      expect(onFieldChange).toHaveBeenCalledWith('responseCooldownMs', 7500);
      expect(onFieldChange).toHaveBeenCalledWith('triageDebounceMs', 750);
    });

    it('clamps latency field values to configured ranges', () => {
      const { onFieldChange } = renderTriageSettings();

      fireEvent.change(screen.getByLabelText('Memory Timeout (ms)'), {
        target: { value: '100' },
      });
      fireEvent.change(screen.getByLabelText('Response Cooldown (ms)'), {
        target: { value: '70000' },
      });
      fireEvent.change(screen.getByLabelText('Triage Debounce (ms)'), {
        target: { value: '-1' },
      });

      expect(onFieldChange).toHaveBeenCalledWith('memoryTimeoutMs', 500);
      expect(onFieldChange).toHaveBeenCalledWith('responseCooldownMs', 60000);
      expect(onFieldChange).toHaveBeenCalledWith('triageDebounceMs', 0);
    });

    it('calls onFieldChange with "moderationResponse" toggled', () => {
      const { onFieldChange } = renderTriageSettings();

      fireEvent.click(screen.getByRole('button', { name: 'Enforce Safety Guardrails' }));

      expect(onFieldChange).toHaveBeenCalledWith('moderationResponse', true);
    });

    it('calls onFieldChange with "debugFooter" toggled', () => {
      const { onFieldChange } = renderTriageSettings();

      fireEvent.click(screen.getByRole('button', { name: 'Show Debug Metadata' }));

      expect(onFieldChange).toHaveBeenCalledWith('debugFooter', true);
    });

    it('calls onFieldChange with "statusReactions" toggled', () => {
      const { onFieldChange } = renderTriageSettings();

      fireEvent.click(screen.getByRole('button', { name: 'Visual Status Feedback' }));

      expect(onFieldChange).toHaveBeenCalledWith('statusReactions', true);
    });

    it('calls onFieldChange with "directMentionFastPath" toggled', () => {
      const { onFieldChange } = renderTriageSettings();

      fireEvent.click(screen.getByRole('button', { name: 'Fast Direct Replies' }));

      expect(onFieldChange).toHaveBeenCalledWith('directMentionFastPath', true);
    });

    it('does not call onFieldChange for non-numeric budget input', () => {
      const { onFieldChange } = renderTriageSettings();

      fireEvent.change(screen.getByLabelText('Classify Budget ($)'), {
        target: { value: 'abc' },
      });

      expect(onFieldChange).not.toHaveBeenCalled();
    });

    it('does not call onFieldChange for non-numeric latency input', () => {
      const { onFieldChange } = renderTriageSettings();

      fireEvent.change(screen.getByLabelText('Memory Timeout (ms)'), {
        target: { value: 'abc' },
      });
      fireEvent.change(screen.getByLabelText('Response Cooldown (ms)'), {
        target: { value: '' },
      });

      expect(onFieldChange).not.toHaveBeenCalled();
    });

    it('calls onFieldChange with false when directMentionFastPath is toggled off', () => {
      const { onFieldChange } = renderTriageSettings({ triage: { enabled: true, directMentionFastPath: true } });

      fireEvent.click(screen.getByRole('button', { name: 'Fast Direct Replies' }));

      expect(onFieldChange).toHaveBeenCalledWith('directMentionFastPath', false);
    });

    it('calls onFieldChange with latency values at exact field minimums', () => {
      const { onFieldChange } = renderTriageSettings({
        triage: {
          enabled: true,
          memoryTimeoutMs: 1000,
          responseCooldownMs: 500,
          triageDebounceMs: 50,
        },
      });

      fireEvent.change(screen.getByLabelText('Memory Timeout (ms)'), {
        target: { value: '500' },
      });
      fireEvent.change(screen.getByLabelText('Response Cooldown (ms)'), {
        target: { value: '0' },
      });
      fireEvent.change(screen.getByLabelText('Triage Debounce (ms)'), {
        target: { value: '0' },
      });

      expect(onFieldChange).toHaveBeenCalledWith('memoryTimeoutMs', 500);
      expect(onFieldChange).toHaveBeenCalledWith('responseCooldownMs', 0);
      expect(onFieldChange).toHaveBeenCalledWith('triageDebounceMs', 0);
    });

    it('calls onFieldChange with latency values at exact field maximums', () => {
      const { onFieldChange } = renderTriageSettings();

      fireEvent.change(screen.getByLabelText('Memory Timeout (ms)'), {
        target: { value: '30000' },
      });
      fireEvent.change(screen.getByLabelText('Response Cooldown (ms)'), {
        target: { value: '60000' },
      });
      fireEvent.change(screen.getByLabelText('Triage Debounce (ms)'), {
        target: { value: '2000' },
      });

      expect(onFieldChange).toHaveBeenCalledWith('memoryTimeoutMs', 30000);
      expect(onFieldChange).toHaveBeenCalledWith('responseCooldownMs', 60000);
      expect(onFieldChange).toHaveBeenCalledWith('triageDebounceMs', 2000);
    });
  });

  describe('disabled state', () => {
    it('disables both model selectors when saving=true', () => {
      renderTriageSettings(createTriageDraftConfig(), { saving: true });

      expect(screen.getByLabelText('Classifier Engine')).toBeDisabled();
      expect(screen.getByLabelText('Response Engine')).toBeDisabled();
    });

    it('disables all operational mode toggles when saving=true', () => {
      renderTriageSettings(createTriageDraftConfig(), { saving: true });

      expect(screen.getByRole('button', { name: 'Enforce Safety Guardrails' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Show Debug Metadata' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Visual Status Feedback' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Fast Direct Replies' })).toBeDisabled();
    });

    it('disables budget inputs when saving=true', () => {
      renderTriageSettings(createTriageDraftConfig(), { saving: true });

      expect(screen.getByLabelText('Classify Budget ($)')).toBeDisabled();
      expect(screen.getByLabelText('Response Budget ($)')).toBeDisabled();
    });

    it('disables latency inputs when saving=true', () => {
      renderTriageSettings(createTriageDraftConfig(), { saving: true });

      expect(screen.getByLabelText('Memory Timeout (ms)')).toBeDisabled();
      expect(screen.getByLabelText('Response Cooldown (ms)')).toBeDisabled();
      expect(screen.getByLabelText('Triage Debounce (ms)')).toBeDisabled();
    });
  });
});
