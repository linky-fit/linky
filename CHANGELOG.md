# Changelog

All notable user-facing changes to Linky are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Every release must include `en-US` followed by `cs-CZ`; the text is also used
on Google Play and must stay within 500 characters per language.

Všechny významné uživatelské změny Linky jsou uvedené v tomto souboru.
Formát vychází z [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Každá vydaná verze musí obsahovat nejprve `en-US` a potom `cs-CZ`; text se
používá také v Google Play a musí se vejít do 500 znaků na jazyk.

## [Unreleased]

### en-US

### cs-CZ

## [26.9.7] - 2026-09-04

### en-US

- Payments sent to your `<npub>@npub.cash` address are now collected automatically alongside `<npub>@linky.fit` payments.
- Fixed changing the default mint when your profile uses another Lightning address.

### cs-CZ

- Platby poslané na vaši adresu `<npub>@npub.cash` se nyní automaticky přijmou stejně jako platby na `<npub>@linky.fit`.
- Opravena změna výchozího mintu, když profil používá jinou Lightning adresu.

## [26.9.6] - 2026-09-03

### en-US

- Scanned bank QR payments (SPD, EPC, PAY by square) can be edited before sending the offer; account and BIC are checked.
- Contact search: faster, results stream in, Linky users and NIP-05 matches come first, accent-insensitive.
- Lightning addresses work in any letter case; fixed-amount LNURL payments survive re-quotes; server errors are shown.
- Receive amounts can be pasted from the clipboard.
- Mint fee estimate shows one decimal.
- No more automatic swapping to the main mint.

### cs-CZ

- Bankovní QR platby (SPD, EPC, PAY by square) lze před odesláním nabídky upravit; účet a BIC se kontrolují.
- Hledání kontaktů: rychlejší, výsledky přibývají průběžně, uživatelé Linky a NIP-05 shody první, bez ohledu na diakritiku.
- Lightning adresy nezávisí na velikosti písmen; LNURL platby s pevnou částkou přežijí přepočet; chyby serveru se zobrazí.
- Částku k přijetí lze vložit ze schránky.
- Odhad poplatku mintu má jedno desetinné místo.
- Zrušen automatický převod do hlavního mintu.

## [26.9.5] - 2026-09-01

### en-US

- Proxy payment offers can reach recipients one by one with an adjustable delay; recipients keep their order and queued contacts are visible in the offer detail.
- The proxy payment detail shows a four-step progress bar, names who accepted, and the amount can be tapped to switch its unit.
- Clearer payer view: the confirmation button sits right under the QR code and payment details are collapsed by default.
- New Linky users now appear in add-contact suggestions right after finishing sign-up.

### cs-CZ

- Nabídky proxy plateb lze posílat příjemcům postupně s nastavitelnou prodlevou; příjemci mají dané pořadí a čekající kontakty jsou vidět v detailu nabídky.
- Detail proxy platby ukazuje čtyřdílný ukazatel průběhu, jméno toho, kdo nabídku přijal, a klepnutím na částku lze přepnout jednotku.
- Přehlednější pohled plátce: potvrzení je hned pod QR kódem a detaily platby jsou sbalené.
- Noví uživatelé Linky se hned po dokončení registrace zobrazují v návrzích při přidávání kontaktu.

## [26.9.4] - 2026-09-01

### en-US

- Reworked Cashu wallet internals for more reliable sends, receives, top-ups, Lightning payments, and token recovery.
- Existing balances and unfinished top-ups or automatic swaps now migrate safely to the new wallet engine.

### cs-CZ

- Přepracované vnitřní fungování Cashu peněženky zvyšuje spolehlivost odesílání, příjmu, dobíjení, Lightning plateb a obnovy tokenů.
- Stávající zůstatky a nedokončená dobití či automatické převody se bezpečně převedou do nové peněženky.

## [26.9.3] - 2026-08-28

### en-US

- Search for new contacts by name: the add-contact screen shows up to three matching Nostr profiles, with exact npub/NIP-05 matches highlighted.
- The add-contact screen lists the newest Linky users from the last hour.
- New-profile setup is split into two steps: pick your name, then choose how others see you — upload a photo, take a selfie with the front camera, or edit the generated avatar.
- Refreshed welcome screen with clearer texts.

### cs-CZ

- Hledání nových kontaktů podle jména: obrazovka přidání kontaktu ukáže až tři odpovídající Nostr profily, přesná shoda npub/NIP-05 je zvýrazněná.
- Obrazovka přidání kontaktu ukazuje nejnovější uživatele Linky za poslední hodinu.
- Vytvoření profilu je rozdělené do dvou kroků: nejdřív jméno, potom jak tě uvidí ostatní — nahrát fotku, vyfotit selfie přední kamerou nebo upravit vygenerovaného avatara.
- Přepracovaná úvodní obrazovka s jasnějšími texty.

## [26.9.2] - 2026-08-26

### en-US

- Send PDF files in chat (up to 2 MB); recipients see a preview and can open or save them.
- Add contacts mentioned in a message to a group straight from the chat.
- Redesigned main mint selection with a Recommended badge and fees shown for the selected mint.
- Custom mint URLs no longer need the https:// prefix.
- Bank payment offers now show clearly when the payout was rejected.

### cs-CZ

- Posílání PDF v chatu (do 2 MB); příjemce vidí náhled a může PDF otevřít nebo uložit.
- Kontakty ze zprávy lze přidat do skupiny přímo z chatu.
- Přepracovaný výběr hlavního mintu se štítkem Doporučeno a poplatky u zvoleného mintu.
- Vlastní URL mintu už nevyžaduje předponu https://.
- Nabídky bankovní platby nyní jasně ukazují zamítnutou výplatu.

## [26.9.1] - 2026-08-15

### en-US

- Messages and payment offers now recover more reliably after relay interruptions.
- Archived contacts keep their chat history and return automatically when a new message arrives.
- Fixed competing proxy-payment acceptances and profile updates after changing Nostr keys.

### cs-CZ

- Zprávy a nabídky plateb se nyní po výpadku relay serveru obnovují spolehlivěji.
- Archivované kontakty si zachovají historii chatu a po nové zprávě se automaticky obnoví.
- Opraveny souběžné příjmy proxy plateb a aktualizace profilu po změně Nostr klíčů.

## [26.9.0] - 2026-08-07

### en-US

- Linky now asks for consent before using temporary in-memory storage when persistent browser storage is unavailable.
- Improved chat layout and scrolling around the keyboard on iOS.
- Tapping actions next to an input no longer dismisses the keyboard unnecessarily.
- Message actions now appear above the chat composer on iOS.

### cs-CZ

- Linky se nyní zeptá na souhlas s použitím dočasné paměti, pokud není dostupné trvalé úložiště prohlížeče.
- Vylepšeno rozložení a posouvání chatu kolem klávesnice na iOS.
- Klepnutí na akce vedle vstupního pole už zbytečně nezavírá klávesnici.
- Akce zpráv se na iOS nyní zobrazují nad polem pro psaní.

## [26.8.5] - 2026-08-05

### en-US

- App updates now apply automatically on startup instead of showing an update banner.
- Short conversations stay scrollable above the keyboard on iOS.
- The conversation stays visible behind the reaction menu.
- Fixed a loading loop when creating an incognito profile.

### cs-CZ

- Aktualizace aplikace se nyní při spuštění použijí automaticky místo zobrazení lišty s výzvou.
- Krátké konverzace jdou na iOS posouvat i nad otevřenou klávesnicí.
- Konverzace zůstává viditelná za nabídkou reakcí.
- Opravena smyčka načítání při vytváření inkognito profilu.

## [26.8.4] - 2026-08-04

### en-US

- Fixed a crash when opening the app from a notification while it was closed.
- Notification setup now reports when push is not supported in the build instead of showing "Denied".

### cs-CZ

- Opraven pád aplikace při otevření z notifikace ve chvíli, kdy byla aplikace vypnutá.
- Nastavení notifikací nyní hlásí, když build nepodporuje push, místo zobrazení „Zamítnuto".

## [26.8.3] - 2026-08-03

### en-US

- Messages and proxy payment offers now recover more reliably after an internet or relay outage, without requiring an app restart.
- The Android QR scanner falls back to a full-screen preview when needed.
- The public website has refreshed privacy icons.

### cs-CZ

- Zprávy a nabídky proxy plateb se po výpadku internetu nebo relay serveru obnoví spolehlivěji, bez nutnosti restartovat aplikaci.
- QR skener na Androidu v případě potřeby použije náhled přes celou obrazovku.
- Veřejný web má nové ikony soukromí.

## [26.8.2] - 2026-08-02

### en-US

- Proxy payments now group active offers, show previous response times, handle simultaneous recipients more clearly, and let either side add one minute.
- Payment confirmations stay attached to the offer and offer statuses are clearer in chats.
- The Android QR preview now fits the visible scanning frame.
- Language selection has its own settings page.
- The public website has a refreshed hero image and layout.

### cs-CZ

- Proxy platby nově seskupují aktivní nabídky, ukazují předchozí časy odezvy, přehledněji řeší více příjemců a oběma stranám dovolují přidat minutu.
- Potvrzení platby zůstává u nabídky a její stav je v chatu čitelnější.
- Náhled QR skeneru na Androidu nyní odpovídá viditelnému rámečku.
- Výběr jazyka má vlastní stránku nastavení.
- Veřejný web má nový úvodní obrázek a upravené rozložení.

## [26.8.1] - 2026-08-01

### en-US

- New desktop navigation makes contacts, wallet, and settings clearer.
- The app is now available in German.
- Contacts can belong to multiple groups; contacts mentioned in a message can be saved together.
- Bank QR payments support Czech SPD, Slovak PAY by square, and European EPC/SEPA.
- Decimal input can be enabled for fiat amounts.
- The scanner focuses better, supports camera switching, and reads QR codes more reliably.
- Push notification reliability has been improved.

### cs-CZ

- Nové desktopové rozhraní zpřehledňuje kontakty, peněženku a nastavení.
- Aplikace je nově dostupná také v němčině.
- Kontakt může patřit do více skupin a kontakty zmíněné v přijaté zprávě lze uložit najednou.
- Bankovní QR platby podporují české SPD, slovenské PAY by square i evropské EPC/SEPA.
- U částek ve fiat měnách lze zapnout desetinné zadávání.
- Skener lépe vybírá a ostří kameru, umožňuje přepínání kamer a spolehlivěji čte QR kódy.
- Vylepšili jsme spolehlivost push notifikací.

## [26.7.10] - 2026-07-31

### en-US

- Bank payment offers now survive an app reload on the device where they were created.
- Nostr inbox processing is more consistent across active chats, background sync, reactions, and unknown senders.
- Cashu message payments and wallet operations are more reliable.
- Startup and push registration no longer perform unnecessary work before login.

### cs-CZ

- Nabídky bankovní platby nově přežijí opětovné načtení aplikace na zařízení, kde vznikly.
- Zpracování Nostr zpráv je jednotnější v otevřeném chatu, synchronizaci na pozadí, reakcích i u neznámých odesílatelů.
- Cashu platby ve zprávách a operace peněženky jsou spolehlivější.
- Spuštění aplikace a registrace push již před přihlášením nedělají zbytečnou práci.

## [26.7.9] - 2026-07-30

### en-US

- Desktop now offers a split contacts-and-wallet view with persistent search and filters.
- Mobile scrolling, swipe gestures, chat positioning around the keyboard, and Android back navigation are smoother and more predictable.
- Chat, Cashu, owner-lane sync, and push delivery received broad stability and performance fixes.
- Automated tests now run in CI.

### cs-CZ

- Desktop nově nabízí rozdělený pohled na kontakty a peněženku s trvale dostupným hledáním a filtry.
- Posouvání na mobilu, gesta, pozice chatu při otevření klávesnice a tlačítko Zpět na Androidu fungují plynuleji a předvídatelněji.
- Chat, Cashu, synchronizace datových větví a push dostaly řadu oprav stability a výkonu.
- Automatické testy se nově spouštějí v CI.

## [26.7.8] - 2026-07-28

### en-US

- Proxy bank payments now have a dedicated progress screen with clearer status, countdowns, recipient handling, and direct notification links.
- Active proxy offers stay visible while navigating contacts and chats.
- The Push/Service Worker debug page no longer overlaps on small screens.

### cs-CZ

- Proxy bankovní platby mají vlastní obrazovku průběhu s jasnějšími stavy, odpočtem, správou příjemců a přímými odkazy z notifikací.
- Aktivní proxy nabídky zůstávají viditelné při pohybu mezi kontakty a chaty.
- Ladicí stránka Push/Service Worker se na malých displejích již nepřekrývá.

## [26.7.7] - 2026-07-28

### en-US

- Android native push notifications are now enabled for production builds.
- The Back up keys guide now opens and completes correctly, with clearer copy instructions.

### cs-CZ

- Produkční sestavení pro Android nově podporuje nativní push notifikace.
- Průvodce zálohou klíčů se nyní správně otevírá i dokončuje a má srozumitelnější pokyny ke kopírování.

## [26.7.6] - 2026-07-22

### en-US

- Cashu tokens and proofs are displayed more clearly in chats, including overpaid invoice change.
- Notification taps now open the relevant conversation directly.
- Image uploads are smaller and more reliable, and LNURL/lightning-address handling has improved.
- Identity and older local-first data lanes load and synchronize more reliably.
- Zapstore releases are now automated.

### cs-CZ

- Cashu tokeny a proofs jsou v chatu přehlednější, včetně vrácené hodnoty z přeplacené faktury.
- Klepnutí na notifikaci nově otevře příslušnou konverzaci.
- Obrázky se nahrávají úsporněji a spolehlivěji a zlepšilo se zpracování LNURL i lightning adres.
- Identita a starší větve lokálních dat se načítají a synchronizují spolehlivěji.
- Vydávání přes Zapstore je automatizované.

## [26.7.5] - 2026-07-13

### en-US

- Contacts shared in chat are now shown as interactive pills and groups can be mentioned at once.
- Profile photos can be cropped before saving.
- Archived contacts are easier to recognize and restore.
- Bank-payment reimbursements have a dedicated notification.
- The wallet warns when a larger balance may be better suited to hardware-wallet support.

### cs-CZ

- Kontakty sdílené v chatu se zobrazují jako interaktivní štítky a lze zmínit celou skupinu najednou.
- Profilovou fotku lze před uložením oříznout.
- Archivované kontakty lze snáz poznat a obnovit.
- Proplacení bankovní platby má vlastní notifikaci.
- Peněženka upozorní, když už může být pro větší zůstatek vhodnější hardwarová peněženka.

## [26.7.4] - 2026-07-10

### en-US

- Adding a contact now suggests people you might know and opens existing contacts instead of duplicating them.
- Notifications show contact names more consistently.
- Custom lightning-address validation and purchase flow have improved.
- Proxy-payment loading and bank-app handoff are more reliable.
- Long bursts of notifications no longer flood the screen with toasts.

### cs-CZ

- Přidávání kontaktu nově nabízí lidi, které možná znáte, a existující kontakt otevře místo vytvoření duplicity.
- Notifikace zobrazují jména kontaktů jednotněji.
- Zlepšilo se ověření i nákup vlastní lightning adresy.
- Načítání proxy plateb a předání do bankovní aplikace je spolehlivější.
- Větší množství notifikací již nezahltí obrazovku oznámeními.

## [26.7.3] - 2026-07-06

### en-US

- The new-contact screen can search by npub, NIP-05, or reserved name as you type.
- Search results can be opened directly, while unknown identifiers can be used to create a contact manually.
- Contact onboarding has been updated for the new search flow.
- Avatar choices and icons have been expanded and polished.

### cs-CZ

- Obrazovka nového kontaktu umí během psaní hledat podle npub, NIP-05 nebo rezervovaného jména.
- Výsledek lze rovnou otevřít a z neznámého identifikátoru ručně vytvořit kontakt.
- Průvodce přidáním kontaktu odpovídá novému hledání.
- Výběr avatarů a ikon byl rozšířen a upraven.

## [26.7.2] - 2026-07-04

### en-US

- Notification setup and delivery checks are more reliable.
- Master keys now have a dedicated settings page with explicit show and hide controls.
- Transaction history calculates and displays Lightning fees more accurately.

### cs-CZ

- Nastavení a kontrola doručování notifikací jsou spolehlivější.
- Hlavní klíče mají vlastní stránku nastavení s jasným zobrazením a skrytím.
- Historie transakcí počítá a zobrazuje Lightning poplatky přesněji.

## [26.7.1] - 2026-07-02

### en-US

- Linky can scan Czech SPD bank-payment QR codes, open them in a bank app, and ask trusted contacts to pay in exchange for sats.
- Chats can send end-to-end encrypted images with local caching and save/open actions.
- Bank-payment offers now show their progress and status in chat.
- Cashu token messages are recognized and presented more clearly.

### cs-CZ

- Linky umí načíst české bankovní QR platby SPD, otevřít je v bankovní aplikaci a požádat známé o zaplacení výměnou za saty.
- V chatu lze posílat koncově šifrované obrázky, lokálně je ukládat a znovu otevřít či stáhnout.
- Nabídky bankovní platby zobrazují v chatu svůj průběh a stav.
- Cashu tokeny ve zprávách se rozpoznávají a zobrazují přehledněji.

[unreleased]: https://github.com/hynek-jina/linky/compare/v26.9.5...HEAD
[26.9.5]: https://github.com/hynek-jina/linky/compare/v26.9.4...v26.9.5
[26.9.4]: https://github.com/hynek-jina/linky/compare/v26.9.3...v26.9.4
[26.9.3]: https://github.com/hynek-jina/linky/compare/v26.9.2...v26.9.3
[26.9.2]: https://github.com/hynek-jina/linky/compare/v26.9.1...v26.9.2
[26.9.1]: https://github.com/hynek-jina/linky/compare/v26.9.0...v26.9.1
[26.9.0]: https://github.com/hynek-jina/linky/compare/v26.8.5...v26.9.0
[26.8.5]: https://github.com/hynek-jina/linky/compare/v26.8.4...v26.8.5
[26.8.4]: https://github.com/hynek-jina/linky/compare/v26.8.3...v26.8.4
[26.8.3]: https://github.com/hynek-jina/linky/compare/v26.8.2...v26.8.3
[26.8.2]: https://github.com/hynek-jina/linky/compare/v26.8.1...v26.8.2
[26.8.1]: https://github.com/hynek-jina/linky/compare/v26.7.10...v26.8.1
[26.7.10]: https://github.com/hynek-jina/linky/compare/v26.7.9...v26.7.10
[26.7.9]: https://github.com/hynek-jina/linky/compare/v26.7.8...v26.7.9
[26.7.8]: https://github.com/hynek-jina/linky/compare/v26.7.7...v26.7.8
[26.7.7]: https://github.com/hynek-jina/linky/compare/v26.7.6...v26.7.7
[26.7.6]: https://github.com/hynek-jina/linky/compare/v26.7.5...v26.7.6
[26.7.5]: https://github.com/hynek-jina/linky/compare/v26.7.4...v26.7.5
[26.7.4]: https://github.com/hynek-jina/linky/compare/v26.7.3...v26.7.4
[26.7.3]: https://github.com/hynek-jina/linky/compare/v26.7.2...v26.7.3
[26.7.2]: https://github.com/hynek-jina/linky/compare/v26.7.1...v26.7.2
[26.7.1]: https://github.com/hynek-jina/linky/compare/v26.6.10...v26.7.1
