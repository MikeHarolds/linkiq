import { parseUserAgent } from './user-agent-parser';

const CHROME_DESKTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const SAFARI_MOBILE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const IPAD_SAFARI =
  'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const GOOGLEBOT =
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const BINGBOT =
  'Mozilla/5.0 (compatible; Bingbot/2.0; +http://www.bing.com/bingbot.htm)';

describe('parseUserAgent', () => {
  it('parses a desktop Chrome UA correctly', () => {
    const result = parseUserAgent(CHROME_DESKTOP);
    expect(result.isBot).toBe(false);
    expect(result.deviceType).toBe('desktop');
    expect(result.browser).toBe('Chrome');
    expect(result.os).toBe('Windows');
  });

  it('parses a mobile Safari (iPhone) UA correctly', () => {
    const result = parseUserAgent(SAFARI_MOBILE);
    expect(result.isBot).toBe(false);
    expect(result.deviceType).toBe('mobile');
    expect(result.os).toBe('iOS');
  });

  it('parses an Android Chrome UA correctly', () => {
    const result = parseUserAgent(ANDROID_CHROME);
    expect(result.isBot).toBe(false);
    expect(result.deviceType).toBe('mobile');
    expect(result.os).toBe('Android');
  });

  it('parses an iPad UA as tablet', () => {
    const result = parseUserAgent(IPAD_SAFARI);
    expect(result.deviceType).toBe('tablet');
  });

  it('detects Googlebot as a bot', () => {
    const result = parseUserAgent(GOOGLEBOT);
    expect(result.isBot).toBe(true);
    expect(result.deviceType).toBe('bot');
  });

  it('detects Bingbot as a bot', () => {
    expect(parseUserAgent(BINGBOT).isBot).toBe(true);
  });

  it('treats a missing user agent as a bot (real browsers always send one)', () => {
    expect(parseUserAgent(undefined).isBot).toBe(true);
    expect(parseUserAgent(null).isBot).toBe(true);
    expect(parseUserAgent('').isBot).toBe(true);
  });

  it('does not classify a normal browser as a bot', () => {
    expect(parseUserAgent(CHROME_DESKTOP).isBot).toBe(false);
    expect(parseUserAgent(SAFARI_MOBILE).isBot).toBe(false);
  });
});
