export function parseDevSigningIdentity(description: string) {
  if (/^Signature=adhoc$/m.test(description)) {
    return '-';
  }
  return /^Authority=(.+)$/m.exec(description)?.[1] ?? null;
}

export function parseDevCodeSigningIdentities(description: string) {
  return Array.from(
    description.matchAll(/^\s*\d+\)\s+([0-9a-f]{40})\s+"([^"]+)"/gim),
    match => ({ hash: match[1].toUpperCase(), name: match[2] })
  );
}

export function selectDevSigningIdentity({
  existingIdentity,
  existingCertificateHash,
  configuredIdentity,
  availableIdentities,
}: {
  existingIdentity: string | null;
  existingCertificateHash?: string;
  configuredIdentity?: string;
  availableIdentities: readonly { hash: string; name: string }[];
}) {
  const requested = configuredIdentity || existingIdentity;
  if (requested === '-') {
    return '-';
  }
  if (configuredIdentity && /^[0-9a-f]{40}$/i.test(configuredIdentity)) {
    return configuredIdentity;
  }
  let matches;
  if (!configuredIdentity && existingCertificateHash) {
    matches = availableIdentities.filter(
      identity =>
        identity.hash.toUpperCase() === existingCertificateHash.toUpperCase()
    );
  } else {
    const name =
      requested ??
      availableIdentities.find(identity =>
        identity.name.startsWith('Apple Development:')
      )?.name ??
      availableIdentities.find(identity =>
        identity.name.startsWith('Developer ID Application:')
      )?.name;
    if (!name) return '-';
    matches = availableIdentities.filter(identity => identity.name === name);
    if (!matches.length && configuredIdentity) {
      matches = availableIdentities.filter(identity =>
        identity.name.includes(configuredIdentity)
      );
    }
  }
  const hashes = [
    ...new Set(matches.map(identity => identity.hash.toUpperCase())),
  ];
  if (hashes.length > 1) {
    throw new Error(
      `Nota Dev signing name "${requested ?? matches[0].name}" is ambiguous. ` +
        'Set NOTA_DEV_CODESIGN_IDENTITY to the exact 40-character certificate SHA-1 ' +
        'from security find-identity -v -p codesigning before re-signing.'
    );
  }
  if (!hashes.length) {
    throw new Error(
      `Nota Dev needs re-signing with "${requested}", but that signing identity is unavailable. ` +
        'Restore its certificate and private key in your keychain, or explicitly set ' +
        'NOTA_DEV_CODESIGN_IDENTITY to a replacement certificate SHA-1 (use "-" for ad-hoc signing). ' +
        'Changing identity may require granting macOS permissions again.'
    );
  }
  return hashes[0];
}
