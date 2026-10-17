package fit.linky.legacysecrets

import android.content.Context
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.ByteArrayInputStream
import java.io.File
import org.json.JSONTokener

// The Capacitor app's store (apps/native-shell LinkySecretStorageBridge), opened with the same master key and schemes.
private const val PREFS_NAME = "linky.secure.secrets"

// EncryptedSharedPreferences keeps its Tink keysets in the same file as the entries.
private const val KEYSET_PREFIX = "__androidx_security_crypto_encrypted_prefs_"

// Capacitor's default Android origin (androidScheme https, hostname localhost).
private const val CAPACITOR_ORIGIN = "https://localhost/"

private const val READ_LOCAL_STORAGE =
  "JSON.stringify(Object.fromEntries(Object.keys(localStorage).map((key) => [key, localStorage.getItem(key)])))"

class LinkyLegacySecretsModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("LinkyLegacySecrets")

    Function("hasLegacySecrets") {
      context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).all.keys.any {
        !it.startsWith(KEYSET_PREFIX)
      }
    }

    AsyncFunction("readLegacySecrets") {
      openLegacyPreferences().all.mapNotNull { (key, value) ->
        (value as? String)?.let { key to it }
      }.toMap()
    }

    AsyncFunction("readLegacyWebStorage") { promise: Promise ->
      if (!File(webViewDir(), "Default/Local Storage").exists()) {
        promise.resolve(null)
        return@AsyncFunction
      }
      readLocalStorage(promise)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("clearLegacyStores") {
      val undeleted = webViewDirs().filter { it.exists() && !it.deleteRecursively() }
      if (!context.deleteSharedPreferences(PREFS_NAME) || undeleted.isNotEmpty()) {
        throw IllegalStateException("Capacitor storage not fully deleted: ${undeleted.map { it.name }}")
      }
    }
  }

  private fun openLegacyPreferences() =
    EncryptedSharedPreferences.create(
      context,
      PREFS_NAME,
      MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
      EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
      EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

  private fun webViewDir() = File(context.applicationInfo.dataDir, "app_webview")

  // The WebView profile (localStorage, IndexedDB, OPFS, service worker), its GPU and HTTP caches, the live-update bundles.
  private fun webViewDirs() =
    listOf(
      webViewDir(),
      File(context.applicationInfo.dataDir, "app_textures"),
      File(context.cacheDir, "WebView"),
      File(context.filesDir, "live-updates"),
    )

  /** Opens an empty page on the Capacitor origin, so nothing of the old app runs, and dumps its localStorage. */
  private fun readLocalStorage(promise: Promise) {
    val webView = WebView(context)
    var settled = false
    webView.settings.javaScriptEnabled = true
    webView.settings.domStorageEnabled = true
    webView.settings.blockNetworkLoads = true
    webView.webViewClient = object : WebViewClient() {
      override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest) =
        WebResourceResponse("text/plain", "utf-8", ByteArrayInputStream(ByteArray(0)))

      override fun onPageFinished(view: WebView, url: String) {
        if (settled) return
        settled = true
        view.evaluateJavascript(READ_LOCAL_STORAGE) { result ->
          view.destroy()
          // evaluateJavascript hands back the script's value JSON-encoded, here a string.
          val dump = JSONTokener(result).nextValue() as? String
          if (dump == null) {
            promise.reject("ERR_LEGACY_WEB_STORAGE", "localStorage could not be read", null)
          } else {
            promise.resolve(dump)
          }
        }
      }
    }
    webView.loadDataWithBaseURL(CAPACITOR_ORIGIN, "<html></html>", "text/html", "utf-8", null)
  }
}
