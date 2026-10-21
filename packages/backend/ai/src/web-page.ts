import { Agent, fetch } from 'undici';

import { assertPublicWebCrawlUrl, createPinnedWebCrawlLookup } from './tools';

const MAX_REDIRECTS = 5;
const MAX_PAGE_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15000;
const USER_AGENT = 'Mozilla/5.0 (compatible; NotaWebClipper/1.0)';

function parseCharset(contentType: string) {
  const charset = /charset=([^;]+)/i.exec(contentType)?.[1]?.trim();
  try {
    return new TextDecoder(charset || 'utf-8');
  } catch {
    return new TextDecoder('utf-8');
  }
}

async function readLimitedText(
  body: AsyncIterable<Uint8Array> | null,
  contentType: string
) {
  if (!body) return '';
  const decoder = parseCharset(contentType);
  let bytes = 0;
  let text = '';
  for await (const chunk of body) {
    bytes += chunk.byteLength;
    if (bytes > MAX_PAGE_BYTES) {
      throw new Error('The page is too large to save (over 5 MB).');
    }
    text += decoder.decode(chunk, { stream: true });
  }
  return text + decoder.decode();
}

/**
 * Downloads one public HTML page for the web clipper. Every redirect hop is
 * re-validated and pinned to its checked addresses, like the web_crawl tool.
 */
export async function fetchPublicWebPage(rawUrl: string) {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new Error('Enter a valid http or https URL.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const addresses = await assertPublicWebCrawlUrl(url);
      const dispatcher = new Agent({
        connect: {
          lookup: createPinnedWebCrawlLookup(
            url.hostname.replace(/^\[(.*)\]$/, '$1'),
            addresses
          ),
        },
      });
      try {
        const response = await fetch(url, {
          dispatcher,
          headers: {
            Accept: 'text/html,application/xhtml+xml',
            'User-Agent': USER_AGENT,
          },
          redirect: 'manual',
          signal: controller.signal,
        });
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          await response.body?.cancel();
          if (!location) {
            throw new Error(`The page redirected without a location.`);
          }
          url = new URL(location, url);
          continue;
        }
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error(`The page returned HTTP ${response.status}.`);
        }
        const contentType = response.headers.get('content-type') ?? '';
        if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
          await response.body?.cancel();
          throw new Error('This URL is not a web page.');
        }
        const html = await readLimitedText(response.body, contentType);
        return { html, url: url.toString() };
      } finally {
        await dispatcher.close();
      }
    }
    throw new Error('The page redirected too many times.');
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error('The page took too long to load.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
