import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AI_MODEL,
  VISIBLE_PROVIDER_MODEL_OPTIONS,
  buildVisibleProviderModelOptions,
  getVisibleProviderModelValue,
  groupProviderModelOptions,
  isProviderModelId,
} from '@/lib/provider-model-options';
import providersCatalog from '@/data/providers.json';

const providerCatalog = {
  providers: {
    minimax: {
      displayName: 'MiniMax',
      models: {
        'MiniMax-M2.7': {
          displayName: 'MiniMax M2.7',
          availability: { visible: true, tier: 'free' },
        },
        'MiniMax-M2.5': {
          displayName: 'MiniMax M2.5',
          availability: { visible: false, tier: 'free' },
        },
        'MiniMax-M2': {
          displayName: 'MiniMax M2',
        },
      },
    },
    moonshot: {
      displayName: 'Moonshot',
      models: {
        'kimi-k2.6': {
          displayName: 'Kimi K2.6',
          availability: { visible: true, tier: 'free' },
        },
      },
    },
    openrouter: {
      displayName: 'OpenRouter',
      models: {
        'minimax/minimax-m2.5:free': {
          displayName: 'MiniMax M2.5 Free',
          availability: { visible: true, tier: 'free' },
        },
      },
    },
  },
};

describe('provider model options', () => {
  it('builds dropdown options only for models with availability.visible not false', () => {
    const options = buildVisibleProviderModelOptions(providerCatalog);

    expect(options.map((option) => option.value)).toEqual([
      'minimax:MiniMax-M2.7',
      'minimax:MiniMax-M2',
      'moonshot:kimi-k2.6',
      'openrouter:minimax/minimax-m2.5:free',
    ]);
    expect(options.map((option) => option.value)).not.toContain('minimax:MiniMax-M2.5');
  });

  it('groups visible model options by provider for select optgroups', () => {
    const groups = groupProviderModelOptions(buildVisibleProviderModelOptions(providerCatalog));

    expect(groups).toEqual([
      {
        providerName: 'minimax',
        providerDisplayName: 'MiniMax',
        options: [
          expect.objectContaining({ value: 'minimax:MiniMax-M2.7' }),
          expect.objectContaining({ value: 'minimax:MiniMax-M2' }),
        ],
      },
      {
        providerName: 'moonshot',
        providerDisplayName: 'Moonshot',
        options: [expect.objectContaining({ value: 'moonshot:kimi-k2.6' })],
      },
      {
        providerName: 'openrouter',
        providerDisplayName: 'OpenRouter',
        options: [expect.objectContaining({ value: 'openrouter:minimax/minimax-m2.5:free' })],
      },
    ]);
  });

  it('canonicalizes supported saved model values case-insensitively', () => {
    const options = buildVisibleProviderModelOptions(providerCatalog);

    expect(getVisibleProviderModelValue('MINIMAX:minimax-m2.7', options)).toBe(
      'minimax:MiniMax-M2.7',
    );
  });

  it('derives the default model from the first synced visible catalog entry', () => {
    expect(DEFAULT_AI_MODEL).toBe(VISIBLE_PROVIDER_MODEL_OPTIONS[0]?.value);
  });

  it('preserves hidden and unknown valid provider:model IDs', () => {
    const options = buildVisibleProviderModelOptions(providerCatalog);

    expect(getVisibleProviderModelValue('minimax:MiniMax-M2.7', options)).toBe(
      'minimax:MiniMax-M2.7',
    );
    expect(getVisibleProviderModelValue('minimax:MiniMax-M2.5', options)).toBe(
      'minimax:MiniMax-M2.5',
    );
    expect(getVisibleProviderModelValue('anthropic:claude-3-5-haiku', options)).toBe(
      'anthropic:claude-3-5-haiku',
    );
  });

  it('preserves provider model IDs with colons in the model segment', () => {
    const options = buildVisibleProviderModelOptions(providerCatalog);

    expect(isProviderModelId('openrouter:minimax/minimax-m2.5:free')).toBe(true);
    expect(getVisibleProviderModelValue('OPENROUTER:minimax/minimax-m2.5:free', options)).toBe(
      'openrouter:minimax/minimax-m2.5:free',
    );
    expect(getVisibleProviderModelValue('provider:model:extra', options)).toBe(
      'provider:model:extra',
    );
  });

  it('rejects malformed provider model IDs and falls back to the default option', () => {
    const options = buildVisibleProviderModelOptions(providerCatalog);

    for (const value of [
      '',
      ':orphan-model',
      'provider:',
      'provider::free',
      'bare-model',
      'provider:has whitespace',
      ' provider:model',
      'provider:model ',
    ]) {
      expect(isProviderModelId(value)).toBe(false);
      expect(getVisibleProviderModelValue(value, options)).toBe(options[0]?.value);
    }
  });

  it('uses catalog order when falling back to the default model', () => {
    const options = buildVisibleProviderModelOptions({
      providers: {
        moonshot: {
          displayName: 'Moonshot',
          models: {
            'kimi-k2.6': {
              displayName: 'Kimi K2.6',
              availability: { visible: true },
            },
          },
        },
        minimax: {
          displayName: 'MiniMax',
          models: {
            'MiniMax-M2.7': {
              displayName: 'MiniMax M2.7',
              availability: { visible: true },
            },
          },
        },
      },
    });

    expect(options[0]?.value).toBe('moonshot:kimi-k2.6');
    expect(getVisibleProviderModelValue('not a provider model', options)).toBe(options[0]?.value);
  });
});

describe('providers.json catalog display names', () => {
  it('no OpenRouter model displayName contains "(via OpenRouter)"', () => {
    const openrouterModels = providersCatalog.providers.openrouter.models as Record<
      string,
      { displayName: string }
    >;
    for (const [modelId, model] of Object.entries(openrouterModels)) {
      expect(
        model.displayName,
        `Model ${modelId} should not include "(via OpenRouter)" in displayName`,
      ).not.toContain('(via OpenRouter)');
    }
  });

  it('changed OpenRouter models have correct display names without provider suffix', () => {
    const openrouterModels = providersCatalog.providers.openrouter.models as Record<
      string,
      { displayName: string }
    >;

    expect(openrouterModels['minimax/minimax-m2.5']?.displayName).toBe('MiniMax M2.5');
    expect(openrouterModels['minimax/minimax-m2.5:free']?.displayName).toBe('MiniMax M2.5 Free');
    expect(openrouterModels['moonshotai/kimi-k2.6']?.displayName).toBe('Kimi K2.6');
    expect(openrouterModels['moonshotai/kimi-k2.5']?.displayName).toBe('Kimi K2.5');
    expect(openrouterModels['moonshotai/kimi-k2-thinking']?.displayName).toBe('Kimi K2 Thinking');
    expect(openrouterModels['moonshotai/kimi-k2-0905']?.displayName).toBe('Kimi K2 0905');
    expect(openrouterModels['moonshotai/kimi-k2']?.displayName).toBe('Kimi K2');
  });

  it('no provider model displayName contains "(via OpenRouter)" across the full catalog', () => {
    const { providers } = providersCatalog;
    for (const [providerName, providerConfig] of Object.entries(providers)) {
      const models = (providerConfig as { models: Record<string, { displayName: string }> }).models;
      for (const [modelId, model] of Object.entries(models)) {
        expect(
          model.displayName,
          `${providerName}/${modelId} should not include "(via OpenRouter)"`,
        ).not.toContain('(via OpenRouter)');
      }
    }
  });

  it('buildVisibleProviderModelOptions on the real catalog produces OpenRouter options without "(via OpenRouter)"', () => {
    const options = buildVisibleProviderModelOptions(providersCatalog);
    const openrouterOptions = options.filter((o) => o.providerName === 'openrouter');

    expect(openrouterOptions.length).toBeGreaterThan(0);
    for (const option of openrouterOptions) {
      expect(option.label).not.toContain('(via OpenRouter)');
      expect(option.modelDisplayName).not.toContain('(via OpenRouter)');
    }
  });

  it('specific OpenRouter model options have the correct label and modelDisplayName', () => {
    const options = buildVisibleProviderModelOptions(providersCatalog);

    const m25 = options.find((o) => o.value === 'openrouter:minimax/minimax-m2.5');
    expect(m25?.label).toBe('MiniMax M2.5');
    expect(m25?.modelDisplayName).toBe('MiniMax M2.5');

    const kimiK26 = options.find((o) => o.value === 'openrouter:moonshotai/kimi-k2.6');
    expect(kimiK26?.label).toBe('Kimi K2.6');
    expect(kimiK26?.modelDisplayName).toBe('Kimi K2.6');

    const kimiK2 = options.find((o) => o.value === 'openrouter:moonshotai/kimi-k2');
    expect(kimiK2?.label).toBe('Kimi K2');
    expect(kimiK2?.modelDisplayName).toBe('Kimi K2');
  });
});
