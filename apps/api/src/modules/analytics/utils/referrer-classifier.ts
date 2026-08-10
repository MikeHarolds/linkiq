export type ReferrerCategory =
  'direct' | 'search' | 'social' | 'referral' | 'other';

export interface ClassifiedReferrer {
  category: ReferrerCategory;
  domain: string | null;
  url: string | null;
}

const SEARCH_DOMAINS = new Set([
  'google.com',
  'bing.com',
  'yahoo.com',
  'duckduckgo.com',
  'baidu.com',
  'yandex.com',
  'ecosia.org',
]);

const SOCIAL_DOMAINS = new Set([
  'facebook.com',
  'x.com',
  'twitter.com',
  'instagram.com',
  'linkedin.com',
  'tiktok.com',
  'reddit.com',
  'pinterest.com',
  't.co',
  'threads.net',
]);

/** Strips a leading "www." and lowercases, for consistent domain matching. */
function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '');
}

/**
 * Classifies a referrer into a coarse category. An empty/missing referrer
 * is "direct" (the visitor typed the URL, used a bookmark, or came from a
 * source that strips the Referer header, e.g. some native apps) — we do
 * NOT guess at a more specific category for those, since that would be
 * incorrect the majority of the time. A referrer that fails to parse as a
 * URL is "other", not silently dropped or misclassified as direct.
 */
export function classifyReferrer(
  rawReferrer: string | undefined | null,
): ClassifiedReferrer {
  if (!rawReferrer || rawReferrer.trim() === '') {
    return { category: 'direct', domain: null, url: null };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawReferrer);
  } catch {
    return { category: 'other', domain: null, url: rawReferrer.slice(0, 2048) };
  }

  const domain = normalizeHostname(parsed.hostname);

  if (SEARCH_DOMAINS.has(domain)) {
    return { category: 'search', domain, url: parsed.toString() };
  }
  if (SOCIAL_DOMAINS.has(domain)) {
    return { category: 'social', domain, url: parsed.toString() };
  }
  return { category: 'referral', domain, url: parsed.toString() };
}

/** Recognized marketing query params — the only ones ever persisted (see
 * ClickEvent.queryParams). Arbitrary query strings are never captured
 * wholesale, since they can carry PII (emails, session tokens, ...). */
const CAPTURED_QUERY_PARAMS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
] as const;

export function extractMarketingParams(
  queryString: string | undefined,
): Record<string, string> | null {
  if (!queryString) return null;

  const params = new URLSearchParams(queryString);
  const result: Record<string, string> = {};

  for (const key of CAPTURED_QUERY_PARAMS) {
    const value = params.get(key);
    if (value) {
      result[key] = value.slice(0, 255);
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}
