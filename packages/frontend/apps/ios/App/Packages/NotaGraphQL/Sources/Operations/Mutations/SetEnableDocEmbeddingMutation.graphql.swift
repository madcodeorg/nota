// @generated
// This file was automatically generated and should not be edited.

@_exported import ApolloAPI

public class SetEnableDocEmbeddingMutation: GraphQLMutation {
  public static let operationName: String = "setEnableDocEmbedding"
  public static let operationDocument: ApolloAPI.OperationDocument = .init(
    definition: .init(
      #"mutation setEnableDocEmbedding($id: ID!, $enableDocEmbedding: Boolean!) { updateWorkspace(input: { id: $id, enableDocEmbedding: $enableDocEmbedding }) { __typename id } }"#
    ))

  public var id: ID
  public var enableDocEmbedding: Bool

  public init(
    id: ID,
    enableDocEmbedding: Bool
  ) {
    self.id = id
    self.enableDocEmbedding = enableDocEmbedding
  }

  public var __variables: Variables? { [
    "id": id,
    "enableDocEmbedding": enableDocEmbedding
  ] }

  public struct Data: NotaGraphQL.SelectionSet {
    public let __data: DataDict
    public init(_dataDict: DataDict) { __data = _dataDict }

    public static var __parentType: any ApolloAPI.ParentType { NotaGraphQL.Objects.Mutation }
    public static var __selections: [ApolloAPI.Selection] { [
      .field("updateWorkspace", UpdateWorkspace.self, arguments: ["input": [
        "id": .variable("id"),
        "enableDocEmbedding": .variable("enableDocEmbedding")
      ]]),
    ] }

    /// Update workspace
    public var updateWorkspace: UpdateWorkspace { __data["updateWorkspace"] }

    /// UpdateWorkspace
    ///
    /// Parent Type: `WorkspaceType`
    public struct UpdateWorkspace: NotaGraphQL.SelectionSet {
      public let __data: DataDict
      public init(_dataDict: DataDict) { __data = _dataDict }

      public static var __parentType: any ApolloAPI.ParentType { NotaGraphQL.Objects.WorkspaceType }
      public static var __selections: [ApolloAPI.Selection] { [
        .field("__typename", String.self),
        .field("id", NotaGraphQL.ID.self),
      ] }

      public var id: NotaGraphQL.ID { __data["id"] }
    }
  }
}
