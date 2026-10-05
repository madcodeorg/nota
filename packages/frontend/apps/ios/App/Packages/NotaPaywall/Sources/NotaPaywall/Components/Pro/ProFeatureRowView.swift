//
//  ProFeatureRowView.swift
//  NotaPaywall
//
//  Created by qaq on 9/18/25.
//

import NotaResources
import SwiftUI

struct ProFeatureRowView: View {
  let feature: Feature
  let index: Int

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 8) {
      Image(systemName: "checkmark")
        .font(.system(size: 16))
        .foregroundColor(NotaColors.buttonPrimary.color)

      Text(feature.text)
        .font(.system(size: 16))
        .contentTransition(.numericText())
        .foregroundColor(feature.isHighlighted ? NotaColors.buttonPrimary.color : NotaColors.textPrimary.color)
        .lineLimit(nil)
        .fixedSize(horizontal: false, vertical: true)

      Spacer()
    }
    .transition(.opacity)
  }
}

#Preview {
  VStack(alignment: .leading, spacing: 16) {
    Divider()
    ProFeatureRowView(
      feature: .init(
        "Hello World Feature Row View",
        isHighlighted: true
      ),
      index: 0
    )
    Divider()
    ProFeatureRowView(
      feature: .init("Hello World Feature Row View"),
      index: 0
    )
    Divider()
  }
  .padding()
  .background(Color.gray.opacity(0.25).ignoresSafeArea())
}
