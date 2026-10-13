package fit.linky.legacysecrets

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// The Capacitor app's store (apps/native-shell LinkySecretStorageBridge), opened with the same master key and schemes.
private const val PREFS_NAME = "linky.secure.secrets"

// EncryptedSharedPreferences keeps its Tink keysets in the same file as the entries.
private const val KEYSET_PREFIX = "__androidx_security_crypto_encrypted_prefs_"

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

    AsyncFunction("clearLegacySecrets") {
      if (!context.deleteSharedPreferences(PREFS_NAME)) {
        throw IllegalStateException("$PREFS_NAME could not be deleted")
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
}
