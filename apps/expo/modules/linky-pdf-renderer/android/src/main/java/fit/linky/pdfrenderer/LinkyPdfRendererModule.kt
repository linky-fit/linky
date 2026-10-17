package fit.linky.pdfrenderer

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.util.UUID
import kotlin.math.ceil
import kotlin.math.min
import kotlin.math.sqrt

class LinkyPdfRendererModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("LinkyPdfRenderer")

    AsyncFunction("renderPages") {
      source: String,
      outputDirectory: String,
      maxPages: Int,
      targetWidth: Double,
      maxPixels: Double,
      maxAspect: Double ->
      val directory = fileOf(outputDirectory).apply { mkdirs() }
      ParcelFileDescriptor.open(fileOf(source), ParcelFileDescriptor.MODE_READ_ONLY).use { descriptor ->
        val renderer = PdfRenderer(descriptor)
        try {
          (0 until min(renderer.pageCount, maxPages)).map { index ->
            val page = renderer.openPage(index)
            try {
              renderPage(page, directory, targetWidth, maxPixels, maxAspect)
            } finally {
              page.close()
            }
          }
        } finally {
          renderer.close()
        }
      }
    }
  }

  private fun fileOf(uri: String) =
    File(Uri.parse(uri).path ?: throw IllegalArgumentException("not a file uri"))

  private fun renderPage(
    page: PdfRenderer.Page,
    directory: File,
    targetWidth: Double,
    maxPixels: Double,
    maxAspect: Double,
  ): Map<String, Any> {
    val pageWidth = page.width.toDouble()
    val pageHeight = page.height.toDouble()
    if (pageWidth <= 0 || pageHeight <= 0 || pageHeight / pageWidth > maxAspect) {
      throw IllegalArgumentException("pdf-page-geometry-unsupported")
    }
    val requestedScale = targetWidth / pageWidth
    val pixels = pageWidth * pageHeight * requestedScale * requestedScale
    val scale = if (pixels > maxPixels) requestedScale * sqrt(maxPixels / pixels) else requestedScale
    val width = ceil(pageWidth * scale).toInt()
    val height = ceil(pageHeight * scale).toInt()
    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    try {
      bitmap.eraseColor(Color.WHITE)
      page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
      val output = File(directory, "${UUID.randomUUID()}.jpg")
      output.outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, 85, it) }
      return mapOf("uri" to Uri.fromFile(output).toString(), "width" to width, "height" to height)
    } finally {
      bitmap.recycle()
    }
  }
}
