// Renders the download and beta pages from /releases.json, which the Site
// workflow builds from GitHub Releases. Everything is inserted with
// textContent, so release notes cannot inject markup.
(() => {
  const channel =
    document.documentElement.dataset.channel === 'beta' ? 'beta' : 'stable';
  const RELEASES_PAGE = 'https://github.com/madcodeorg/nota/releases';

  const OS_NAME = { macos: 'macOS', windows: 'Windows', linux: 'Linux' };
  const ARCH_NAME = {
    macos: { arm64: 'Apple silicon' },
    windows: { x64: '64-bit (x64)' },
    linux: { x64: '64-bit (x64)' },
  };
  // rank: lower sorts first. primary: the file offered as the main download.
  const KINDS = {
    dmg: { label: 'Installer (.dmg)', rank: 0, primary: true },
    'nsis.exe': { label: 'Installer (.exe)', rank: 0, primary: true },
    appimage: { label: 'AppImage', rank: 0, primary: true },
    deb: { label: 'Debian package (.deb)', rank: 1 },
    exe: { label: 'Alternate installer (.exe)', rank: 2 },
    flatpak: { label: 'Flatpak', rank: 2 },
    zip: { label: 'Zip archive', rank: 3 },
  };

  const el = (tag, props, ...children) => {
    const node = document.createElement(tag);
    Object.assign(node, props);
    node.append(...children);
    return node;
  };

  const platformIcon = os =>
    el('img', {
      className: 'platform-icon',
      src: `/launch/icons/${{ macos: 'apple', windows: 'windows', linux: 'linux' }[os]}.svg`,
      width: 20,
      height: 20,
      alt: '',
    });

  const describe = asset => {
    const match = /^nota-.+?-(macos|windows|linux)-(arm64|x64)\.(.+)$/.exec(
      asset.name
    );
    const kind = match && KINDS[match[3].toLowerCase()];
    if (!match || !kind) return null;
    return { os: match[1], arch: match[2], kind };
  };

  const formatDate = value =>
    new Date(value).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });

  const formatSize = bytes => `${(bytes / 1048576).toFixed(1)} MB`;

  const detectOS = () => {
    const platform = navigator.userAgentData?.platform || navigator.platform;
    const text = `${platform} ${navigator.userAgent}`;
    if (/android|iphone|ipad/i.test(text)) return null;
    if (/windows|^win/i.test(text)) return 'windows';
    if (/mac/i.test(text)) return 'macos';
    if (/linux|x11/i.test(text)) return 'linux';
    return null;
  };

  const primaryAsset = (release, os) =>
    release.assets.find(a => {
      const info = describe(a);
      return info && info.os === os && info.kind.primary;
    });

  const renderNotes = notes => {
    const lines = notes
      .split('\n')
      .map(line => line.replace(/^\s*[-*]\s+/, '').trim())
      .filter(Boolean);
    if (lines.length === 0) {
      return el('p', {
        className: 'rel-notes-empty',
        textContent: 'No release notes for this version.',
      });
    }
    return el(
      'ul',
      { className: 'rel-notes' },
      ...lines.map(line => el('li', { textContent: line }))
    );
  };

  const renderFile = asset => {
    const info = describe(asset);
    const row = el(
      'li',
      { className: 'rel-file' },
      el(
        'span',
        { className: 'rel-file-os' },
        platformIcon(info.os),
        `${OS_NAME[info.os]} · ${ARCH_NAME[info.os][info.arch]}`
      ),
      el('a', { href: asset.url, textContent: info.kind.label }),
      el('span', {
        className: 'rel-file-size',
        textContent: formatSize(asset.size),
      })
    );
    if (asset.sha256) {
      const copy = el('button', {
        className: 'rel-copy',
        type: 'button',
        textContent: 'Copy',
      });
      copy.setAttribute('aria-label', `Copy SHA-256 for ${asset.name}`);
      copy.addEventListener('click', () => {
        navigator.clipboard
          ?.writeText(asset.sha256)
          .then(() => {
            copy.textContent = 'Copied';
            setTimeout(() => (copy.textContent = 'Copy'), 1500);
          })
          .catch(() => {});
      });
      row.append(
        el(
          'span',
          { className: 'rel-hash', title: asset.sha256 },
          `SHA-256 ${asset.sha256.slice(0, 12)}…`,
          copy
        )
      );
    }
    return row;
  };

  const renderRelease = (release, isLatest) => {
    const files = release.assets
      .map(asset => ({ asset, info: describe(asset) }))
      .filter(entry => entry.info)
      .sort(
        (a, b) =>
          a.info.os.localeCompare(b.info.os) ||
          a.info.kind.rank - b.info.kind.rank
      );
    const summary = el(
      'summary',
      {},
      el('span', {
        className: 'rel-version',
        textContent: `v${release.version}`,
      })
    );
    if (isLatest) {
      summary.append(
        el('span', { className: 'rel-badge', textContent: 'Latest' })
      );
    }
    summary.append(
      el('span', {
        className: 'rel-date',
        textContent: formatDate(release.date),
      })
    );

    const body = el(
      'div',
      { className: 'rel-body' },
      renderNotes(release.notes)
    );
    if (files.length > 0) {
      body.append(
        el(
          'ul',
          { className: 'rel-files' },
          ...files.map(f => renderFile(f.asset))
        )
      );
      if (files.some(f => f.info.os === 'windows')) {
        body.append(
          el('p', {
            className: 'rel-more',
            textContent:
              'Windows installers may be unsigned and show a SmartScreen warning. Choose More info, then Run anyway, if you trust this download.',
          })
        );
      }
    } else {
      body.append(
        el('p', {
          className: 'rel-notes-empty',
          textContent: 'No installers attached.',
        })
      );
    }
    body.append(
      el(
        'p',
        { className: 'rel-more' },
        el('a', { href: release.url, textContent: 'View on GitHub' })
      )
    );

    const details = el('details', { className: 'rel-release' }, summary, body);
    details.open = isLatest;
    return details;
  };

  const renderHero = (latest, stable, releases) => {
    const actions = document.querySelector('[data-hero-actions]');
    const meta = document.querySelector('[data-hero-meta]');
    if (!actions || !meta) return;
    actions.replaceChildren();
    meta.replaceChildren();

    if (!latest) {
      meta.textContent =
        channel === 'beta'
          ? 'No beta build is published right now.'
          : 'No release is published yet.';
      actions.append(
        el('a', {
          className: 'text-link',
          href: RELEASES_PAGE,
          textContent: 'See GitHub Releases',
        })
      );
      return;
    }

    const os = detectOS();
    const platforms = Object.keys(OS_NAME);
    if (os) platforms.sort((a, b) => Number(b === os) - Number(a === os));
    for (const platform of platforms) {
      const release = releases.find(item => primaryAsset(item, platform));
      const asset = release && primaryAsset(release, platform);
      const link = el(
        'a',
        {
          className: `button${platform === os && asset ? '' : ' button-secondary'}`,
          href: asset?.url ?? (platform === 'linux' ? '#linux' : RELEASES_PAGE),
        },
        platformIcon(platform),
        `${OS_NAME[platform]}`
      );
      if (asset) {
        link.append(
          el('span', {
            className: 'button-version',
            textContent: `v${release.version}`,
          })
        );
        link.setAttribute(
          'aria-label',
          `Download Nota v${release.version} for ${OS_NAME[platform]}`
        );
      } else {
        link.setAttribute(
          'aria-label',
          `View ${OS_NAME[platform]} download availability`
        );
      }
      actions.append(link);
    }
    meta.textContent = `Latest ${channel}: v${latest.version} · Published ${formatDate(latest.date)}.`;

    if (channel === 'beta' && stable) {
      const ahead = document.querySelector('[data-beta-ahead]');
      ahead?.replaceChildren(
        `Current stable release is v${stable.version}. `,
        el('a', { href: '/download/', textContent: 'Get the stable version.' })
      );
    }
  };

  const showStatus = message => {
    const list = document.querySelector('[data-release-list]');
    list?.replaceChildren(
      el(
        'p',
        { className: 'rel-status' },
        `${message} `,
        el('a', { href: RELEASES_PAGE, textContent: 'See GitHub Releases.' })
      )
    );
  };

  fetch('/releases.json', { cache: 'no-cache' })
    .then(response => {
      if (!response.ok) throw new Error(String(response.status));
      return response.json();
    })
    .then(all => {
      const byDate = (a, b) => new Date(b.date) - new Date(a.date);
      const stableReleases = all.filter(r => !r.prerelease).sort(byDate);
      const releases = all
        .filter(r => r.prerelease === (channel === 'beta'))
        .sort(byDate);

      renderHero(releases[0], stableReleases[0], releases);

      const linuxFiles = document.querySelector('[data-linux-files]');
      if (linuxFiles) {
        const linuxRelease = all
          .sort(byDate)
          .find(release =>
            release.assets.some(asset => describe(asset)?.os === 'linux')
          );
        linuxFiles.replaceChildren(
          ...(linuxRelease
            ? [
                el('p', {
                  textContent: `Linux files for v${linuxRelease.version}${linuxRelease.prerelease ? ' (pre-release)' : ''}.`,
                }),
                el(
                  'ul',
                  { className: 'rel-files' },
                  ...linuxRelease.assets
                    .filter(asset => describe(asset)?.os === 'linux')
                    .map(renderFile)
                ),
              ]
            : [
                el('p', {
                  textContent:
                    'No Linux installers are attached to published releases yet.',
                }),
              ])
        );
      }

      const list = document.querySelector('[data-release-list]');
      if (!list) return;
      if (releases.length === 0) {
        showStatus(
          channel === 'beta'
            ? 'No beta builds are published right now.'
            : 'No releases are published yet.'
        );
        return;
      }
      list.replaceChildren(
        ...releases.map((release, index) => renderRelease(release, index === 0))
      );
    })
    .catch(() => {
      showStatus('The version list could not be loaded.');
    });
})();
