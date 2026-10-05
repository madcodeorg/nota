// @generated
// This file was automatically generated and should not be edited.

@_exported import ApolloAPI

public class GetUserFeaturesQuery: GraphQLQuery {
  public static let operationName: String = "getUserFeatures"
  public static let operationDocument: ApolloAPI.OperationDocument = .init(
    definition: .init(
      #"query getUserFeatures { currentUser { __typename id features } }"#
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
        .field("id", NotaGraphQL.ID.self),
        .field("features", [GraphQLEnum<NotaGraphQL.FeatureType>].self),
      ] }

      public var id: NotaGraphQL.ID { __data["id"] }
      /// Enabled features of a user
      public var features: [GraphQLEnum<NotaGraphQL.FeatureType>] { __data["features"] }
    }
  }
}
