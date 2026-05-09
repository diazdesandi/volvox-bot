import type { GuildConfig } from '@/components/dashboard/config-editor-utils';
import { ChannelModeSection } from '@/components/dashboard/config-sections/ChannelModeSection';
import { ChannelSelector } from '@/components/ui/channel-selector';
import type { ChannelMode } from '@/types/config';
import { SYSTEM_PROMPT_MAX_LENGTH } from '@/types/config';
import { SystemPromptEditor } from '../system-prompt-editor';

/**
 * Render AI chat configuration controls including a system prompt editor and optional guild-specific panels.
 *
 * Renders a SystemPromptEditor bound to `draftConfig.ai?.systemPrompt`, and when `guildId` is provided it also
 * renders a "Response Boundaries" channel selector for blocked channels and a ChannelModeSection for per-channel
 * and default mode configuration.
 *
 * @param draftConfig - Current editable guild AI configuration
 * @param saving - When true, disables interactive inputs
 * @param guildId - Guild identifier; when falsy guild-specific sections are omitted
 * @param onSystemPromptChange - Called with the updated system prompt string
 * @param onBlockedChannelsChange - Called with the updated list of blocked channel IDs
 * @param onChannelModeChange - Called to set or clear a specific channel's mode
 * @param onDefaultChannelModeChange - Called to change the default channel mode
 * @param onResetAllChannelModes - Called to reset all channel modes to their defaults
 * @returns The JSX element containing AI chat settings UI for the given draft configuration
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
            selected={(draftConfig.ai?.blockedChannelIds ?? []) as string[]}
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
