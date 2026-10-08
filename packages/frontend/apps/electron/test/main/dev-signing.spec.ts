import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { runInNewContext } from 'node:vm';

import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

import {
  parseDevCodeSigningIdentities,
  parseDevSigningIdentity,
  selectDevSigningIdentity,
} from '../../scripts/dev-signing';

const signer = 'Apple Development: Existing Developer (EXISTING)';
const otherSigner = 'Apple Development: Other Developer (OTHER)';
const signerHash = 'A'.repeat(40);
const otherHash = 'B'.repeat(40);
const certificate = { name: signer, hash: signerHash };
const otherCertificate = { name: otherSigner, hash: otherHash };

describe('dev signing identity selection', () => {
  it('reads the leaf authority, not an intermediate certificate', () => {
    expect(
      parseDevSigningIdentity(`Executable=/Nota Dev.app
Authority=${signer}
Authority=Apple Worldwide Developer Relations Certification Authority`)
    ).toBe(signer);
    expect(parseDevSigningIdentity('Signature=adhoc\n')).toBe('-');
    expect(parseDevSigningIdentity('code object is not signed')).toBeNull();
  });

  it('retains certificate hashes from keychain output', () => {
    expect(
      parseDevCodeSigningIdentities(
        `  1) ${signerHash.toLowerCase()} "${signer}"\n  1 valid identities found`
      )
    ).toEqual([certificate]);
  });

  it('keeps the existing signer instead of the first available identity', () => {
    expect(
      selectDevSigningIdentity({
        existingIdentity: signer,
        availableIdentities: [otherCertificate, certificate],
      })
    ).toBe(signerHash);
  });

  it.each([
    { availableIdentities: [] },
    { availableIdentities: [otherCertificate] },
  ])(
    'refuses to downgrade or switch an unavailable certified signer: %j',
    ({ availableIdentities }) => {
      expect(() =>
        selectDevSigningIdentity({
          existingIdentity: signer,
          availableIdentities,
        })
      ).toThrow('Restore its certificate and private key');
    }
  );

  it('preserves an existing ad-hoc identity when a certificate appears', () => {
    expect(
      selectDevSigningIdentity({
        existingIdentity: '-',
        availableIdentities: [certificate],
      })
    ).toBe('-');
  });

  it('supports first-time certified and ad-hoc setup', () => {
    for (const availableIdentities of [[], [certificate]]) {
      expect(
        selectDevSigningIdentity({
          existingIdentity: null,
          availableIdentities,
        })
      ).toBe(availableIdentities[0]?.hash ?? '-');
    }
  });

  it('allows an explicitly requested identity change', () => {
    expect(
      selectDevSigningIdentity({
        existingIdentity: signer,
        configuredIdentity: '-',
        availableIdentities: [],
      })
    ).toBe('-');
  });

  it.each([undefined, signer, 'Apple Development:'])(
    'rejects ambiguous names without an exact existing leaf (override: %s)',
    configuredIdentity => {
      expect(() =>
        selectDevSigningIdentity({
          existingIdentity: null,
          configuredIdentity,
          availableIdentities: [certificate, { name: signer, hash: otherHash }],
        })
      ).toThrow('ambiguous');
    }
  );

  it('selects the exact cached leaf when two certificates have the same name', () => {
    expect(
      selectDevSigningIdentity({
        existingIdentity: signer,
        existingCertificateHash: signerHash,
        availableIdentities: [{ name: signer, hash: otherHash }, certificate],
      })
    ).toBe(signerHash);
  });

  it('does not replace an unavailable leaf with another certificate of the same name', () => {
    expect(() =>
      selectDevSigningIdentity({
        existingIdentity: signer,
        existingCertificateHash: signerHash,
        availableIdentities: [{ name: signer, hash: otherHash }],
      })
    ).toThrow('unavailable');
  });

  it('tolerates the same certificate in multiple keychains', () => {
    expect(
      selectDevSigningIdentity({
        existingIdentity: signer,
        availableIdentities: [certificate, certificate],
      })
    ).toBe(signerHash);
  });

  it('resolves a unique explicit partial name to its exact hash', () => {
    expect(
      selectDevSigningIdentity({
        existingIdentity: null,
        configuredIdentity: 'Existing Developer',
        availableIdentities: [otherCertificate, certificate],
      })
    ).toBe(signerHash);
  });
});

// Evaluate only preparation functions. Never import dev.ts, which starts watchers.
const devSource = ts.createSourceFile(
  'dev.ts',
  readFileSync(new URL('../../scripts/dev.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true
);
const preparationFunctions = new Set([
  'devElectronCodeSignatureIsValid',
  'findMacOSDevCodeSigningIdentities',
  'readDevElectronCertificateHash',
  'readDevElectronSigningIdentity',
  'devElectronUsesSigningIdentity',
  'devElectronPlistStringMatches',
  'readDevElectronAppCache',
  'stageDevElectronAppBundle',
  'recoverDevElectronAppPromotion',
  'promoteDevElectronAppBundle',
  'prepareDevElectronForMacOSPermissions',
]);
const preparationCode = ts.transpileModule(
  devSource.statements
    .filter(
      statement =>
        ts.isFunctionDeclaration(statement) &&
        preparationFunctions.has(statement.name?.text ?? '')
    )
    .map(statement => statement.getText(devSource))
    .join('\n'),
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } }
).outputText;

function fixture({
  existing = true,
  identity = signer,
  valid = true,
  configuredIdentity,
  sourceChanged = false,
  metadataChanged = false,
  iconChanged = false,
  keychainFails = false,
  signingFails = false,
  verificationFails = false,
  certificateReadFails = false,
  cloneFails = false,
  failures = [],
  availableIdentities = [],
}: {
  existing?: boolean;
  identity?: string;
  valid?: boolean;
  configuredIdentity?: string;
  sourceChanged?: boolean;
  metadataChanged?: boolean;
  iconChanged?: boolean;
  keychainFails?: boolean;
  signingFails?: boolean;
  verificationFails?: boolean;
  certificateReadFails?: boolean;
  cloneFails?: boolean;
  failures?: string[];
  availableIdentities?: { name: string; hash: string }[];
} = {}) {
  const cache = '/nota/out/nota-dev';
  const app = `${cache}/Nota Dev.app`;
  const staging = `${cache}/Nota Dev.staging.app`;
  const backup = `${cache}/Nota Dev.backup.app`;
  const fingerprintFile = `${cache}/source.json`;
  const journal = `${cache}/promotion.json`;
  const source = '/nota/node_modules/electron/dist/Electron.app';
  const fingerprint = JSON.stringify(
    Array.from({ length: 3 }, () => ({ modifiedAt: 1, size: 1 }))
  );
  const metadata = { CFBundleIdentifier: 'pro.nota.app.dev' };
  const usage = { NSMicrophoneUsageDescription: 'Microphone access' };
  type Bundle = {
    identity: string;
    hash: string;
    valid: boolean;
    metadata: Record<string, string>;
    icon: string;
  };
  const original: Bundle = {
    identity,
    hash: signerHash,
    valid,
    metadata: {
      ...metadata,
      ...usage,
      ...(metadataChanged ? { NSMicrophoneUsageDescription: 'Old text' } : {}),
    },
    icon: iconChanged ? 'old' : 'icon',
  };
  const bundles = new Map<string, Bundle>([
    [source, { identity: '-', hash: '', valid: true, metadata: {}, icon: '' }],
  ]);
  if (existing) bundles.set(app, structuredClone(original));
  const originalFingerprint = sourceChanged ? 'old fingerprint' : fingerprint;
  const files = new Map<string, string>();
  if (existing) files.set(fingerprintFile, originalFingerprint);
  const bundleAt = (file: string) => {
    const entry = [...bundles].find(
      ([path]) => path === file || file.startsWith(`${path}/`)
    );
    if (!entry) throw new Error(`Missing mock bundle: ${file}`);
    return entry[1];
  };
  const mutations: string[] = [];
  const operations: string[] = [];
  const mutate = (operation: string) => {
    operations.push(operation);
    if (failures[0] === operation) {
      failures.shift();
      throw new Error(`Injected failure: ${operation}`);
    }
    mutations.push(operation);
  };
  const clone = (from: string, to: string) => {
    mutate(`clone:${from}`);
    bundles.set(to, structuredClone(bundleAt(from)));
  };
  const execFileSync = vi.fn((command: string, args: string[]) => {
    if (command === '/usr/bin/security') {
      if (keychainFails) throw new Error('keychain unavailable');
      return Buffer.from(
        availableIdentities
          .map(({ hash, name }, i) => `  ${i + 1}) ${hash} "${name}"`)
          .join('\n')
      );
    }
    if (command === '/usr/bin/plutil') {
      if (args[0] === '-extract') {
        return Buffer.from(bundleAt(args.at(-1)!).metadata[args[1]] ?? '');
      }
      const bundle = bundleAt(args.at(-1)!);
      mutate(`plist:${args.at(-1)}`);
      bundle.metadata[args[1]] = args[3];
      bundle.valid = false;
      return;
    }
    if (command === '/usr/bin/codesign') {
      if (args[0] === '-d') {
        if (certificateReadFails)
          throw new Error('certificate extraction failed');
        expect(args).toEqual([
          '-d',
          '--extract-certificates=/tmp/nota-dev-certificate-mock/certificate',
          app,
        ]);
        files.set(
          `${args[1].slice('--extract-certificates='.length)}0`,
          bundleAt(args[2]).hash
        );
        return;
      }
      const bundle = bundleAt(args.at(-1)!);
      if (args[0] === '--verify') {
        operations.push(`verify:${args.at(-1)}`);
        if (!bundle.valid) throw new Error('invalid signature');
        return;
      }
      mutate(`sign:${args.at(-1)}`);
      bundle.valid = false;
      if (signingFails) throw new Error('private key unavailable');
      bundle.identity =
        availableIdentities.find(item => item.hash === args[2])?.name ??
        args[2];
      bundle.hash = args[2];
      bundle.valid = !verificationFails;
      return;
    }
    if (command === '/bin/cp') {
      clone(args[1], args[2]);
      if (cloneFails) throw new Error('APFS clone failed after partial copy');
      return;
    }
    throw new Error(`Unexpected command: ${command}`);
  });
  const spawnSync = vi.fn((_command: string, args: string[]) => {
    const bundle = bundleAt(args.at(-1)!);
    if (args[0] === '--verify') {
      expect(args[2]).toMatch(/^=certificate leaf = H"[0-9a-f]{40}"$/i);
      const hash = /H"(.+)"/.exec(args[2])?.[1];
      return {
        status: bundle.valid && hash?.toUpperCase() === bundle.hash ? 0 : 1,
      };
    }
    return {
      status: 0,
      stdout: '',
      stderr:
        bundle.identity === '-'
          ? 'Signature=adhoc\n'
          : `Authority=${bundle.identity}\nAuthority=Apple Root CA\n`,
    };
  });
  const { prepare, recover } = runInNewContext(
    `${preparationCode}\n({ prepare: prepareDevElectronForMacOSPermissions, recover: recoverDevElectronAppPromotion })`,
    {
      Buffer,
      // This sandbox simulates macOS even when Vitest runs on Windows.
      resolve: posix.resolve,
      parseDevCodeSigningIdentities,
      parseDevSigningIdentity,
      selectDevSigningIdentity,
      execFileSync,
      spawnSync,
      process: {
        platform: 'darwin',
        env: { NOTA_DEV_CODESIGN_IDENTITY: configuredIdentity },
      },
      console: { log: vi.fn(), warn: vi.fn() },
      rootDir: '/nota',
      electronDir: '/nota/electron',
      macOSDevAppBundle: app,
      macOSDevAppCacheDir: cache,
      macOSDevAppDisplayName: 'Nota Dev',
      macOSDevAppBundleIdentifier: metadata.CFBundleIdentifier,
      macOSDevElectronBundleMetadata: metadata,
      devElectronTccUsageDescriptions: usage,
      macOSDevAppBackupBundle: backup,
      macOSDevAppFingerprintFile: fingerprintFile,
      macOSDevAppPromotionFile: journal,
      X509Certificate: class {
        fingerprint: string;
        constructor(bytes: Buffer) {
          this.fingerprint = bytes.toString().match(/../g)!.join(':');
        }
      },
      tmpdir: () => '/tmp',
      mkdtempSync: () => '/tmp/nota-dev-certificate-mock',
      existsSync: (file: string) =>
        bundles.has(file) ||
        files.has(file) ||
        (file.endsWith('nota-dev.icns') && Boolean(bundleAt(file).icon)),
      statSync: () => ({ mtimeMs: 1, size: 1 }),
      readFileSync: (file: string, encoding?: string) => {
        let value = files.get(file);
        if (file.endsWith('icon_internal.icns')) value = 'icon';
        if (file.endsWith('nota-dev.icns')) value = bundleAt(file).icon;
        if (value === undefined) throw new Error(`Missing mock file: ${file}`);
        return encoding ? value : Buffer.from(value);
      },
      mkdirSync: () => mutate('mkdir'),
      copyFileSync: (_from: string, to: string) => {
        mutate(`icon:${to}`);
        bundleAt(to).icon = 'icon';
        bundleAt(to).valid = false;
      },
      cpSync: (from: string, to: string) => {
        expect(bundles.has(to)).toBe(false);
        clone(from, to);
      },
      rmSync: (file: string) => {
        if (file.startsWith('/tmp/')) return;
        mutate(`remove:${file}`);
        bundles.delete(file);
        files.delete(file);
      },
      renameSync: (from: string, to: string) => {
        mutate(`rename:${from}->${to}`);
        if (bundles.has(from)) {
          if (bundles.has(to))
            throw new Error('Cannot overwrite a nonempty bundle');
          bundles.set(to, bundles.get(from)!);
          bundles.delete(from);
        } else if (files.has(from)) {
          files.set(to, files.get(from)!);
          files.delete(from);
        } else {
          throw new Error(`Missing rename source: ${from}`);
        }
      },
      writeFileSync: (file: string, value: string) => {
        mutate(`write:${file}`);
        files.set(file, value);
      },
    }
  ) as { prepare: () => string; recover: () => void };
  const signingCalls = () =>
    execFileSync.mock.calls.filter(
      ([command, args]) =>
        command === '/usr/bin/codesign' && args[0] === '--force'
    );
  const keychainCalls = () =>
    execFileSync.mock.calls.filter(
      ([command]) => command === '/usr/bin/security'
    );
  return {
    prepare,
    recover,
    mutations,
    operations,
    signingCalls,
    keychainCalls,
    spawnSync,
    app,
    staging,
    backup,
    files,
    bundles,
    original,
    originalFingerprint,
    fingerprint,
    fingerprintFile,
    journal,
    execFileSync,
    expectOriginal: () => {
      expect(bundles.get(app)).toEqual(original);
      expect(files.get(fingerprintFile)).toBe(
        existing ? originalFingerprint : undefined
      );
    },
  };
}

describe('cached dev bundle signing continuity', () => {
  it.each([
    { keychainFails: true },
    { availableIdentities: [otherCertificate] },
    { identity: '-', availableIdentities: [certificate] },
    { availableIdentities: [certificate, { name: signer, hash: otherHash }] },
  ])('leaves a valid unchanged bundle untouched: %j', options => {
    const f = fixture(options);
    expect(f.prepare()).toBe(f.app);
    expect(f.mutations).toEqual([]);
    expect(f.keychainCalls()).toEqual([]);
  });

  it.each([
    { sourceChanged: true },
    { metadataChanged: true },
    { iconChanged: true },
    { valid: false },
    { sourceChanged: true, keychainFails: true },
  ])(
    'fails before mutation when resealing needs an unavailable signer: %j',
    options => {
      const f = fixture({
        ...options,
        availableIdentities: [otherCertificate],
      });
      expect(() => f.prepare()).toThrow('NOTA_DEV_CODESIGN_IDENTITY');
      expect(f.mutations).toEqual([]);
    }
  );

  it('retains the original signer when replacing the Electron cache', () => {
    const f = fixture({
      sourceChanged: true,
      availableIdentities: [otherCertificate, certificate],
    });
    expect(f.prepare()).toBe(f.app);
    expect(f.signingCalls()).toEqual([
      [
        '/usr/bin/codesign',
        [
          '--force',
          '--sign',
          signerHash,
          '--identifier',
          'pro.nota.app.dev',
          '--timestamp=none',
          f.staging,
        ],
      ],
    ]);
    expect(f.operations.indexOf(`verify:${f.staging}`)).toBeLessThan(
      f.operations.indexOf(`rename:${f.app}->${f.backup}`)
    );
    expect(f.files.get(f.fingerprintFile)).toBe(f.fingerprint);
    expect(f.bundles.get(f.backup)).toEqual(f.original);
    expect(f.files.has(f.journal)).toBe(false);
  });

  it('keeps the previous cache and fingerprint when replacement signing fails', () => {
    const f = fixture({
      sourceChanged: true,
      availableIdentities: [certificate],
      signingFails: true,
    });
    expect(() => f.prepare()).toThrow('private key unavailable');
    expect(f.mutations).not.toContain(`remove:${f.app}`);
    f.expectOriginal();
    expect(f.files.has(f.journal)).toBe(false);
  });

  it('supports first-time ad-hoc setup when the keychain is unavailable', () => {
    const f = fixture({ existing: false, keychainFails: true });
    expect(f.prepare()).toBe(f.app);
    expect(f.signingCalls()[0][1][2]).toBe('-');
  });

  it('supports an explicit downgrade when the old certificate is unavailable', () => {
    const f = fixture({ configuredIdentity: '-' });
    f.prepare();
    expect(f.signingCalls()[0][1][2]).toBe('-');
    expect(f.keychainCalls()).toEqual([]);
  });

  it('does not re-sign for an explicit matching full certificate name', () => {
    const f = fixture({ configuredIdentity: signer });
    f.prepare();
    expect(f.mutations).toEqual([]);
    expect(f.keychainCalls()).toEqual([]);
  });

  it('keeps ad-hoc signing across an Electron replacement even if a certificate appears', () => {
    const f = fixture({
      identity: '-',
      sourceChanged: true,
      availableIdentities: [certificate],
    });
    f.prepare();
    expect(f.signingCalls()[0][1][2]).toBe('-');
    expect(f.keychainCalls()).toEqual([]);
  });

  it('stages a metadata reseal with the exact cached leaf certificate', () => {
    const f = fixture({
      metadataChanged: true,
      availableIdentities: [otherCertificate, certificate],
    });
    f.prepare();
    expect(f.signingCalls()[0][1][2]).toBe(signerHash);
    expect(f.signingCalls()[0][1].at(-1)).toBe(f.staging);
    expect(f.bundles.get(f.backup)).toEqual(f.original);
    expect(f.keychainCalls()).toHaveLength(1);
  });

  it.each([true, false])(
    'checks an explicit certificate hash without comparing Authority text (match: %s)',
    hashMatches => {
      const hash = (hashMatches ? signerHash : otherHash).toLowerCase();
      const f = fixture({ configuredIdentity: hash });
      f.prepare();
      expect(f.spawnSync).toHaveBeenCalledWith(
        '/usr/bin/codesign',
        ['--verify', '-R', `=certificate leaf = H"${hash}"`, f.app],
        { stdio: 'ignore' }
      );
      expect(f.signingCalls()).toHaveLength(hashMatches ? 0 : 1);
    }
  );

  it.each([
    { metadataChanged: true },
    { iconChanged: true },
    { configuredIdentity: '-' },
    { valid: false },
  ])('preserves the live cache when a cache-hit reseal fails: %j', options => {
    const f = fixture({
      ...options,
      signingFails: true,
      availableIdentities: [certificate],
    });
    expect(() => f.prepare()).toThrow('private key unavailable');
    f.expectOriginal();
    expect(f.signingCalls()[0][1].at(-1)).toBe(f.staging);
    expect(f.files.has(f.journal)).toBe(false);
  });

  it('does not promote a staged bundle that fails signature verification', () => {
    const f = fixture({
      metadataChanged: true,
      verificationFails: true,
      availableIdentities: [certificate],
    });
    expect(() => f.prepare()).toThrow('signature is invalid');
    f.expectOriginal();
    expect(f.files.has(f.journal)).toBe(false);
  });

  it('clears a partial clone before the ordinary copy fallback', () => {
    const f = fixture({
      iconChanged: true,
      cloneFails: true,
      configuredIdentity: '-',
    });
    f.prepare();
    expect(f.bundles.get(f.backup)).toEqual(f.original);
  });

  it('fails before cache mutation if the cached certificate cannot be read', () => {
    const f = fixture({ iconChanged: true, certificateReadFails: true });
    expect(() => f.prepare()).toThrow(
      'Cannot read the cached Nota Dev signing certificate'
    );
    expect(f.mutations).toEqual([]);
    f.expectOriginal();
  });

  it('rejects an ambiguous explicit name before staging', () => {
    const f = fixture({
      iconChanged: true,
      configuredIdentity: signer,
      availableIdentities: [certificate, { name: signer, hash: otherHash }],
    });
    expect(() => f.prepare()).toThrow('ambiguous');
    expect(f.mutations).toEqual([]);
  });

  it('uses the cached leaf, not another certificate sharing its name', () => {
    const f = fixture({
      iconChanged: true,
      availableIdentities: [{ name: signer, hash: otherHash }, certificate],
    });
    f.prepare();
    expect(f.signingCalls()[0][1][2]).toBe(signerHash);
  });
});

describe('dev cache promotion recovery', () => {
  const cache = '/nota/out/nota-dev';
  const app = `${cache}/Nota Dev.app`;
  const staging = `${cache}/Nota Dev.staging.app`;
  const backup = `${cache}/Nota Dev.backup.app`;
  const fingerprintFile = `${cache}/source.json`;
  const journal = `${cache}/promotion.json`;

  it.each([
    `write:${journal}.tmp`,
    `rename:${journal}.tmp->${journal}`,
    `rename:${app}->${backup}`,
    `rename:${staging}->${app}`,
    `write:${fingerprintFile}.tmp`,
    `rename:${fingerprintFile}.tmp->${fingerprintFile}`,
    `remove:${journal}`,
  ])('restores the old cache on failure at %s', operation => {
    const f = fixture({
      sourceChanged: true,
      configuredIdentity: '-',
      failures: [operation],
    });
    expect(() => f.prepare()).toThrow('Injected failure');
    f.expectOriginal();
    expect(f.files.has(f.journal)).toBe(false);
  });

  it.each([
    'before-backup',
    'after-backup',
    'after-install',
    'after-fingerprint',
  ])('recovers interrupted promotion at startup: %s', phase => {
    const f = fixture();
    f.files.set(
      f.journal,
      JSON.stringify({
        hadBundle: true,
        fingerprint: f.originalFingerprint,
      })
    );
    if (phase !== 'before-backup') {
      f.bundles.set(f.backup, f.bundles.get(f.app)!);
      f.bundles.delete(f.app);
    }
    if (phase === 'after-install' || phase === 'after-fingerprint') {
      f.bundles.set(f.app, { ...f.original, identity: '-', hash: '' });
    }
    if (phase === 'after-fingerprint') f.files.set(f.fingerprintFile, 'new');
    expect(f.prepare()).toBe(f.app);
    f.expectOriginal();
    expect(f.signingCalls()).toEqual([]);
    expect(f.keychainCalls()).toEqual([]);
    expect(f.files.has(f.journal)).toBe(false);
  });

  it('retains recovery state when rollback rename fails, then recovers on retry', () => {
    const f = fixture({
      configuredIdentity: '-',
      failures: [`write:${fingerprintFile}.tmp`, `rename:${backup}->${app}`],
    });
    expect(() => f.prepare()).toThrow('promotion and rollback failed');
    expect(f.bundles.get(f.backup)).toEqual(f.original);
    expect(f.files.has(f.journal)).toBe(true);
    f.recover();
    f.expectOriginal();
    expect(f.files.has(f.journal)).toBe(false);
  });

  it('can retry recovery after restoring the app but failing to restore its fingerprint', () => {
    const f = fixture({
      configuredIdentity: '-',
      failures: [
        `write:${fingerprintFile}.tmp`,
        `write:${fingerprintFile}.tmp`,
      ],
    });
    expect(() => f.prepare()).toThrow('promotion and rollback failed');
    expect(f.bundles.get(f.app)).toEqual(f.original);
    expect(f.bundles.has(f.backup)).toBe(false);
    expect(f.files.has(f.journal)).toBe(true);
    f.recover();
    f.expectOriginal();
  });

  it('removes a failed first-time promotion without inventing a previous signer', () => {
    const f = fixture({
      existing: false,
      failures: [`write:${fingerprintFile}.tmp`],
    });
    expect(() => f.prepare()).toThrow('Injected failure');
    expect(f.bundles.has(f.app)).toBe(false);
    expect(f.files.has(f.fingerprintFile)).toBe(false);
    expect(f.files.has(f.journal)).toBe(false);
  });

  it('recovers an interrupted first-time promotion', () => {
    const f = fixture({ existing: false });
    f.files.set(
      f.journal,
      JSON.stringify({ hadBundle: false, fingerprint: null })
    );
    f.bundles.set(f.app, { ...f.original, identity: '-', hash: '' });
    f.files.set(f.fingerprintFile, f.fingerprint);
    f.recover();
    expect(f.bundles.has(f.app)).toBe(false);
    expect(f.files.has(f.fingerprintFile)).toBe(false);
    expect(f.files.has(f.journal)).toBe(false);
  });

  it('retains an uncommitted backup when the journal is malformed', () => {
    const f = fixture();
    f.files.set(f.journal, '{"hadBundle":true}');
    f.bundles.set(f.backup, f.original);
    expect(() => f.prepare()).toThrow('Invalid Nota Dev promotion journal');
    expect(f.bundles.get(f.backup)).toEqual(f.original);
    expect(f.mutations).toEqual([]);
  });
});
