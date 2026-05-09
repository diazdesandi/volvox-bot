import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { GuildConfig } from '@/components/dashboard/config-editor-utils';

vi.mock('@/components/dashboard/system-prompt-editor', () => ({
  SystemPromptEditor: ({
    value,
    onChange,
    disabled,
    maxLength,
  }: {
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
    maxLength?: number;
  }) => (
    <textarea
      aria-label="system prompt"
      value={value}
      onChange={(e) => onChange(e.target.value)}
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

function createDraftConfig(overrides: Partial<GuildConfig> = {}): GuildConfig {
  return {
    ai: {
      enabled: true,
      systemPrompt: 'Test prompt',
      blockedChannelIds: [],
    },
    ...overrides,
  };
}

function renderAiChatSettings({
  draftConfig = createDraftConfig(),
  saving = false,
  guildId = 'guild-1',
  onSystemPromptChange = vi.fn(),
  onBlockedChannelsChange = vi.fn(),
  onChannelModeChange = vi.fn(),
  onDefaultChannelModeChange = vi.fn(),
  onResetAllChannelModes = vi.fn(),
}: Partial<React.ComponentProps<typeof AiChatSettings>> = {}) {
  return render(
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
}

describe('AiChatSettings', () => {
  it('renders the system prompt editor with the current system prompt value', () => {
    renderAiChatSettings({
      draftConfig: createDraftConfig({ ai: { systemPrompt: 'Hello, I am your assistant.' } }),
    });

    expect(screen.getByLabelText('system prompt')).toHaveValue('Hello, I am your assistant.');
  });

  it('renders with empty system prompt when systemPrompt is not set', () => {
    const draftConfig: GuildConfig = { ai: {} };
    renderAiChatSettings({ draftConfig });

    expect(screen.getByLabelText('system prompt')).toHaveValue('');
  });

  it('renders the blocked channels selector when guildId is provided', () => {
    renderAiChatSettings({ guildId: 'guild-1' });

    expect(screen.getByTestId('channel-selector-ai-blocked-channels')).toBeInTheDocument();
  });

  it('renders the channel mode section when guildId is provided', () => {
    renderAiChatSettings({ guildId: 'guild-1' });

    expect(screen.getByTestId('channel-mode-section')).toBeInTheDocument();
  });

  it('does not render the blocked channels selector when guildId is empty', () => {
    renderAiChatSettings({ guildId: '' });

    expect(screen.queryByTestId('channel-selector-ai-blocked-channels')).not.toBeInTheDocument();
  });

  it('does not render the channel mode section when guildId is empty', () => {
    renderAiChatSettings({ guildId: '' });

    expect(screen.queryByTestId('channel-mode-section')).not.toBeInTheDocument();
  });

  it('disables the system prompt editor when saving is true', () => {
    renderAiChatSettings({ saving: true });

    expect(screen.getByLabelText('system prompt')).toBeDisabled();
  });

  it('renders a "Response Boundaries" section heading when guildId is provided', () => {
    renderAiChatSettings({ guildId: 'guild-1' });

    expect(screen.getByText('Response Boundaries')).toBeInTheDocument();
  });

  it('passes all required props through without errors when config is empty', () => {
    const draftConfig: GuildConfig = {};
    expect(() => renderAiChatSettings({ draftConfig })).not.toThrow();
    expect(screen.getByLabelText('system prompt')).toBeInTheDocument();
  });
});