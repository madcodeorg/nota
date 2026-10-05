// @generated
// This file was automatically generated and should not be edited.

@_exported import ApolloAPI

public class ActivateLicenseMutation: GraphQLMutation {
  public static let operationName: String = "activateLicense"
  public static let operationDocument: ApolloAPI.OperationDocument = .init(
    definition: .init(
      #"mutation activateLicense($workspaceId: String!, $license: String!) { activateLicense(workspaceId: $workspaceId, license: $license) { __typename ...licenseBody } }"#,
      fragments: [LicenseBody.self]
    ))

  public var workspaceId: String
  public var license: String

  public init(
    workspaceId: String,
    license: String
  ) {
    self.workspaceId = workspaceId
    self.license = license
  }

  public var __variables: Variables? { [
    "workspaceId": workspaceId,
    "license": license
  ] }

  public struct Data: NotaGraphQL.SelectionSet {
    public let __data: DataDict
    public init(_dataDict: DataDict) { __data = _dataDict }

    public static var __parentType: any ApolloAPI.ParentType { NotaGraphQL.Objects.Mutation }
    public static var __selections: [ApolloAPI.Selection] { [
      .field("activateLicense", ActivateLicense.self, arguments: [
        "workspaceId": .variable("workspaceId"),
        "license": .variable("license")
      ]),
    ] }

    public var activateLicense: ActivateLicense { __data["activateLicense"] }

    /// ActivateLicense
    ///
    /// Parent Type: `License`
    public struct ActivateLicense: NotaGraphQL.SelectionSet {
      public let __data: DataDict
      public init(_dataDict: DataDict) { __data = _dataDict }

      public static var __parentType: any ApolloAPI.ParentType { NotaGraphQL.Objects.License }
      public static var __selections: [ApolloAPI.Selection] { [
        .field("__typename", String.self),
        .fragment(LicenseBody.self),
      ] }

      public var expiredAt: NotaGraphQL.DateTime? { __data["expiredAt"] }
      public var installedAt: NotaGraphQL.DateTime { __data["installedAt"] }
      public var quantity: Int { __data["quantity"] }
      public var recurring: GraphQLEnum<NotaGraphQL.SubscriptionRecurring> { __data["recurring"] }
      public var validatedAt: NotaGraphQL.DateTime { __data["validatedAt"] }
      public var variant: GraphQLEnum<NotaGraphQL.SubscriptionVariant>? { __data["variant"] }

      public struct Fragments: FragmentContainer {
        public let __data: DataDict
        public init(_dataDict: DataDict) { __data = _dataDict }

        public var licenseBody: LicenseBody { _toFragment() }
      }
    }
  }
}
