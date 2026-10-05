import type { Framework } from '@nota/infra';

import { UrlService } from '../url';
import { GoogleSession } from './entities/google-session';
import { GoogleAuthService } from './services/google-auth';

export type {
  GoogleSessionStatus,
  GoogleTokens,
  GoogleUserInfo,
} from './entities/google-session';
export { GoogleSession } from './entities/google-session';
export { GoogleAuthService } from './services/google-auth';
export { GoogleAuthCallback } from './views/auth-callback';

export function configureGoogleAuthModule(framework: Framework) {
  framework.entity(GoogleSession).service(GoogleAuthService, [UrlService]);
}
