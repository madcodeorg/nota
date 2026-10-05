// @generated
// This file was automatically generated and should not be edited.

@_exported import ApolloAPI

public class AddContextCategoryMutation: GraphQLMutation {
  public static let operationName: String = "addContextCategory"
  public static let operationDocument: ApolloAPI.OperationDocument = .init(
    definition: .init(
      #"mutation addContextCategory($options: AddContextCategoryInput!) { addContextCategory(options: $options) { __typename id createdAt type docs { __typename id createdAt status } } }"#
    ))

  public var options: AddContextCategoryInput

  public init(options: AddContextCategoryInput) {
    self.options = options
  }

  public var __variables: Variables? { ["options": options] }

  public struct Data: NotaGraphQL.SelectionSet {
    public let __data: DataDict
    public init(_dataDict: DataDict) { __data = _dataDict }

    public static var __parentType: any ApolloAPI.ParentType { NotaGraphQL.Objects.Mutation }
    public static var __selections: [ApolloAPI.Selection] { [
      .field("addContextCategory", AddContextCategory.self, arguments: ["options": .variable("options")]),
    ] }

    /// add a category to context
    public var addContextCategory: AddContextCategory { __data["addContextCategory"] }

    /// AddContextCategory
    ///
    /// Parent Type: `CopilotContextCategory`
    public struct AddContextCategory: NotaGraphQL.SelectionSet {
      public let __data: DataDict
      public init(_dataDict: DataDict) { __data = _dataDict }

      public static var __parentType: any ApolloAPI.ParentType { NotaGraphQL.Objects.CopilotContextCategory }
      public static var __selections: [ApolloAPI.Selection] { [
        .field("__typename", String.self),
        .field("id", NotaGraphQL.ID.self),
        .field("createdAt", NotaGraphQL.SafeInt.self),
        .field("type", GraphQLEnum<NotaGraphQL.ContextCategories>.self),
        .field("docs", [Doc].self),
      ] }

      public var id: NotaGraphQL.ID { __data["id"] }
      public var createdAt: NotaGraphQL.SafeInt { __data["createdAt"] }
      public var type: GraphQLEnum<NotaGraphQL.ContextCategories> { __data["type"] }
      public var docs: [Doc] { __data["docs"] }

      /// AddContextCategory.Doc
      ///
      /// Parent Type: `CopilotContextDoc`
      public struct Doc: NotaGraphQL.SelectionSet {
        public let __data: DataDict
        public init(_dataDict: DataDict) { __data = _dataDict }

        public static var __parentType: any ApolloAPI.ParentType { NotaGraphQL.Objects.CopilotContextDoc }
        public static var __selections: [ApolloAPI.Selection] { [
          .field("__typename", String.self),
          .field("id", NotaGraphQL.ID.self),
          .field("createdAt", NotaGraphQL.SafeInt.self),
          .field("status", GraphQLEnum<NotaGraphQL.ContextEmbedStatus>?.self),
        ] }

        public var id: NotaGraphQL.ID { __data["id"] }
        public var createdAt: NotaGraphQL.SafeInt { __data["createdAt"] }
        public var status: GraphQLEnum<NotaGraphQL.ContextEmbedStatus>? { __data["status"] }
      }
    }
  }
}
