import Foundation

func defaultDataDirectory(support: URL, release: Bool) -> String {
    support.appendingPathComponent(release ? "MARICODE" : "Merry Development").path
}
