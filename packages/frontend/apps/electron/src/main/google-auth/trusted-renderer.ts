export function isTrustedGoogleSessionWorkbenchId(
  workbenchId: string | undefined
) {
  return typeof workbenchId === 'string' && /^app-[\w-]+$/.test(workbenchId);
}
