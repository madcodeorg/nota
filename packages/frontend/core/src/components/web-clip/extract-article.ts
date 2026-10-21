const JUNK_SELECTOR = [
  'script',
  'style',
  'noscript',
  'template',
  'iframe',
  'object',
  'embed',
  'form',
  'button',
  'input',
  'select',
  'textarea',
  'nav',
  'header',
  'footer',
  'aside',
  'svg',
  'canvas',
  '[role="navigation"]',
  '[role="banner"]',
  '[role="contentinfo"]',
  '[aria-hidden="true"]',
  '[hidden]',
].join(',');
const MAX_IMAGES = 20;

function textLength(element: Element) {
  return element.textContent?.replace(/\s+/g, ' ').trim().length ?? 0;
}

function pickContentRoot(doc: Document): Element {
  const candidates = Array.from(
    doc.querySelectorAll('article, main, [role="main"]')
  );
  let best: Element | null = null;
  for (const candidate of candidates) {
    if (!best || textLength(candidate) > textLength(best)) best = candidate;
  }
  // A tiny <article> (a teaser card) is worse than the whole body.
  return best && textLength(best) > 200 ? best : doc.body;
}

function absolutize(value: string | null, base: string) {
  if (!value) return null;
  try {
    const url = new URL(value, base);
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

/**
 * Reduces a downloaded web page to its readable content: picks the main
 * article, drops navigation and scripts, and makes links and images absolute.
 */
export function extractArticle(html: string, pageUrl: string) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const metaTitle = doc
    .querySelector('meta[property="og:title"]')
    ?.getAttribute('content');
  const title =
    (metaTitle || doc.title || '').replace(/\s+/g, ' ').trim() ||
    new URL(pageUrl).hostname;

  const content = pickContentRoot(doc).cloneNode(true) as Element;
  content.querySelectorAll(JUNK_SELECTOR).forEach(node => node.remove());

  content.querySelectorAll('a').forEach(anchor => {
    const href = absolutize(anchor.getAttribute('href'), pageUrl);
    if (href) anchor.setAttribute('href', href);
    else anchor.removeAttribute('href');
  });

  let images = 0;
  content.querySelectorAll('img').forEach(image => {
    const src = absolutize(
      image.getAttribute('src') || image.dataset.src || null,
      pageUrl
    );
    if (!src || images >= MAX_IMAGES) {
      image.remove();
      return;
    }
    image.setAttribute('src', src);
    images++;
  });
  content.querySelectorAll('picture source').forEach(node => node.remove());

  const firstHeading = content.querySelector('h1');
  if (firstHeading && firstHeading.textContent?.trim() === title) {
    firstHeading.remove();
  }

  const source = doc.createElement('p');
  const link = doc.createElement('a');
  link.href = pageUrl;
  link.textContent = pageUrl;
  source.append('Source: ', link);

  return {
    title,
    html: `<html><body>${source.outerHTML}${content.innerHTML}</body></html>`,
  };
}
