// @generated
// This file was automatically generated and should not be edited.

@_exported import ApolloAPI

public struct LicenseBody: NotaGraphQL.SelectionSet, Fragment {
  public static var fragmentDefinition: StaticString {
    #"fragment licenseBody on License { __typename expiredAt installedAt quantity recurring validatedAt variant }"#
  }

  public let __data: DataDict
  public init(_dataDict: DataDict) { __data = _dataDict }

  public static var __parentType: any ApolloAPI.ParentType { NotaGraphQL.Objects.License }
  public static var __selections: [ApolloAPI.Selection] { [
    .field("__typename", String.self),
    .field("expiredAt", NotaGraphQL.DateTime?.self),
    .field("installedAt", NotaGraphQL.DateTime.self),
    .field("quantity", Int.self),
    .field("recurring", GraphQLEnum<NotaGraphQL.SubscriptionRecurring>.self),
    .field("validatedAt", NotaGraphQL.DateTime.self),
    .field("variant", GraphQLEnum<NotaGraphQL.SubscriptionVariant>?.self),
  ] }

  public var expiredAt: NotaGraphQL.DateTime? { __data["expiredAt"] }
  public var installedAt: NotaGraphQL.DateTime { __data["installedAt"] }
  public var quantity: Int { __data["quantity"] }
  public var recurring: GraphQLEnum<NotaGraphQL.SubscriptionRecurring> { __data["recurring"] }
  public var validatedAt: NotaGraphQL.DateTime { __data["validatedAt"] }
  public var variant: GraphQLEnum<NotaGraphQL.SubscriptionVariant>? { __data["variant"] }
}
