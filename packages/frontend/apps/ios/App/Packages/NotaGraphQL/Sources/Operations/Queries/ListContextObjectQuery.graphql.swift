// @generated
// This file was automatically generated and should not be edited.

@_exported import ApolloAPI

public class ListContextObjectQuery: GraphQLQuery {
  public static let operationName: String = "listContextObject"
  public static let operationDocument: ApolloAPI.OperationDocument = .init(
    definition: .init(
      #"query listContextObject($workspaceId: String!, $sessionId: String!, $contextId: String!) { currentUser { __typename copilot(workspaceId: $workspaceId) { __typename contexts(sessionId: $sessionId, contextId: $contextId) { __typename blobs { __typename id status createdAt } docs { __typename id status createdAt } files { __typename id name mimeType blobId chunkSize error status createdAt } tags { __typename type id docs { __typename id status createdAt } createdAt } collections { __typename type id docs { __typename id status createdAt } createdAt } } } } }"#
    ))

  public var workspaceId: String
  public var sessionId: String
  public var contextId: String

  public init(
    workspaceId: String,
    sessionId: String,
    contextId: String
  ) {
    self.workspaceId = workspaceId
    self.sessionId = sessionId
    self.contextId = contextId
  }

  public var __variables: Variables? { [
    "workspaceId": workspaceId,
    "sessionId": sessionId,
    "contextId": contextId
  ] }

  public struct Data: NotaGraphQL.SelectionSet {
    public let __data: DataDict
    public init(_dataDict: DataDict) { __data = _dataDict }

    public static var __parentType: any ApolloAPI.ParentType { NotaGraphQL.Objects.Query }
    public static var __selections: [ApolloAPI.Selection] { [
      .field("currentUser", CurrentUser?.self),
    ] }

    /// Get current user
    public var currentUser: CurrentUser? { __data["currentUser"] }

    /// CurrentUser
    ///
    /// Parent Type: `UserType`
    public struct CurrentUser: NotaGraphQL.SelectionSet {
      public let __data: DataDict
      public init(_dataDict: DataDict) { __data = _dataDict }

      public static var __parentType: any ApolloAPI.ParentType { NotaGraphQL.Objects.UserType }
      public static var __selections: [ApolloAPI.Selection] { [
        .field("__typename", String.self),
        .field("copilot", Copilot.self, arguments: ["workspaceId": .variable("workspaceId")]),
      ] }

      public var copilot: Copilot { __data["copilot"] }

      /// CurrentUser.Copilot
      ///
      /// Parent Type: `Copilot`
      public struct Copilot: NotaGraphQL.SelectionSet {
        public let __data: DataDict
        public init(_dataDict: DataDict) { __data = _dataDict }

        public static var __parentType: any ApolloAPI.ParentType { NotaGraphQL.Objects.Copilot }
        public static var __selections: [ApolloAPI.Selection] { [
          .field("__typename", String.self),
          .field("contexts", [Context].self, arguments: [
            "sessionId": .variable("sessionId"),
            "contextId": .variable("contextId")
          ]),
        ] }

        /// Get the context list of a session
        public var contexts: [Context] { __data["contexts"] }

        /// CurrentUser.Copilot.Context
        ///
        /// Parent Type: `CopilotContext`
        public struct Context: NotaGraphQL.SelectionSet {
          public let __data: DataDict
          public init(_dataDict: DataDict) { __data = _dataDict }

          public static var __parentType: any ApolloAPI.ParentType { NotaGraphQL.Objects.CopilotContext }
          public static var __selections: [ApolloAPI.Selection] { [
            .field("__typename", String.self),
            .field("blobs", [Blob].self),
            .field("docs", [Doc].self),
            .field("files", [File].self),
            .field("tags", [Tag].self),
            .field("collections", [Collection].self),
          ] }

          /// list blobs in context
          public var blobs: [Blob] { __data["blobs"] }
          /// list files in context
          public var docs: [Doc] { __data["docs"] }
          /// list files in context
          public var files: [File] { __data["files"] }
          /// list tags in context
          public var tags: [Tag] { __data["tags"] }
          /// list collections in context
          public var collections: [Collection] { __data["collections"] }

          /// CurrentUser.Copilot.Context.Blob
          ///
          /// Parent Type: `CopilotContextBlob`
          public struct Blob: NotaGraphQL.SelectionSet {
            public let __data: DataDict
            public init(_dataDict: DataDict) { __data = _dataDict }

            public static var __parentType: any ApolloAPI.ParentType { NotaGraphQL.Objects.CopilotContextBlob }
            public static var __selections: [ApolloAPI.Selection] { [
              .field("__typename", String.self),
              .field("id", NotaGraphQL.ID.self),
              .field("status", GraphQLEnum<NotaGraphQL.ContextEmbedStatus>?.self),
              .field("createdAt", NotaGraphQL.SafeInt.self),
            ] }

            public var id: NotaGraphQL.ID { __data["id"] }
            public var status: GraphQLEnum<NotaGraphQL.ContextEmbedStatus>? { __data["status"] }
            public var createdAt: NotaGraphQL.SafeInt { __data["createdAt"] }
          }

          /// CurrentUser.Copilot.Context.Doc
          ///
          /// Parent Type: `CopilotContextDoc`
          public struct Doc: NotaGraphQL.SelectionSet {
            public let __data: DataDict
            public init(_dataDict: DataDict) { __data = _dataDict }

            public static var __parentType: any ApolloAPI.ParentType { NotaGraphQL.Objects.CopilotContextDoc }
            public static var __selections: [ApolloAPI.Selection] { [
              .field("__typename", String.self),
              .field("id", NotaGraphQL.ID.self),
              .field("status", GraphQLEnum<NotaGraphQL.ContextEmbedStatus>?.self),
              .field("createdAt", NotaGraphQL.SafeInt.self),
            ] }

            public var id: NotaGraphQL.ID { __data["id"] }
            public var status: GraphQLEnum<NotaGraphQL.ContextEmbedStatus>? { __data["status"] }
            public var createdAt: NotaGraphQL.SafeInt { __data["createdAt"] }
          }

          /// CurrentUser.Copilot.Context.File
          ///
          /// Parent Type: `CopilotContextFile`
          public struct File: NotaGraphQL.SelectionSet {
            public let __data: DataDict
            public init(_dataDict: DataDict) { __data = _dataDict }

            public static var __parentType: any ApolloAPI.ParentType { NotaGraphQL.Objects.CopilotContextFile }
            public static var __selections: [ApolloAPI.Selection] { [
              .field("__typename", String.self),
              .field("id", NotaGraphQL.ID.self),
              .field("name", String.self),
              .field("mimeType", String.self),
              .field("blobId", String.self),
              .field("chunkSize", NotaGraphQL.SafeInt.self),
              .field("error", String?.self),
              .field("status", GraphQLEnum<NotaGraphQL.ContextEmbedStatus>.self),
              .field("createdAt", NotaGraphQL.SafeInt.self),
            ] }

            public var id: NotaGraphQL.ID { __data["id"] }
            public var name: String { __data["name"] }
            public var mimeType: String { __data["mimeType"] }
            public var blobId: String { __data["blobId"] }
            public var chunkSize: NotaGraphQL.SafeInt { __data["chunkSize"] }
            public var error: String? { __data["error"] }
            public var status: GraphQLEnum<NotaGraphQL.ContextEmbedStatus> { __data["status"] }
            public var createdAt: NotaGraphQL.SafeInt { __data["createdAt"] }
          }

          /// CurrentUser.Copilot.Context.Tag
          ///
          /// Parent Type: `CopilotContextCategory`
          public struct Tag: NotaGraphQL.SelectionSet {
            public let __data: DataDict
            public init(_dataDict: DataDict) { __data = _dataDict }

            public static var __parentType: any ApolloAPI.ParentType { NotaGraphQL.Objects.CopilotContextCategory }
            public static var __selections: [ApolloAPI.Selection] { [
              .field("__typename", String.self),
              .field("type", GraphQLEnum<NotaGraphQL.ContextCategories>.self),
              .field("id", NotaGraphQL.ID.self),
              .field("docs", [Doc].self),
              .field("createdAt", NotaGraphQL.SafeInt.self),
            ] }

            public var type: GraphQLEnum<NotaGraphQL.ContextCategories> { __data["type"] }
            public var id: NotaGraphQL.ID { __data["id"] }
            public var docs: [Doc] { __data["docs"] }
            public var createdAt: NotaGraphQL.SafeInt { __data["createdAt"] }

            /// CurrentUser.Copilot.Context.Tag.Doc
            ///
            /// Parent Type: `CopilotContextDoc`
            public struct Doc: NotaGraphQL.SelectionSet {
              public let __data: DataDict
              public init(_dataDict: DataDict) { __data = _dataDict }

              public static var __parentType: any ApolloAPI.ParentType { NotaGraphQL.Objects.CopilotContextDoc }
              public static var __selections: [ApolloAPI.Selection] { [
                .field("__typename", String.self),
                .field("id", NotaGraphQL.ID.self),
                .field("status", GraphQLEnum<NotaGraphQL.ContextEmbedStatus>?.self),
                .field("createdAt", NotaGraphQL.SafeInt.self),
              ] }

              public var id: NotaGraphQL.ID { __data["id"] }
              public var status: GraphQLEnum<NotaGraphQL.ContextEmbedStatus>? { __data["status"] }
              public var createdAt: NotaGraphQL.SafeInt { __data["createdAt"] }
            }
          }

          /// CurrentUser.Copilot.Context.Collection
          ///
          /// Parent Type: `CopilotContextCategory`
          public struct Collection: NotaGraphQL.SelectionSet {
            public let __data: DataDict
            public init(_dataDict: DataDict) { __data = _dataDict }

            public static var __parentType: any ApolloAPI.ParentType { NotaGraphQL.Objects.CopilotContextCategory }
            public static var __selections: [ApolloAPI.Selection] { [
              .field("__typename", String.self),
              .field("type", GraphQLEnum<NotaGraphQL.ContextCategories>.self),
              .field("id", NotaGraphQL.ID.self),
              .field("docs", [Doc].self),
              .field("createdAt", NotaGraphQL.SafeInt.self),
            ] }

            public var type: GraphQLEnum<NotaGraphQL.ContextCategories> { __data["type"] }
            public var id: NotaGraphQL.ID { __data["id"] }
            public var docs: [Doc] { __data["docs"] }
            public var createdAt: NotaGraphQL.SafeInt { __data["createdAt"] }

            /// CurrentUser.Copilot.Context.Collection.Doc
            ///
            /// Parent Type: `CopilotContextDoc`
            public struct Doc: NotaGraphQL.SelectionSet {
              public let __data: DataDict
              public init(_dataDict: DataDict) { __data = _dataDict }

              public static var __parentType: any ApolloAPI.ParentType { NotaGraphQL.Objects.CopilotContextDoc }
              public static var __selections: [ApolloAPI.Selection] { [
                .field("__typename", String.self),
                .field("id", NotaGraphQL.ID.self),
                .field("status", GraphQLEnum<NotaGraphQL.ContextEmbedStatus>?.self),
                .field("createdAt", NotaGraphQL.SafeInt.self),
              ] }

              public var id: NotaGraphQL.ID { __data["id"] }
              public var status: GraphQLEnum<NotaGraphQL.ContextEmbedStatus>? { __data["status"] }
              public var createdAt: NotaGraphQL.SafeInt { __data["createdAt"] }
            }
          }
        }
      }
    }
  }
}
