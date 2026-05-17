import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { GuildConfig } from '@/components/dashboard/config-editor-utils';

const mockUseConfigContext = vi.fn();
const baseConfig: GuildConfig = {
  ai: { enabled: true, systemPrompt: 'Be helpful', blockedChannelIds: [] },
  moderation: {
    enabled: true,
    alertChannelId: 'reports',
    autoDelete: true,
    logging: { channels: { default: 'logs' } },
    dmNotifications: { warn: true, timeout: true, kick: true, ban: true },
    escalation: { enabled: true, thresholds: [] },
  },
  permissions: {
    enabled: true,
    adminRoleIds: ['admin'],
    moderatorRoleIds: ['mod'],
    modRoles: ['mod'],
    usePermissions: true,
    allowedCommands: {},
  },
  auditLog: { enabled: true, retentionDays: 90 },
  tickets: {
    enabled: true,
    mode: 'thread',
    category: 'tickets',
    supportRole: 'support',
    supportRoles: ['support', 'senior'],
    transcriptChannel: 'transcripts',
    autoCloseHours: 48,
    maxOpenPerUser: 3,
  },
  starboard: {
    enabled: true,
    channelId: 'stars',
    threshold: 3,
    emoji: '⭐',
    selfStarAllowed: false,
    ignoredChannels: [],
  },
  memory: { enabled: true, maxContextMemories: 10, autoExtract: true },
  engagement: {
    enabled: true,
    trackMessages: true,
    trackReactions: true,
    activityBadges: [{ days: 7, label: 'Regular' }],
  },
};

const updateDraftConfig = vi.fn((updater: (config: GuildConfig) => GuildConfig) => updater(baseConfig));

vi.mock('@/components/dashboard/config-context', () => ({
  useConfigContext: () => mockUseConfigContext(),
}));

vi.mock('@/components/ui/channel-selector', () => ({
  ChannelSelector: ({ id, placeholder }: { id?: string; placeholder?: string }) => (
    <div data-testid={id ? `channel-selector-${id}` : 'channel-selector'}>{placeholder}</div>
  ),
}));

vi.mock('@/components/ui/role-selector', () => ({
  RoleSelector: ({
    id,
    selected,
    maxSelections,
    onChange,
  }: {
    id?: string;
    selected: string[];
    maxSelections?: number;
    onChange: (selected: string[]) => void;
  }) => (
    <button
      type="button"
      data-testid={id ?? 'role-selector'}
      data-selected={selected.join(',')}
      data-max-selections={maxSelections ?? 'none'}
      onClick={() => onChange(['support', 'senior', 'admin'])}
    />
  ),
}));

vi.mock('@/components/ui/discord-markdown-editor', () => ({
  DiscordMarkdownEditor: ({ label, value }: { label?: string; value?: string }) => (
    <textarea aria-label={label ?? 'discord markdown'} defaultValue={value} />
  ),
}));

vi.mock('@/components/ui/embed-builder', () => ({
  defaultEmbedConfig: () => ({
    title: '',
    description: '',
    color: '#5865f2',
    fields: [],
    format: 'embed',
    showTimestamp: false,
  }),
  EmbedBuilder: ({ value }: { value: { description?: string } }) => (
    <div data-testid="embed-builder">{value.description}</div>
  ),
}));

vi.mock('@/components/ui/command', () => ({
  Command: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CommandInput: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  CommandList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CommandEmpty: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CommandGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CommandItem: ({ children, onSelect }: { children: React.ReactNode; onSelect?: () => void }) => (
    <button type="button" onClick={onSelect}>{children}</button>
  ),
}));

vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard/settings',
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { CommunityToolsCategory } from '@/components/dashboard/config-categories/community-tools';
import { ConfigLandingContent } from '@/components/dashboard/config-categories/config-landing';
import { ModerationSafetyCategory } from '@/components/dashboard/config-categories/moderation-safety';
import { SupportIntegrationsCategory } from '@/components/dashboard/config-categories/support-integrations';
import { AuditLogSection } from '@/components/dashboard/config-sections/AuditLogSection';
import { CommunityFeaturesSection } from '@/components/dashboard/config-sections/CommunityFeaturesSection';
import { EngagementSection } from '@/components/dashboard/config-sections/EngagementSection';
import { MemorySection } from '@/components/dashboard/config-sections/MemorySection';
import { PermissionsSection } from '@/components/dashboard/config-sections/PermissionsSection';
import { StarboardSection } from '@/components/dashboard/config-sections/StarboardSection';
import { TicketsSection } from '@/components/dashboard/config-sections/TicketsSection';
import { CategoryNavigation } from '@/components/dashboard/config-workspace/category-navigation';
import { CONFIG_CATEGORIES, CONFIG_SEARCH_ITEMS, FEATURE_LABELS } from '@/components/dashboard/config-workspace/config-categories';
import { ConfigSearch } from '@/components/dashboard/config-workspace/config-search';
import { CONFIG_NAVIGATION } from '@/components/dashboard/config-workspace/navigation';
import { SettingsFeatureCard } from '@/components/dashboard/config-workspace/settings-feature-card';

const dirtyCounts = {
  'ai-automation': 2,
  'moderation-safety': 0,
  'onboarding-growth': 0,
  'community-tools': 0,
  'support-integrations': 0,
};

const featureCategoryByTabId: Record<string, string> = {
  'ai-automod': 'moderation-safety',
  moderation: 'moderation-safety',
  permissions: 'moderation-safety',
  'audit-log': 'moderation-safety',
  'community-tools': 'community-tools',
  starboard: 'community-tools',
  tickets: 'support-integrations',
};

function setConfigContext(activeTabId: string) {
  mockUseConfigContext.mockReturnValue({
    draftConfig: baseConfig,
    savedConfig: baseConfig,
    saving: false,
    guildId: 'guild-1',
    activeTabId,
    activeCategoryId: featureCategoryByTabId[activeTabId] ?? activeTabId,
    visibleFeatureIds: new Set([activeTabId]),
    dirtyCategoryCounts: dirtyCounts,
    updateDraftConfig,
    handleSearchSelect: vi.fn(),
  });
}

describe('dashboard config coverage smoke tests', () => {
  it('does not expose the removed challenges feature in config workspace metadata', () => {
    const metadata = JSON.stringify({
      categories: CONFIG_CATEGORIES,
      searchItems: CONFIG_SEARCH_ITEMS,
      featureLabels: FEATURE_LABELS,
      navigation: CONFIG_NAVIGATION.map((category) => ({
        ...category,
        icon: category.icon.displayName ?? category.icon.name,
        tabs: category.tabs.map((tab) => ({
          ...tab,
          icon: tab.icon.displayName ?? tab.icon.name,
        })),
      })),
    });

    expect(metadata).not.toMatch(/challenge/i);
  });

  it('does not expose the removed GitHub feed feature in config workspace metadata', () => {
    const metadata = JSON.stringify({
      categories: CONFIG_CATEGORIES,
      searchItems: CONFIG_SEARCH_ITEMS,
      featureLabels: FEATURE_LABELS,
      navigation: CONFIG_NAVIGATION.map((category) => ({
        ...category,
        icon: category.icon.displayName ?? category.icon.name,
        tabs: category.tabs.map((tab) => ({
          ...tab,
          icon: tab.icon.displayName ?? tab.icon.name,
        })),
      })),
    });

    expect(metadata).not.toMatch(/github-feed/i);
    expect(metadata).not.toMatch(/GitHub Feed/i);
    expect(metadata).not.toMatch(/GitHub Activity Feed/i);
  });

  it.each([
    ['ai-automod', ModerationSafetyCategory, 'Detection Model'],
    ['moderation', ModerationSafetyCategory, 'Moderation'],
    ['permissions', ModerationSafetyCategory, 'Permissions'],
    ['audit-log', ModerationSafetyCategory, 'Audit Log'],
    ['community-tools', CommunityToolsCategory, 'Community Tools'],
    ['starboard', CommunityToolsCategory, 'Starboard'],
    ['tickets', SupportIntegrationsCategory, 'Tickets'],
  ])('renders %s config category', (activeTabId, Component, expectedText) => {
    setConfigContext(activeTabId);

    render(<Component />);

    expect(document.body.textContent).toMatch(new RegExp(expectedText, 'i'));
  });

  it('keeps all selected ticket support roles in the role selector', () => {
    updateDraftConfig.mockClear();
    setConfigContext('tickets');

    const { getByTestId } = render(<SupportIntegrationsCategory />);

    const selector = getByTestId('support-role-id');
    expect(selector).toHaveAttribute('data-selected', 'support,senior');
    expect(selector).toHaveAttribute('data-max-selections', 'none');

    fireEvent.click(selector);

    const updater = updateDraftConfig.mock.calls.at(-1)?.[0];
    expect(updater?.(baseConfig).tickets).toMatchObject({
      supportRole: 'support',
      supportRoles: ['support', 'senior', 'admin'],
    });
  });

  it('renders the config landing and workspace navigation primitives', () => {
    setConfigContext('moderation');

    render(
      <>
        <ConfigLandingContent />
        <CategoryNavigation dirtyCounts={dirtyCounts} />
        <ConfigSearch
          value="ai"
          onChange={vi.fn()}
          results={[{ id: 'ai-chat-enabled', label: 'Enable AI Chat', categoryId: 'ai-automation', featureId: 'ai-chat', description: 'Toggle AI chat', keywords: ['ai'], isAdvanced: false }]}
          onSelect={vi.fn()}
        />
        <SettingsFeatureCard
          featureId="ai-chat"
          title="AI Chat"
          description="Toggle AI replies"
          basicContent={<span>AI Chat settings</span>}
          enabled
        />
      </>,
    );

    expect(document.body.textContent).toMatch(/Select a category/i);
    expect(document.body.textContent).toMatch(/AI Chat/i);
  });

  it('renders reusable config sections with enabled drafts', () => {
    render(
      <>
        <AuditLogSection
          draftConfig={baseConfig}
          saving={false}
          onEnabledChange={vi.fn()}
          onRetentionDaysChange={vi.fn()}
        />
        <CommunityFeaturesSection
          draftConfig={baseConfig}
          saving={false}
          onToggleChange={vi.fn()}
        />
        <EngagementSection
          draftConfig={baseConfig}
          saving={false}
          onActivityBadgesChange={vi.fn()}
        />
        <MemorySection
          draftConfig={baseConfig}
          saving={false}
          onEnabledChange={vi.fn()}
          onFieldChange={vi.fn()}
        />
        <PermissionsSection
          draftConfig={baseConfig}
          guildId="guild-1"
          saving={false}
          onFieldChange={vi.fn()}
        />
        <StarboardSection draftConfig={baseConfig} saving={false} onFieldChange={vi.fn()} />
        <TicketsSection
          draftConfig={baseConfig}
          saving={false}
          onEnabledChange={vi.fn()}
          onFieldChange={vi.fn()}
        />
      </>,
    );

    expect(document.body.textContent).toMatch(/Enable/i);
    expect(document.body.textContent).toMatch(/Ticket/i);
  });
});
