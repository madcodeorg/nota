// @generated
// This file was automatically generated and should not be edited.

@_exported import ApolloAPI

public class CreateCommentMutation: GraphQLMutation {
  public static let operationName: String = "createComment"
  public static let operationDocument: ApolloAPI.OperationDocument = .init(
    definition: .init(
      #"mutation createComment($input: CommentCreateInput!) { createComment(input: $input) { __typename id content resolved createdAt updatedAt user { __typename id name avatarUrl } replies { __typename commentId id content createdAt updatedAt user { __typename id name avatarUrl } } } }"#
    ))

  public var input: CommentCreateInput

  public init(input: CommentCreateInput) {
    self.input = input
  }

  public var __variables: Variables? { ["input": input] }

  public struct Data: NotaGraphQL.SelectionSet {
    public let __data: DataDict
    public init(_dataDict: DataDict) { __data = _dataDict }

    public static var __parentType: any ApolloAPI.ParentType { NotaGraphQL.Objects.Mutation }
    public static var __selections: [ApolloAPI.Selection] { [
      .field("createComment", CreateComment.self, arguments: ["input": .variable("input")]),
    ] }

    public var createComment: CreateComment { __data["createComment"] }

    /// CreateComment
    ///
    /// Parent Type: `CommentObjectType`
    public struct CreateComment: NotaGraphQL.SelectionSet {
      public let __data: DataDict
      public init(_dataDict: DataDict) { __data = _dataDict }

      public static var __parentType: any ApolloAPI.ParentType { NotaGraphQL.Objects.CommentObjectType }
      public static var __selections: [ApolloAPI.Selection] { [
        .field("__typename", String.self),
        .field("id", NotaGraphQL.ID.self),
        .field("content", NotaGraphQL.JSONObject.self),
        .field("resolved", Bool.self),
        .field("createdAt", NotaGraphQL.DateTime.self),
        .field("updatedAt", NotaGraphQL.DateTime.self),
        .field("user", User.self),
        .field("replies", [Reply].self),
      ] }

      public var id: NotaGraphQL.ID { __data["id"] }
      /// The content of the comment
      public var content: NotaGraphQL.JSONObject { __data["content"] }
      /// Whether the comment is resolved
      public var resolved: Bool { __data["resolved"] }
      /// The created at time of the comment
      public var createdAt: NotaGraphQL.DateTime { __data["createdAt"] }
      /// The updated at time of the comment
      public var updatedAt: NotaGraphQL.DateTime { __data["updatedAt"] }
      /// The user who created the comment
      public var user: User { __data["user"] }
      /// The replies of the comment
      public var replies: [Reply] { __data["replies"] }

      /// CreateComment.User
      ///
      /// Parent Type: `PublicUserType`
      public struct User: NotaGraphQL.SelectionSet {
        public let __data: DataDict
        public init(_dataDict: DataDict) { __data = _dataDict }

        public static var __parentType: any ApolloAPI.ParentType { NotaGraphQL.Objects.PublicUserType }
        public static var __selections: [ApolloAPI.Selection] { [
          .field("__typename", String.self),
          .field("id", String.self),
          .field("name", String.self),
          .field("avatarUrl", String?.self),
        ] }

        public var id: String { __data["id"] }
        public var name: String { __data["name"] }
        public var avatarUrl: String? { __data["avatarUrl"] }
      }

      /// CreateComment.Reply
      ///
      /// Parent Type: `ReplyObjectType`
      public struct Reply: NotaGraphQL.SelectionSet {
        public let __data: DataDict
        public init(_dataDict: DataDict) { __data = _dataDict }

        public static var __parentType: any ApolloAPI.ParentType { NotaGraphQL.Objects.ReplyObjectType }
        public static var __selections: [ApolloAPI.Selection] { [
          .field("__typename", String.self),
          .field("commentId", NotaGraphQL.ID.self),
          .field("id", NotaGraphQL.ID.self),
          .field("content", NotaGraphQL.JSONObject.self),
          .field("createdAt", NotaGraphQL.DateTime.self),
          .field("updatedAt", NotaGraphQL.DateTime.self),
          .field("user", User.self),
        ] }

        public var commentId: NotaGraphQL.ID { __data["commentId"] }
        public var id: NotaGraphQL.ID { __data["id"] }
        /// The content of the reply
        public var content: NotaGraphQL.JSONObject { __data["content"] }
        /// The created at time of the reply
        public var createdAt: NotaGraphQL.DateTime { __data["createdAt"] }
        /// The updated at time of the reply
        public var updatedAt: NotaGraphQL.DateTime { __data["updatedAt"] }
        /// The user who created the reply
        public var user: User { __data["user"] }

        /// CreateComment.Reply.User
        ///
        /// Parent Type: `PublicUserType`
        public struct User: NotaGraphQL.SelectionSet {
          public let __data: DataDict
          public init(_dataDict: DataDict) { __data = _dataDict }

          public static var __parentType: any ApolloAPI.ParentType { NotaGraphQL.Objects.PublicUserType }
          public static var __selections: [ApolloAPI.Selection] { [
            .field("__typename", String.self),
            .field("id", String.self),
            .field("name", String.self),
            .field("avatarUrl", String?.self),
          ] }

          public var id: String { __data["id"] }
          public var name: String { __data["name"] }
          public var avatarUrl: String? { __data["avatarUrl"] }
        }
      }
    }
  }
}
