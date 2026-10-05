// The Swift Programming Language
// https://docs.swift.org/swift-book

import SwiftUI
import UIKit

public enum NotaColors: String, CaseIterable {
  case buttonPrimary = "nota.button.primary"
  case iconActivated = "nota.icon.activated"
  case iconPrimary = "nota.icon.primary"
  case layerBackgroundPrimary = "nota.layer.background.primary"
  case layerBackgroundSecondary = "nota.layer.background.secondary"
  case layerBorder = "nota.layer.border"
  case layerPureWhite = "nota.layer.pureWhite"
  case textEmphasis = "nota.text.emphasis"
  case textLink = "nota.text.link"
  case textListDotAndNumber = "nota.text.listDotAndNumber"
  case textPlaceholder = "nota.text.placeholder"
  case textPrimary = "nota.text.primary"
  case textPureWhite = "nota.text.pureWhite"
  case textSecondary = "nota.text.secondary"
  case textTertiary = "nota.text.tertiary"

  @available(iOS 13.0, *)
  public var color: Color {
    Color(rawValue, bundle: .module)
  }

  public var uiColor: UIColor {
    UIColor(named: rawValue, in: .module, compatibleWith: nil) ?? .clear
  }
}

public enum NotaIcons: String, CaseIterable {
  case arrowDown = "ArrowDown"
  case arrowUpBig = "ArrowUpBig"
  case box = "Box"
  case broom = "Broom"
  case bubble = "Bubble"
  case calendar = "Calendar"
  case camera = "Camera"
  case checkCircle = "CheckCircle"
  case close = "Close"
  case image = "Image"
  case more = "More"
  case page = "Page"
  case plus = "Plus"
  case settings = "Settings"
  case think = "Think"
  case tools = "Tools"
  case upload = "Upload"
  case web = "Web"

  @available(iOS 13.0, *)
  public var image: Image {
    Image(rawValue, bundle: .module)
  }

  @available(iOS 13.0, *)
  public var uiImage: UIImage {
    UIImage(named: rawValue, in: .module, with: .none) ?? UIImage()
  }
}
