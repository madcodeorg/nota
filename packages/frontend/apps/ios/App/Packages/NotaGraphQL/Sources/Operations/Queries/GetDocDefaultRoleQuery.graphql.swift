// @generated
// This file was automatically generated and should not be edited.

@_exported import ApolloAPI

public class GetDocDefaultRoleQuery: GraphQLQuery {
  public static let operationName: String = "getDocDefaultRole"
  public static let operationDocument: ApolloAPI.OperationDocument = .init(
    definition: .init(
      #"query getDocDefaultRole($workspaceId: String!, $docId: String!) { workspace(id: $workspaceId) { __typename doc(docId: $docId) { __typename defaultRole } } }"#
    ))

  public var workspaceId: String
  public var docId: String

  public init(
    workspaceId: String,
    docId: String
  ) {
    self.workspaceId = workspaceId
    self.docId = docId
  }

  public var __variables: Variables? { [
    "workspaceId": workspaceId,
    "docId": docId
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
        .field("doc", Doc.self, arguments: ["docId": .variable("docId")]),
      ] }

      /// Get get with given id
      public var doc: Doc { __data["doc"] }

      /// Workspace.Doc
      ///
      /// Parent Type: `DocType`
      public struct Doc: NotaGraphQL.SelectionSet {
        public let __data: DataDict
        public init(_dataDict: DataDict) { __data = _dataDict }

        public static var __parentType: any ApolloAPI.ParentType { NotaGraphQL.Objects.DocType }
        public static var __selections: [ApolloAPI.Selection] { [
          .field("__typename", String.self),
          .field("defaultRole", GraphQLEnum<NotaGraphQL.DocRole>.self),
        ] }

        public var defaultRole: GraphQLEnum<NotaGraphQL.DocRole> { __data["defaultRole"] }
      }
    }
  }
}
