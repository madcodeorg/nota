// swift-tools-version: 5.9
// The swift-tools-version declares the minimum version of Swift required to build this package.

import PackageDescription

let package = Package(
  name: "NotaResources",
  products: [
    .library(
      name: "NotaResources",
      targets: ["NotaResources"]
    ),
  ],
  targets: [
    .target(
      name: "NotaResources",
      resources: [
        .process("Resources/Icons.xcassets"),
        .process("Resources/Colors.xcassets"),
      ]
    ),
  ]
)
