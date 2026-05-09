import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { GuildConfig } from '@/components/dashboard/config-editor-utils';
import type { ChannelMode } from '@/types/config';

vi.mock('@/components/dashboard/system-prompt-editor', () => ({
  SystemPromptEditor: ({
    value,
    onChange,
    disabled,
    maxLength,
  }: {
    value: string;
    onChange: (v: string) => void;
    disabled?: boolean;
    maxLength?: number;
  }) => (
    <textarea
      aria-label="system prompt"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      maxLength={maxLength}
    />
  ),
}));

vi.mock('@/components/ui/channel-selector', () => ({
  ChannelSelector: ({ id }: { id?: string }) => (
    <div data-testid={id ? `channel-selector-${id}` : 'channel-selector'} />
  ),
}));

vi.mock('@/components/dashboard/config-sections/ChannelModeSection', () => ({
  ChannelModeSection: () => <div data-testid="channel-mode-section" />,
}));

import { AiChatSettings } from '@/components/dashboard/config-categories/ai-chat-settings';

function createDefaultDraftConfig(overrides: Partial<GuildConfig> = {}): GuildConfig {
  return {
    ai: {
      enabled: true,
      systemPrompt: 'You are a helpful assistant.',
      blockedChannelIds: [],
    },
    ...overrides,
  };
}

function renderAiChatSettings(
  draftConfig: GuildConfig = createDefaultDraftConfig(),
  props: {
    saving?: boolean;
    guildId?: string;
    onSystemPromptChange?: ReturnType<typeof vi.fn>;
    onBlockedChannelsChange?: ReturnType<typeof vi.fn>;
    onChannelModeChange?: ReturnType<typeof vi.fn>;
    onDefaultChannelModeChange?: ReturnType<typeof vi.fn>;
    onResetAllChannelModes?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const {
    saving = false,
    guildId = 'guild-1',
    onSystemPromptChange = vi.fn(),
    onBlockedChannelsChange = vi.fn(),
    onChannelModeChange = vi.fn(),
    onDefaultChannelModeChange = vi.fn(),
    onResetAllChannelModes = vi.fn(),
  } = props;

  render(
    <AiChatSettings
      draftConfig={draftConfig}
      saving={saving}
      guildId={guildId}
      onSystemPromptChange={onSystemPromptChange}
      onBlockedChannelsChange={onBlockedChannelsChange}
      onChannelModeChange={onChannelModeChange}
      onDefaultChannelModeChange={onDefaultChannelModeChange}
      onResetAllChannelModes={onResetAllChannelModes}
    />,
  );

  return {
    onSystemPromptChange,
    onBlockedChannelsChange,
    onChannelModeChange,
    onDefaultChannelModeChange,
    onResetAllChannelModes,
  };
}

describe('AiChatSettings', () => {
  it('renders the system prompt editor with the current system prompt value', () => {
    renderAiChatSettings();

    expect(screen.getByLabelText('system prompt')).toHaveValue('You are a helpful assistant.');
  });

  it('renders the system prompt editor with an empty string when systemPrompt is absent', () => {
    const draftConfig = createDefaultDraftConfig({ ai: { enabled: true } });

    renderAiChatSettings(draftConfig);

    expect(screen.getByLabelText('system prompt')).toHaveValue('');
  });

  it('renders the blocked channels selector when guildId is provided', () => {
    renderAiChatSettings();

    expect(screen.getByTestId('channel-selector-ai-blocked-channels')).toBeInTheDocument();
  });

  it('renders the channel mode section when guildId is provided', () => {
    renderAiChatSettings();

    expect(screen.getByTestId('channel-mode-section')).toBeInTheDocument();
  });

  it('does not render the blocked channels or channel mode section when guildId is empty', () => {
    renderAiChatSettings(createDefaultDraftConfig(), { guildId: '' });

    expect(screen.queryByTestId('channel-selector-ai-blocked-channels')).not.toBeInTheDocument();
    expect(screen.queryByTestId('channel-mode-section')).not.toBeInTheDocument();
  });

  it('renders Response Boundaries section heading when guildId is provided', () => {
    renderAiChatSettings();

    expect(screen.getByText('Response Boundaries')).toBeInTheDocument();
  });

  it('passes saving=true to the system prompt editor to disable it', () => {
    renderAiChatSettings(createDefaultDraftConfig(), { saving: true });

    expect(screen.getByLabelText('system prompt')).toBeDisabled();
  });

  it('passes onSystemPromptChange through to the system prompt editor', () => {
    const onSystemPromptChange = vi.fn();
    renderAiChatSettings(createDefaultDraftConfig(), { onSystemPromptChange });

    fireEvent.change(screen.getByLabelText('system prompt'), {
      target: { value: 'New prompt' },
    });

    expect(onSystemPromptChange).toHaveBeenCalledWith('New prompt');
  });
});