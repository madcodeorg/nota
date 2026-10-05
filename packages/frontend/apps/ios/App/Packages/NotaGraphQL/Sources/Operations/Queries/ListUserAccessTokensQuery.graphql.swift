// @generated
// This file was automatically generated and should not be edited.

@_exported import ApolloAPI

public class ListUserAccessTokensQuery: GraphQLQuery {
  public static let operationName: String = "listUserAccessTokens"
  public static let operationDocument: ApolloAPI.OperationDocument = .init(
    definition: .init(
      #"query listUserAccessTokens { currentUser { __typename revealedAccessTokens { __typename id name createdAt expiresAt token } } }"#
    ))

  public init() {}

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
        .field("revealedAccessTokens", [RevealedAccessToken].self),
      ] }

      public var revealedAccessTokens: [RevealedAccessToken] { __data["revealedAccessTokens"] }

      /// CurrentUser.RevealedAccessToken
      ///
      /// Parent Type: `RevealedAccessToken`
      public struct RevealedAccessToken: NotaGraphQL.SelectionSet {
        public let __data: DataDict
        public init(_dataDict: DataDict) { __data = _dataDict }

        public static var __parentType: any ApolloAPI.ParentType { NotaGraphQL.Objects.RevealedAccessToken }
        public static var __selections: [ApolloAPI.Selection] { [
          .field("__typename", String.self),
          .field("id", String.self),
          .field("name", String.self),
          .field("createdAt", NotaGraphQL.DateTime.self),
          .field("expiresAt", NotaGraphQL.DateTime?.self),
          .field("token", String.self),
        ] }

        public var id: String { __data["id"] }
        public var name: String { __data["name"] }
        public var createdAt: NotaGraphQL.DateTime { __data["createdAt"] }
        public var expiresAt: NotaGraphQL.DateTime? { __data["expiresAt"] }
        public var token: String { __data["token"] }
      }
    }
  }
}
