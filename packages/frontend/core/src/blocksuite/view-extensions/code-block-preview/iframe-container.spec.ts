// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';

import { linkIframe } from './iframe-container';

describe('local HTML previews', () => {
  it('renders inline without sending document content to a remote host', () => {
    const iframe = document.createElement('iframe');
    const html =
      '<h1>Private note</h1><script>document.body.dataset.ready = 1</script>';

    linkIframe(iframe, html);

    expect(iframe.srcdoc).toBe(html);
    expect(iframe.hasAttribute('src')).toBe(false);
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts');
  });

  it('removes inherited origin access and old load handlers when refreshed', () => {
    const iframe = document.createElement('iframe');
    const oldLoadHandler = vi.fn();
    iframe.src = 'https://example.com/old-preview';
    iframe.setAttribute(
      'sandbox',
      'allow-scripts allow-same-origin allow-popups'
    );
    iframe.onload = oldLoadHandler;

    linkIframe(iframe, '<p>First render</p>');
    linkIframe(iframe, '<p>Updated render</p>');
    iframe.dispatchEvent(new Event('load'));

    expect(iframe.srcdoc).toBe('<p>Updated render</p>');
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts');
    expect(oldLoadHandler).not.toHaveBeenCalled();
  });
});
