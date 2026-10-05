import Foundation

final class AppConfigManager {
  struct AppConfig: Decodable {
    let notaVersion: String
  }

  static var notaVersion: String?

  static func getNotaVersion() -> String {
    if notaVersion == nil {
      let file = Bundle(for: AppConfigManager.self).url(forResource: "capacitor.config", withExtension: "json")!
      let data = try! Data(contentsOf: file)
      let config = try! JSONDecoder().decode(AppConfig.self, from: data)
      notaVersion = config.notaVersion
    }

    return notaVersion!
  }
}
