import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import test from 'node:test';

import { Window } from 'happy-dom';

const publicRoot = new URL('../../public/', import.meta.url);
const pageURL = 'https://thenota.app/';
const pageHTML = readFileSync(new URL('launch.html', publicRoot), 'utf8');
const menuScript = readFileSync(new URL('launch/site.js', publicRoot), 'utf8');

function createPage(t, { runScript = true, omit } = {}) {
  const window = new Window({
    url: pageURL,
    settings: {
      // Evaluate only this repository's script; never load remote page resources.
      enableJavaScriptEvaluation: true,
      suppressInsecureJavaScriptEnvironmentWarning: true,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      disableIframePageLoading: true,
    },
  });
  t.after(() => window.happyDOM.close());
  window.document.write(pageHTML);
  if (omit) window.document.querySelector(omit).remove();
  if (runScript) window.eval(menuScript);
  return {
    window,
    document: window.document,
    toggle: window.document.querySelector('.menu-toggle'),
    navigation: window.document.querySelector('#navigation'),
  };
}

function assertMenuState(toggle, navigation, open) {
  assert.equal(toggle.getAttribute('aria-expanded'), String(open));
  assert.equal(
    toggle.getAttribute('aria-label'),
    open ? 'Close navigation' : 'Open navigation'
  );
  assert.equal(navigation.dataset.open, String(open));
}

void test('opening the menu moves focus to its first navigation link', t => {
  const { document, toggle, navigation } = createPage(t);
  assert.equal(document.documentElement.classList.contains('js-ready'), true);
  toggle.focus();
  toggle.click();
  assertMenuState(toggle, navigation, true);
  assert.equal(document.activeElement, navigation.querySelector('a'));
});

void test('closing the menu returns focus from a navigation link to the toggle', t => {
  const { document, toggle, navigation } = createPage(t);
  toggle.click();
  navigation.querySelector('a').focus();
  toggle.click();
  assertMenuState(toggle, navigation, false);
  assert.equal(document.activeElement, toggle);
});

void test('Escape closes an open menu and returns focus to the toggle', t => {
  const { window, document, toggle, navigation } = createPage(t);
  toggle.click();
  navigation.querySelector('a').focus();
  document.dispatchEvent(
    new window.KeyboardEvent('keydown', { key: 'Escape' })
  );
  assertMenuState(toggle, navigation, false);
  assert.equal(document.activeElement, toggle);
});

void test('Escape does not steal focus when the menu is already closed', t => {
  const { window, document, toggle } = createPage(t);
  const download = document.querySelector('.header-download');
  download.focus();
  document.dispatchEvent(
    new window.KeyboardEvent('keydown', { key: 'Escape' })
  );
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(document.activeElement, download);
});

void test('clicking a nested navigation link element closes the menu and restores focus', t => {
  const { document, toggle, navigation } = createPage(t);
  const link = navigation.querySelector('a');
  const label = document.createElement('span');
  label.textContent = link.textContent;
  link.replaceChildren(label);
  toggle.click();
  link.focus();
  label.click();
  assertMenuState(toggle, navigation, false);
  assert.equal(document.activeElement, toggle);
});

void test('clicking navigation space leaves the menu open', t => {
  const { toggle, navigation } = createPage(t);
  toggle.click();
  navigation.click();
  assertMenuState(toggle, navigation, true);
});

for (const omit of ['.menu-toggle', '#navigation']) {
  void test(`the script tolerates a page without ${omit}`, t => {
    const { document } = createPage(t, { omit });
    assert.equal(
      document.documentElement.classList.contains('js-ready'),
      false
    );
  });
}

void test('navigation links remain available before JavaScript initializes', t => {
  const { document, navigation } = createPage(t, { runScript: false });
  assert.equal(document.documentElement.classList.contains('js-ready'), false);
  assert.equal(navigation.hidden, false);
  assert.equal(navigation.hasAttribute('inert'), false);
  assert.notEqual(navigation.getAttribute('aria-hidden'), 'true');
  assert.ok(navigation.querySelector('a[href="#meetings"]'));
  assert.ok(navigation.querySelector('a[href="#notes"]'));
  assert.ok(navigation.querySelector('a[href="#ai"]'));
});

void test('capture block toggles its demo recording state without media access', t => {
  const { document } = createPage(t);
  const button = document.querySelector('[data-record-demo]');
  const card = document.querySelector('[data-capture-card]');
  const status = document.querySelector('[data-capture-status]');
  const label = document.querySelector('[data-record-label]');

  assert.ok(button);
  assert.ok(card);
  assert.ok(status);
  assert.ok(label);
  assert.equal(button.getAttribute('aria-pressed'), 'false');
  assert.equal(button.getAttribute('aria-label'), 'Play recording demo');
  assert.equal(button.getAttribute('aria-describedby'), 'capture-disclaimer');
  assert.equal(card.dataset.state, 'ready');
  assert.equal(status.textContent, 'Ready');

  button.click();
  assert.equal(button.getAttribute('aria-pressed'), 'true');
  assert.equal(button.getAttribute('aria-label'), 'Stop recording demo');
  assert.equal(card.dataset.state, 'recording');
  assert.equal(status.textContent, 'Recording');
  assert.equal(label.textContent, 'Stop demo');

  button.click();
  assert.equal(button.getAttribute('aria-pressed'), 'false');
  assert.equal(button.getAttribute('aria-label'), 'Play recording demo');
  assert.equal(card.dataset.state, 'ready');
  assert.equal(status.textContent, 'Ready');
  assert.equal(label.textContent, 'Record');
});

void test('download CTAs point to GitHub Releases and use the Mac label', t => {
  const { document } = createPage(t, { runScript: false });
  const downloadLinks = [
    ...document.querySelectorAll('a[href*="/releases"]'),
  ].filter(link => link.textContent.trim() === 'Download for Mac');

  assert.equal(downloadLinks.length, 3);
  for (const link of downloadLinks) {
    assert.equal(
      link.getAttribute('href'),
      'https://github.com/madcodeorg/nota/releases'
    );
  }
});

void test('page anchors and local assets resolve, including CSS fonts and illustrations', t => {
  const { document } = createPage(t, { runScript: false });
  const stylesheets = [];

  function assertLocalFile(url) {
    const file = new URL(`.${decodeURIComponent(url.pathname)}`, publicRoot);
    assert.equal(
      statSync(file).isFile(),
      true,
      `Missing local asset: ${url.href}`
    );
  }

  for (const element of document.querySelectorAll(
    'a[href], img[src], script[src], link[href]'
  )) {
    const reference =
      element.getAttribute('href') ?? element.getAttribute('src');
    assert.ok(reference, `Empty reference on ${element.tagName}`);
    const url = new URL(reference, pageURL);
    if (url.origin !== new URL(pageURL).origin) continue;
    if (url.pathname === '/' && url.hash) {
      assert.ok(
        document.getElementById(decodeURIComponent(url.hash.slice(1))),
        `Missing anchor: ${reference}`
      );
    } else {
      assertLocalFile(url);
    }
    if (element.getAttribute('rel') === 'stylesheet') stylesheets.push(url);
  }

  for (const stylesheet of stylesheets) {
    const css = readFileSync(
      new URL(`.${stylesheet.pathname}`, publicRoot),
      'utf8'
    );
    for (const match of css.matchAll(/url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/g)) {
      const url = new URL(match[1], stylesheet);
      if (url.origin === new URL(pageURL).origin) assertLocalFile(url);
    }
  }
});

void test('footer preserves the published privacy and terms links', t => {
  const { document } = createPage(t, { runScript: false });
  const footer = document.querySelector('footer');
  for (const [label, path] of [
    ['Privacy', '/privacy.html'],
    ['Terms', '/terms.html'],
  ]) {
    const link = footer.querySelector(`a[href="${path}"]`);
    assert.ok(link, `Missing ${label} link`);
    assert.equal(link.textContent.trim(), label);
    assert.equal(statSync(new URL(`.${path}`, publicRoot)).isFile(), true);
  }
});
