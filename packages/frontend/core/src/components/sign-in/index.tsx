import { Button, notify } from '@nota/component';
import {
  AuthContainer,
  AuthContent,
  AuthHeader,
  NotaLogoIcon,
} from '@nota/component/auth-components';
import type { AuthSessionStatus } from '@nota/core/modules/cloud/entities/session';
import { GoogleAuthService } from '@nota/core/modules/google-auth';
import { useLiveData, useService } from '@nota/infra';
import { useCallback, useEffect, useState } from 'react';

import * as style from './style.css';

export type SignInStep =
  | 'signIn'
  | 'signInWithPassword'
  | 'signInWithEmail'
  | 'addSelfhosted';

export interface SignInState {
  step: SignInStep;
  email?: string;
  hasPassword?: boolean;
  redirectUrl?: string;
  initialServerBaseUrl?: string;
}

export const SignInPanel = ({
  onSkip,
  onAuthenticated,
}: {
  onAuthenticated?: (status: AuthSessionStatus) => void;
  onSkip: () => void;
  server?: string;
  initStep?: SignInStep | undefined;
}) => {
  const googleAuthService = useService(GoogleAuthService);
  const googleStatus = useLiveData(googleAuthService.session.status$);
  const googleUserInfo = useLiveData(googleAuthService.session.userInfo$);
  const [isConnecting, setIsConnecting] = useState(false);

  const isAuthenticated = googleStatus === 'connected';

  useEffect(() => {
    if (isAuthenticated && onAuthenticated) {
      onAuthenticated('authenticated');
    }
  }, [isAuthenticated, onAuthenticated]);

  const handleGoogleSignIn = useCallback(() => {
    setIsConnecting(true);
    googleAuthService
      .connect()
      .catch((err: unknown) => {
        console.error('[SignIn] Google sign-in failed:', err);
        notify.error({
          title: 'Sign in failed',
          message:
            err instanceof Error ? err.message : 'Could not connect to Google.',
        });
      })
      .finally(() => {
        setIsConnecting(false);
      });
  }, [googleAuthService]);

  if (isAuthenticated && googleUserInfo) {
    return (
      <AuthContainer>
        <AuthHeader title="Signed in" subTitle={googleUserInfo.email} />
        <AuthContent>
          <div className={style.connectedInfo}>
            <div className={style.connectedAvatar}>
              {googleUserInfo.picture ? (
                <img
                  src={googleUserInfo.picture}
                  alt={googleUserInfo.name}
                  className={style.avatarImg}
                />
              ) : (
                <div className={style.avatarFallback}>
                  {googleUserInfo.name.charAt(0).toUpperCase()}
                </div>
              )}
            </div>
            <div className={style.connectedDetails}>
              <div className={style.connectedName}>{googleUserInfo.name}</div>
              <div className={style.connectedEmail}>{googleUserInfo.email}</div>
            </div>
          </div>
          <Button style={{ width: '100%' }} size="extraLarge" onClick={onSkip}>
            Continue to Nota
          </Button>
        </AuthContent>
      </AuthContainer>
    );
  }

  return (
    <AuthContainer>
      <AuthHeader
        title="Sign in to Nota"
        subTitle="Save your work to Google Drive"
      />

      <AuthContent>
        <Button
          className={style.googleButton}
          size="extraLarge"
          block
          onClick={handleGoogleSignIn}
          loading={isConnecting || googleStatus === 'connecting'}
        >
          <div className={style.googleButtonContent}>
            <svg className={style.googleLogo} viewBox="0 0 24 24">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.3v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.08z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
            <span>
              {isConnecting || googleStatus === 'connecting'
                ? 'Connecting...'
                : 'Continue with Google'}
            </span>
          </div>
        </Button>

        <div className={style.skipDivider}>
          <div className={style.skipDividerLine} />
          <span className={style.skipDividerText}>or</span>
          <div className={style.skipDividerLine} />
        </div>

        <div className={style.skipSection}>
          <NotaLogoIcon width={24} height={24} />
          <div className={style.benefitText}>
            Sign in to sync your notes across devices and back them up to Google
            Drive
          </div>
          <Button variant="plain" onClick={onSkip} className={style.skipLink}>
            Continue without signing in
          </Button>
        </div>
      </AuthContent>
    </AuthContainer>
  );
};
