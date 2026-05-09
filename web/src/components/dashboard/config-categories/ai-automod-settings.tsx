import { AiModelSelect } from '@/components/dashboard/ai-model-select';
import { type GuildConfig, inputClasses } from '@/components/dashboard/config-editor-utils';
import { ChannelSelector } from '@/components/ui/channel-selector';
import {
  AI_AUTOMOD_ACTION_OPTIONS,
  AI_AUTOMOD_CATEGORIES,
  AI_AUTOMOD_DM_NOTIFICATION_OPTIONS,
  type SelectableAiAutoModAction,
} from '@/data/ai-automod-catalog';
import { cn } from '@/lib/utils';
import type { AiAutoModCategory, AiAutoModDmNotificationAction } from '@/types/config';
import { ToggleSwitch } from '../toggle-switch';

export type AiAutoModDraft = NonNullable<GuildConfig['aiAutoMod']>;
export type AiAutoModFieldUpdater<K extends keyof AiAutoModDraft> =
  | AiAutoModDraft[K]
  | ((previousValue: AiAutoModDraft[K], previousAiAutoMod: AiAutoModDraft) => AiAutoModDraft[K]);

const AI_AUTOMOD_ACTION_ORDER = AI_AUTOMOD_ACTION_OPTIONS.map((option) => option.value);

/**
 * Type-guard that determines whether a value is a recognized selectable AI automod action.
 *
 * @param value - The value to test.
 * @returns `true` if `value` is a string matching one of the known selectable automod action identifiers, `false` otherwise.
 */
function isSelectableAiAutoModAction(value: unknown): value is SelectableAiAutoModAction {
  return (
    typeof value === 'string' &&
    AI_AUTOMOD_ACTION_ORDER.includes(value as SelectableAiAutoModAction)
  );
}

/**
 * Produce a deduplicated list of actions ordered by the canonical AI_AUTOMOD_ACTION_ORDER.
 *
 * @param actions - Array of selectable action values (may contain duplicates)
 * @returns The unique actions from `actions`, sorted according to `AI_AUTOMOD_ACTION_ORDER`
 */
function sortAiAutoModActions(
  actions: readonly SelectableAiAutoModAction[],
): SelectableAiAutoModAction[] {
  const selected = new Set(actions);
  return AI_AUTOMOD_ACTION_ORDER.filter((action) => selected.has(action));
}

/**
 * Normalize a persisted or configured automod action value into a stable, ordered list of valid actions.
 *
 * Accepts raw input from storage or configuration and produces a deduplicated, ordered array of
 * SelectableAiAutoModAction values. If `value === 'none'`, returns an empty array. If `value` is an
 * array it is used as the source; if `value` is a single valid action it is wrapped in an array;
 * otherwise `fallback` is used. The result keeps the first occurrence of each valid action and is
 * ordered according to the canonical action order.
 *
 * @param value - Raw persisted/configured value which may be `'none'`, an array, a single action, or unknown
 * @param fallback - Fallback array of actions to use when `value` is not a recognized action or array
 * @returns An ordered, deduplicated array of valid `SelectableAiAutoModAction` values
 */
function normalizeAiAutoModActions(
  value: unknown,
  fallback: readonly SelectableAiAutoModAction[],
): SelectableAiAutoModAction[] {
  if (value === 'none') return [];

  let rawActions: readonly unknown[];
  if (Array.isArray(value)) {
    rawActions = value;
  } else if (isSelectableAiAutoModAction(value)) {
    rawActions = [value];
  } else {
    rawActions = fallback;
  }
  const uniqueActions = rawActions.filter(
    (action, index, allActions): action is SelectableAiAutoModAction =>
      isSelectableAiAutoModAction(action) && allActions.indexOf(action) === index,
  );

  return sortAiAutoModActions(uniqueActions);
}

/**
 * Update the response-action mapping for a single automod category by adding or removing an action.
 *
 * The function uses `fallbackActions` when the category has no existing entry, ensures the resulting
 * action list contains unique values, and returns actions in a stable canonical order.
 *
 * @param previousActions - Existing category -> actions mapping (may be `null`/`undefined`)
 * @param categoryKey - The category whose actions should be updated
 * @param fallbackActions - Default actions to use when the category has no existing entry
 * @param action - The action to add or remove for the category
 * @param checked - If `true`, add `action` to the category; if `false`, remove it
 * @returns An updated, non-nullable mapping of category keys to their normalized action lists
 */
export function toggleAiAutoModCategoryAction(
  previousActions: AiAutoModDraft['actions'],
  categoryKey: AiAutoModCategory,
  fallbackActions: readonly SelectableAiAutoModAction[],
  action: SelectableAiAutoModAction,
  checked: boolean,
): NonNullable<AiAutoModDraft['actions']> {
  const previousActionMap = previousActions ?? {};
  const previousCategoryActions = normalizeAiAutoModActions(
    previousActionMap[categoryKey],
    fallbackActions,
  );
  const nextActions = checked
    ? sortAiAutoModActions([...previousCategoryActions, action])
    : previousCategoryActions.filter((selectedAction) => selectedAction !== action);

  return {
    ...previousActionMap,
    [categoryKey]: nextActions,
  };
}

/**
 * Renders a labeled checkbox toggle for a single automod action option.
 *
 * @param categoryLabel - Human-readable label of the automod category (used for the checkbox aria-label)
 * @param option - The action option object containing `label` and `value` to display
 * @param checked - Whether the checkbox is currently selected
 * @param disabled - Whether the checkbox is disabled
 * @param onToggle - Callback invoked with the new checked state when the checkbox changes
 * @returns A JSX element representing the action toggle control
 */
function AiAutoModActionToggle({
  categoryLabel,
  option,
  checked,
  disabled,
  onToggle,
}: Readonly<{
  categoryLabel: string;
  option: (typeof AI_AUTOMOD_ACTION_OPTIONS)[number];
  checked: boolean;
  disabled: boolean;
  onToggle: (checked: boolean) => void;
}>) {
  return (
    <label className="cursor-pointer">
      <input
        type="checkbox"
        aria-label={`${categoryLabel} ${option.label}`}
        checked={checked}
        onChange={(event) => onToggle(event.target.checked)}
        disabled={disabled}
        className="peer sr-only"
      />
      <span className="block rounded-lg border border-border/40 bg-background/70 px-3 py-2 text-[11px] font-bold text-foreground/60 transition-colors peer-checked:border-primary/60 peer-checked:bg-primary/15 peer-checked:text-foreground peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary">
        {option.label}
      </span>
    </label>
  );
}

/**
 * Renders a labeled card-style toggle for a single AI AutoMod DM notification option.
 *
 * @param option - The DM notification option containing `label` and `description` to display.
 * @param checked - `true` if the toggle is on, `false` otherwise.
 * @param disabled - `true` to disable user interaction with the toggle.
 * @param onToggle - Callback invoked with the new checked state when the toggle changes.
 * @returns The JSX element for the DM notification toggle control.
 */
function AiAutoModDmNotificationToggle({
  option,
  checked,
  disabled,
  onToggle,
}: Readonly<{
  option: (typeof AI_AUTOMOD_DM_NOTIFICATION_OPTIONS)[number];
  checked: boolean;
  disabled: boolean;
  onToggle: (checked: boolean) => void;
}>) {
  return (
    <label className="group cursor-pointer rounded-2xl border border-border/40 bg-background/45 p-4 transition-colors hover:border-primary/40 hover:bg-primary/5">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <span className="text-sm font-bold text-foreground/85">{option.label}</span>
          <p className="text-[11px] leading-5 text-muted-foreground">{option.description}</p>
        </div>
        <input
          type="checkbox"
          aria-label={`DM notifications for ${option.label}`}
          checked={checked}
          onChange={(event) => onToggle(event.target.checked)}
          disabled={disabled}
          className="mt-0.5 h-4 w-4 rounded border-border/60 accent-primary disabled:cursor-not-allowed disabled:opacity-50"
        />
      </div>
    </label>
  );
}

/**
 * Determine whether DM notifications for a specific AI automod action are enabled for the guild.
 *
 * Checks the value with the following precedence: `draftConfig.aiAutoMod.dmNotifications[action]`,
 * then `draftConfig.moderation.dmNotifications[action]`, and defaults to enabled.
 *
 * @param draftConfig - The guild configuration draft to read settings from
 * @param action - The DM notification action to check
 * @returns `true` if DM notifications for `action` are enabled, `false` otherwise
 */
function isAiAutoModDmNotificationEnabled(
  draftConfig: GuildConfig,
  action: AiAutoModDmNotificationAction,
): boolean {
  return Boolean(
    draftConfig.aiAutoMod?.dmNotifications?.[action] ??
      draftConfig.moderation?.dmNotifications?.[action] ??
      true,
  );
}

/**
 * Render the AI Auto Moderation settings UI for editing a guild's `aiAutoMod` configuration.
 *
 * Renders controls for selecting the detection model, incident report channel, instant enforcement (auto-delete),
 * per-category confidence thresholds and response actions, and user DM notification toggles. Inputs respect the
 * `saving` state and call the provided change handlers to update the draft configuration.
 *
 * @param draftConfig - Current guild configuration draft containing `aiAutoMod` and related settings
 * @param saving - When `true`, disables form inputs to prevent edits while saving
 * @param guildId - Guild identifier used by the channel selector
 * @param modelValue - Currently selected detection model value for the model selector
 * @param onFieldChange - Updates a top-level `aiAutoMod` field; accepts either a direct value or an updater function
 * @param onActionChange - Called when a per-category response action checkbox is toggled
 * @param onDmNotificationChange - Called when a DM notification action toggle is changed
 * @returns A JSX element containing the AI Auto Moderation settings form and controls
 */
export function AiAutoModSettings({
  draftConfig,
  saving,
  guildId,
  modelValue,
  onFieldChange,
  onActionChange,
  onDmNotificationChange,
}: Readonly<{
  draftConfig: GuildConfig;
  saving: boolean;
  guildId: string;
  modelValue: string;
  onFieldChange: <K extends keyof AiAutoModDraft>(
    field: K,
    value: AiAutoModFieldUpdater<K>,
  ) => void;
  onActionChange: (
    categoryKey: AiAutoModCategory,
    fallbackActions: readonly SelectableAiAutoModAction[],
    action: SelectableAiAutoModAction,
    checked: boolean,
  ) => void;
  onDmNotificationChange: (action: AiAutoModDmNotificationAction, checked: boolean) => void;
}>) {
  return (
    <div className="space-y-6">
      <div className="p-6 rounded-[24px] border border-border/40 bg-muted/20 backdrop-blur-xl">
        <div className="mb-6 space-y-1">
          <h3 className="text-sm font-semibold tracking-wide text-foreground/90">
            Core Moderation Settings
          </h3>
          <p className="text-[11px] text-muted-foreground/60 uppercase tracking-wider">
            Incident reporting and enforcements
          </p>
        </div>
        <div className="space-y-6">
          <AiModelSelect
            id="ai-automod-model"
            label="Detection Model"
            value={modelValue}
            onChange={(value) => onFieldChange('model', value)}
            disabled={saving}
          />

          <div className="space-y-3">
            <label
              htmlFor="ai-automod-flag-channel"
              className="text-sm font-bold tracking-tight text-foreground/80"
            >
              Incident Report Channel
            </label>
            <ChannelSelector
              id="ai-automod-flag-channel"
              guildId={guildId}
              selected={
                draftConfig.aiAutoMod?.flagChannelId ? [draftConfig.aiAutoMod.flagChannelId] : []
              }
              onChange={(selected) => onFieldChange('flagChannelId', selected[0] ?? null)}
              disabled={saving}
              placeholder="Select a channel for review..."
              maxSelections={1}
              filter="text"
            />
          </div>

          <div className="flex items-center justify-between p-4 rounded-xl bg-white/[0.02] border border-border/30 shadow-inner">
            <div className="space-y-0.5">
              <span className="text-sm font-bold text-foreground/90">Instant Enforcement</span>
              <p className="text-[11px] text-muted-foreground font-medium">
                Automatically remove messages that trigger high-severity flags.
              </p>
            </div>
            <ToggleSwitch
              checked={Boolean(draftConfig.aiAutoMod?.autoDelete ?? true)}
              onChange={(v) => onFieldChange('autoDelete', v)}
              disabled={saving}
              label="Auto-delete"
            />
          </div>
        </div>
      </div>

      <div className="p-6 rounded-[24px] border border-border/40 bg-muted/20 backdrop-blur-xl">
        <div className="mb-6 space-y-1">
          <h3 className="text-sm font-semibold tracking-wide text-foreground/90">
            Sensitivity & Actions
          </h3>
          <p className="text-[11px] text-muted-foreground/60 uppercase tracking-wider">
            Confidence thresholds and response matrix
          </p>
        </div>

        <div className="overflow-hidden rounded-2xl border border-border/30 bg-background/30">
          <div className="hidden grid-cols-[minmax(10rem,1fr)_8rem_minmax(14rem,2fr)] gap-4 border-b border-border/30 px-4 py-3 sm:grid">
            <span className="text-[11px] font-black uppercase tracking-[0.2em] text-foreground/50">
              Category
            </span>
            <span className="text-right text-[11px] font-black uppercase tracking-[0.2em] text-foreground/50">
              Threshold
            </span>
            <span className="text-[11px] font-black uppercase tracking-[0.2em] text-foreground/50">
              Response
            </span>
          </div>
          <div className="divide-y divide-border/20">
            {AI_AUTOMOD_CATEGORIES.map((category) => {
              const selectedActions = normalizeAiAutoModActions(
                (
                  draftConfig.aiAutoMod?.actions as
                    | Partial<Record<AiAutoModCategory, unknown>>
                    | undefined
                )?.[category.key],
                category.defaultActions,
              );

              return (
                <div
                  key={category.key}
                  className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(10rem,1fr)_8rem_minmax(14rem,2fr)] sm:items-center sm:gap-4 sm:py-3"
                >
                  <span className="text-sm font-bold text-foreground/80">{category.label}</span>
                  <div className="grid gap-1.5 sm:block">
                    <span className="text-[10px] font-black uppercase tracking-[0.18em] text-foreground/40 sm:hidden">
                      Threshold
                    </span>
                    <div className="relative w-full sm:ml-auto sm:w-28">
                      <input
                        id={`ai-threshold-${category.key}`}
                        aria-label={`${category.label} Threshold`}
                        type="number"
                        min={0}
                        max={100}
                        step={5}
                        value={Math.round(
                          (draftConfig.aiAutoMod?.thresholds?.[category.key] ??
                            category.defaultThreshold) * 100,
                        )}
                        onChange={(event) => {
                          const raw = Number(event.target.value);
                          const value = Number.isNaN(raw) ? 0 : Math.min(1, Math.max(0, raw / 100));
                          onFieldChange('thresholds', (previousThresholds) => ({
                            ...previousThresholds,
                            [category.key]: value,
                          }));
                        }}
                        onFocus={(event) => event.target.select()}
                        disabled={saving}
                        className={cn(
                          inputClasses,
                          'w-full text-right pr-8 font-mono font-semibold',
                        )}
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-muted-foreground">
                        %
                      </span>
                    </div>
                  </div>
                  <fieldset className="grid min-w-0 gap-1.5">
                    <legend className="sr-only">{category.label} Actions</legend>
                    <span className="text-[10px] font-black uppercase tracking-[0.18em] text-foreground/40 sm:hidden">
                      Response
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {AI_AUTOMOD_ACTION_OPTIONS.map((option) => (
                        <AiAutoModActionToggle
                          key={option.value}
                          categoryLabel={category.label}
                          option={option}
                          checked={selectedActions.includes(option.value)}
                          disabled={saving}
                          onToggle={(checked) =>
                            onActionChange(
                              category.key,
                              category.defaultActions,
                              option.value,
                              checked,
                            )
                          }
                        />
                      ))}
                      {selectedActions.length === 0 && (
                        <span className="rounded-lg border border-dashed border-border/40 px-3 py-2 text-[11px] font-bold text-muted-foreground">
                          No response actions
                        </span>
                      )}
                    </div>
                  </fieldset>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-border/30 bg-background/30 p-4">
          <div className="mb-4 grid gap-1 sm:grid-cols-[1fr_auto] sm:items-end">
            <div className="space-y-1">
              <h4 className="text-sm font-semibold tracking-wide text-foreground/90">
                User DM Notifications
              </h4>
              <p className="text-[11px] text-muted-foreground/70">
                Send one concise DM after successful AI enforcement, summarizing the actions,
                triggered categories, and reason.
              </p>
            </div>
            <span className="rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-primary">
              One DM per incident
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {AI_AUTOMOD_DM_NOTIFICATION_OPTIONS.map((option) => (
              <AiAutoModDmNotificationToggle
                key={option.value}
                option={option}
                checked={isAiAutoModDmNotificationEnabled(draftConfig, option.value)}
                disabled={saving}
                onToggle={(checked) => onDmNotificationChange(option.value, checked)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
