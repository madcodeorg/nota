//
//  SKUnitCategory.swift
//  NotaPaywall
//
//  Created by qaq on 9/18/25.
//

import Foundation

public enum SKUnitCategory: Int, CaseIterable, Equatable, Identifiable, Sendable {
  public var id: Int { rawValue }

  case pro
  case ai
}

public extension SKUnitCategory {
  var title: String {
    switch self {
    case .pro: "Nota.Pro"
    case .ai: "AI"
    }
  }
}
