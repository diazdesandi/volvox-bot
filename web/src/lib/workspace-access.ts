import { isGuildManageable } from '@/hooks/use-guild-role';
import { WELCOME_ROUTE } from '@/lib/routes';
import type { MutualGuild } from '@/types/discord';

export const DASHBOARD_WELCOME_ROUTE = WELCOME_ROUTE;

export interface DashboardWelcomeRedirectState {
  readonly error: boolean;
  readonly guilds: readonly MutualGuild[];
  readonly loading: boolean;
  readonly pathname: string;
}

export interface WorkspaceSelectorGroups {
  readonly installedGuilds: MutualGuild[];
  readonly manageableGuilds: MutualGuild[];
  readonly memberOnlyGuilds: MutualGuild[];
}

export interface WelcomeWorkspaceGroups {
  readonly manageableGuilds: MutualGuild[];
  readonly viewerOnlyGuilds: MutualGuild[];
}

export function isDashboardWelcomeRoute(pathname: string): boolean {
  return pathname === WELCOME_ROUTE || pathname.startsWith(`${WELCOME_ROUTE}/`);
}

export function hasAuthoritativeBotPresence(guilds: readonly MutualGuild[]): boolean {
  return guilds.every((guild) => guild.botPresenceAuthoritative !== false);
}

export function hasBotPresenceAccess(guild: MutualGuild): boolean {
  return guild.botPresent || guild.botPresenceAuthoritative === false;
}

export function hasCommunityHubAccess(guild: MutualGuild): boolean {
  return guild.config?.communityHubs?.enabled === true;
}

export function isInstalledManageableWorkspace(guild: MutualGuild): boolean {
  return guild.botPresent && isGuildManageable(guild);
}

export function isSelectableManageableWorkspace(guild: MutualGuild): boolean {
  return hasBotPresenceAccess(guild) && isGuildManageable(guild);
}

export function isInstalledAccessibleWorkspace(guild: MutualGuild): boolean {
  return guild.botPresent && (isGuildManageable(guild) || hasCommunityHubAccess(guild));
}

export function hasInstalledManageableWorkspace(guilds: readonly MutualGuild[]): boolean {
  return guilds.some(isInstalledAccessibleWorkspace);
}

export function shouldOpenDashboardWelcome({
  error,
  guilds,
  loading,
  pathname,
}: DashboardWelcomeRedirectState): boolean {
  return (
    !isDashboardWelcomeRoute(pathname) &&
    !loading &&
    !error &&
    hasAuthoritativeBotPresence(guilds) &&
    !hasInstalledManageableWorkspace(guilds)
  );
}

export function getWorkspaceSelectorGroups(
  guilds: readonly MutualGuild[],
): WorkspaceSelectorGroups {
  const installedGuilds = guilds.filter(hasBotPresenceAccess);

  return {
    installedGuilds,
    manageableGuilds: installedGuilds.filter(isGuildManageable),
    memberOnlyGuilds: installedGuilds.filter(
      (guild) => !isGuildManageable(guild) && hasCommunityHubAccess(guild),
    ),
  };
}

export function getWelcomeWorkspaceGroups(guilds: readonly MutualGuild[]): WelcomeWorkspaceGroups {
  return {
    manageableGuilds: guilds.filter(isGuildManageable),
    viewerOnlyGuilds: guilds.filter((guild) => !isGuildManageable(guild)),
  };
}

export function normalizeMemberCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function normalizeGuildMemberCount(value: Record<string, unknown>): number | null {
  return (
    normalizeMemberCount(value.memberCount) ?? normalizeMemberCount(value.approximate_member_count)
  );
}
