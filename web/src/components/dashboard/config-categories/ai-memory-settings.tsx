import {
  type GuildConfig,
  inputClasses,
  parseNumberInput,
} from '@/components/dashboard/config-editor-utils';
import { cn } from '@/lib/utils';
import { ToggleSwitch } from '../toggle-switch';

export function AiMemorySettings({
  draftConfig,
  saving,
  onFieldChange,
}: Readonly<{
  draftConfig: GuildConfig;
  saving: boolean;
  onFieldChange: (field: string, value: unknown) => void;
}>) {
  return (
    <div className="p-4 sm:p-6 rounded-[24px] border border-border/40 bg-muted/20 backdrop-blur-xl space-y-6">
      <div className="space-y-3">
        <label
          htmlFor="max-context-memories"
          className="text-sm font-bold tracking-tight text-foreground/90"
        >
          Retrieval Depth
        </label>
        <div className="flex items-center gap-4">
          <input
            id="max-context-memories"
            type="number"
            min={1}
            value={draftConfig.memory?.maxContextMemories ?? 10}
            onChange={(event) => {
              const num = parseNumberInput(event.target.value, 1);
              if (num !== undefined) onFieldChange('maxContextMemories', num);
            }}
            onFocus={(event) => event.target.select()}
            disabled={saving}
            className={cn(inputClasses, 'w-40')}
          />
          <span className="text-xs text-muted-foreground font-bold uppercase tracking-widest">
            Memories max
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between p-4 rounded-xl bg-white/[0.02] border border-border/30 shadow-inner">
        <div className="space-y-0.5">
          <span className="text-sm font-bold text-foreground/90">Autonomous Extraction</span>
          <p className="text-[11px] text-muted-foreground font-medium">
            AI will automatically identify and save important facts.
          </p>
        </div>
        <ToggleSwitch
          checked={draftConfig.memory?.autoExtract ?? false}
          onChange={(value) => onFieldChange('autoExtract', value)}
          disabled={saving}
          label="Auto-Extract"
        />
      </div>
    </div>
  );
}
