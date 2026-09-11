// swift-tools-version: 5.9
import Foundation
import PackageDescription

guard let source = ProcessInfo.processInfo.environment["LINKY_BITCHAT_SOURCE"] else {
    fatalError("Run scripts/verify-bitchat.sh with the upstream checkout path")
}
let package = Package(
    name: "MeshVectors",
    platforms: [.macOS(.v13)],
    dependencies: [.package(path: source + "/localPackages/BitFoundation")],
    targets: [.executableTarget(
        name: "MeshVectors",
        dependencies: [.product(name: "BitFoundation", package: "BitFoundation")],
        path: "Sources"
    )]
)
