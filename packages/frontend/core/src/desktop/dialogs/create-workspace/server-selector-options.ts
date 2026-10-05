export function selectableWorkspaceServers<T extends { id: string }>(
  servers: readonly T[],
  isElectron: boolean
) {
  return isElectron
    ? servers.filter(server => server.id !== 'nota-cloud')
    : [...servers];
}

export function initialWorkspaceCreationTarget(
  requestedId: string | undefined,
  options: { googleConnected: boolean; isElectron: boolean }
) {
  const safeRequestedId =
    options.isElectron && requestedId === 'nota-cloud'
      ? undefined
      : requestedId;
  return (
    safeRequestedId ?? (options.googleConnected ? 'google-drive' : 'local')
  );
}
