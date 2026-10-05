// @generated
// This file was automatically generated and should not be edited.

@_exported import ApolloAPI

public class WorkspaceQuotaQuery: GraphQLQuery {
  public static let operationName: String = "workspaceQuota"
  public static let operationDocument: ApolloAPI.OperationDocument = .init(
    definition: .init(
      #"query workspaceQuota($id: String!) { workspace(id: $id) { __typename quota { __typename name blobLimit storageQuota usedStorageQuota historyPeriod memberLimit memberCount overcapacityMemberCount humanReadable { __typename name blobLimit storageQuota historyPeriod memberLimit memberCount overcapacityMemberCount } } } }"#
    ))

  public var id: String

  public init(id: String) {
    self.id = id
  }

  public var __variables: Variables? { ["id": id] }

  public struct Data: NotaGraphQL.SelectionSet {
    public let __data: DataDict
    public init(_dataDict: DataDict) { __data = _dataDict }

    public static var __parentType: any ApolloAPI.ParentType { NotaGraphQL.Objects.Query }
    public static var __selections: [ApolloAPI.Selection] { [
      .field("workspace", Workspace.self, arguments: ["id": .variable("id")]),
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
        .field("quota", Quota.self),
      ] }

      /// quota of workspace
      public var quota: Quota { __data["quota"] }

      /// Workspace.Quota
      ///
      /// Parent Type: `WorkspaceQuotaType`
      public struct Quota: NotaGraphQL.SelectionSet {
        public let __data: DataDict
        public init(_dataDict: DataDict) { __data = _dataDict }

        public static var __parentType: any ApolloAPI.ParentType { NotaGraphQL.Objects.WorkspaceQuotaType }
        public static var __selections: [ApolloAPI.Selection] { [
          .field("__typename", String.self),
          .field("name", String.self),
          .field("blobLimit", NotaGraphQL.SafeInt.self),
          .field("storageQuota", NotaGraphQL.SafeInt.self),
          .field("usedStorageQuota", NotaGraphQL.SafeInt.self),
          .field("historyPeriod", NotaGraphQL.SafeInt.self),
          .field("memberLimit", Int.self),
          .field("memberCount", Int.self),
          .field("overcapacityMemberCount", Int.self),
          .field("humanReadable", HumanReadable.self),
        ] }

        public var name: String { __data["name"] }
        public var blobLimit: NotaGraphQL.SafeInt { __data["blobLimit"] }
        public var storageQuota: NotaGraphQL.SafeInt { __data["storageQuota"] }
        public var usedStorageQuota: NotaGraphQL.SafeInt { __data["usedStorageQuota"] }
        public var historyPeriod: NotaGraphQL.SafeInt { __data["historyPeriod"] }
        public var memberLimit: Int { __data["memberLimit"] }
        public var memberCount: Int { __data["memberCount"] }
        public var overcapacityMemberCount: Int { __data["overcapacityMemberCount"] }
        public var humanReadable: HumanReadable { __data["humanReadable"] }

        /// Workspace.Quota.HumanReadable
        ///
        /// Parent Type: `WorkspaceQuotaHumanReadableType`
        public struct HumanReadable: NotaGraphQL.SelectionSet {
          public let __data: DataDict
          public init(_dataDict: DataDict) { __data = _dataDict }

          public static var __parentType: any ApolloAPI.ParentType { NotaGraphQL.Objects.WorkspaceQuotaHumanReadableType }
          public static var __selections: [ApolloAPI.Selection] { [
            .field("__typename", String.self),
            .field("name", String.self),
            .field("blobLimit", String.self),
            .field("storageQuota", String.self),
            .field("historyPeriod", String.self),
            .field("memberLimit", String.self),
            .field("memberCount", String.self),
            .field("overcapacityMemberCount", String.self),
          ] }

          public var name: String { __data["name"] }
          public var blobLimit: String { __data["blobLimit"] }
          public var storageQuota: String { __data["storageQuota"] }
          public var historyPeriod: String { __data["historyPeriod"] }
          public var memberLimit: String { __data["memberLimit"] }
          public var memberCount: String { __data["memberCount"] }
          public var overcapacityMemberCount: String { __data["overcapacityMemberCount"] }
        }
      }
    }
  }
}
