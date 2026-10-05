import { GoogleAuthService } from '@nota/core/modules/google-auth';
import { useLiveData, useService } from '@nota/infra';

export type AccountDisplayInfo = {
  avatar?: string | null;
  email: string | null;
  id: string;
  name: string;
  source: 'google';
};

export function useAccountDisplay(): AccountDisplayInfo | null {
  const googleAuthService = useService(GoogleAuthService);
  const googleStatus = useLiveData(googleAuthService.session.status$);
  const googleUserInfo = useLiveData(googleAuthService.session.userInfo$);

  if (googleStatus === 'connected' && googleUserInfo) {
    return {
      avatar: googleUserInfo.picture ?? null,
      email: googleUserInfo.email || null,
      id: googleUserInfo.sub,
      name: googleUserInfo.name || googleUserInfo.email || 'Google account',
      source: 'google',
    };
  }

  return null;
}
