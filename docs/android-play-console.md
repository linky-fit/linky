# Android Play Console CI

Verzované Android releasy (změna verze v `package.json` na `main`, ručně pushnutý `v*` tag nebo ruční spuštění workflow `Android APK Release`) nahrávají podepsaný AAB do Google Play na tracky `internal` a `beta` (Open testing) a APK na GitHub Releases. Běžný push do `main` Play build nepublikuje. Workflow je v [.github/workflows/android-apk-release.yml](../.github/workflows/android-apk-release.yml); CI nastavuje `versionCode = 200000000 + github.run_number` v [android-release-setup](../.github/actions/android-release-setup/action.yml). Ponech název souboru release workflow, aby čítač pokračoval.

## 1. Připrav Google Play Console

1. založ aplikaci `fit.linky.app`, pokud ještě neexistuje
2. nastav `Testing` -> `Open testing`, dostupné země a testery interního tracku
3. dokonči store listing a povinné formuláře v app setupu; účet musí mít přístup k Open testing
4. v `Publishing overview` vypni Managed publishing, pokud se mají schválené verze zveřejnit automaticky

Bez dokončeného základního nastavení umí Play API vracet chyby, i když je AAB validní.

## 2. Vytvoř service account pro Play API

V Google Cloud projektu propojeném s Play Console:

1. otevři `APIs & Services` -> `Credentials`
2. vytvoř nový `Service account`
3. vygeneruj JSON key
4. v Play Console otevři `Users and permissions`
5. přidej service account a dej mu oprávnění `Release apps to testing tracks` pro tuto aplikaci

Obsah JSON klíče ulož do GitHub secretu `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` jako čistý JSON text.

## 3. Připrav upload key secrets

Upload key vygeneruj podle [docs/android-upload-key.md](./android-upload-key.md), pak z něj vytvoř base64 hodnotu:

```bash
base64 -i "$HOME/.keys/linky/linky-upload-key.jks" | pbcopy
```

Do GitHub repository secrets přidej `ANDROID_UPLOAD_KEYSTORE_BASE64`, `ANDROID_UPLOAD_STORE_PASSWORD`, `ANDROID_UPLOAD_KEY_ALIAS` a `ANDROID_UPLOAD_KEY_PASSWORD`.

## 4. Přidej Firebase config secret

Android build používá FCM push konfiguraci, takže do GitHub secrets přidej i base64 obsah `google-services.json` jako `ANDROID_GOOGLE_SERVICES_JSON_BASE64`:

```bash
base64 -i apps/native-shell/android/app/google-services.json | pbcopy
```

## 5. Ověř první run

1. vydej novou verzi změnou `package.json` a doplněním `CHANGELOG.md`
2. v GitHub Actions počkej na job `Publish to Google Play open testing`
3. v Play Console zkontroluj `Open testing` a `Publishing overview`

## Poznámky

- Google může release kontrolovat; úspěšný upload neznamená okamžitou dostupnost testerům. Se zapnutým Managed publishing je po schválení potřeba ruční publikace a některé stavy po zamítnutí vyžadují ruční odeslání ke kontrole.
- AAB zůstává i jako GitHub Actions artifact; neúspěšný Play job lze spustit znovu bez nového buildu.
- Nastavení testování: https://support.google.com/googleplay/android-developer/answer/9845334
- Kontrola a publikování: https://support.google.com/googleplay/android-developer/answer/9859654
