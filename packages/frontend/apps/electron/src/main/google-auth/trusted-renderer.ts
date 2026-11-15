export function isTrustedGoogleSessionWorkbenchId(
  workbenchId: string | undefined
) {
  return typeof workbenchId === 'string' && /^app-[\w-]+$/.test(workbenchId);
}

/** The renderer is the first-launch window and is showing the onboarding page. */
export function isTrustedOnboardingRenderer(
  senderId: number,
  senderUrl: string,
  onboardingWebContentsId: number | undefined,
  onboardingUrl: string
) {
  if (onboardingWebContentsId === undefined) return false;
  if (senderId !== onboardingWebContentsId) return false;
  return (
    senderUrl === onboardingUrl ||
    senderUrl.startsWith(`${onboardingUrl}?`) ||
    senderUrl.startsWith(`${onboardingUrl}#`)
  );
}
