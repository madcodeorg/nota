@preconcurrency import AVFoundation
import Foundation
import Speech

struct JsonOutput: Encodable {
  let ok: Bool
  let command: String
  let available: Bool?
  let locale: String?
  let text: String?
  let error: String?
  var supportedLocales: [String]? = nil
  var installedLocales: [String]? = nil
  var systemLocale: String? = nil
}

struct StreamInput: Decodable {
  let type: String
  let frameId: String?
  let pcmBase64: String?
  let startMs: Double?
  let endMs: Double?
}

actor StreamFrameDeduplicator {
  private var seenFrameIds: Set<String> = []

  func shouldProcess(_ frameId: String?) -> Bool {
    guard let frameId, !frameId.isEmpty else {
      // Older Nota builds did not send frame IDs. Continue processing those
      // commands so the helper remains backward compatible.
      return true
    }
    return seenFrameIds.insert(frameId).inserted
  }
}

struct StreamOutput: Encodable {
  let ok: Bool
  let type: String
  let text: String?
  let startMs: Double?
  let endMs: Double?
  let source: String?
  let error: String?
}

actor StreamTimeline {
  private var latestStartMs: Double?
  private var latestEndMs: Double?

  func update(startMs: Double?, endMs: Double?) {
    if let startMs {
      latestStartMs = startMs
    }
    if let endMs {
      latestEndMs = endMs
    }
  }

  func range() -> (startMs: Double?, endMs: Double?) {
    (latestStartMs, latestEndMs)
  }
}

actor TranscriptCollector {
  private var results: [String] = []

  func append(_ text: String) {
    results.append(text)
  }

  func joined() -> String {
    results.joined(separator: " ").trimmingCharacters(in: .whitespacesAndNewlines)
  }
}

final class ConverterInputState: @unchecked Sendable {
  let buffer: AVAudioPCMBuffer
  var consumed = false

  init(buffer: AVAudioPCMBuffer) {
    self.buffer = buffer
  }
}

func writeJson(_ output: JsonOutput) {
  let encoder = JSONEncoder()
  encoder.outputFormatting = [.withoutEscapingSlashes]
  if let data = try? encoder.encode(output),
     let line = String(data: data, encoding: .utf8)
  {
    print(line)
  }
}

func writeStreamJson(_ output: StreamOutput) {
  let encoder = JSONEncoder()
  encoder.outputFormatting = [.withoutEscapingSlashes]
  if let data = try? encoder.encode(output),
     let line = String(data: data, encoding: .utf8)
  {
    print(line)
    fflush(stdout)
  }
}

func fail(command: String, _ message: String) -> Never {
  writeJson(
    JsonOutput(
      ok: false,
      command: command,
      available: nil,
      locale: nil,
      text: nil,
      error: message
    )
  )
  exit(1)
}

@available(macOS 26.0, *)
func pcmBufferFromInterleavedFloat32(
  data: Data,
  sampleRate: Double,
  channels: Int
) throws -> AVAudioPCMBuffer {
  let channelCount = max(1, channels)
  let frameCount = data.count / MemoryLayout<Float32>.size / channelCount
  guard frameCount > 0 else {
    throw NSError(
      domain: "NotaAppleSpeechHelper",
      code: 2,
      userInfo: [NSLocalizedDescriptionKey: "Audio chunk is empty."]
    )
  }
  guard
    let format = AVAudioFormat(
      commonFormat: .pcmFormatFloat32,
      sampleRate: sampleRate,
      channels: AVAudioChannelCount(channelCount),
      interleaved: false
    ),
    let buffer = AVAudioPCMBuffer(
      pcmFormat: format,
      frameCapacity: AVAudioFrameCount(frameCount)
    ),
    let channelData = buffer.floatChannelData
  else {
    throw NSError(
      domain: "NotaAppleSpeechHelper",
      code: 3,
      userInfo: [NSLocalizedDescriptionKey: "Could not allocate PCM buffer."]
    )
  }

  buffer.frameLength = AVAudioFrameCount(frameCount)
  data.withUnsafeBytes { rawBuffer in
    let samples = rawBuffer.bindMemory(to: Float32.self)
    for frame in 0..<frameCount {
      for channel in 0..<channelCount {
        channelData[channel][frame] = samples[(frame * channelCount) + channel]
      }
    }
  }
  return buffer
}

@available(macOS 26.0, *)
func convertBuffer(_ buffer: AVAudioPCMBuffer, to outputFormat: AVAudioFormat) throws -> AVAudioPCMBuffer {
  if buffer.format == outputFormat {
    return buffer
  }
  guard let converter = AVAudioConverter(from: buffer.format, to: outputFormat) else {
    throw NSError(
      domain: "NotaAppleSpeechHelper",
      code: 4,
      userInfo: [NSLocalizedDescriptionKey: "Could not create audio converter."]
    )
  }

  let ratio = outputFormat.sampleRate / buffer.format.sampleRate
  let capacity = max(1, Int(Double(buffer.frameLength) * ratio) + 16)
  guard
    let outputBuffer = AVAudioPCMBuffer(
      pcmFormat: outputFormat,
      frameCapacity: AVAudioFrameCount(capacity)
    )
  else {
    throw NSError(
      domain: "NotaAppleSpeechHelper",
      code: 5,
      userInfo: [NSLocalizedDescriptionKey: "Could not allocate converted PCM buffer."]
    )
  }

  let inputState = ConverterInputState(buffer: buffer)
  var error: NSError?
  converter.convert(to: outputBuffer, error: &error) { _, outStatus in
    if inputState.consumed {
      outStatus.pointee = .noDataNow
      return nil
    }
    inputState.consumed = true
    outStatus.pointee = .haveData
    return inputState.buffer
  }
  if let error {
    throw error
  }
  return outputBuffer
}

@available(macOS 26.0, *)
func supportedLocale(_ identifier: String?) async throws -> Locale {
  let requested = identifier.flatMap { Locale(identifier: $0) } ?? Locale.current
  if let locale = await SpeechTranscriber.supportedLocale(equivalentTo: requested) {
    return locale
  }
  throw NSError(
    domain: "NotaAppleSpeechHelper",
    code: 1,
    userInfo: [
      NSLocalizedDescriptionKey:
        "SpeechTranscriber does not support locale \(requested.identifier).",
    ]
  )
}

@available(macOS 26.0, *)
func ensureAssets(for transcriber: SpeechTranscriber) async throws {
  if let request = try await AssetInventory.assetInstallationRequest(
    supporting: [transcriber]
  ) {
    try await request.downloadAndInstall()
  }
}

@available(macOS 26.0, *)
func transcribeAudioFile(path: String, localeIdentifier: String?) async throws -> String {
  let fileUrl = URL(fileURLWithPath: path)
  let audioFile = try AVAudioFile(forReading: fileUrl)
  let locale = try await supportedLocale(localeIdentifier)
  let transcriber = SpeechTranscriber(
    locale: locale,
    preset: .transcription
  )
  guard SpeechTranscriber.isAvailable else {
    throw NSError(
      domain: "NotaAppleSpeechHelper",
      code: 7,
      userInfo: [NSLocalizedDescriptionKey: "SpeechTranscriber is not available on this Mac right now."]
    )
  }
  try await ensureAssets(for: transcriber)

  let analyzer = SpeechAnalyzer(modules: [transcriber])
  // SpeechAnalyzer otherwise defers model/configuration work until the first
  // audio arrives. Preheating here keeps that cold start out of the first
  // transcript result and follows Apple's recommended responsiveness path.
  try await analyzer.prepareToAnalyze(in: audioFile.processingFormat)
  let collector = TranscriptCollector()
  let resultTask = Task {
    for try await result in transcriber.results {
      let text = String(result.text.characters).trimmingCharacters(
        in: .whitespacesAndNewlines
      )
      if !text.isEmpty {
        await collector.append(text)
      }
    }
  }

  let lastSampleTime = try await analyzer.analyzeSequence(from: audioFile)
  if let lastSampleTime {
    try await analyzer.finalizeAndFinish(through: lastSampleTime)
  } else {
    await analyzer.cancelAndFinishNow()
  }
  try await resultTask.value
  return await collector.joined()
}

@available(macOS 26.0, *)
func transcribeStdinStream(
  sampleRate: Double,
  channels: Int,
  source: String,
  localeIdentifier: String?
) async throws {
  let locale = try await supportedLocale(localeIdentifier)
  let transcriber = SpeechTranscriber(
    locale: locale,
    preset: .timeIndexedProgressiveTranscription
  )
  guard SpeechTranscriber.isAvailable else {
    throw NSError(
      domain: "NotaAppleSpeechHelper",
      code: 7,
      userInfo: [NSLocalizedDescriptionKey: "SpeechTranscriber is not available on this Mac right now."]
    )
  }
  try await ensureAssets(for: transcriber)

  guard let outputFormat = await SpeechAnalyzer.bestAvailableAudioFormat(
    compatibleWith: [transcriber]
  ) else {
    throw NSError(
      domain: "NotaAppleSpeechHelper",
      code: 6,
      userInfo: [NSLocalizedDescriptionKey: "No Apple SpeechAnalyzer-compatible audio format is available."]
    )
  }
  let analyzer = SpeechAnalyzer(modules: [transcriber])
  // Do not advertise readiness until the on-device model and audio pipeline
  // are actually warm. This avoids accepting live frames while SpeechAnalyzer
  // is still doing its lazy first-input setup.
  try await analyzer.prepareToAnalyze(in: outputFormat)
  writeStreamJson(
    StreamOutput(
      ok: true,
      type: "ready",
      text: nil,
      startMs: nil,
      endMs: nil,
      source: source,
      error: nil
    )
  )
  let (inputSequence, inputBuilder) = AsyncStream.makeStream(of: AnalyzerInput.self)
  let decoder = JSONDecoder()
  let frameDeduplicator = StreamFrameDeduplicator()
  let timeline = StreamTimeline()

  let resultTask = Task {
    do {
      for try await result in transcriber.results {
        let text = String(result.text.characters).trimmingCharacters(
          in: .whitespacesAndNewlines
        )
        if !text.isEmpty {
          let range = await timeline.range()
          writeStreamJson(
            StreamOutput(
              ok: true,
              type: result.isFinal ? "final" : "partial",
              text: text,
              startMs: range.startMs,
              endMs: range.endMs,
              source: source,
              error: nil
            )
          )
        }
      }
    } catch {
      writeStreamJson(
        StreamOutput(
          ok: false,
          type: "error",
          text: nil,
          startMs: nil,
          endMs: nil,
          source: source,
          error: error.localizedDescription
        )
      )
    }
  }

  let inputTask = Task {
    while let line = readLine(strippingNewline: true) {
      guard !line.isEmpty else {
        continue
      }
      let command = try decoder.decode(StreamInput.self, from: Data(line.utf8))
      if command.type == "stop" {
        inputBuilder.finish()
        break
      }
      guard command.type == "audio",
        let pcmBase64 = command.pcmBase64,
        let audioData = Data(base64Encoded: pcmBase64)
      else {
        continue
      }
      guard await frameDeduplicator.shouldProcess(command.frameId) else {
        continue
      }

      let inputBuffer = try pcmBufferFromInterleavedFloat32(
        data: audioData,
        sampleRate: sampleRate,
        channels: channels
      )
      let converted = try convertBuffer(inputBuffer, to: outputFormat)
      let startTime = CMTime(
        seconds: max(0, (command.startMs ?? 0) / 1000),
        preferredTimescale: 1000
      )
      await timeline.update(startMs: command.startMs, endMs: command.endMs)
      inputBuilder.yield(
        AnalyzerInput(buffer: converted, bufferStartTime: startTime)
      )
    }
    inputBuilder.finish()
  }

  do {
    let lastSampleTime = try await analyzer.analyzeSequence(inputSequence)
    try await inputTask.value
    if let lastSampleTime {
      try await analyzer.finalizeAndFinish(through: lastSampleTime)
    } else {
      await analyzer.cancelAndFinishNow()
    }
    await resultTask.value
  } catch {
    await analyzer.cancelAndFinishNow()
    inputBuilder.finish()
    throw error
  }
}

@main
struct AppleSpeechHelper {
  static func main() async {
    let arguments = Array(CommandLine.arguments.dropFirst())
    let command = arguments.first ?? "status"

    guard #available(macOS 26.0, *) else {
      fail(
        command: command,
        "Apple SpeechAnalyzer requires macOS 26 or newer."
      )
    }

    switch command {
    case "languages", "prepare-language":
      do {
        if command == "prepare-language" {
          guard arguments.count >= 2 else { fail(command: command, "A speech language is required.") }
          let locale = try await supportedLocale(arguments[1])
          let transcriber = SpeechTranscriber(locale: locale, preset: .transcription)
          try await ensureAssets(for: transcriber)
        }
        let supported = await SpeechTranscriber.supportedLocales
        let installed = await SpeechTranscriber.installedLocales
        let system = try? await supportedLocale(nil)
        writeJson(JsonOutput(ok: true, command: command,
          available: SpeechTranscriber.isAvailable, locale: nil, text: nil, error: nil,
          supportedLocales: supported.map { $0.identifier(.bcp47) }.sorted(),
          installedLocales: installed.map { $0.identifier(.bcp47) }.sorted(),
          systemLocale: system?.identifier(.bcp47)))
      } catch { fail(command: command, error.localizedDescription) }

    case "status":
      do {
        let locale = try await supportedLocale(arguments.dropFirst().first)
        writeJson(
          JsonOutput(
            ok: true,
            command: command,
            available: SpeechTranscriber.isAvailable,
            locale: locale.identifier,
            text: nil,
            error: nil
          )
        )
      } catch {
        fail(command: command, error.localizedDescription)
      }

    case "transcribe-file":
      guard arguments.count >= 2 else {
        fail(command: command, "Usage: nota-apple-speech-helper transcribe-file <path> [locale]")
      }
      do {
        let text = try await transcribeAudioFile(
          path: arguments[1],
          localeIdentifier: arguments.count >= 3 ? arguments[2] : nil
        )
        writeJson(
          JsonOutput(
            ok: true,
            command: command,
            available: true,
            locale: nil,
            text: text,
            error: nil
          )
        )
      } catch {
        fail(command: command, error.localizedDescription)
      }

    case "transcribe-stream":
      do {
        let sampleRate = arguments.count >= 2 ? Double(arguments[1]) ?? 48000 : 48000
        let channels = arguments.count >= 3 ? Int(arguments[2]) ?? 2 : 2
        let source = arguments.count >= 4 ? arguments[3] : "system"
        let locale = arguments.count >= 5 ? arguments[4] : nil
        try await transcribeStdinStream(
          sampleRate: sampleRate,
          channels: channels,
          source: source,
          localeIdentifier: locale
        )
      } catch {
        writeStreamJson(
          StreamOutput(
            ok: false,
            type: "error",
            text: nil,
            startMs: nil,
            endMs: nil,
            source: nil,
            error: error.localizedDescription
          )
        )
        exit(1)
      }

    default:
      fail(command: command, "Unknown command: \(command)")
    }
  }
}
