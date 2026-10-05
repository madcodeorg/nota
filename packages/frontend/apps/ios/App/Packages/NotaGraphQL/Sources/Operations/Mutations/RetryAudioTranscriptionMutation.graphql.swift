// @generated
// This file was automatically generated and should not be edited.

@_exported import ApolloAPI

public class RetryAudioTranscriptionMutation: GraphQLMutation {
  public static let operationName: String = "retryAudioTranscription"
  public static let operationDocument: ApolloAPI.OperationDocument = .init(
    definition: .init(
      #"mutation retryAudioTranscription($workspaceId: String!, $jobId: String!) { retryAudioTranscription(workspaceId: $workspaceId, jobId: $jobId) { __typename id status } }"#
    ))

  public var workspaceId: String
  public var jobId: String

  public init(
    workspaceId: String,
    jobId: String
  ) {
    self.workspaceId = workspaceId
    self.jobId = jobId
  }

  public var __variables: Variables? { [
    "workspaceId": workspaceId,
    "jobId": jobId
  ] }

  public struct Data: NotaGraphQL.SelectionSet {
    public let __data: DataDict
    public init(_dataDict: DataDict) { __data = _dataDict }

    public static var __parentType: any ApolloAPI.ParentType { NotaGraphQL.Objects.Mutation }
    public static var __selections: [ApolloAPI.Selection] { [
      .field("retryAudioTranscription", RetryAudioTranscription?.self, arguments: [
        "workspaceId": .variable("workspaceId"),
        "jobId": .variable("jobId")
      ]),
    ] }

    public var retryAudioTranscription: RetryAudioTranscription? { __data["retryAudioTranscription"] }

    /// RetryAudioTranscription
    ///
    /// Parent Type: `TranscriptionResultType`
    public struct RetryAudioTranscription: NotaGraphQL.SelectionSet {
      public let __data: DataDict
      public init(_dataDict: DataDict) { __data = _dataDict }

      public static var __parentType: any ApolloAPI.ParentType { NotaGraphQL.Objects.TranscriptionResultType }
      public static var __selections: [ApolloAPI.Selection] { [
        .field("__typename", String.self),
        .field("id", NotaGraphQL.ID.self),
        .field("status", GraphQLEnum<NotaGraphQL.AiJobStatus>.self),
      ] }

      public var id: NotaGraphQL.ID { __data["id"] }
      public var status: GraphQLEnum<NotaGraphQL.AiJobStatus> { __data["status"] }
    }
  }
}
