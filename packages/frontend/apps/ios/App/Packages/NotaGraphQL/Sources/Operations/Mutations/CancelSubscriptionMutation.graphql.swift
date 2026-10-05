// @generated
// This file was automatically generated and should not be edited.

@_exported import ApolloAPI

public class CancelSubscriptionMutation: GraphQLMutation {
  public static let operationName: String = "cancelSubscription"
  public static let operationDocument: ApolloAPI.OperationDocument = .init(
    definition: .init(
      #"mutation cancelSubscription($plan: SubscriptionPlan = Pro, $workspaceId: String) { cancelSubscription(plan: $plan, workspaceId: $workspaceId) { __typename id status nextBillAt canceledAt } }"#
    ))

  public var plan: GraphQLNullable<GraphQLEnum<SubscriptionPlan>>
  public var workspaceId: GraphQLNullable<String>

  public init(
    plan: GraphQLNullable<GraphQLEnum<SubscriptionPlan>> = .init(.pro),
    workspaceId: GraphQLNullable<String>
  ) {
    self.plan = plan
    self.workspaceId = workspaceId
  }

  public var __variables: Variables? { [
    "plan": plan,
    "workspaceId": workspaceId
  ] }

  public struct Data: NotaGraphQL.SelectionSet {
    public let __data: DataDict
    public init(_dataDict: DataDict) { __data = _dataDict }

    public static var __parentType: any ApolloAPI.ParentType { NotaGraphQL.Objects.Mutation }
    public static var __selections: [ApolloAPI.Selection] { [
      .field("cancelSubscription", CancelSubscription.self, arguments: [
        "plan": .variable("plan"),
        "workspaceId": .variable("workspaceId")
      ]),
    ] }

    public var cancelSubscription: CancelSubscription { __data["cancelSubscription"] }

    /// CancelSubscription
    ///
    /// Parent Type: `SubscriptionType`
    public struct CancelSubscription: NotaGraphQL.SelectionSet {
      public let __data: DataDict
      public init(_dataDict: DataDict) { __data = _dataDict }

      public static var __parentType: any ApolloAPI.ParentType { NotaGraphQL.Objects.SubscriptionType }
      public static var __selections: [ApolloAPI.Selection] { [
        .field("__typename", String.self),
        .field("id", String?.self),
        .field("status", GraphQLEnum<NotaGraphQL.SubscriptionStatus>.self),
        .field("nextBillAt", NotaGraphQL.DateTime?.self),
        .field("canceledAt", NotaGraphQL.DateTime?.self),
      ] }

      @available(*, deprecated, message: "removed")
      public var id: String? { __data["id"] }
      public var status: GraphQLEnum<NotaGraphQL.SubscriptionStatus> { __data["status"] }
      public var nextBillAt: NotaGraphQL.DateTime? { __data["nextBillAt"] }
      public var canceledAt: NotaGraphQL.DateTime? { __data["canceledAt"] }
    }
  }
}
