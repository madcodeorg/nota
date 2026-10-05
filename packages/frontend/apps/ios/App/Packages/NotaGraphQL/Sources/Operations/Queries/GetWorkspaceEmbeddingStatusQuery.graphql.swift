// @generated
// This file was automatically generated and should not be edited.

@_exported import ApolloAPI

public class GetWorkspaceEmbeddingStatusQuery: GraphQLQuery {
  public static let operationName: String = "getWorkspaceEmbeddingStatus"
  public static let operationDocument: ApolloAPI.OperationDocument = .init(
    definition: .init(
      #"query getWorkspaceEmbeddingStatus($workspaceId: String!) { queryWorkspaceEmbeddingStatus(workspaceId: $workspaceId) { __typename total embedded } }"#
    ))

  public var workspaceId: String

  public init(workspaceId: String) {
    self.workspaceId = workspaceId
  }

  public var __variables: Variables? { ["workspaceId": workspaceId] }

  public struct Data: NotaGraphQL.SelectionSet {
    public let __data: DataDict
    public init(_dataDict: DataDict) { __data = _dataDict }

    public static var __parentType: any ApolloAPI.ParentType { NotaGraphQL.Objects.Query }
    public static var __selections: [ApolloAPI.Selection] { [
      .field("queryWorkspaceEmbeddingStatus", QueryWorkspaceEmbeddingStatus.self, arguments: ["workspaceId": .variable("workspaceId")]),
    ] }

    /// query workspace embedding status
    public var queryWorkspaceEmbeddingStatus: QueryWorkspaceEmbeddingStatus { __data["queryWorkspaceEmbeddingStatus"] }

    /// QueryWorkspaceEmbeddingStatus
    ///
    /// Parent Type: `ContextWorkspaceEmbeddingStatus`
    public struct QueryWorkspaceEmbeddingStatus: NotaGraphQL.SelectionSet {
      public let __data: DataDict
      public init(_dataDict: DataDict) { __data = _dataDict }

      public static var __parentType: any ApolloAPI.ParentType { NotaGraphQL.Objects.ContextWorkspaceEmbeddingStatus }
      public static var __selections: [ApolloAPI.Selection] { [
        .field("__typename", String.self),
        .field("total", NotaGraphQL.SafeInt.self),
        .field("embedded", NotaGraphQL.SafeInt.self),
      ] }

      public var total: NotaGraphQL.SafeInt { __data["total"] }
      public var embedded: NotaGraphQL.SafeInt { __data["embedded"] }
    }
  }
}
