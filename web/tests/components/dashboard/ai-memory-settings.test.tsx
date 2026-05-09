import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { GuildConfig } from '@/components/dashboard/config-editor-utils';

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

import { AiMemorySettings } from '@/components/dashboard/config-categories/ai-memory-settings';

function createDraftConfig(overrides: Partial<GuildConfig> = {}): GuildConfig {
  return {
    memory: {
      enabled: true,
      maxContextMemories: 10,
      autoExtract: false,
    },
    ...overrides,
  };
}

function renderAiMemorySettings({
  draftConfig = createDraftConfig(),
  saving = false,
  onFieldChange = vi.fn(),
}: Partial<React.ComponentProps<typeof AiMemorySettings>> = {}) {
  return render(
    <AiMemorySettings
      draftConfig={draftConfig}
      saving={saving}
      onFieldChange={onFieldChange}
    />,
  );
}

describe('AiMemorySettings', () => {
  describe('Retrieval Depth (maxContextMemories)', () => {
    it('renders the retrieval depth input with the current maxContextMemories value', () => {
      renderAiMemorySettings({
        draftConfig: createDraftConfig({ memory: { maxContextMemories: 15 } }),
      });

      expect(screen.getByLabelText('Retrieval Depth')).toHaveValue(15);
    });

    it('defaults to 10 when maxContextMemories is not set', () => {
      const draftConfig: GuildConfig = { memory: {} };
      renderAiMemorySettings({ draftConfig });

      expect(screen.getByLabelText('Retrieval Depth')).toHaveValue(10);
    });

    it('defaults to 10 when memory section is absent', () => {
      renderAiMemorySettings({ draftConfig: {} });

      expect(screen.getByLabelText('Retrieval Depth')).toHaveValue(10);
    });

    it('calls onFieldChange with maxContextMemories when the input changes', () => {
      const onFieldChange = vi.fn();
      renderAiMemorySettings({ onFieldChange });

      fireEvent.change(screen.getByLabelText('Retrieval Depth'), {
        target: { value: '25' },
      });

      expect(onFieldChange).toHaveBeenCalledWith('maxContextMemories', 25);
    });

    it('does not call onFieldChange when the input value cannot be parsed', () => {
      const onFieldChange = vi.fn();
      renderAiMemorySettings({ onFieldChange });

      // Empty string input should result in parseNumberInput returning undefined
      fireEvent.change(screen.getByLabelText('Retrieval Depth'), {
        target: { value: '' },
      });

      expect(onFieldChange).not.toHaveBeenCalled();
    });

    it('disables the retrieval depth input when saving is true', () => {
      renderAiMemorySettings({ saving: true });

      expect(screen.getByLabelText('Retrieval Depth')).toBeDisabled();
    });

    it('renders the "Memories max" label next to the input', () => {
      renderAiMemorySettings();

      expect(screen.getByText('Memories max')).toBeInTheDocument();
    });
  });

  describe('Autonomous Extraction (autoExtract)', () => {
    it('renders the auto-extract toggle as disabled when autoExtract is false', () => {
      renderAiMemorySettings({
        draftConfig: createDraftConfig({ memory: { autoExtract: false } }),
      });

      expect(screen.getByRole('button', { name: 'Auto-Extract' })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    });

    it('renders the auto-extract toggle as enabled when autoExtract is true', () => {
      renderAiMemorySettings({
        draftConfig: createDraftConfig({ memory: { autoExtract: true } }),
      });

      expect(screen.getByRole('button', { name: 'Auto-Extract' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });

    it('defaults auto-extract toggle to false when field is absent', () => {
      renderAiMemorySettings({ draftConfig: { memory: {} } });

      expect(screen.getByRole('button', { name: 'Auto-Extract' })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    });

    it('calls onFieldChange with autoExtract=true when disabled toggle is clicked', () => {
      const onFieldChange = vi.fn();
      renderAiMemorySettings({
        draftConfig: createDraftConfig({ memory: { autoExtract: false } }),
        onFieldChange,
      });

      fireEvent.click(screen.getByRole('button', { name: 'Auto-Extract' }));

      expect(onFieldChange).toHaveBeenCalledWith('autoExtract', true);
    });

    it('calls onFieldChange with autoExtract=false when enabled toggle is clicked', () => {
      const onFieldChange = vi.fn();
      renderAiMemorySettings({
        draftConfig: createDraftConfig({ memory: { autoExtract: true } }),
        onFieldChange,
      });

      fireEvent.click(screen.getByRole('button', { name: 'Auto-Extract' }));

      expect(onFieldChange).toHaveBeenCalledWith('autoExtract', false);
    });

    it('disables the auto-extract toggle when saving is true', () => {
      renderAiMemorySettings({ saving: true });

      expect(screen.getByRole('button', { name: 'Auto-Extract' })).toBeDisabled();
    });

    it('renders the "Autonomous Extraction" section heading', () => {
      renderAiMemorySettings();

      expect(screen.getByText('Autonomous Extraction')).toBeInTheDocument();
    });
  });
});