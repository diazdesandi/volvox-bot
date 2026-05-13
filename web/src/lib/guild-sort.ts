import type { MutualGuild } from '@/types/discord';

const guildNameCollator = new Intl.Collator('en-US', {
  numeric: true,
  sensitivity: 'base',
});

export function compareGuildsByName(firstGuild: MutualGuild, secondGuild: MutualGuild): number {
  const nameComparison = guildNameCollator.compare(firstGuild.name, secondGuild.name);

  if (nameComparison !== 0) {
    return nameComparison;
  }

  return firstGuild.id.localeCompare(secondGuild.id, 'en-US');
}

export function sortGuildsByName(guilds: readonly MutualGuild[]): MutualGuild[] {
  return [...guilds].sort(compareGuildsByName);
}
