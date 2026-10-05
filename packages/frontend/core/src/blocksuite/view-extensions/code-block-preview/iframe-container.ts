export function linkIframe(iframe: HTMLIFrameElement, html: string) {
  // An opaque origin keeps preview scripts away from workspace data and the
  // privileged Electron origin. Render locally so previews also work offline.
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.removeAttribute('src');
  iframe.onload = null;
  iframe.srcdoc = html;
}
