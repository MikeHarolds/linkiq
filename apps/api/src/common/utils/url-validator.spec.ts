import { validateDestinationUrl } from './url-validator';

describe('validateDestinationUrl', () => {
  it('accepts a valid http URL', () => {
    const result = validateDestinationUrl('http://example.com/page');
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe('http://example.com/page');
  });

  it('accepts a valid https URL', () => {
    const result = validateDestinationUrl('https://example.com/page?query=1');
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe('https://example.com/page?query=1');
  });

  it('rejects an empty string', () => {
    expect(validateDestinationUrl('').valid).toBe(false);
    expect(validateDestinationUrl('   ').valid).toBe(false);
  });

  it('rejects a malformed URL', () => {
    const result = validateDestinationUrl('not a url at all');
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/malformed/i);
  });

  it('rejects a URL with no host', () => {
    // "http://" alone throws in the URL constructor, covered by malformed;
    // this checks the case where parsing succeeds but hostname is empty.
    const result = validateDestinationUrl('file:///etc/passwd');
    expect(result.valid).toBe(false);
  });

  it('rejects unsupported protocols', () => {
    expect(validateDestinationUrl('ftp://example.com/file').valid).toBe(false);
    expect(validateDestinationUrl('ws://example.com').valid).toBe(false);
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'blob:https://example.com/uuid',
    'about:blank',
  ])('rejects the dangerous scheme in "%s"', (dangerousUrl) => {
    const result = validateDestinationUrl(dangerousUrl);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/not allowed/i);
  });

  it('rejects URLs exceeding the max length', () => {
    const longUrl = `https://example.com/${'a'.repeat(2100)}`;
    const result = validateDestinationUrl(longUrl);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/exceeds/i);
  });

  it('trims surrounding whitespace before validating', () => {
    const result = validateDestinationUrl('  https://example.com  ');
    expect(result.valid).toBe(true);
  });

  it('does not alter the query string or path during normalization', () => {
    const result = validateDestinationUrl(
      'https://example.com/Path/With/Case?Query=Value&Other=1',
    );
    expect(result.valid).toBe(true);
    expect(result.normalized).toContain('/Path/With/Case');
    expect(result.normalized).toContain('Query=Value');
  });
});
