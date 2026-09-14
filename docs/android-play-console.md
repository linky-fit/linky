# Android Play Console CI

Verzované Android releasy automaticky nahrávají podepsaný AAB do Google Play na `internal` i `beta` track. `beta` je veřejné testování (Open testing). Běžný push do `main` už Play build nepublikuje.

Workflow je v [.github/workflows/android-apk-release.yml](../.github/workflows/android-apk-release.yml).

## Co to dělá

Release spustí změna verze v `package.json` na `main`, ručně pushnutý `v*` tag nebo ruční spuštění `Android APK Release`. Existující tag zabrání opakovanému vydání při branch pushi.

1. projde E2E testy a `bun run check-code`
2. obnoví Firebase config a upload keystore z GitHub secrets
3. sestaví podepsaný APK a AAB ze stejného commitu se stejným `versionCode`
4. publikuje APK na GitHub Releases
5. v samostatném jobu nahraje AAB s českými a anglickými release notes na `internal,beta` se stavem `completed` a odešle změny ke kontrole

CI používá `versionCode = 200000000 + github.run_number`. Nový základ je vyšší než kódy původního samostatného Play workflow (`100000000 + github.run_number`), jehož čítač byl jiný. Ponech název souboru release workflow, aby čítač pokračoval.

## 1. Připrav Google Play Console

V Google Play Console:

1. založ aplikaci `fit.linky.app`, pokud ještě neexistuje
2. nastav `Testing` -> `Open testing`, dostupné země a testery interního tracku
3. dokonči store listing a povinné formuláře v app setupu; účet musí mít přístup k Open testing
4. v `Publishing overview` vypni Managed publishing, pokud se mají schválené verze zveřejnit automaticky

Bez dokončeného základního nastavení umí Play API vracet chyby i když je AAB validní.

## 2. Vytvoř service account pro Play API

V Google Cloud projektu propojeném s Play Console:

1. otevři `APIs & Services` -> `Credentials`
2. vytvoř nový `Service account`
3. vygeneruj JSON key
4. v Play Console otevři `Users and permissions`
5. přidej service account a dej mu oprávnění `Release apps to testing tracks` pro tuto aplikaci

Obsah JSON klíče ulož do GitHub secretu `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` jako čistý JSON text.

## 3. Připrav upload key secrets

Upload key vygeneruj podle [docs/android-upload-key.md](./android-upload-key.md).

Pak z něj vytvoř base64 hodnotu:

```bash
base64 -i "$HOME/.keys/linky/linky-upload-key.jks" | pbcopy
```

Do GitHub repository secrets přidej:

1. `ANDROID_UPLOAD_KEYSTORE_BASE64`
2. `ANDROID_UPLOAD_STORE_PASSWORD`
3. `ANDROID_UPLOAD_KEY_ALIAS`
4. `ANDROID_UPLOAD_KEY_PASSWORD`

## 4. Přidej Firebase config secret

Protože Android build používá FCM push konfiguraci, přidej do GitHub secrets i base64 obsah `google-services.json`:

```bash
base64 -i apps/native-shell/android/app/google-services.json | pbcopy
```

Secret se jmenuje `ANDROID_GOOGLE_SERVICES_JSON_BASE64`.

## 5. Ověř první run

Po nastavení secrets:

1. vydej novou verzi změnou `package.json` a doplněním `CHANGELOG.md`
2. otevři GitHub Actions workflow `Android APK Release`
3. počkej na job `Publish to Google Play open testing`
4. v Play Console zkontroluj `Open testing` a `Publishing overview`

## Poznámky

- Interní testeři dostávají stejný AAB jako veřejní testeři, pouze při verzovaném releasu.
- Google může release kontrolovat. Úspěšný upload neznamená okamžitou dostupnost testerům.
- Se zapnutým Managed publishing je po schválení potřeba ruční publikace. Některé stavy po zamítnutí releasu mohou vyžadovat ruční odeslání ke kontrole.
- AAB zůstává i jako GitHub Actions artifact; neúspěšný Play job lze spustit znovu bez nového buildu.
- Nastavení testování: https://support.google.com/googleplay/android-developer/answer/9845334
- Kontrola a publikování: https://support.google.com/googleplay/android-developer/answer/9859654
