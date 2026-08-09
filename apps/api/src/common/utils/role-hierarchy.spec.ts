import { hasSufficientRole } from './role-hierarchy';

describe('hasSufficientRole', () => {
  it('allows an exact role match', () => {
    expect(hasSufficientRole('ADMIN', ['ADMIN'])).toBe(true);
  });

  it('allows a higher role to satisfy a lower requirement', () => {
    expect(hasSufficientRole('OWNER', ['ADMIN'])).toBe(true);
    expect(hasSufficientRole('OWNER', ['MEMBER'])).toBe(true);
    expect(hasSufficientRole('ADMIN', ['MEMBER'])).toBe(true);
    expect(hasSufficientRole('ADMIN', ['VIEWER'])).toBe(true);
  });

  it('rejects a lower role against a higher requirement', () => {
    expect(hasSufficientRole('MEMBER', ['ADMIN'])).toBe(false);
    expect(hasSufficientRole('VIEWER', ['MEMBER'])).toBe(false);
    expect(hasSufficientRole('VIEWER', ['OWNER'])).toBe(false);
  });

  it('respects the full hierarchy: OWNER > ADMIN > MEMBER > VIEWER', () => {
    expect(hasSufficientRole('OWNER', ['OWNER'])).toBe(true);
    expect(hasSufficientRole('ADMIN', ['OWNER'])).toBe(false);
  });

  it('picks the least-strict requirement when multiple roles are allowed', () => {
    expect(hasSufficientRole('MEMBER', ['ADMIN', 'MEMBER'])).toBe(true);
  });

  it('allows any role when no roles are required', () => {
    expect(hasSufficientRole('VIEWER', [])).toBe(true);
  });
});
