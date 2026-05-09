import type { GuildConfig } from '@/components/dashboard/config-editor-utils';
import { ChannelModeSection } from '@/components/dashboard/config-sections/ChannelModeSection';
import { ChannelSelector } from '@/components/ui/channel-selector';
import type { ChannelMode } from '@/types/config';
import { SYSTEM_PROMPT_MAX_LENGTH } from '@/types/config';
import { SystemPromptEditor } from '../system-prompt-editor';

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
