import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { Window } from 'happy-dom';

const source = path =>
  readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const release = (version, assets, prerelease = false) => ({
  version,
  prerelease,
  date: '2026-11-06T00:00:00Z',
  notes: '<img src=x onerror=alert(1)>',
  url: `https://github.com/madcodeorg/nota/releases/tag/v${version}`,
  assets: assets.map(extension => ({
    name: `nota-${version}-stable-${extension}`,
    size: 1234,
    url: `https://github.com/madcodeorg/nota/releases/download/v${version}/nota-${version}-stable-${extension}`,
  })),
});

async function render(
  page,
  script,
  releases,
  platform = 'Linux',
  fetchFails = false
) {
  const window = new Window({
    url: 'https://thenota.app/',
    settings: {
      disableCSSFileLoading: true,
      disableJavaScriptFileLoading: true,
    },
  });
  window.document.write(source(page));
  Object.defineProperty(window.navigator, 'platform', { value: platform });
  Object.defineProperty(window.navigator, 'userAgent', { value: platform });
  window.fetch = async url => {
    if (fetchFails) throw new Error('offline');
    return {
      ok: true,
      json: async () => structuredClone(releases),
      text: async () => (url.includes('latest-mac') ? 'version: 0.1.13\n' : ''),
    };
  };
  window.eval(source(script));
  await new Promise(resolve => setTimeout(resolve, 0));
  return window;
}

const desktop = release('0.1.13', ['macos-arm64.dmg', 'windows-x64.nsis.exe']);
const allPlatforms = release('0.1.14', [
  'macos-arm64.dmg',
  'windows-x64.nsis.exe',
  'linux-x64.AppImage',
  'linux-x64.deb',
]);

void test('download buttons include all three platform icons; Linux absence is not a fabricated download', async () => {
  const window = await render(
    'public/download/index.html',
    'public/launch/releases.js',
    [desktop]
  );
  try {
    const links = [
      ...window.document.querySelectorAll('[data-hero-actions] a'),
    ];
    assert.equal(links.length, 3);
    assert.match(links[0].textContent, /Linux/);
    assert.equal(links[0].getAttribute('href'), '#linux');
    for (const link of links)
      assert.equal(link.querySelector('img').getAttribute('alt'), '');
    assert.match(
      window.document.querySelector('[data-linux-files]').textContent,
      /No Linux installers/
    );
    assert.equal(window.document.querySelectorAll('.rel-notes img').length, 0);
    assert.match(
      window.document.querySelector('.rel-notes').textContent,
      /<img/
    );
  } finally {
    await window.happyDOM.abort();
  }
});

void test('AppImage and Debian assets become working Linux download links', async () => {
  const window = await render(
    'public/download/index.html',
    'public/launch/releases.js',
    [allPlatforms]
  );
  try {
    assert.match(
      window.document.querySelector('[data-hero-actions] a').href,
      /linux-x64.AppImage$/
    );
    assert.equal(
      window.document.querySelectorAll('[data-linux-files] .rel-file').length,
      2
    );
    assert.match(
      window.document.querySelector('[data-linux-files]').textContent,
      /Debian/
    );
  } finally {
    await window.happyDOM.abort();
  }
});

void test('Linux prerelease files are explicitly labelled, not offered as a stable primary download', async () => {
  const linuxBeta = release('0.1.14-beta.1', ['linux-x64.AppImage'], true);
  const window = await render(
    'public/download/index.html',
    'public/launch/releases.js',
    [desktop, linuxBeta]
  );
  try {
    assert.equal(
      window.document
        .querySelector('[data-hero-actions] a')
        .getAttribute('href'),
      '#linux'
    );
    assert.match(
      window.document.querySelector('[data-linux-files]').textContent,
      /pre-release/
    );
    assert.equal(
      window.document.querySelectorAll('[data-release-list] details').length,
      1
    );
  } finally {
    await window.happyDOM.abort();
  }
});

void test('home page upgrades available platform links and retains the Linux availability link', async () => {
  const window = await render(
    'public/launch.html',
    'public/launch/site.js',
    [desktop],
    'Win32'
  );
  try {
    for (const link of window.document.querySelectorAll(
      '[data-platform="windows"]'
    ))
      assert.match(link.href, /windows-x64.nsis.exe$/);
    for (const link of window.document.querySelectorAll(
      '[data-platform="linux"]'
    ))
      assert.equal(link.getAttribute('href'), '/download/#linux');
    assert.equal(
      window.document.querySelectorAll('img[src^="/launch/ui-"]').length,
      5
    );
    for (const image of window.document.querySelectorAll(
      'img[src^="/launch/ui-"]'
    ))
      assert.equal(image.getAttribute('height'), '1004');
  } finally {
    await window.happyDOM.abort();
  }
});

void test('home page retains usable navigation when release metadata cannot load', async () => {
  const window = await render(
    'public/launch.html',
    'public/launch/site.js',
    [],
    'Linux',
    true
  );
  try {
    assert.equal(
      window.document
        .querySelector('[data-platform="macos"]')
        .getAttribute('href'),
      '/download/'
    );
    assert.equal(
      window.document
        .querySelector('[data-platform="linux"]')
        .getAttribute('href'),
      '/download/#linux'
    );
  } finally {
    await window.happyDOM.abort();
  }
});
