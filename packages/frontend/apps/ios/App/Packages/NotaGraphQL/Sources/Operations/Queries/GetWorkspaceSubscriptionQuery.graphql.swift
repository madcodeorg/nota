// @generated
// This file was automatically generated and should not be edited.

@_exported import ApolloAPI

public class GetWorkspaceSubscriptionQuery: GraphQLQuery {
  public static let operationName: String = "getWorkspaceSubscription"
  public static let operationDocument: ApolloAPI.OperationDocument = .init(
    definition: .init(
      #"query getWorkspaceSubscription($workspaceId: String!) { workspace(id: $workspaceId) { __typename subscription { __typename id status plan recurring start end nextBillAt canceledAt variant } } }"#
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
        .field("subscription", Subscription?.self),
      ] }

      /// The team subscription of the workspace, if exists.
      public var subscription: Subscription? { __data["subscription"] }

      /// Workspace.Subscription
      ///
      /// Parent Type: `SubscriptionType`
      public struct Subscription: NotaGraphQL.SelectionSet {
        public let __data: DataDict
        public init(_dataDict: DataDict) { __data = _dataDict }

        public static var __parentType: any ApolloAPI.ParentType { NotaGraphQL.Objects.SubscriptionType }
        public static var __selections: [ApolloAPI.Selection] { [
          .field("__typename", String.self),
          .field("id", String?.self),
          .field("status", GraphQLEnum<NotaGraphQL.SubscriptionStatus>.self),
          .field("plan", GraphQLEnum<NotaGraphQL.SubscriptionPlan>.self),
          .field("recurring", GraphQLEnum<NotaGraphQL.SubscriptionRecurring>.self),
          .field("start", NotaGraphQL.DateTime.self),
          .field("end", NotaGraphQL.DateTime?.self),
          .field("nextBillAt", NotaGraphQL.DateTime?.self),
          .field("canceledAt", NotaGraphQL.DateTime?.self),
          .field("variant", GraphQLEnum<NotaGraphQL.SubscriptionVariant>?.self),
        ] }

        @available(*, deprecated, message: "removed")
        public var id: String? { __data["id"] }
        public var status: GraphQLEnum<NotaGraphQL.SubscriptionStatus> { __data["status"] }
        /// The 'Free' plan just exists to be a placeholder and for the type convenience of frontend.
        /// There won't actually be a subscription with plan 'Free'
        public var plan: GraphQLEnum<NotaGraphQL.SubscriptionPlan> { __data["plan"] }
        public var recurring: GraphQLEnum<NotaGraphQL.SubscriptionRecurring> { __data["recurring"] }
        public var start: NotaGraphQL.DateTime { __data["start"] }
        public var end: NotaGraphQL.DateTime? { __data["end"] }
        public var nextBillAt: NotaGraphQL.DateTime? { __data["nextBillAt"] }
        public var canceledAt: NotaGraphQL.DateTime? { __data["canceledAt"] }
        public var variant: GraphQLEnum<NotaGraphQL.SubscriptionVariant>? { __data["variant"] }
      }
    }
  }
}
