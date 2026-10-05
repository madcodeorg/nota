// swift-tools-version: 6.2

import PackageDescription

let package = Package(
  name: "AppleSpeechHelper",
  platforms: [
    .macOS(.v26)
  ],
  products: [
    .executable(name: "nota-apple-speech-helper", targets: ["AppleSpeechHelper"])
  ],
  targets: [
    .executableTarget(
      name: "AppleSpeechHelper",
      path: "Sources/AppleSpeechHelper"
    ),
    .testTarget(
      name: "AppleSpeechHelperTests",
      dependencies: ["AppleSpeechHelper"],
      path: "Tests/AppleSpeechHelperTests"
    ),
  ]
)
