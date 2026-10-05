export { Server } from './entities/server';
export type { AuthAccountInfo } from './entities/session';
export { AccountChanged } from './events/account-changed';
export { AccountLoggedIn } from './events/account-logged-in';
export { AccountLoggedOut } from './events/account-logged-out';
export { AuthProvider } from './provider/auth';
export { ValidatorProvider } from './provider/validator';
export { ServerScope } from './scopes/server';
export { AccessTokenService } from './services/access-token';
export { AuthService } from './services/auth';
export { CaptchaService } from './services/captcha';
export { DefaultServerService } from './services/default-server';
export { DocCreatedByUpdatedBySyncService } from './services/doc-created-by-updated-by-sync';
export { EventSourceService } from './services/eventsource';
export { FetchService } from './services/fetch';
export { GraphQLService } from './services/graphql';
export { InvitationService } from './services/invitation';
export type { PublicUserInfo } from './services/public-user';
export { PublicUserService } from './services/public-user';
export { ServerService } from './services/server';
export { ServersService } from './services/servers';
export { SubscriptionService } from './services/subscription';
export { UserFeatureService } from './services/user-feature';
export { UserQuotaService } from './services/user-quota';
export {
  type UserSettings,
  UserSettingsService,
} from './services/user-settings';
export { WorkspaceServerService } from './services/workspace-server';
export type { ServerConfig } from './types';

// eslint-disable-next-line simple-import-sort/imports
import { type Framework } from '@nota/infra';

import { GlobalCache, GlobalState } from '../storage/providers/global';
import { GlobalStateService } from '../storage/services/global';
import { UrlService } from '../url';
import { WorkspaceScope, WorkspaceService } from '../workspace';
import { Server } from './entities/server';
import { AuthSession } from './entities/session';
import { Subscription } from './entities/subscription';
import { UserFeature } from './entities/user-feature';
import { UserQuota } from './entities/user-quota';
import { configureDefaultAuthProvider } from './impl/auth';
import { AuthProvider } from './provider/auth';
import { ValidatorProvider } from './provider/validator';
import { ServerScope } from './scopes/server';
import { InvitationService } from './services/invitation';
import { AuthService } from './services/auth';
import { BlocksuiteWriterInfoService } from './services/blocksuite-writer-info';
import { CaptchaService } from './services/captcha';
import { DefaultServerService } from './services/default-server';
import { EventSourceService } from './services/eventsource';
import { FetchService } from './services/fetch';
import { GraphQLService } from './services/graphql';
import { PublicUserService } from './services/public-user';
import { ServerService } from './services/server';
import { ServersService } from './services/servers';
import { SubscriptionService } from './services/subscription';
import { UserFeatureService } from './services/user-feature';
import { UserQuotaService } from './services/user-quota';
import { UserSettingsService } from './services/user-settings';
import { WorkspaceServerService } from './services/workspace-server';
import { AcceptInviteStore } from './stores/accept-invite';
import { AuthStore } from './stores/auth';
import { InviteInfoStore } from './stores/invite-info';
import { PublicUserStore } from './stores/public-user';
import { ServerConfigStore } from './stores/server-config';
import { ServerListStore } from './stores/server-list';
import { SubscriptionStore } from './stores/subscription';
import { UserFeatureStore } from './stores/user-feature';
import { UserQuotaStore } from './stores/user-quota';
import { UserSettingsStore } from './stores/user-settings';
import { DocCreatedByService } from './services/doc-created-by';
import { DocUpdatedByService } from './services/doc-updated-by';
import { DocCreatedByUpdatedBySyncService } from './services/doc-created-by-updated-by-sync';
import { WorkspacePermissionService } from '../permissions';
import { DocScope, DocsService } from '../doc';
import { DocCreatedByUpdatedBySyncStore } from './stores/doc-created-by-updated-by-sync';
import { GlobalDialogService } from '../dialogs';
import { AccessTokenService } from './services/access-token';
import { AccessTokenStore } from './stores/access-token';

export function configureCloudModule(framework: Framework) {
  configureDefaultAuthProvider(framework);

  framework
    .service(ServersService, [ServerListStore, ServerConfigStore])
    .service(DefaultServerService, [ServersService])
    .store(ServerListStore, [GlobalStateService])
    .store(ServerConfigStore)
    .entity(Server, [ServerListStore])
    .scope(ServerScope)
    .service(ServerService, [ServerScope])
    .service(FetchService, [ServerService])
    .service(EventSourceService, [ServerService])
    .service(GraphQLService, [FetchService])
    .service(CaptchaService, f => {
      return new CaptchaService(
        f.get(ServerService),
        f.get(FetchService),
        f.getOptional(ValidatorProvider)
      );
    })
    .service(AuthService, [
      FetchService,
      AuthStore,
      UrlService,
      GlobalDialogService,
    ])
    .store(AuthStore, [
      FetchService,
      GraphQLService,
      GlobalState,
      ServerService,
      AuthProvider,
    ])
    .entity(AuthSession, [AuthStore])
    .service(SubscriptionService)
    .store(SubscriptionStore, [GraphQLService, GlobalCache])
    .entity(Subscription, [AuthService, ServerService, SubscriptionStore])
    .service(UserQuotaService)
    .store(UserQuotaStore, [GraphQLService])
    .entity(UserQuota, [AuthService, UserQuotaStore])
    .service(UserFeatureService)
    .entity(UserFeature, [AuthService, UserFeatureStore])
    .store(UserFeatureStore, [GraphQLService])
    .store(InviteInfoStore, [GraphQLService])
    .service(InvitationService, [AcceptInviteStore, InviteInfoStore])
    .store(AcceptInviteStore, [GraphQLService])
    .service(PublicUserService, [PublicUserStore])
    .store(PublicUserStore, [GraphQLService])
    .service(UserSettingsService, [UserSettingsStore])
    .store(UserSettingsStore, [GraphQLService])
    .service(AccessTokenService, [AccessTokenStore])
    .store(AccessTokenStore, [GraphQLService]);

  framework
    .scope(WorkspaceScope)
    .service(WorkspaceServerService)
    .service(DocCreatedByService, [WorkspaceServerService])
    .scope(DocScope)
    .service(DocUpdatedByService, [WorkspaceServerService]);
  framework
    .scope(WorkspaceScope)
    .service(BlocksuiteWriterInfoService, [WorkspaceServerService])
    .service(DocCreatedByUpdatedBySyncService, [
      WorkspaceService,
      DocsService,
      WorkspacePermissionService,
      DocCreatedByUpdatedBySyncStore,
    ])
    .store(DocCreatedByUpdatedBySyncStore, [
      WorkspaceServerService,
      WorkspaceService,
    ]);
}
