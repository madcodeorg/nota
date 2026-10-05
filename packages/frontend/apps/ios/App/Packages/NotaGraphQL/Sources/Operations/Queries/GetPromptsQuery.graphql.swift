// @generated
// This file was automatically generated and should not be edited.

@_exported import ApolloAPI

public class GetPromptsQuery: GraphQLQuery {
  public static let operationName: String = "getPrompts"
  public static let operationDocument: ApolloAPI.OperationDocument = .init(
    definition: .init(
      #"query getPrompts { listCopilotPrompts { __typename name model action config { __typename frequencyPenalty presencePenalty temperature topP } messages { __typename role content params } } }"#
    ))

  public init() {}

  public struct Data: NotaGraphQL.SelectionSet {
    public let __data: DataDict
    public init(_dataDict: DataDict) { __data = _dataDict }

    public static var __parentType: any ApolloAPI.ParentType { NotaGraphQL.Objects.Query }
    public static var __selections: [ApolloAPI.Selection] { [
      .field("listCopilotPrompts", [ListCopilotPrompt].self),
    ] }

    /// List all copilot prompts
    public var listCopilotPrompts: [ListCopilotPrompt] { __data["listCopilotPrompts"] }

    /// ListCopilotPrompt
    ///
    /// Parent Type: `CopilotPromptType`
    public struct ListCopilotPrompt: NotaGraphQL.SelectionSet {
      public let __data: DataDict
      public init(_dataDict: DataDict) { __data = _dataDict }

      public static var __parentType: any ApolloAPI.ParentType { NotaGraphQL.Objects.CopilotPromptType }
      public static var __selections: [ApolloAPI.Selection] { [
        .field("__typename", String.self),
        .field("name", String.self),
        .field("model", String.self),
        .field("action", String?.self),
        .field("config", Config?.self),
        .field("messages", [Message].self),
      ] }

      public var name: String { __data["name"] }
      public var model: String { __data["model"] }
      public var action: String? { __data["action"] }
      public var config: Config? { __data["config"] }
      public var messages: [Message] { __data["messages"] }

      /// ListCopilotPrompt.Config
      ///
      /// Parent Type: `CopilotPromptConfigType`
      public struct Config: NotaGraphQL.SelectionSet {
        public let __data: DataDict
        public init(_dataDict: DataDict) { __data = _dataDict }

        public static var __parentType: any ApolloAPI.ParentType { NotaGraphQL.Objects.CopilotPromptConfigType }
        public static var __selections: [ApolloAPI.Selection] { [
          .field("__typename", String.self),
          .field("frequencyPenalty", Double?.self),
          .field("presencePenalty", Double?.self),
          .field("temperature", Double?.self),
          .field("topP", Double?.self),
        ] }

        public var frequencyPenalty: Double? { __data["frequencyPenalty"] }
        public var presencePenalty: Double? { __data["presencePenalty"] }
        public var temperature: Double? { __data["temperature"] }
        public var topP: Double? { __data["topP"] }
      }

      /// ListCopilotPrompt.Message
      ///
      /// Parent Type: `CopilotPromptMessageType`
      public struct Message: NotaGraphQL.SelectionSet {
        public let __data: DataDict
        public init(_dataDict: DataDict) { __data = _dataDict }

        public static var __parentType: any ApolloAPI.ParentType { NotaGraphQL.Objects.CopilotPromptMessageType }
        public static var __selections: [ApolloAPI.Selection] { [
          .field("__typename", String.self),
          .field("role", GraphQLEnum<NotaGraphQL.CopilotPromptMessageRole>.self),
          .field("content", String.self),
          .field("params", NotaGraphQL.JSON?.self),
        ] }

        public var role: GraphQLEnum<NotaGraphQL.CopilotPromptMessageRole> { __data["role"] }
        public var content: String { __data["content"] }
        public var params: NotaGraphQL.JSON? { __data["params"] }
      }
    }
  }
}
