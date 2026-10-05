// @generated
// This file was automatically generated and should not be edited.

import ApolloAPI

public protocol SelectionSet: ApolloAPI.SelectionSet & ApolloAPI.RootSelectionSet
where Schema == NotaGraphQL.SchemaMetadata {}

public protocol InlineFragment: ApolloAPI.SelectionSet & ApolloAPI.InlineFragment
where Schema == NotaGraphQL.SchemaMetadata {}

public protocol MutableSelectionSet: ApolloAPI.MutableRootSelectionSet
where Schema == NotaGraphQL.SchemaMetadata {}

public protocol MutableInlineFragment: ApolloAPI.MutableSelectionSet & ApolloAPI.InlineFragment
where Schema == NotaGraphQL.SchemaMetadata {}

public enum SchemaMetadata: ApolloAPI.SchemaMetadata {
  public static let configuration: any ApolloAPI.SchemaConfiguration.Type = SchemaConfiguration.self

  public static func objectType(forTypename typename: String) -> ApolloAPI.Object? {
    switch typename {
    case "AdminWorkspace": return NotaGraphQL.Objects.AdminWorkspace
    case "AdminWorkspaceMember": return NotaGraphQL.Objects.AdminWorkspaceMember
    case "AdminWorkspaceSharedLink": return NotaGraphQL.Objects.AdminWorkspaceSharedLink
    case "AggregateBucketHitsObjectType": return NotaGraphQL.Objects.AggregateBucketHitsObjectType
    case "AggregateBucketObjectType": return NotaGraphQL.Objects.AggregateBucketObjectType
    case "AggregateResultObjectType": return NotaGraphQL.Objects.AggregateResultObjectType
    case "AppConfigValidateResult": return NotaGraphQL.Objects.AppConfigValidateResult
    case "BlobUploadInit": return NotaGraphQL.Objects.BlobUploadInit
    case "BlobUploadPart": return NotaGraphQL.Objects.BlobUploadPart
    case "BlobUploadedPart": return NotaGraphQL.Objects.BlobUploadedPart
    case "CalendarAccountObjectType": return NotaGraphQL.Objects.CalendarAccountObjectType
    case "CalendarCalDAVProviderPresetObjectType": return NotaGraphQL.Objects.CalendarCalDAVProviderPresetObjectType
    case "CalendarEventObjectType": return NotaGraphQL.Objects.CalendarEventObjectType
    case "CalendarSubscriptionObjectType": return NotaGraphQL.Objects.CalendarSubscriptionObjectType
    case "ChatMessage": return NotaGraphQL.Objects.ChatMessage
    case "CommentChangeObjectType": return NotaGraphQL.Objects.CommentChangeObjectType
    case "CommentChangeObjectTypeEdge": return NotaGraphQL.Objects.CommentChangeObjectTypeEdge
    case "CommentObjectType": return NotaGraphQL.Objects.CommentObjectType
    case "CommentObjectTypeEdge": return NotaGraphQL.Objects.CommentObjectTypeEdge
    case "ContextMatchedDocChunk": return NotaGraphQL.Objects.ContextMatchedDocChunk
    case "ContextMatchedFileChunk": return NotaGraphQL.Objects.ContextMatchedFileChunk
    case "ContextWorkspaceEmbeddingStatus": return NotaGraphQL.Objects.ContextWorkspaceEmbeddingStatus
    case "Copilot": return NotaGraphQL.Objects.Copilot
    case "CopilotContext": return NotaGraphQL.Objects.CopilotContext
    case "CopilotContextBlob": return NotaGraphQL.Objects.CopilotContextBlob
    case "CopilotContextCategory": return NotaGraphQL.Objects.CopilotContextCategory
    case "CopilotContextDoc": return NotaGraphQL.Objects.CopilotContextDoc
    case "CopilotContextFile": return NotaGraphQL.Objects.CopilotContextFile
    case "CopilotHistories": return NotaGraphQL.Objects.CopilotHistories
    case "CopilotHistoriesTypeEdge": return NotaGraphQL.Objects.CopilotHistoriesTypeEdge
    case "CopilotModelType": return NotaGraphQL.Objects.CopilotModelType
    case "CopilotModelsType": return NotaGraphQL.Objects.CopilotModelsType
    case "CopilotPromptConfigType": return NotaGraphQL.Objects.CopilotPromptConfigType
    case "CopilotPromptMessageType": return NotaGraphQL.Objects.CopilotPromptMessageType
    case "CopilotPromptType": return NotaGraphQL.Objects.CopilotPromptType
    case "CopilotQuota": return NotaGraphQL.Objects.CopilotQuota
    case "CopilotWorkspaceConfig": return NotaGraphQL.Objects.CopilotWorkspaceConfig
    case "CopilotWorkspaceFile": return NotaGraphQL.Objects.CopilotWorkspaceFile
    case "CopilotWorkspaceFileTypeEdge": return NotaGraphQL.Objects.CopilotWorkspaceFileTypeEdge
    case "CopilotWorkspaceIgnoredDoc": return NotaGraphQL.Objects.CopilotWorkspaceIgnoredDoc
    case "CopilotWorkspaceIgnoredDocTypeEdge": return NotaGraphQL.Objects.CopilotWorkspaceIgnoredDocTypeEdge
    case "CredentialsRequirementType": return NotaGraphQL.Objects.CredentialsRequirementType
    case "DeleteAccount": return NotaGraphQL.Objects.DeleteAccount
    case "DocHistoryType": return NotaGraphQL.Objects.DocHistoryType
    case "DocPermissions": return NotaGraphQL.Objects.DocPermissions
    case "DocType": return NotaGraphQL.Objects.DocType
    case "DocTypeEdge": return NotaGraphQL.Objects.DocTypeEdge
    case "EditorType": return NotaGraphQL.Objects.EditorType
    case "GrantedDocUserType": return NotaGraphQL.Objects.GrantedDocUserType
    case "GrantedDocUserTypeEdge": return NotaGraphQL.Objects.GrantedDocUserTypeEdge
    case "InvitationType": return NotaGraphQL.Objects.InvitationType
    case "InvitationWorkspaceType": return NotaGraphQL.Objects.InvitationWorkspaceType
    case "InviteLink": return NotaGraphQL.Objects.InviteLink
    case "InviteResult": return NotaGraphQL.Objects.InviteResult
    case "InviteUserType": return NotaGraphQL.Objects.InviteUserType
    case "InvoiceType": return NotaGraphQL.Objects.InvoiceType
    case "License": return NotaGraphQL.Objects.License
    case "LimitedUserType": return NotaGraphQL.Objects.LimitedUserType
    case "ListedBlob": return NotaGraphQL.Objects.ListedBlob
    case "Mutation": return NotaGraphQL.Objects.Mutation
    case "NotificationObjectType": return NotaGraphQL.Objects.NotificationObjectType
    case "NotificationObjectTypeEdge": return NotaGraphQL.Objects.NotificationObjectTypeEdge
    case "PageInfo": return NotaGraphQL.Objects.PageInfo
    case "PaginatedCommentChangeObjectType": return NotaGraphQL.Objects.PaginatedCommentChangeObjectType
    case "PaginatedCommentObjectType": return NotaGraphQL.Objects.PaginatedCommentObjectType
    case "PaginatedCopilotHistoriesType": return NotaGraphQL.Objects.PaginatedCopilotHistoriesType
    case "PaginatedCopilotWorkspaceFileType": return NotaGraphQL.Objects.PaginatedCopilotWorkspaceFileType
    case "PaginatedDocType": return NotaGraphQL.Objects.PaginatedDocType
    case "PaginatedGrantedDocUserType": return NotaGraphQL.Objects.PaginatedGrantedDocUserType
    case "PaginatedIgnoredDocsType": return NotaGraphQL.Objects.PaginatedIgnoredDocsType
    case "PaginatedNotificationObjectType": return NotaGraphQL.Objects.PaginatedNotificationObjectType
    case "PasswordLimitsType": return NotaGraphQL.Objects.PasswordLimitsType
    case "PublicUserType": return NotaGraphQL.Objects.PublicUserType
    case "Query": return NotaGraphQL.Objects.Query
    case "ReleaseVersionType": return NotaGraphQL.Objects.ReleaseVersionType
    case "RemoveAvatar": return NotaGraphQL.Objects.RemoveAvatar
    case "ReplyObjectType": return NotaGraphQL.Objects.ReplyObjectType
    case "RevealedAccessToken": return NotaGraphQL.Objects.RevealedAccessToken
    case "SearchDocObjectType": return NotaGraphQL.Objects.SearchDocObjectType
    case "SearchNodeObjectType": return NotaGraphQL.Objects.SearchNodeObjectType
    case "SearchResultObjectType": return NotaGraphQL.Objects.SearchResultObjectType
    case "SearchResultPagination": return NotaGraphQL.Objects.SearchResultPagination
    case "ServerConfigType": return NotaGraphQL.Objects.ServerConfigType
    case "StreamObject": return NotaGraphQL.Objects.StreamObject
    case "SubscriptionPrice": return NotaGraphQL.Objects.SubscriptionPrice
    case "SubscriptionType": return NotaGraphQL.Objects.SubscriptionType
    case "TranscriptionItemType": return NotaGraphQL.Objects.TranscriptionItemType
    case "TranscriptionResultType": return NotaGraphQL.Objects.TranscriptionResultType
    case "UserImportFailedType": return NotaGraphQL.Objects.UserImportFailedType
    case "UserQuotaHumanReadableType": return NotaGraphQL.Objects.UserQuotaHumanReadableType
    case "UserQuotaType": return NotaGraphQL.Objects.UserQuotaType
    case "UserQuotaUsageType": return NotaGraphQL.Objects.UserQuotaUsageType
    case "UserSettingsType": return NotaGraphQL.Objects.UserSettingsType
    case "UserType": return NotaGraphQL.Objects.UserType
    case "WorkspaceCalendarItemObjectType": return NotaGraphQL.Objects.WorkspaceCalendarItemObjectType
    case "WorkspaceCalendarObjectType": return NotaGraphQL.Objects.WorkspaceCalendarObjectType
    case "WorkspaceDocMeta": return NotaGraphQL.Objects.WorkspaceDocMeta
    case "WorkspacePermissions": return NotaGraphQL.Objects.WorkspacePermissions
    case "WorkspaceQuotaHumanReadableType": return NotaGraphQL.Objects.WorkspaceQuotaHumanReadableType
    case "WorkspaceQuotaType": return NotaGraphQL.Objects.WorkspaceQuotaType
    case "WorkspaceRolePermissions": return NotaGraphQL.Objects.WorkspaceRolePermissions
    case "WorkspaceType": return NotaGraphQL.Objects.WorkspaceType
    case "WorkspaceUserType": return NotaGraphQL.Objects.WorkspaceUserType
    case "tokenType": return NotaGraphQL.Objects.TokenType
    default: return nil
    }
  }
}

public enum Objects {}
public enum Interfaces {}
public enum Unions {}
