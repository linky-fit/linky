import ExpoModulesCore
import PDFKit
import UIKit

public class LinkyPdfRendererModule: Module {
  public func definition() -> ModuleDefinition {
    Name("LinkyPdfRenderer")

    AsyncFunction("renderPages") {
      (source: URL, outputDirectory: URL, maxPages: Int, targetWidth: Double, maxPixels: Double, maxAspect: Double)
        throws -> [[String: Any]] in
      guard let document = PDFDocument(url: source) else {
        throw Exception(name: "PdfUnreadable", description: "The PDF could not be opened")
      }
      try FileManager.default.createDirectory(at: outputDirectory, withIntermediateDirectories: true)
      return try (0..<min(document.pageCount, maxPages)).map { index in
        guard let page = document.page(at: index) else {
          throw Exception(name: "PdfUnreadable", description: "A PDF page could not be read")
        }
        return try renderPage(
          page, to: outputDirectory, targetWidth: targetWidth, maxPixels: maxPixels, maxAspect: maxAspect)
      }
    }
  }
}

private func renderPage(
  _ page: PDFPage, to directory: URL, targetWidth: Double, maxPixels: Double, maxAspect: Double
) throws -> [String: Any] {
  let box = page.bounds(for: .cropBox).size
  let quarterTurned = abs(page.rotation) % 180 == 90
  let pageWidth = Double(quarterTurned ? box.height : box.width)
  let pageHeight = Double(quarterTurned ? box.width : box.height)
  guard pageWidth > 0, pageHeight > 0, pageHeight / pageWidth <= maxAspect else {
    throw Exception(name: "PdfPageGeometry", description: "pdf-page-geometry-unsupported")
  }
  let requestedScale = targetWidth / pageWidth
  let pixels = pageWidth * pageHeight * requestedScale * requestedScale
  let scale = pixels > maxPixels ? requestedScale * (maxPixels / pixels).squareRoot() : requestedScale
  let width = Int((pageWidth * scale).rounded(.up))
  let height = Int((pageHeight * scale).rounded(.up))

  let format = UIGraphicsImageRendererFormat()
  format.scale = 1
  let renderer = UIGraphicsImageRenderer(size: CGSize(width: width, height: height), format: format)
  let jpeg = renderer.jpegData(withCompressionQuality: 0.85) { context in
    UIColor.white.setFill()
    context.fill(CGRect(x: 0, y: 0, width: width, height: height))
    // PDF space has its origin bottom-left, UIKit's top-left.
    context.cgContext.translateBy(x: 0, y: CGFloat(height))
    context.cgContext.scaleBy(x: CGFloat(scale), y: -CGFloat(scale))
    page.draw(with: .cropBox, to: context.cgContext)
  }
  let output = directory.appendingPathComponent("\(UUID().uuidString).jpg")
  try jpeg.write(to: output)
  return ["uri": output.absoluteString, "width": width, "height": height]
}
