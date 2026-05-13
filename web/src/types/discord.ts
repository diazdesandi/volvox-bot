export interface DiscordGuild {
  id: string;
  name: string;
  icon: string | null;
  iconHash?: string | null;
  owner: boolean;
  permissions: string;
  features: string[];
  approximate_member_count?: number | null;
  approximate_presence_count?: number | null;
}

export interface GuildCommunityConfig {
  communityHubs?: {
    enabled?: boolean;
  };
}

export interface BotGuild {
  id: string;
  name: string;
  icon: string | null;
  iconHash?: string | null;
  memberCount?: number | null;
  config?: GuildCommunityConfig;
}

export interface MutualGuild extends DiscordGuild {
  botPresent: boolean;
  botPresenceAuthoritative?: boolean;
  memberCount?: number | null;
  access?: 'owner' | 'admin' | 'moderator' | 'viewer';
  config?: GuildCommunityConfig;
}

export interface DiscordChannel {
  id: string;
  name: string;
  type: number;
  parentId?: string | null;
  position?: number;
}

export interface DiscordRole {
  id: string;
  name: string;
  color: number;
}
