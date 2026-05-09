import type { GuildConfig } from '@/components/dashboard/config-editor-utils';
import { ChannelModeSection } from '@/components/dashboard/config-sections/ChannelModeSection';
import { ChannelSelector } from '@/components/ui/channel-selector';
import type { ChannelMode } from '@/types/config';
import { SYSTEM_PROMPT_MAX_LENGTH } from '@/types/config';
import { SystemPromptEditor } from '../system-prompt-editor';

/**
 * Render controls for configuring AI chat settings for a guild.
 *
 * Renders a system prompt editor bound to `draftConfig.ai?.systemPrompt`. When `guildId` is provided, also renders a 'Response Boundaries' channel selector for `draftConfig.ai?.blockedChannelIds` and a channel mode configuration section.
 *
 * @param draftConfig - Draft guild configuration used to populate the controls (e.g., `ai.systemPrompt`, `ai.blockedChannelIds`).
 * @param saving - If true, input controls are disabled to reflect an in-progress save.
 * @param guildId - Guild identifier; when falsy, guild-scoped controls (blocked channels and channel modes) are not rendered.
 * @param onSystemPromptChange - Called with the new system prompt value when it changes.
 * @param onBlockedChannelsChange - Called with the updated list of blocked channel IDs.
 * @param onChannelModeChange - Called to set or clear the mode for a specific channel (`channelId`, `mode` or `undefined` to clear).
 * @param onDefaultChannelModeChange - Called to change the default channel mode.
 * @param onResetAllChannelModes - Called to reset all per-channel mode overrides to defaults.
 * @returns A JSX element that renders the AI chat settings UI.
 */
export function AiChatSettings({
  draftConfig,
  saving,
  guildId,
  onSystemPromptChange,
  onBlockedChannelsChange,
  onChannelModeChange,
  onDefaultChannelModeChange,
  onResetAllChannelModes,
}: Readonly<{
  draftConfig: GuildConfig;
  saving: boolean;
  guildId: string;
  onSystemPromptChange: (value: string) => void;
  onBlockedChannelsChange: (channels: string[]) => void;
  onChannelModeChange: (channelId: string, mode: ChannelMode | undefined) => void;
  onDefaultChannelModeChange: (mode: ChannelMode) => void;
  onResetAllChannelModes: () => void;
}>) {
  const blockedChannelIds = Array.isArray(draftConfig.ai?.blockedChannelIds)
    ? draftConfig.ai.blockedChannelIds.filter((id): id is string => typeof id === 'string')
    : [];

  return (
    <div className="space-y-6">
      <SystemPromptEditor
        value={draftConfig.ai?.systemPrompt ?? ''}
        onChange={onSystemPromptChange}
        disabled={saving}
        maxLength={SYSTEM_PROMPT_MAX_LENGTH}
      />

      {guildId && (
        <div className="p-4 sm:p-6 rounded-[24px] border border-border/40 bg-muted/20 backdrop-blur-xl">
          <div className="mb-4 space-y-1">
            <h3 className="text-sm font-semibold tracking-wide text-foreground/90">
              Response Boundaries
            </h3>
            <p className="text-[11px] text-muted-foreground/60 uppercase tracking-wider">
              Select channels where the AI should never respond
            </p>
          </div>
          <ChannelSelector
            id="ai-blocked-channels"
            guildId={guildId}
            selected={blockedChannelIds}
            onChange={onBlockedChannelsChange}
            placeholder="Search channels to block..."
            disabled={saving}
            filter="text"
          />
        </div>
      )}

      {guildId && (
        <div className="rounded-[24px] border border-border/40 bg-muted/20 backdrop-blur-xl p-1">
          <ChannelModeSection
            draftConfig={draftConfig}
            saving={saving}
            guildId={guildId}
            onChannelModeChange={onChannelModeChange}
            onDefaultModeChange={onDefaultChannelModeChange}
            onResetAll={onResetAllChannelModes}
          />
        </div>
      )}
    </div>
  );
}
