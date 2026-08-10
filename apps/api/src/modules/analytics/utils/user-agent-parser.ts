import { isbot } from 'isbot';
import { UAParser } from 'ua-parser-js';

export interface ParsedUserAgent {
  isBot: boolean;
  deviceType: 'desktop' | 'mobile' | 'tablet' | 'bot' | 'unknown';
  os: string | null;
  browser: string | null;
}

/**
 * Wraps ua-parser-js (device/OS/browser) + isbot (crawler detection) into
 * one call. A missing/empty User-Agent is itself treated as bot-like — a
 * real browser always sends one, so its absence is a "suspicious request
 * characteristic" in its own right, not just an unknown case.
 */
export function parseUserAgent(
  userAgent: string | undefined | null,
): ParsedUserAgent {
  if (!userAgent || userAgent.trim() === '') {
    return { isBot: true, deviceType: 'bot', os: null, browser: null };
  }

  const detectedBot = isbot(userAgent);

  const parser = new UAParser(userAgent);
  const result = parser.getResult();

  const deviceType: ParsedUserAgent['deviceType'] = detectedBot
    ? 'bot'
    : result.device.type === 'mobile'
      ? 'mobile'
      : result.device.type === 'tablet'
        ? 'tablet'
        : result.device.type === undefined
          ? 'desktop' // ua-parser-js leaves type undefined for regular desktop browsers
          : 'unknown';

  return {
    isBot: detectedBot,
    deviceType,
    os: result.os.name ?? null,
    browser: result.browser.name ?? null,
  };
}
