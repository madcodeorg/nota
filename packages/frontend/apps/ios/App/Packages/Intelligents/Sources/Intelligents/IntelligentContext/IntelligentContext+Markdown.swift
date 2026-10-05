//
//  IntelligentContext+Markdown.swift
//  Intelligents
//
//  Created by 秋星桥 on 7/4/25.
//

import Foundation
import MarkdownView

extension IntelligentContext {
  func prepareMarkdownViewThemes() {
    MarkdownTheme.default.colors.body = .notaTextPrimary
    MarkdownTheme.default.colors.highlight = .notaTextLink
  }
}
