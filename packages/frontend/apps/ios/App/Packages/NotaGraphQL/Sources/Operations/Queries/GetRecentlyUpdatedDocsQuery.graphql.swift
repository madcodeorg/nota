// @generated
// This file was automatically generated and should not be edited.

@_exported import ApolloAPI

public class GetRecentlyUpdatedDocsQuery: GraphQLQuery {
  public static let operationName: String = "getRecentlyUpdatedDocs"
  public static let operationDocument: ApolloAPI.OperationDocument = .init(
    definition: .init(
      #"query getRecentlyUpdatedDocs($workspaceId: String!, $pagination: PaginationInput!) { workspace(id: $workspaceId) { __typename recentlyUpdatedDocs(pagination: $pagination) { __typename totalCount pageInfo { __typename endCursor hasNextPage } edges { __typename node { __typename id title createdAt updatedAt creatorId lastUpdaterId } } } } }"#
    ))

  public var workspaceId: String
  public var pagination: PaginationInput

  public init(
    workspaceId: String,
    pagination: PaginationInput
  ) {
    self.workspaceId = workspaceId
    self.pagination = pagination
  }

  public var __variables: Variables? { [
    "workspaceId": workspaceId,
    "pagination": pagination
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
        .field("recentlyUpdatedDocs", RecentlyUpdatedDocs.self, arguments: ["pagination": .variable("pagination")]),
      ] }

      /// Get recently updated docs of a workspace
      public var recentlyUpdatedDocs: RecentlyUpdatedDocs { __data["recentlyUpdatedDocs"] }

      /// Workspace.RecentlyUpdatedDocs
      ///
      /// Parent Type: `PaginatedDocType`
      public struct RecentlyUpdatedDocs: NotaGraphQL.SelectionSet {
        public let __data: DataDict
        public init(_dataDict: DataDict) { __data = _dataDict }

        public static var __parentType: any ApolloAPI.ParentType { NotaGraphQL.Objects.PaginatedDocType }
        public static var __selections: [ApolloAPI.Selection] { [
          .field("__typename", String.self),
          .field("totalCount", Int.self),
          .field("pageInfo", PageInfo.self),
          .field("edges", [Edge].self),
        ] }

        public var totalCount: Int { __data["totalCount"] }
        public var pageInfo: PageInfo { __data["pageInfo"] }
        public var edges: [Edge] { __data["edges"] }

        /// Workspace.RecentlyUpdatedDocs.PageInfo
        ///
        /// Parent Type: `PageInfo`
        public struct PageInfo: NotaGraphQL.SelectionSet {
          public let __data: DataDict
          public init(_dataDict: DataDict) { __data = _dataDict }

          public static var __parentType: any ApolloAPI.ParentType { NotaGraphQL.Objects.PageInfo }
          public static var __selections: [ApolloAPI.Selection] { [
            .field("__typename", String.self),
            .field("endCursor", String?.self),
            .field("hasNextPage", Bool.self),
          ] }

          public var endCursor: String? { __data["endCursor"] }
          public var hasNextPage: Bool { __data["hasNextPage"] }
        }

        /// Workspace.RecentlyUpdatedDocs.Edge
        ///
        /// Parent Type: `DocTypeEdge`
        public struct Edge: NotaGraphQL.SelectionSet {
          public let __data: DataDict
          public init(_dataDict: DataDict) { __data = _dataDict }

          public static var __parentType: any ApolloAPI.ParentType { NotaGraphQL.Objects.DocTypeEdge }
          public static var __selections: [ApolloAPI.Selection] { [
            .field("__typename", String.self),
            .field("node", Node.self),
          ] }

          public var node: Node { __data["node"] }

          /// Workspace.RecentlyUpdatedDocs.Edge.Node
          ///
          /// Parent Type: `DocType`
          public struct Node: NotaGraphQL.SelectionSet {
            public let __data: DataDict
            public init(_dataDict: DataDict) { __data = _dataDict }

            public static var __parentType: any ApolloAPI.ParentType { NotaGraphQL.Objects.DocType }
            public static var __selections: [ApolloAPI.Selection] { [
              .field("__typename", String.self),
              .field("id", String.self),
              .field("title", String?.self),
              .field("createdAt", NotaGraphQL.DateTime?.self),
              .field("updatedAt", NotaGraphQL.DateTime?.self),
              .field("creatorId", String?.self),
              .field("lastUpdaterId", String?.self),
            ] }

            public var id: String { __data["id"] }
            public var title: String? { __data["title"] }
            public var createdAt: NotaGraphQL.DateTime? { __data["createdAt"] }
            public var updatedAt: NotaGraphQL.DateTime? { __data["updatedAt"] }
            public var creatorId: String? { __data["creatorId"] }
            public var lastUpdaterId: String? { __data["lastUpdaterId"] }
          }
        }
      }
    }
  }
}
