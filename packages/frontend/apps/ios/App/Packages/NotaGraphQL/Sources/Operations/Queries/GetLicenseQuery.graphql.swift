// @generated
// This file was automatically generated and should not be edited.

@_exported import ApolloAPI

public class GetLicenseQuery: GraphQLQuery {
  public static let operationName: String = "getLicense"
  public static let operationDocument: ApolloAPI.OperationDocument = .init(
    definition: .init(
      #"query getLicense($workspaceId: String!) { workspace(id: $workspaceId) { __typename license { __typename ...licenseBody } } }"#,
      fragments: [LicenseBody.self]
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
        .field("license", License?.self),
      ] }

      /// The selfhost license of the workspace
      public var license: License? { __data["license"] }

      /// Workspace.License
      ///
      /// Parent Type: `License`
      public struct License: NotaGraphQL.SelectionSet {
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
}
