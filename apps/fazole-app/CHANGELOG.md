# Changelog

All notable user-facing changes to the fazole.fit app are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Every release must include `en-US` followed by `cs-CZ`.

Všechny významné uživatelské změny aplikace fazole.fit jsou uvedené v tomto souboru.
Formát vychází z [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Každá vydaná verze musí obsahovat nejprve `en-US` a potom `cs-CZ`.

## [Unreleased]

## [26.10.2] - 2026-10-15

### en-US

- Welcome screen with a language switch and two plain choices: a new business or restoring an existing one.
- The shop name and the bank account are both optional; with neither filled in, the setup continues with "Set up later". The account field also takes a Czech IBAN.
- The wallet shows the balance alone; its activity list is gone.
- Settings without explanations under the rows; the shop picture is managed inside the shop details, the Bitcoin QR code picks between universal, Cashu and Lightning, and security moved to the bottom. Restoring another shop needs a device reset first.
- Wide screens keep the section rail on the terminal and the payment screen, so the terminal has no menu button there.

### cs-CZ

- Úvodní obrazovka s přepínáním jazyka a dvěma prostými volbami: nový podnik, nebo obnovení existujícího.
- Název podniku i bankovní účet jsou nepovinné; bez obojího pokračuje založení tlačítkem „Nastavím později“. Do pole účtu jde zadat i český IBAN.
- Peněženka ukazuje jen zůstatek; seznam pohybů zmizel.
- Nastavení bez vysvětlivek pod položkami; obrázek podniku se spravuje v údajích podniku, bitcoinový QR kód vybírá mezi univerzálním, Cashu a Lightning a zabezpečení se přesunulo dolů. Obnova jiného podniku vyžaduje nejdřív reset zařízení.
- Na širokých obrazovkách zůstává lišta sekcí i na terminálu a na platbě, takže terminál tam nemá tlačítko menu.

## [26.10.1] - 2026-10-15

### en-US

- First release: a payment terminal for bank transfers (QR), Lightning and Cashu.
- Payment history, bitcoin withdrawals to Linky or Lightning, and a support chat.
- Sign in with a Linky recovery seed. Czech and English.

### cs-CZ

- První vydání: platební terminál pro bankovní převody (QR), Lightning a Cashu.
- Historie plateb, výběry bitcoinu do Linky či přes Lightning a chat s podporou.
- Přihlášení obnovovací frází z Linky. Čeština a angličtina.
