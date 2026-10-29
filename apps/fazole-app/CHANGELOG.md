# Changelog

All notable user-facing changes to the Fazole app are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Every release must include `en-US` followed by `cs-CZ`.

Všechny významné uživatelské změny aplikace Fazole jsou uvedené v tomto souboru.
Formát vychází z [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Každá vydaná verze musí obsahovat nejprve `en-US` a potom `cs-CZ`.

## [Unreleased]

## [26.10.4] - 2026-10-30

### en-US

- A payment that arrives shows as a small banner at the top of the terminal instead of covering the screen, so the next charge can start right away; a direct transfer is announced the same way.
- A shop with a MONETA account can paste an API token from Internet Banka in Settings; the bank then confirms a bank QR payment by itself while its QR code is on screen, the same way a bitcoin payment is confirmed. The token is offered as soon as a MONETA account is saved and under every bank QR code until it is added.
- The bank QR code carries the shop's name as the recipient's name instead of the message for the recipient, and its fields follow the order of the banking standard's own example, so every banking app reads the instant payment request the same way.
- Every screen starts below the phone's status bar and notch, so the terminal's menu button and the other top bars are no longer hidden under them on phones with a cut-out.
- History, Wallet and Settings name themselves in a small centered top bar, like the payment screen, instead of a large heading.
- The app is called Fazole, without the ".fit": on the welcome screen, in the installed app's name and in the update notice.
- Settings pick the mint new payments are minted at, from the recommended ones or by its address.

### cs-CZ

- Příchozí platba se ukáže jako malý proužek nahoře na terminálu místo překrytí celé obrazovky, takže další účtování může začít hned; přímý převod se hlásí stejně.
- Obchod s účtem u MONETA může v Nastavení vložit API token z Internet Banky; banka pak sama potvrdí platbu bankovním QR kódem, dokud je kód na obrazovce, stejně jako se potvrzuje platba bitcoinem. Token se nabídne hned po uložení účtu u MONETA a pod každým bankovním QR kódem, dokud není přidaný.
- Bankovní QR kód nese název obchodu jako jméno příjemce místo zprávy pro příjemce a jeho pole jdou v pořadí vzorového příkazu z bankovního standardu, aby každá bankovní aplikace stejně přečetla i požadavek na okamžitou platbu.
- Každá obrazovka začíná pod stavovou lištou a výřezem displeje, takže tlačítko menu na terminálu ani ostatní horní lišty už na telefonech s výřezem nezůstávají schované pod nimi.
- Historie, Peněženka a Nastavení mají název v malé vycentrované horní liště jako obrazovka platby místo velkého nadpisu.
- Aplikace se jmenuje Fazole, bez koncovky „.fit“: na úvodní obrazovce, v názvu nainstalované aplikace i v upozornění na novou verzi.
- V nastavení lze vybrat mincovnu, u které se razí nové platby, z doporučených nebo zadáním adresy.

## [26.10.3] - 2026-10-19

### en-US

- Selected text in a field is highlighted again.
- The bean icon has a transparent background.
- The bank QR code asks the customer's bank for an instant payment.
- Cash: one button in the wallet names a Linky contact (by name, address or npub; hynek@linky.fit unless changed) and an amount. When the wallet holds that much, the contact gets a request to exchange it for cash; when it does not, the amount can be taken as a pledge: they hand the cash over and every bitcoin payment is forwarded to them until it is repaid, with a chat message at each step. The wallet shows what is still owed, in whole crowns like its balance.
- Withdrawing asks for the recipient straight away: a Linky name, an npub, a Lightning address or an invoice, with the Linky profile shown once found.
- The shop's name and picture are republished as its Nostr profile on every start, so contacts see who writes to them.

### cs-CZ

- Označený text v poli je zase zvýrazněný.
- Ikona fazole má průhledné pozadí.
- Bankovní QR kód žádá banku zákazníka o okamžitou platbu.
- Hotovost: jedno tlačítko v peněžence, kde zadáte kontakt v Linky (jméno, adresu nebo npub; výchozí hynek@linky.fit) a částku. Když peněženka tolik má, kontakt dostane žádost o směnu za hotovost; když nemá, lze částku přijmout jako zástavu: kontakt vám dá hotovost a každá přijatá bitcoinová platba se mu přeposílá, dokud se nesplatí, o každém kroku dostane zprávu do chatu. Peněženka ukazuje, kolik zbývá doplatit, v celých korunách stejně jako zůstatek.
- Výběr se rovnou ptá na příjemce: jméno v Linky, npub, Lightning adresu nebo fakturu; nalezený profil v Linky se ukáže pod polem.
- Název a obrázek obchodu se při každém spuštění znovu zveřejní jako jeho Nostr profil, takže kontakty vidí, kdo jim píše.

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
