// @generated
// This file was automatically generated and should not be edited.

@_exported import ApolloAPI

public class GetMembersByWorkspaceIdQuery: GraphQLQuery {
  public static let operationName: String = "getMembersByWorkspaceId"
  public static let operationDocument: ApolloAPI.OperationDocument = .init(
    definition: .init(
      #"query getMembersByWorkspaceId($workspaceId: String!, $skip: Int, $take: Int, $query: String) { workspace(id: $workspaceId) { __typename memberCount members(skip: $skip, take: $take, query: $query) { __typename id name email avatarUrl permission inviteId emailVerified status } } }"#
    ))

  public var workspaceId: String
  public var skip: GraphQLNullable<Int>
  public var take: GraphQLNullable<Int>
  public var query: GraphQLNullable<String>

  public init(
    workspaceId: String,
    skip: GraphQLNullable<Int>,
    take: GraphQLNullable<Int>,
    query: GraphQLNullable<String>
  ) {
    self.workspaceId = workspaceId
    self.skip = skip
    self.take = take
    self.query = query
  }

  public var __variables: Variables? { [
    "workspaceId": workspaceId,
    "skip": skip,
    "take": take,
    "query": query
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
        .field("memberCount", Int.self),
        .field("members", [Member].self, arguments: [
          "skip": .variable("skip"),
          "take": .variable("take"),
          "query": .variable("query")
        ]),
      ] }

      /// member count of workspace
      public var memberCount: Int { __data["memberCount"] }
      /// Members of workspace
      public var members: [Member] { __data["members"] }

      /// Workspace.Member
      ///
      /// Parent Type: `InviteUserType`
      public struct Member: NotaGraphQL.SelectionSet {
        public let __data: DataDict
        public init(_dataDict: DataDict) { __data = _dataDict }

        public static var __parentType: any ApolloAPI.ParentType { NotaGraphQL.Objects.InviteUserType }
        public static var __selections: [ApolloAPI.Selection] { [
          .field("__typename", String.self),
          .field("id", NotaGraphQL.ID.self),
          .field("name", String?.self),
          .field("email", String?.self),
          .field("avatarUrl", String?.self),
          .field("permission", GraphQLEnum<NotaGraphQL.Permission>.self),
          .field("inviteId", String.self),
          .field("emailVerified", Bool?.self),
          .field("status", GraphQLEnum<NotaGraphQL.WorkspaceMemberStatus>.self),
        ] }

        public var id: NotaGraphQL.ID { __data["id"] }
        /// User name
        public var name: String? { __data["name"] }
        /// User email
        public var email: String? { __data["email"] }
        /// User avatar url
        public var avatarUrl: String? { __data["avatarUrl"] }
        /// User permission in workspace
        @available(*, deprecated, message: "Use role instead")
        public var permission: GraphQLEnum<NotaGraphQL.Permission> { __data["permission"] }
        /// Invite id
        public var inviteId: String { __data["inviteId"] }
        /// User email verified
        public var emailVerified: Bool? { __data["emailVerified"] }
        /// Member invite status in workspace
        public var status: GraphQLEnum<NotaGraphQL.WorkspaceMemberStatus> { __data["status"] }
      }
    }
  }
}
