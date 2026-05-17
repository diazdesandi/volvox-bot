import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('removed memory opt-out management', () => {
  it('does not ship the opt-out runtime module', () => {
    expect(existsSync(resolve(process.cwd(), 'src/modules/optout.js'))).toBe(false);
  });

  it('does not import the opt-out module from the memory command', () => {
    const memoryCommandSource = readFileSync(
      resolve(process.cwd(), 'src/commands/memory.js'),
      'utf8',
    );

    expect(memoryCommandSource).not.toMatch(
      /import\s+(?:[\s\S]*?\s+from\s+)?['"]\.\.\/modules\/optout(?:\.js)?['"]/,
    );
  });

  it('does not register a /memory optout subcommand', () => {
    const memoryCommandSource = readFileSync(
      resolve(process.cwd(), 'src/commands/memory.js'),
      'utf8',
    );

    expect(memoryCommandSource).not.toMatch(
      /\.addSubcommand\(\s*\(?\s*sub\s*\)?\s*=>\s*sub[\s\S]*?\.setName\(['"]optout['"]\)/,
    );
  });
});
