// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "MirrorCore",
    platforms: [.iOS(.v17), .macOS(.v13)],
    products: [.library(name: "MirrorCore", targets: ["MirrorCore"])],
    targets: [
        .target(name: "MirrorCore"),
        .testTarget(name: "MirrorCoreTests", dependencies: ["MirrorCore"]),
    ]
)
