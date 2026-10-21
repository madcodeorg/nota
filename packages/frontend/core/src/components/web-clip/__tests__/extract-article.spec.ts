/**
 * @vitest-environment happy-dom
 */
import { describe, expect, test } from 'vitest';

import { extractArticle } from '../extract-article';

const body = 'Readable paragraph text. '.repeat(20);

describe('extractArticle', () => {
  test('keeps the article and drops page chrome', () => {
    const { title, html } = extractArticle(
      `<html><head><title>Fallback</title>
        <meta property="og:title" content="Real Title"></head>
        <body><nav>Menu</nav><article><h1>Real Title</h1><p>${body}</p>
        <script>alert(1)</script><a href="/next">Next</a>
        <img src="pic.png"></article><footer>Footer</footer></body></html>`,
      'https://example.com/post/1'
    );
    expect(title).toBe('Real Title');
    expect(html).toContain('Readable paragraph text.');
    expect(html).not.toContain('Menu');
    expect(html).not.toContain('Footer');
    expect(html).not.toContain('alert(1)');
    expect(html).not.toContain('<h1>');
    expect(html).toContain('href="https://example.com/next"');
    expect(html).toContain('src="https://example.com/post/pic.png"');
    expect(html).toContain('Source: <a href="https://example.com/post/1">');
  });

  test('falls back to the body and hostname', () => {
    const { title, html } = extractArticle(
      `<html><body><p>${body}</p><a href="javascript:alert(1)">x</a></body></html>`,
      'https://example.com/'
    );
    expect(title).toBe('example.com');
    expect(html).toContain('Readable paragraph text.');
    expect(html).not.toContain('javascript:');
  });
});
