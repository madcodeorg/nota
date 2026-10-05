// @generated
// This file was automatically generated and should not be edited.

@_exported import ApolloAPI

public class QuotaQuery: GraphQLQuery {
  public static let operationName: String = "quota"
  public static let operationDocument: ApolloAPI.OperationDocument = .init(
    definition: .init(
      #"query quota { currentUser { __typename id quota { __typename name blobLimit storageQuota historyPeriod memberLimit humanReadable { __typename name blobLimit storageQuota historyPeriod memberLimit } } quotaUsage { __typename storageQuota } } }"#
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
        .field("quota", Quota.self),
        .field("quotaUsage", QuotaUsage.self),
      ] }

      public var id: NotaGraphQL.ID { __data["id"] }
      public var quota: Quota { __data["quota"] }
      public var quotaUsage: QuotaUsage { __data["quotaUsage"] }

      /// CurrentUser.Quota
      ///
      /// Parent Type: `UserQuotaType`
      public struct Quota: NotaGraphQL.SelectionSet {
        public let __data: DataDict
        public init(_dataDict: DataDict) { __data = _dataDict }

        public static var __parentType: any ApolloAPI.ParentType { NotaGraphQL.Objects.UserQuotaType }
        public static var __selections: [ApolloAPI.Selection] { [
          .field("__typename", String.self),
          .field("name", String.self),
          .field("blobLimit", NotaGraphQL.SafeInt.self),
          .field("storageQuota", NotaGraphQL.SafeInt.self),
          .field("historyPeriod", NotaGraphQL.SafeInt.self),
          .field("memberLimit", Int.self),
          .field("humanReadable", HumanReadable.self),
        ] }

        public var name: String { __data["name"] }
        public var blobLimit: NotaGraphQL.SafeInt { __data["blobLimit"] }
        public var storageQuota: NotaGraphQL.SafeInt { __data["storageQuota"] }
        public var historyPeriod: NotaGraphQL.SafeInt { __data["historyPeriod"] }
        public var memberLimit: Int { __data["memberLimit"] }
        public var humanReadable: HumanReadable { __data["humanReadable"] }

        /// CurrentUser.Quota.HumanReadable
        ///
        /// Parent Type: `UserQuotaHumanReadableType`
        public struct HumanReadable: NotaGraphQL.SelectionSet {
          public let __data: DataDict
          public init(_dataDict: DataDict) { __data = _dataDict }

          public static var __parentType: any ApolloAPI.ParentType { NotaGraphQL.Objects.UserQuotaHumanReadableType }
          public static var __selections: [ApolloAPI.Selection] { [
            .field("__typename", String.self),
            .field("name", String.self),
            .field("blobLimit", String.self),
            .field("storageQuota", String.self),
            .field("historyPeriod", String.self),
            .field("memberLimit", String.self),
          ] }

          public var name: String { __data["name"] }
          public var blobLimit: String { __data["blobLimit"] }
          public var storageQuota: String { __data["storageQuota"] }
          public var historyPeriod: String { __data["historyPeriod"] }
          public var memberLimit: String { __data["memberLimit"] }
        }
      }

      /// CurrentUser.QuotaUsage
      ///
      /// Parent Type: `UserQuotaUsageType`
      public struct QuotaUsage: NotaGraphQL.SelectionSet {
        public let __data: DataDict
        public init(_dataDict: DataDict) { __data = _dataDict }

        public static var __parentType: any ApolloAPI.ParentType { NotaGraphQL.Objects.UserQuotaUsageType }
        public static var __selections: [ApolloAPI.Selection] { [
          .field("__typename", String.self),
          .field("storageQuota", NotaGraphQL.SafeInt.self),
        ] }

        @available(*, deprecated, message: "use `UserQuotaType[\'usedStorageQuota\']` instead")
        public var storageQuota: NotaGraphQL.SafeInt { __data["storageQuota"] }
      }
    }
  }
}
