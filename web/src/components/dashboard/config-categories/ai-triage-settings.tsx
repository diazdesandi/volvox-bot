import { AiModelSelect } from '@/components/dashboard/ai-model-select';
import {
  type GuildConfig,
  inputClasses,
  parseNumberInput,
} from '@/components/dashboard/config-editor-utils';
import { ChannelSelector } from '@/components/ui/channel-selector';
import { RoleSelector } from '@/components/ui/role-selector';
import { ToggleSwitch } from '../toggle-switch';

type TriageConfigDraft = NonNullable<GuildConfig['triage']>;
export type TriageConfigField = keyof TriageConfigDraft;
type TriageConfigFieldValue = TriageConfigDraft[TriageConfigField];
type TriageBooleanField = Extract<
  TriageConfigField,
  'moderationResponse' | 'debugFooter' | 'statusReactions' | 'directMentionFastPath'
>;
type TriageNumericField = Extract<
  TriageConfigField,
  'memoryTimeoutMs' | 'responseCooldownMs' | 'triageDebounceMs'
>;

const TRIAGE_NUMERIC_FIELDS = [
  {
    id: 'memory-timeout-ms',
    label: 'Memory Timeout (ms)',
    key: 'memoryTimeoutMs',
    min: 500,
    max: 30000,
    defaultValue: 2000,
    step: 100,
  },
  {
    id: 'response-cooldown-ms',
    label: 'Response Cooldown (ms)',
    key: 'responseCooldownMs',
    min: 0,
    max: 60000,
    defaultValue: 0,
    step: 500,
  },
  {
    id: 'triage-debounce-ms',
    label: 'Triage Debounce (ms)',
    key: 'triageDebounceMs',
    min: 0,
    max: 2000,
    defaultValue: 500,
    step: 50,
  },
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  key: TriageNumericField;
  min: number;
  max: number;
  defaultValue: number;
  step: number;
}>;

const TRIAGE_BOOLEAN_TOGGLES = [
  {
    id: 'moderationResponse',
    label: 'Enforce Safety Guardrails',
    key: 'moderationResponse',
    defaultValue: true,
  },
  { id: 'debugFooter', label: 'Show Debug Metadata', key: 'debugFooter', defaultValue: false },
  {
    id: 'statusReactions',
    label: 'Visual Status Feedback',
    key: 'statusReactions',
    defaultValue: true,
  },
  {
    id: 'directMentionFastPath',
    label: 'Fast Direct Replies',
    key: 'directMentionFastPath',
    defaultValue: true,
  },
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  key: TriageBooleanField;
  defaultValue: boolean;
}>;

/**
 * Renders the triage settings editor UI for a guild's AI configuration.
 *
 * @param draftConfig - Current guild configuration used to populate form fields
 * @param saving - When true, disables inputs to prevent edits while saving
 * @param guildId - Guild identifier used by channel and role selectors
 * @param classifyModelValue - Selected classifier model id/value
 * @param respondModelValue - Selected responder model id/value
 * @param onFieldChange - Callback invoked when a triage field changes; receives the field key and the new value
 * @returns A JSX element containing the triage settings editor
 */
export function AiTriageSettings({
  draftConfig,
  saving,
  guildId,
  classifyModelValue,
  respondModelValue,
  onFieldChange,
}: Readonly<{
  draftConfig: GuildConfig;
  saving: boolean;
  guildId: string;
  classifyModelValue: string;
  respondModelValue: string;
  onFieldChange: (field: TriageConfigField, value: TriageConfigFieldValue) => void;
}>) {
  return (
    <div className="space-y-6">
      <div className="p-6 rounded-[24px] border border-border/40 bg-muted/20 backdrop-blur-xl">
        <div className="mb-6 space-y-1">
          <h3 className="text-sm font-semibold tracking-wide text-foreground/90">Engine Setup</h3>
          <p className="text-[11px] text-muted-foreground/60 uppercase tracking-wider">
            Model selection and log destination
          </p>
        </div>
        <div className="grid gap-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <AiModelSelect
              id="classify-model"
              label="Classifier Engine"
              value={classifyModelValue}
              onChange={(value) => onFieldChange('classifyModel', value)}
              disabled={saving}
              wrapperClassName="space-y-2"
              labelClassName="ml-1 text-[11px] uppercase tracking-wider text-muted-foreground"
            />
            <AiModelSelect
              id="respond-model"
              label="Response Engine"
              value={respondModelValue}
              onChange={(value) => onFieldChange('respondModel', value)}
              disabled={saving}
              wrapperClassName="space-y-2"
              labelClassName="ml-1 text-[11px] uppercase tracking-wider text-muted-foreground"
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="moderation-log-channel"
              className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground ml-1"
            >
              Triage Audit Log
            </label>
            <ChannelSelector
              id="moderation-log-channel"
              guildId={guildId}
              selected={
                draftConfig.triage?.moderationLogChannel
                  ? [draftConfig.triage.moderationLogChannel]
                  : []
              }
              onChange={(selected) => onFieldChange('moderationLogChannel', selected[0] ?? null)}
              disabled={saving}
              placeholder="Select a channel for triage history..."
              maxSelections={1}
              filter="text"
            />
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-6 rounded-[24px] border border-border/40 bg-muted/20 backdrop-blur-xl">
        <div className="mb-6 space-y-1">
          <h3 className="text-sm font-semibold tracking-wide text-foreground/90">Role Filtering</h3>
          <p className="text-[11px] text-muted-foreground/60 uppercase tracking-wider">
            Control which users the AI responds to
          </p>
        </div>
        <div className="grid sm:grid-cols-2 gap-6">
          <div className="space-y-2">
            <label
              htmlFor="triage-allowed-roles"
              className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground ml-1"
            >
              Allowed Roles
            </label>
            <p className="text-[10px] text-muted-foreground/60 ml-1">
              Only triage messages from users with these roles. Empty = everyone allowed.
            </p>
            <RoleSelector
              id="triage-allowed-roles"
              guildId={guildId}
              selected={draftConfig.triage?.allowedRoles ?? []}
              onChange={(selected) => onFieldChange('allowedRoles', selected)}
              disabled={saving}
              placeholder="Select allowed roles..."
            />
          </div>
          <div className="space-y-2">
            <label
              htmlFor="triage-excluded-roles"
              className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground ml-1"
            >
              Excluded Roles
            </label>
            <p className="text-[10px] text-muted-foreground/60 ml-1">
              Never triage messages from users with these roles. Takes precedence over allowed.
            </p>
            <RoleSelector
              id="triage-excluded-roles"
              guildId={guildId}
              selected={draftConfig.triage?.excludedRoles ?? []}
              onChange={(selected) => onFieldChange('excludedRoles', selected)}
              disabled={saving}
              placeholder="Select excluded roles..."
            />
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="p-4 sm:p-6 rounded-[24px] border border-border/40 bg-muted/20 backdrop-blur-xl">
          <div className="mb-6 space-y-1">
            <h3 className="text-sm font-semibold tracking-wide text-foreground/90">Daily Limits</h3>
            <p className="text-[11px] text-muted-foreground/60 uppercase tracking-wider">
              Budget boundaries
            </p>
          </div>
          <div className="space-y-6">
            <div className="space-y-2">
              <label htmlFor="classify-budget" className="text-xs font-bold text-foreground/80">
                Classify Budget ($)
              </label>
              <input
                id="classify-budget"
                type="number"
                step="0.01"
                min={0}
                value={draftConfig.triage?.classifyBudget ?? 0}
                onChange={(event) => {
                  const num = parseNumberInput(event.target.value, 0);
                  if (num !== undefined) onFieldChange('classifyBudget', num);
                }}
                onFocus={(event) => event.target.select()}
                disabled={saving}
                className={inputClasses}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="respond-budget" className="text-xs font-bold text-foreground/80">
                Response Budget ($)
              </label>
              <input
                id="respond-budget"
                type="number"
                step="0.01"
                min={0}
                value={draftConfig.triage?.respondBudget ?? 0}
                onChange={(event) => {
                  const num = parseNumberInput(event.target.value, 0);
                  if (num !== undefined) onFieldChange('respondBudget', num);
                }}
                onFocus={(event) => event.target.select()}
                disabled={saving}
                className={inputClasses}
              />
            </div>
          </div>
        </div>

        <div className="p-4 sm:p-6 rounded-[24px] border border-border/40 bg-muted/20 backdrop-blur-xl">
          <div className="mb-6 space-y-1">
            <h3 className="text-sm font-semibold tracking-wide text-foreground/90">Performance</h3>
            <p className="text-[11px] text-muted-foreground/60 uppercase tracking-wider">
              Latency tuning
            </p>
          </div>
          <div className="space-y-4">
            {TRIAGE_NUMERIC_FIELDS.map((field) => (
              <div key={field.id} className="space-y-2">
                <label htmlFor={field.id} className="text-xs font-bold text-foreground/80">
                  {field.label}
                </label>
                <input
                  id={field.id}
                  type="number"
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  value={draftConfig.triage?.[field.key] ?? field.defaultValue}
                  onChange={(event) => {
                    const num = parseNumberInput(event.target.value, field.min, field.max);
                    if (num !== undefined) onFieldChange(field.key, num);
                  }}
                  onFocus={(event) => event.target.select()}
                  disabled={saving}
                  className={inputClasses}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="p-4 sm:p-6 rounded-[24px] border border-border/40 bg-muted/20 backdrop-blur-xl">
          <div className="mb-6 space-y-1">
            <h3 className="text-sm font-semibold tracking-wide text-foreground/90">
              Operational Modes
            </h3>
            <p className="text-[11px] text-muted-foreground/60 uppercase tracking-wider">
              Behavior toggles
            </p>
          </div>
          <div className="space-y-2">
            {TRIAGE_BOOLEAN_TOGGLES.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-border/30 shadow-inner"
              >
                <span className="text-sm font-semibold text-foreground/80">{item.label}</span>
                <ToggleSwitch
                  checked={draftConfig.triage?.[item.key] ?? item.defaultValue}
                  onChange={(value) => onFieldChange(item.key, value)}
                  disabled={saving}
                  label={item.label}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
