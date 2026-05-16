import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('removed role menu command', () => {
  it('does not ship the /rolemenu command module', () => {
    expect(existsSync(resolve(process.cwd(), 'src/commands/rolemenu.js'))).toBe(false);
  });
});
