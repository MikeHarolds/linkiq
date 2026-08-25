import { escapeHtml, interpolate } from './template-renderer.service';

describe('escapeHtml', () => {
  it('escapes HTML-significant characters', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
  });

  it('escapes quotes and ampersands', () => {
    expect(escapeHtml(`Tom & "Jerry"`)).toBe('Tom &amp; &quot;Jerry&quot;');
  });

  it('leaves plain text untouched', () => {
    expect(escapeHtml('Jane Doe')).toBe('Jane Doe');
  });
});

describe('interpolate', () => {
  it('substitutes known variables', () => {
    expect(interpolate('Hello {{name}}!', { name: 'Jane' })).toBe('Hello Jane!');
  });

  it('HTML-escapes substituted values to prevent injection via user input', () => {
    expect(interpolate('Hi {{name}}', { name: '<img src=x onerror=alert(1)>' })).toBe(
      'Hi &lt;img src=x onerror=alert(1)&gt;',
    );
  });

  it('replaces an unknown placeholder with an empty string', () => {
    expect(interpolate('{{missing}}', {})).toBe('');
  });

  it('substitutes numeric values', () => {
    expect(interpolate('{{count}} clicks', { count: 42 })).toBe('42 clicks');
  });
});
