// @generated
// This file was automatically generated and should not be edited.

@_exported import ApolloAPI

public class ListHistoryQuery: GraphQLQuery {
  public static let operationName: String = "listHistory"
  public static let operationDocument: ApolloAPI.OperationDocument = .init(
    definition: .init(
      #"query listHistory($workspaceId: String!, $pageDocId: String!, $take: Int, $before: DateTime) { workspace(id: $workspaceId) { __typename histories(guid: $pageDocId, take: $take, before: $before) { __typename id timestamp editor { __typename name avatarUrl } } } }"#
    ))

  public var workspaceId: String
  public var pageDocId: String
  public var take: GraphQLNullable<Int>
  public var before: GraphQLNullable<DateTime>

  public init(
    workspaceId: String,
    pageDocId: String,
    take: GraphQLNullable<Int>,
    before: GraphQLNullable<DateTime>
  ) {
    self.workspaceId = workspaceId
    self.pageDocId = pageDocId
    self.take = take
    self.before = before
  }

  public var __variables: Variables? { [
    "workspaceId": workspaceId,
    "pageDocId": pageDocId,
    "take": take,
    "before": before
  ] }

  public struct Data: NotaGraphQL.SelectionSet {
    public let __data: DataDict
    public init(_dataDict: DataDict) { __data = _dataDict }

    public static var __parentType: any ApolloAPI.ParentType { NotaGraphQL.Objects.Query }
    public static var __selections: [ApolloAPI.Selection] { [
      .field("workspace", Workspace.self, arguments: ["id": .variable("workspaceId")]),
    ] }

    /// Get workspace by id
    public var workspace: Workspace { __data["workspace"] }

    /// Workspace
    ///
    /// Parent Type: `WorkspaceType`
    public struct Workspace: NotaGraphQL.SelectionSet {
      public let __data: DataDict
      public init(_dataDict: DataDict) { __data = _dataDict }

      public static var __parentType: any ApolloAPI.ParentType { NotaGraphQL.Objects.WorkspaceType }
      public static var __selections: [ApolloAPI.Selection] { [
        .field("__typename", String.self),
        .field("histories", [History].self, arguments: [
          "guid": .variable("pageDocId"),
          "take": .variable("take"),
          "before": .variable("before")
        ]),
      ] }

      public var histories: [History] { __data["histories"] }

      /// Workspace.History
      ///
      /// Parent Type: `DocHistoryType`
      public struct History: NotaGraphQL.SelectionSet {
        public let __data: DataDict
        public init(_dataDict: DataDict) { __data = _dataDict }

        public static var __parentType: any ApolloAPI.ParentType { NotaGraphQL.Objects.DocHistoryType }
        public static var __selections: [ApolloAPI.Selection] { [
          .field("__typename", String.self),
          .field("id", String.self),
          .field("timestamp", NotaGraphQL.DateTime.self),
          .field("editor", Editor?.self),
        ] }

        public var id: String { __data["id"] }
        public var timestamp: NotaGraphQL.DateTime { __data["timestamp"] }
        public var editor: Editor? { __data["editor"] }

        /// Workspace.History.Editor
        ///
        /// Parent Type: `EditorType`
        public struct Editor: NotaGraphQL.SelectionSet {
          public let __data: DataDict
          public init(_dataDict: DataDict) { __data = _dataDict }

          public static var __parentType: any ApolloAPI.ParentType { NotaGraphQL.Objects.EditorType }
          public static var __selections: [ApolloAPI.Selection] { [
            .field("__typename", String.self),
            .field("name", String.self),
            .field("avatarUrl", String?.self),
          ] }

          public var name: String { __data["name"] }
          public var avatarUrl: String? { __data["avatarUrl"] }
        }
      }
    }
  }
}
