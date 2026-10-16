import {
  OAuthProviderType,
  ServerDeploymentType,
  ServerFeature,
} from '@nota/graphql';

import type { ServerConfig, ServerMetadata } from './types';

// Nota has no hosted cloud. The built-in server always uses the app's own
// origin: in Electron that is the privileged `assets:` origin, whose protocol
// handler forwards API requests to the ephemeral loopback backend and adds the
// per-app credential without exposing it to renderer code.
export const BUILD_IN_SERVERS: (ServerMetadata & { config: ServerConfig })[] =
  environment.isSelfHosted
    ? [
        {
          id: 'nota-cloud',
          baseUrl: location.origin,
          config: {
            serverName: 'Nota Selfhost',
            features: [],
            oauthProviders: [],
            type: ServerDeploymentType.Selfhosted,
            credentialsRequirement: {
              password: {
                minLength: 8,
                maxLength: 32,
              },
            },
          },
        },
      ]
    : [
        {
          id: 'nota-cloud',
          baseUrl: location.origin,
          config: {
            serverName: 'Nota Cloud',
            features: [
              ServerFeature.Indexer,
              ServerFeature.Copilot,
              ServerFeature.CopilotEmbedding,
              ServerFeature.OAuth,
              ServerFeature.Payment,
              ServerFeature.LocalWorkspace,
            ],
            oauthProviders: [OAuthProviderType.Google, OAuthProviderType.Apple],
            type: ServerDeploymentType.Nota,
            credentialsRequirement: {
              password: {
                minLength: 8,
                maxLength: 32,
              },
            },
          },
        },
      ];
