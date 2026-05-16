import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const docsRoot = join(__dirname, '..', '..', 'docs');

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function readText(filePath) {
  return existsSync(filePath) ? readFileSync(filePath, 'utf-8') : '';
}
function getAllPages(tabs) {
  const pages = [];
  for (const tab of tabs) {
    if (Array.isArray(tab.pages)) {
      pages.push(...tab.pages);
    }
    if (Array.isArray(tab.groups)) {
      for (const group of tab.groups) {
        if (Array.isArray(group.pages)) {
          pages.push(...group.pages);
        }
      }
    }
  }
  return pages;
}

function expectContainsAll(content, expectedSnippets) {
  for (const snippet of expectedSnippets) {
    expect(content).toContain(snippet);
  }
}

function getFrontmatter(content) {
  const openingFence = content.indexOf('---');
  expect(openingFence).toBe(0);

  const closingFence = content.indexOf('\n---', openingFence + 3);
  expect(closingFence).toBeGreaterThan(3);

  return content.slice(openingFence + 4, closingFence).split('\n');
}

function getChangelogUpdateLabels(content) {
  return [...content.matchAll(/<Update label="(\d{4}-\d{2}-\d{2})"/g)].map((match) => match[1]);
}

function getSupportHelpGroup(config) {
  const supportTab = config.navigation.tabs.find((tab) => tab.tab === 'Support');
  expect(supportTab).toBeDefined();

  const helpGroup = supportTab?.groups?.find((group) => group.group === 'Help');
  expect(helpGroup).toBeDefined();
  return helpGroup;
}

// ---------------------------------------------------------------------------
// docs/changelog.mdx
// ---------------------------------------------------------------------------

describe('docs/changelog.mdx', () => {
  const mdxPath = join(docsRoot, 'changelog.mdx');
  let content;

  beforeAll(() => {
    content = readText(mdxPath);
  });

  it('file exists', () => {
    expect(existsSync(mdxPath)).toBe(true);
  });

  it('keeps update labels unique', () => {
    const updateLabels = getChangelogUpdateLabels(content);

    expect(updateLabels.length).toBeGreaterThan(0);
    expect(new Set(updateLabels).size).toBe(updateLabels.length);
  });

  it('keeps update labels in descending order', () => {
    const updateLabels = getChangelogUpdateLabels(content);
    const sortedLabels = [...updateLabels].sort((previousLabel, nextLabel) =>
      nextLabel.localeCompare(previousLabel),
    );

    expect(updateLabels).toEqual(sortedLabels);
  });
});

// ---------------------------------------------------------------------------
// docs/docs.json
// ---------------------------------------------------------------------------

describe('docs/docs.json', () => {
  const docsJsonPath = join(docsRoot, 'docs.json');
  let rawConfig;

  beforeAll(() => {
    rawConfig = readText(docsJsonPath);
  });

  function getConfig() {
    return JSON.parse(rawConfig);
  }

  it('file exists', () => {
    expect(existsSync(docsJsonPath)).toBe(true);
  });

  it('is valid JSON', () => {
    expect(rawConfig.length).toBeGreaterThan(0);
    const config = JSON.parse(rawConfig);
    expect(typeof config).toBe('object');
    expect(config).not.toBeNull();
  });

  it('has $schema field pointing to mintlify', () => {
    const config = getConfig();

    expect(config).toHaveProperty('$schema');
    expect(config.$schema).toContain('mintlify');
  });

  it('defaults the docs appearance to dark mode', () => {
    const config = getConfig();

    expect(config).toHaveProperty('appearance');
    expect(config.appearance).toHaveProperty('default', 'dark');
  });

  it('has navigation.tabs array', () => {
    const config = getConfig();

    expect(config).toHaveProperty('navigation');
    expect(config.navigation).toHaveProperty('tabs');
    expect(Array.isArray(config.navigation.tabs)).toBe(true);
    expect(config.navigation.tabs.length).toBeGreaterThan(0);
  });

  it('includes "manual-test-plan" in the Support tab Help group pages', () => {
    const config = getConfig();
    const helpGroup = getSupportHelpGroup(config);

    expect(helpGroup.pages).toContain('manual-test-plan');
  });

  it('"manual-test-plan" is listed after "help" in the Support tab Help group pages', () => {
    const config = getConfig();
    const helpGroup = getSupportHelpGroup(config);

    const helpIdx = helpGroup.pages.indexOf('help');
    const planIdx = helpGroup.pages.indexOf('manual-test-plan');
    expect(helpIdx).toBeGreaterThanOrEqual(0);
    expect(planIdx).toBeGreaterThan(helpIdx);
  });

  it('the Support tab Help group retains the expected support pages', () => {
    const config = getConfig();
    const helpGroup = getSupportHelpGroup(config);

    expectContainsAll(helpGroup.pages, ['faq', 'security', 'help', 'manual-test-plan']);
  });

  it('does not duplicate "manual-test-plan" across all pages', () => {
    const config = getConfig();
    const allPages = getAllPages(config.navigation.tabs);
    const occurrences = allPages.filter((page) => page === 'manual-test-plan').length;
    expect(occurrences).toBe(1);
  });

  it('retains existing core page entries', () => {
    const config = getConfig();
    const allPages = getAllPages(config.navigation.tabs);
    expectContainsAll(allPages, ['introduction', 'faq', 'security', 'help', 'changelog']);
  });
});

// ---------------------------------------------------------------------------
// docs/manual-test-plan.mdx
// ---------------------------------------------------------------------------

describe('docs/manual-test-plan.mdx', () => {
  const mdxPath = join(docsRoot, 'manual-test-plan.mdx');
  let content;

  beforeAll(() => {
    content = existsSync(mdxPath) ? readText(mdxPath) : '';
  });

  it('file exists', () => {
    expect(existsSync(mdxPath)).toBe(true);
  });

  it('has a YAML frontmatter block', () => {
    expect(getFrontmatter(content).length).toBeGreaterThan(0);
  });

  it('frontmatter contains unquoted SEO title "Volvox.Bot Manual QA and Release Test Plan"', () => {
    expect(getFrontmatter(content)).toContain('title: Volvox.Bot Manual QA and Release Test Plan');
  });

  it('frontmatter contains a non-empty single-quoted description', () => {
    const descriptionLine = getFrontmatter(content).find((line) =>
      line.startsWith('description: '),
    );
    expect(descriptionLine).toBeDefined();
    const singleQuote = "'";
    const descriptionPrefix = `description: ${singleQuote}`;
    expect(descriptionLine.startsWith(descriptionPrefix)).toBe(true);
    expect(descriptionLine.endsWith(singleQuote)).toBe(true);
    expect(descriptionLine.slice(descriptionPrefix.length, -1).trim().length).toBeGreaterThan(0);
  });

  it('has a top-level # Manual test plan heading', () => {
    expect(content.split('\n')).toContain('# Manual test plan');
  });

  it('contains link to the rendered GitHub wiki page', () => {
    expect(content).toContain('https://github.com/VolvoxLLC/volvox-bot/wiki/Manual-Test-Plan');
  });

  it('has a "What it covers" section', () => {
    expect(content).toContain('## What it covers');
  });

  const coverageBullets = [
    'Environment matrix and persona setup',
    'Preconditions and release-blocking criteria',
    'End-to-end suites',
    'Negative/abuse testing',
    'Accessibility and performance spot checks',
    'Evidence collection and sign-off ownership',
  ];

  for (const bullet of coverageBullets) {
    it(`"What it covers" lists ${bullet}`, () => {
      expect(content).toContain(bullet);
    });
  }

  it('has a "Publish to GitHub wiki" section', () => {
    expect(content).toContain('## Publish to GitHub wiki');
  });

  it('instructs to include Manual-Test-Plan.md when publishing', () => {
    expect(content).toContain('Manual-Test-Plan.md');
  });

  it('file is non-empty and has meaningful length', () => {
    expect(content.length).toBeGreaterThan(200);
  });
});
