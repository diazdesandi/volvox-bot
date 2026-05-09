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

function renderMemorySettings(
  draftConfig: GuildConfig = {},
  onFieldChange = vi.fn(),
  saving = false,
) {
  render(
    <AiMemorySettings draftConfig={draftConfig} saving={saving} onFieldChange={onFieldChange} />,
  );
  return { onFieldChange };
}

describe('AiMemorySettings', () => {
  it('renders the Retrieval Depth label', () => {
    renderMemorySettings();

    expect(screen.getByText('Retrieval Depth')).toBeInTheDocument();
  });

  it('renders the maxContextMemories input with its default value of 10', () => {
    renderMemorySettings();

    expect(screen.getByRole('spinbutton', { name: /Retrieval Depth/i })).toHaveValue(10);
  });

  it('renders the maxContextMemories input with a configured value', () => {
    renderMemorySettings({ memory: { enabled: true, maxContextMemories: 25 } });

    expect(screen.getByRole('spinbutton', { name: /Retrieval Depth/i })).toHaveValue(25);
  });

  it('renders the Autonomous Extraction toggle', () => {
    renderMemorySettings();

    expect(screen.getByRole('button', { name: 'Auto-Extract' })).toBeInTheDocument();
  });

  it('reflects autoExtract=true on the toggle', () => {
    renderMemorySettings({ memory: { enabled: true, autoExtract: true } });

    expect(screen.getByRole('button', { name: 'Auto-Extract' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('reflects autoExtract=false on the toggle when not set', () => {
    renderMemorySettings({ memory: { enabled: true } });

    expect(screen.getByRole('button', { name: 'Auto-Extract' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('calls onFieldChange with "maxContextMemories" and numeric value when input changes', () => {
    const { onFieldChange } = renderMemorySettings();

    fireEvent.change(screen.getByRole('spinbutton', { name: /Retrieval Depth/i }), {
      target: { value: '15' },
    });

    expect(onFieldChange).toHaveBeenCalledWith('maxContextMemories', 15);
  });

  it('calls onFieldChange with "autoExtract" and true when toggle is clicked while false', () => {
    const { onFieldChange } = renderMemorySettings({ memory: { enabled: true, autoExtract: false } });

    fireEvent.click(screen.getByRole('button', { name: 'Auto-Extract' }));

    expect(onFieldChange).toHaveBeenCalledWith('autoExtract', true);
  });

  it('calls onFieldChange with "autoExtract" and false when toggle is clicked while true', () => {
    const { onFieldChange } = renderMemorySettings({ memory: { enabled: true, autoExtract: true } });

    fireEvent.click(screen.getByRole('button', { name: 'Auto-Extract' }));

    expect(onFieldChange).toHaveBeenCalledWith('autoExtract', false);
  });

  it('disables the maxContextMemories input when saving=true', () => {
    renderMemorySettings({}, vi.fn(), true);

    expect(screen.getByRole('spinbutton', { name: /Retrieval Depth/i })).toBeDisabled();
  });

  it('disables the Auto-Extract toggle when saving=true', () => {
    renderMemorySettings({}, vi.fn(), true);

    expect(screen.getByRole('button', { name: 'Auto-Extract' })).toBeDisabled();
  });

  it('does not call onFieldChange when input has a non-numeric value', () => {
    const { onFieldChange } = renderMemorySettings();

    fireEvent.change(screen.getByRole('spinbutton', { name: /Retrieval Depth/i }), {
      target: { value: 'abc' },
    });

    expect(onFieldChange).not.toHaveBeenCalled();
  });

  it('renders "Memories max" label next to the input', () => {
    renderMemorySettings();

    expect(screen.getByText('Memories max')).toBeInTheDocument();
  });
});