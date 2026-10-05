// @generated
// This file was automatically generated and should not be edited.

@_exported import ApolloAPI

public class CreateUserMutation: GraphQLMutation {
  public static let operationName: String = "createUser"
  public static let operationDocument: ApolloAPI.OperationDocument = .init(
    definition: .init(
      #"mutation createUser($input: CreateUserInput!) { createUser(input: $input) { __typename id } }"#
    ))

  public var input: CreateUserInput

  public init(input: CreateUserInput) {
    self.input = input
  }

  public var __variables: Variables? { ["input": input] }

  public struct Data: NotaGraphQL.SelectionSet {
    public let __data: DataDict
    public init(_dataDict: DataDict) { __data = _dataDict }

    public static var __parentType: any ApolloAPI.ParentType { NotaGraphQL.Objects.Mutation }
    public static var __selections: [ApolloAPI.Selection] { [
      .field("createUser", CreateUser.self, arguments: ["input": .variable("input")]),
    ] }

    /// Create a new user
    public var createUser: CreateUser { __data["createUser"] }

    /// CreateUser
    ///
    /// Parent Type: `UserType`
    public struct CreateUser: NotaGraphQL.SelectionSet {
      public let __data: DataDict
      public init(_dataDict: DataDict) { __data = _dataDict }

      public static var __parentType: any ApolloAPI.ParentType { NotaGraphQL.Objects.UserType }
      public static var __selections: [ApolloAPI.Selection] { [
        .field("__typename", String.self),
        .field("id", NotaGraphQL.ID.self),
      ] }

      public var id: NotaGraphQL.ID { __data["id"] }
    }
  }
}
