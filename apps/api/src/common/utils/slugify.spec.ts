import { slugify, uniqueSlug } from './slugify';

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Marketing Team')).toBe('marketing-team');
  });

  it('strips non-alphanumeric characters', () => {
    expect(slugify("Jane's Organization!")).toBe('jane-s-organization');
  });

  it('trims leading/trailing hyphens', () => {
    expect(slugify('  --Hello World--  ')).toBe('hello-world');
  });

  it('falls back gracefully on empty input', () => {
    expect(slugify('')).toBe('');
  });
});

describe('uniqueSlug', () => {
  it('appends a random suffix to the slugified base', () => {
    const result = uniqueSlug('Marketing Team');
    expect(result).toMatch(/^marketing-team-[0-9a-f]{6}$/);
  });

  it('produces different slugs on repeated calls', () => {
    const a = uniqueSlug('Same Name');
    const b = uniqueSlug('Same Name');
    expect(a).not.toBe(b);
  });

  it('falls back to "workspace" when the base has no valid characters', () => {
    expect(uniqueSlug('!!!')).toMatch(/^workspace-[0-9a-f]{6}$/);
  });
});
