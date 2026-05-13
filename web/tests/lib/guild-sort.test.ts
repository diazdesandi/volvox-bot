import { describe, expect, it } from 'vitest';
import { sortGuildsByName } from '@/lib/guild-sort';
import type { MutualGuild } from '@/types/discord';

function makeGuild(id: string, name: string): MutualGuild {
  return {
    botPresent: true,
    features: [],
    icon: null,
    iconHash: null,
    id,
    memberCount: null,
    name,
    owner: false,
    permissions: '0',
  };
}

describe('sortGuildsByName', () => {
  it('sorts by name with numeric collation and uses id as a deterministic tiebreaker', () => {
    const guilds = [
      makeGuild('b', 'Beta'),
      makeGuild('2', 'alpha 10'),
      makeGuild('a', 'alpha 2'),
      makeGuild('1', 'Alpha 2'),
    ];

    expect(sortGuildsByName(guilds).map((guild) => guild.id)).toEqual(['1', 'a', '2', 'b']);
    expect(guilds.map((guild) => guild.id)).toEqual(['b', '2', 'a', '1']);
  });
});
