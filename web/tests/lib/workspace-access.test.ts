import { describe, expect, it } from 'vitest';
import {
  getWelcomeWorkspaceGroups,
  getWorkspaceSelectorGroups,
  hasAuthoritativeBotPresence,
  hasBotPresenceAccess,
  hasInstalledAccessibleWorkspace,
  isDashboardWelcomeRoute,
  isInstalledManageableWorkspace,
  isSelectableManageableWorkspace,
  normalizeGuildMemberCount,
  normalizeMemberCount,
  shouldOpenDashboardWelcome,
} from '@/lib/workspace-access';
import type { MutualGuild } from '@/types/discord';

function makeGuild(overrides: Partial<MutualGuild> & Pick<MutualGuild, 'id'>): MutualGuild {
  return {
    access: 'viewer',
    botPresent: false,
    features: [],
    icon: null,
    iconHash: null,
    memberCount: null,
    name: overrides.id,
    owner: false,
    permissions: '0',
    ...overrides,
  };
}

describe('workspace-access', () => {
  it('matches dashboard welcome routes including nested setup paths', () => {
    expect(isDashboardWelcomeRoute('/dashboard/welcome')).toBe(true);
    expect(isDashboardWelcomeRoute('/dashboard/welcome/server')).toBe(true);
    expect(isDashboardWelcomeRoute('/dashboard')).toBe(false);
    expect(isDashboardWelcomeRoute('/dashboard/welcome-back')).toBe(false);
  });

  it('opens welcome only when authoritative guild data has no installed accessible workspace', () => {
    const missingBotAdmin = makeGuild({ access: 'admin', id: 'missing-bot', permissions: '8' });

    expect(
      shouldOpenDashboardWelcome({
        error: false,
        guilds: [missingBotAdmin],
        loading: false,
        pathname: '/dashboard',
      }),
    ).toBe(true);

    expect(
      shouldOpenDashboardWelcome({
        error: false,
        guilds: [missingBotAdmin],
        loading: false,
        pathname: '/dashboard/welcome',
      }),
    ).toBe(false);

    expect(
      shouldOpenDashboardWelcome({
        error: false,
        guilds: [makeGuild({ access: 'admin', botPresenceAuthoritative: false, id: 'degraded' })],
        loading: false,
        pathname: '/dashboard',
      }),
    ).toBe(false);

    expect(
      shouldOpenDashboardWelcome({
        error: false,
        guilds: [
          makeGuild({
            access: 'viewer',
            botPresent: true,
            config: { communityHubs: { enabled: true } },
            id: 'hub',
          }),
        ],
        loading: false,
        pathname: '/dashboard',
      }),
    ).toBe(false);
  });

  it('keeps installed/manageable detection authoritative while selector access can degrade open', () => {
    const installedAdmin = makeGuild({ access: 'admin', botPresent: true, id: 'installed' });
    const missingAdmin = makeGuild({ access: 'admin', botPresent: false, id: 'missing' });
    const degradedAdmin = makeGuild({
      access: 'admin',
      botPresenceAuthoritative: false,
      id: 'degraded',
    });

    expect(isInstalledManageableWorkspace(installedAdmin)).toBe(true);
    expect(isInstalledManageableWorkspace(missingAdmin)).toBe(false);
    expect(isInstalledManageableWorkspace(degradedAdmin)).toBe(false);
    expect(isSelectableManageableWorkspace(degradedAdmin)).toBe(true);
    expect(hasBotPresenceAccess(degradedAdmin)).toBe(true);
    expect(hasInstalledAccessibleWorkspace([missingAdmin, degradedAdmin])).toBe(false);
    expect(hasInstalledAccessibleWorkspace([installedAdmin])).toBe(true);
  });

  it('detects installed accessible workspaces through community hub access', () => {
    const viewerHub = makeGuild({
      access: 'viewer',
      botPresent: true,
      config: { communityHubs: { enabled: true } },
      id: 'viewer-hub',
    });
    const viewerNoHub = makeGuild({ access: 'viewer', botPresent: true, id: 'viewer-no-hub' });

    expect(hasInstalledAccessibleWorkspace([viewerHub])).toBe(true);
    expect(hasInstalledAccessibleWorkspace([viewerNoHub])).toBe(false);
  });

  it('groups selector workspaces by bot access, manageability, and community hub access', () => {
    const groups = getWorkspaceSelectorGroups([
      makeGuild({ access: 'admin', botPresent: true, id: 'installed-admin' }),
      makeGuild({ access: 'moderator', botPresenceAuthoritative: false, id: 'degraded-mod' }),
      makeGuild({ access: 'admin', botPresent: false, id: 'missing-admin' }),
      makeGuild({
        access: 'viewer',
        botPresent: true,
        config: { communityHubs: { enabled: true } },
        id: 'viewer-hub',
      }),
      makeGuild({ access: 'viewer', botPresent: true, id: 'viewer-no-hub' }),
    ]);

    expect(groups.installedGuilds.map((guild) => guild.id)).toEqual([
      'installed-admin',
      'degraded-mod',
      'viewer-hub',
      'viewer-no-hub',
    ]);
    expect(groups.manageableGuilds.map((guild) => guild.id)).toEqual([
      'installed-admin',
      'degraded-mod',
    ]);
    expect(groups.memberOnlyGuilds.map((guild) => guild.id)).toEqual(['viewer-hub']);
  });

  it('groups welcome workspaces by permission while bot presence decides direct management eligibility', () => {
    const installedAdmin = makeGuild({ access: 'admin', botPresent: true, id: 'installed' });
    const missingAdmin = makeGuild({ access: 'admin', id: 'missing' });
    const degradedMod = makeGuild({
      access: 'moderator',
      botPresenceAuthoritative: false,
      id: 'degraded',
    });
    const viewer = makeGuild({ access: 'viewer', botPresent: true, id: 'viewer' });

    const groups = getWelcomeWorkspaceGroups([installedAdmin, missingAdmin, degradedMod, viewer]);

    expect(groups.manageableGuilds.map((guild) => guild.id)).toEqual([
      'installed',
      'missing',
      'degraded',
    ]);
    expect(groups.viewerOnlyGuilds.map((guild) => guild.id)).toEqual(['viewer']);
    expect(isSelectableManageableWorkspace(missingAdmin)).toBe(false);
    expect(isSelectableManageableWorkspace(degradedMod)).toBe(true);
  });

  it('reports whether bot presence is authoritative for the whole directory', () => {
    expect(hasAuthoritativeBotPresence([makeGuild({ id: 'a' })])).toBe(true);
    expect(
      hasAuthoritativeBotPresence([
        makeGuild({ id: 'a' }),
        makeGuild({ botPresenceAuthoritative: false, id: 'b' }),
      ]),
    ).toBe(false);
  });

  it('normalizes member counts to safe non-negative integers with API fallback', () => {
    expect(normalizeMemberCount(undefined)).toBeNull();
    expect(normalizeMemberCount(null)).toBeNull();
    expect(normalizeMemberCount(Number.NaN)).toBeNull();
    expect(normalizeMemberCount(Infinity)).toBeNull();
    expect(normalizeMemberCount(-1)).toBeNull();
    expect(normalizeMemberCount(1.5)).toBeNull();
    expect(normalizeMemberCount('12')).toBeNull();
    expect(normalizeMemberCount(0)).toBe(0);
    expect(normalizeMemberCount(42)).toBe(42);
    expect(normalizeGuildMemberCount({ approximate_member_count: 7 })).toBe(7);
    expect(normalizeGuildMemberCount({ memberCount: -1, approximate_member_count: 9 })).toBe(9);
    expect(normalizeGuildMemberCount({ memberCount: 5, approximate_member_count: 9 })).toBe(5);
  });
});
