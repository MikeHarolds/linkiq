/** Interpolates `{{var}}` placeholders, HTML-escaping every substituted
 * value — templates are plain strings with placeholders, never a
 * templating engine dependency, and this is the one place user-supplied
 * values (firstName, etc.) enter an HTML document, so escaping here is
 * the single enforcement point for the whole email layer. */
export function interpolate(
  template: string,
  vars: Record<string, string | number>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = vars[key];
    return value === undefined ? '' : escapeHtml(String(value));
  });
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
