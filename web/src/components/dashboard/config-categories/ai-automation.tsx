'use client';

import { useCallback, useEffect } from 'react';
import { useConfigContext } from '@/components/dashboard/config-context';
import type { ConfigFeatureId } from '@/components/dashboard/config-workspace/types';
import type { SelectableAiAutoModAction } from '@/data/ai-automod-catalog';
import {
  getVisibleProviderModelValue,
  VISIBLE_PROVIDER_MODEL_OPTIONS,
} from '@/lib/provider-model-options';
import type { AiAutoModCategory, AiAutoModDmNotificationAction, ChannelMode } from '@/types/config';
import {
  type AiAutoModDraft,
  type AiAutoModFieldUpdater,
  AiAutoModSettings,
  toggleAiAutoModCategoryAction,
} from './ai-automod-settings';
import { AiChatSettings } from './ai-chat-settings';
import { AiMemorySettings, type MemoryConfigField } from './ai-memory-settings';
import { AiTriageSettings, type TriageConfigField } from './ai-triage-settings';
import { ConfigCategoryLayout } from './config-category-layout';

const hasVisibleModelOptions = VISIBLE_PROVIDER_MODEL_OPTIONS.length > 0;

/**
 * Determines whether a saved model value is a string that differs from the provided normalized model.
 *
 * @param value - The stored value to check.
 * @param normalizedValue - The normalized model string to compare against.
 * @returns `true` if `value` is a string different from `normalizedValue`, `false` otherwise.
 */
function shouldNormalizeSavedModel(value: unknown, normalizedValue: string): value is string {
  return typeof value === 'string' && normalizedValue !== value;
}

/**
 * Produce the toggle checked state and change handler for the given feature tab.
 *
 * @param activeTab - The active feature identifier determining which config subtree to target.
 * @param draftConfig - The current draft configuration used to read the feature's `enabled` value.
 * @param handlers - Updater functions used to write the new `enabled` value back into the appropriate draft config subtree.
 * @returns An object with `checked` set to the feature's current enabled state and `onChange` that updates that enabled state.
 */
function getFeatureToggle(
  activeTab: ConfigFeatureId,
  draftConfig: NonNullable<ReturnType<typeof useConfigContext>['draftConfig']>,
  handlers: {
    updateAiField: (field: string, value: unknown) => void;
    updateAiAutoModField: <K extends keyof AiAutoModDraft>(
      field: K,
      value: AiAutoModFieldUpdater<K>,
    ) => void;
    updateTriageField: (field: TriageConfigField, value: unknown) => void;
    updateMemoryField: (field: MemoryConfigField, value: unknown) => void;
  },
) {
  switch (activeTab) {
    case 'ai-chat':
      return {
        checked: draftConfig.ai?.enabled ?? true,
        onChange: (value: boolean) => handlers.updateAiField('enabled', value),
      };
    case 'ai-automod':
      return {
        checked: draftConfig.aiAutoMod?.enabled ?? false,
        onChange: (value: boolean) => handlers.updateAiAutoModField('enabled', value),
      };
    case 'triage':
      return {
        checked: draftConfig.triage?.enabled ?? true,
        onChange: (value: boolean) => handlers.updateTriageField('enabled', value),
      };
    case 'memory':
      return {
        checked: draftConfig.memory?.enabled ?? true,
        onChange: (value: boolean) => handlers.updateMemoryField('enabled', value),
      };
    default:
      return { checked: false, onChange: () => {} };
  }
}

/**
 * Render the settings UI for the selected AI feature and the shared content-safety panel.
 *
 * Presents the appropriate feature panel based on the active tab (AI Chat, AI AutoMod, Triage, Memory),
 * wires user interactions into the draft configuration via the config context, and performs model
 * normalization effects when needed.
 *
 * @returns The rendered JSX element for the active feature, or `null` when the draft configuration or active tab is unavailable.
 */
export function AiAutomationCategory() {
  const { draftConfig, saving, guildId, updateDraftConfig, activeTabId } = useConfigContext();

  const activeTab = activeTabId as ConfigFeatureId | null;

  const updateAiField = useCallback(
    (field: string, value: unknown) => {
      updateDraftConfig((prev) => ({
        ...prev,
        ai: { ...prev.ai, [field]: value },
      }));
    },
    [updateDraftConfig],
  );

  const updateSystemPrompt = useCallback(
    (value: string) => {
      updateDraftConfig((prev) => ({
        ...prev,
        ai: { ...prev.ai, systemPrompt: value },
      }));
    },
    [updateDraftConfig],
  );

  const updateAiBlockedChannels = useCallback(
    (channels: string[]) => {
      updateDraftConfig((prev) => ({
        ...prev,
        ai: { ...prev.ai, blockedChannelIds: channels },
      }));
    },
    [updateDraftConfig],
  );

  const updateChannelMode = useCallback(
    (channelId: string, mode: ChannelMode | undefined) => {
      updateDraftConfig((prev) => {
        const modes = { ...(prev.ai?.channelModes ?? {}) } as Record<string, ChannelMode>;
        const currentDefault: ChannelMode =
          (prev.ai?.defaultChannelMode as ChannelMode) ?? 'mention';
        if (mode === undefined || mode === currentDefault) {
          delete modes[channelId];
        } else {
          modes[channelId] = mode;
        }
        return { ...prev, ai: { ...prev.ai, channelModes: modes } };
      });
    },
    [updateDraftConfig],
  );

  const updateDefaultChannelMode = useCallback(
    (mode: ChannelMode) => {
      updateDraftConfig((prev) => {
        const existingModes = { ...(prev.ai?.channelModes ?? {}) } as Record<string, ChannelMode>;
        for (const [channelId, channelMode] of Object.entries(existingModes)) {
          if (channelMode === mode) {
            delete existingModes[channelId];
          }
        }
        return {
          ...prev,
          ai: { ...prev.ai, defaultChannelMode: mode, channelModes: existingModes },
        };
      });
    },
    [updateDraftConfig],
  );

  const resetAllChannelModes = useCallback(() => {
    updateDraftConfig((prev) => ({
      ...prev,
      ai: { ...prev.ai, channelModes: {} },
    }));
  }, [updateDraftConfig]);

  const updateAiAutoModField = useCallback(
    <K extends keyof AiAutoModDraft>(field: K, value: AiAutoModFieldUpdater<K>) => {
      updateDraftConfig((prev) => {
        const previousAiAutoMod = (prev.aiAutoMod ?? {}) as AiAutoModDraft;
        const nextValue =
          typeof value === 'function'
            ? (
                value as (
                  previousValue: AiAutoModDraft[K],
                  previousAiAutoMod: AiAutoModDraft,
                ) => AiAutoModDraft[K]
              )(previousAiAutoMod[field], previousAiAutoMod)
            : value;

        return {
          ...prev,
          aiAutoMod: { ...previousAiAutoMod, [field]: nextValue },
        };
      });
    },
    [updateDraftConfig],
  );

  const updateAiAutoModAction = useCallback(
    (
      categoryKey: AiAutoModCategory,
      fallbackActions: readonly SelectableAiAutoModAction[],
      action: SelectableAiAutoModAction,
      checked: boolean,
    ) => {
      updateAiAutoModField('actions', (previousActions) =>
        toggleAiAutoModCategoryAction(
          previousActions,
          categoryKey,
          fallbackActions,
          action,
          checked,
        ),
      );
    },
    [updateAiAutoModField],
  );

  const updateAiAutoModDmNotification = useCallback(
    (action: AiAutoModDmNotificationAction, checked: boolean) => {
      updateDraftConfig((prev) => {
        const previousAiAutoMod = (prev.aiAutoMod ?? {}) as AiAutoModDraft;
        const legacyNotifications = prev.moderation?.dmNotifications;

        return {
          ...prev,
          aiAutoMod: {
            ...previousAiAutoMod,
            dmNotifications: {
              warn: legacyNotifications?.warn ?? true,
              timeout: legacyNotifications?.timeout ?? true,
              kick: legacyNotifications?.kick ?? true,
              ban: legacyNotifications?.ban ?? true,
              ...previousAiAutoMod.dmNotifications,
              [action]: checked,
            },
          },
        };
      });
    },
    [updateDraftConfig],
  );

  const updateTriageField = useCallback(
    (field: TriageConfigField, value: unknown) => {
      updateDraftConfig((prev) => ({
        ...prev,
        triage: { ...prev.triage, [field]: value },
      }));
    },
    [updateDraftConfig],
  );

  const updateMemoryField = useCallback(
    (field: MemoryConfigField, value: unknown) => {
      updateDraftConfig((prev) => ({
        ...prev,
        memory: { ...prev.memory, [field]: value },
      }));
    },
    [updateDraftConfig],
  );

  const hasDraftConfig = draftConfig !== null;
  const currentAiAutoModModel = draftConfig?.aiAutoMod?.model;
  const currentClassifyModel = draftConfig?.triage?.classifyModel;
  const currentRespondModel = draftConfig?.triage?.respondModel;
  const aiAutoModModelValue = getVisibleProviderModelValue(currentAiAutoModModel);
  const classifyModelValue = getVisibleProviderModelValue(currentClassifyModel);
  const respondModelValue = getVisibleProviderModelValue(currentRespondModel);

  useEffect(() => {
    if (!hasDraftConfig || activeTab !== 'ai-automod' || !hasVisibleModelOptions) return;
    if (!shouldNormalizeSavedModel(currentAiAutoModModel, aiAutoModModelValue)) return;

    updateDraftConfig((prev) => {
      const previousModel = prev.aiAutoMod?.model;
      const normalizedModel = getVisibleProviderModelValue(previousModel);
      if (!shouldNormalizeSavedModel(previousModel, normalizedModel)) return prev;

      return {
        ...prev,
        aiAutoMod: {
          ...prev.aiAutoMod,
          model: normalizedModel,
        },
      };
    });
  }, [activeTab, aiAutoModModelValue, currentAiAutoModModel, hasDraftConfig, updateDraftConfig]);

  useEffect(() => {
    if (!hasDraftConfig || activeTab !== 'triage' || !hasVisibleModelOptions) return;
    const shouldNormalizeClassifyModel = shouldNormalizeSavedModel(
      currentClassifyModel,
      classifyModelValue,
    );
    const shouldNormalizeRespondModel = shouldNormalizeSavedModel(
      currentRespondModel,
      respondModelValue,
    );
    if (!shouldNormalizeClassifyModel && !shouldNormalizeRespondModel) return;

    updateDraftConfig((prev) => {
      const previousTriage = prev.triage ?? {};
      const normalizedTriageModels: Record<string, string> = {};
      const normalizedClassifyModel = getVisibleProviderModelValue(previousTriage.classifyModel);
      const normalizedRespondModel = getVisibleProviderModelValue(previousTriage.respondModel);

      if (shouldNormalizeSavedModel(previousTriage.classifyModel, normalizedClassifyModel)) {
        normalizedTriageModels.classifyModel = normalizedClassifyModel;
      }
      if (shouldNormalizeSavedModel(previousTriage.respondModel, normalizedRespondModel)) {
        normalizedTriageModels.respondModel = normalizedRespondModel;
      }
      if (Object.keys(normalizedTriageModels).length === 0) return prev;

      return {
        ...prev,
        triage: {
          ...previousTriage,
          ...normalizedTriageModels,
        },
      };
    });
  }, [
    activeTab,
    classifyModelValue,
    currentClassifyModel,
    currentRespondModel,
    hasDraftConfig,
    respondModelValue,
    updateDraftConfig,
  ]);

  if (!draftConfig) return null;
  if (!activeTab) return null;

  const featureToggle = getFeatureToggle(activeTab, draftConfig, {
    updateAiField,
    updateAiAutoModField,
    updateTriageField,
    updateMemoryField,
  });

  return (
    <ConfigCategoryLayout
      featureId={activeTab}
      toggle={{
        checked: featureToggle.checked,
        onChange: featureToggle.onChange,
        disabled: saving,
      }}
    >
      {activeTab === 'ai-chat' && (
        <AiChatSettings
          draftConfig={draftConfig}
          saving={saving}
          guildId={guildId}
          onSystemPromptChange={updateSystemPrompt}
          onBlockedChannelsChange={updateAiBlockedChannels}
          onChannelModeChange={updateChannelMode}
          onDefaultChannelModeChange={updateDefaultChannelMode}
          onResetAllChannelModes={resetAllChannelModes}
        />
      )}

      {activeTab === 'ai-automod' && (
        <AiAutoModSettings
          draftConfig={draftConfig}
          saving={saving}
          guildId={guildId}
          modelValue={aiAutoModModelValue}
          onFieldChange={updateAiAutoModField}
          onActionChange={updateAiAutoModAction}
          onDmNotificationChange={updateAiAutoModDmNotification}
        />
      )}

      {activeTab === 'triage' && (
        <AiTriageSettings
          draftConfig={draftConfig}
          saving={saving}
          guildId={guildId}
          classifyModelValue={classifyModelValue}
          respondModelValue={respondModelValue}
          onFieldChange={updateTriageField}
        />
      )}

      {activeTab === 'memory' && (
        <AiMemorySettings
          draftConfig={draftConfig}
          saving={saving}
          onFieldChange={updateMemoryField}
        />
      )}
    </ConfigCategoryLayout>
  );
}
