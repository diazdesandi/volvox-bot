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

vi.mock('@/components/ui/role-selector', () => ({
  RoleSelector: ({ id }: { id?: string }) => (
    <div data-testid={id ?? 'role-selector'} />
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

import { AiTriageSettings } from '@/components/dashboard/config-categories/ai-triage-settings';

function createDraftConfig(overrides: Partial<GuildConfig> = {}): GuildConfig {
  const base: GuildConfig = {
    triage: {
      enabled: true,
      classifyModel: 'minimax:MiniMax-M2.7',
      respondModel: 'minimax:MiniMax-M2.7',
      classifyBudget: 5,
      respondBudget: 10,
      moderationResponse: true,
      debugFooter: false,
      statusReactions: true,
    },
  };

  const triage = overrides.triage ? { ...base.triage, ...overrides.triage } : base.triage;
  return { ...base, ...overrides, triage };
}

function renderAiTriageSettings({
  draftConfig = createDraftConfig(),
  saving = false,
  guildId = 'guild-1',
  classifyModelValue = 'minimax:MiniMax-M2.7',
  respondModelValue = 'minimax:MiniMax-M2.7',
  onFieldChange = vi.fn(),
}: Partial<React.ComponentProps<typeof AiTriageSettings>> = {}) {
  return render(
    <AiTriageSettings
      draftConfig={draftConfig}
      saving={saving}
      guildId={guildId}
      classifyModelValue={classifyModelValue}
      respondModelValue={respondModelValue}
      onFieldChange={onFieldChange}
    />,
  );
}

describe('AiTriageSettings', () => {
  describe('Engine Setup', () => {
    it('renders classifier and response model selectors', () => {
      renderAiTriageSettings();

      expect(screen.getByLabelText('Classifier Engine')).toBeInTheDocument();
      expect(screen.getByLabelText('Response Engine')).toBeInTheDocument();
    });

    it('shows the provided classifyModelValue in the classifier selector', () => {
      renderAiTriageSettings({ classifyModelValue: 'moonshot:kimi-k2.6' });

      expect(screen.getByLabelText('Classifier Engine')).toHaveValue('moonshot:kimi-k2.6');
    });

    it('shows the provided respondModelValue in the response selector', () => {
      renderAiTriageSettings({ respondModelValue: 'moonshot:kimi-k2.6' });

      expect(screen.getByLabelText('Response Engine')).toHaveValue('moonshot:kimi-k2.6');
    });

    it('calls onFieldChange with classifyModel when classifier model is changed', () => {
      const onFieldChange = vi.fn();
      renderAiTriageSettings({ onFieldChange });

      fireEvent.change(screen.getByLabelText('Classifier Engine'), {
        target: { value: 'moonshot:kimi-k2.6' },
      });

      expect(onFieldChange).toHaveBeenCalledWith('classifyModel', 'moonshot:kimi-k2.6');
    });

    it('calls onFieldChange with respondModel when response model is changed', () => {
      const onFieldChange = vi.fn();
      renderAiTriageSettings({ onFieldChange });

      fireEvent.change(screen.getByLabelText('Response Engine'), {
        target: { value: 'moonshot:kimi-k2.6' },
      });

      expect(onFieldChange).toHaveBeenCalledWith('respondModel', 'moonshot:kimi-k2.6');
    });

    it('renders the triage audit log channel selector', () => {
      renderAiTriageSettings();

      expect(screen.getByTestId('channel-selector-moderation-log-channel')).toBeInTheDocument();
    });

    it('disables model selectors when saving is true', () => {
      renderAiTriageSettings({ saving: true });

      expect(screen.getByLabelText('Classifier Engine')).toBeDisabled();
      expect(screen.getByLabelText('Response Engine')).toBeDisabled();
    });
  });

  describe('Role Filtering', () => {
    it('renders the allowed roles selector', () => {
      renderAiTriageSettings();

      expect(screen.getByTestId('triage-allowed-roles')).toBeInTheDocument();
    });

    it('renders the excluded roles selector', () => {
      renderAiTriageSettings();

      expect(screen.getByTestId('triage-excluded-roles')).toBeInTheDocument();
    });

    it('renders a "Role Filtering" section heading', () => {
      renderAiTriageSettings();

      expect(screen.getByText('Role Filtering')).toBeInTheDocument();
    });
  });

  describe('Daily Limits', () => {
    it('renders classify budget input with current value', () => {
      renderAiTriageSettings({
        draftConfig: createDraftConfig({ triage: { classifyBudget: 7.5 } }),
      });

      expect(screen.getByLabelText('Classify Budget ($)')).toHaveValue(7.5);
    });

    it('defaults classify budget to 0 when not set', () => {
      renderAiTriageSettings({ draftConfig: createDraftConfig({ triage: { classifyBudget: undefined } }) });

      expect(screen.getByLabelText('Classify Budget ($)')).toHaveValue(0);
    });

    it('renders respond budget input with current value', () => {
      renderAiTriageSettings({
        draftConfig: createDraftConfig({ triage: { respondBudget: 12.5 } }),
      });

      expect(screen.getByLabelText('Response Budget ($)')).toHaveValue(12.5);
    });

    it('defaults respond budget to 0 when not set', () => {
      renderAiTriageSettings({ draftConfig: createDraftConfig({ triage: { respondBudget: undefined } }) });

      expect(screen.getByLabelText('Response Budget ($)')).toHaveValue(0);
    });

    it('calls onFieldChange with classifyBudget when classify budget changes', () => {
      const onFieldChange = vi.fn();
      renderAiTriageSettings({ onFieldChange });

      fireEvent.change(screen.getByLabelText('Classify Budget ($)'), {
        target: { value: '3.50' },
      });

      expect(onFieldChange).toHaveBeenCalledWith('classifyBudget', 3.5);
    });

    it('calls onFieldChange with respondBudget when respond budget changes', () => {
      const onFieldChange = vi.fn();
      renderAiTriageSettings({ onFieldChange });

      fireEvent.change(screen.getByLabelText('Response Budget ($)'), {
        target: { value: '8' },
      });

      expect(onFieldChange).toHaveBeenCalledWith('respondBudget', 8);
    });

    it('does not call onFieldChange when classify budget input is cleared', () => {
      const onFieldChange = vi.fn();
      renderAiTriageSettings({ onFieldChange });

      fireEvent.change(screen.getByLabelText('Classify Budget ($)'), {
        target: { value: '' },
      });

      expect(onFieldChange).not.toHaveBeenCalled();
    });

    it('disables budget inputs when saving is true', () => {
      renderAiTriageSettings({ saving: true });

      expect(screen.getByLabelText('Classify Budget ($)')).toBeDisabled();
      expect(screen.getByLabelText('Response Budget ($)')).toBeDisabled();
    });
  });

  describe('Operational Modes', () => {
    it('renders all three operational mode toggles', () => {
      renderAiTriageSettings();

      expect(screen.getByRole('button', { name: 'Enforce Safety Guardrails' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Show Debug Metadata' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Visual Status Feedback' })).toBeInTheDocument();
    });

    it('reflects the moderationResponse setting in the toggle', () => {
      renderAiTriageSettings({
        draftConfig: createDraftConfig({ triage: { moderationResponse: true } }),
      });

      expect(screen.getByRole('button', { name: 'Enforce Safety Guardrails' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });

    it('reflects the debugFooter setting in the toggle', () => {
      renderAiTriageSettings({
        draftConfig: createDraftConfig({ triage: { debugFooter: true } }),
      });

      expect(screen.getByRole('button', { name: 'Show Debug Metadata' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });

    it('defaults operational toggles to false when fields are absent', () => {
      renderAiTriageSettings({ draftConfig: { triage: {} } });

      expect(screen.getByRole('button', { name: 'Enforce Safety Guardrails' })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
      expect(screen.getByRole('button', { name: 'Show Debug Metadata' })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
      expect(screen.getByRole('button', { name: 'Visual Status Feedback' })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    });

    it('calls onFieldChange with moderationResponse when Enforce Safety Guardrails is toggled', () => {
      const onFieldChange = vi.fn();
      renderAiTriageSettings({
        draftConfig: createDraftConfig({ triage: { moderationResponse: false } }),
        onFieldChange,
      });

      fireEvent.click(screen.getByRole('button', { name: 'Enforce Safety Guardrails' }));

      expect(onFieldChange).toHaveBeenCalledWith('moderationResponse', true);
    });

    it('calls onFieldChange with debugFooter when Show Debug Metadata is toggled', () => {
      const onFieldChange = vi.fn();
      renderAiTriageSettings({
        draftConfig: createDraftConfig({ triage: { debugFooter: false } }),
        onFieldChange,
      });

      fireEvent.click(screen.getByRole('button', { name: 'Show Debug Metadata' }));

      expect(onFieldChange).toHaveBeenCalledWith('debugFooter', true);
    });

    it('calls onFieldChange with statusReactions when Visual Status Feedback is toggled', () => {
      const onFieldChange = vi.fn();
      renderAiTriageSettings({
        draftConfig: createDraftConfig({ triage: { statusReactions: false } }),
        onFieldChange,
      });

      fireEvent.click(screen.getByRole('button', { name: 'Visual Status Feedback' }));

      expect(onFieldChange).toHaveBeenCalledWith('statusReactions', true);
    });

    it('disables all operational mode toggles when saving is true', () => {
      renderAiTriageSettings({ saving: true });

      expect(screen.getByRole('button', { name: 'Enforce Safety Guardrails' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Show Debug Metadata' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Visual Status Feedback' })).toBeDisabled();
    });
  });

  describe('Section headings and layout', () => {
    it('renders "Engine Setup" section heading', () => {
      renderAiTriageSettings();

      expect(screen.getByText('Engine Setup')).toBeInTheDocument();
    });

    it('renders "Daily Limits" section heading', () => {
      renderAiTriageSettings();

      expect(screen.getByText('Daily Limits')).toBeInTheDocument();
    });

    it('renders "Operational Modes" section heading', () => {
      renderAiTriageSettings();

      expect(screen.getByText('Operational Modes')).toBeInTheDocument();
    });
  });
});
