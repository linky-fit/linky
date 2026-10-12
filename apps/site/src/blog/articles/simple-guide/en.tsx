import { BulletList, TextLink } from "@linky-fit/ui";
import {
  DemoFigure,
  Heading,
  Paragraph,
  ScreenshotFigure,
  Subheading,
} from "../../prose";
import { shots } from "./media";

export function Body() {
  return (
    <>
      <Paragraph>
        This guide does not describe every feature of Linky, and even the
        features it does describe are not covered in full. It is written in the
        style of “how do I do this” and “how do I do that”, so that you can
        start using Linky as soon and as easily as possible. By the time you
        want the more advanced features and settings, you will probably be at a
        level where you no longer need a guide. The screenshots show the Czech
        app; the buttons are in the same places in every language.
      </Paragraph>

      <Heading>1. Installation</Heading>
      <Subheading>Android</Subheading>
      <Paragraph>
        Get Linky from{" "}
        <TextLink href="https://play.google.com/store/apps/details?id=fit.linky.app">
          Google Play
        </TextLink>
        . When searching, type “Linky.fit”; the word Linky alone turns up other
        apps too. If you use Zapstore, Linky is there as well. After installing,
        continue with part 2, Creating an account.
      </Paragraph>
      <Subheading>iPhone</Subheading>
      <Paragraph>
        Linky is not in the App Store yet. On an iPhone you save and launch it
        as a web app (PWA). Open{" "}
        <TextLink href="https://app.linky.fit">app.linky.fit</TextLink> in
        Safari, tap the Share button, choose Add to Home Screen and confirm with
        Add. A Linky icon appears on your home screen and the app then behaves
        like any other.
      </Paragraph>
      <Paragraph>
        The same address, app.linky.fit, works in a browser on your computer.
        There is one account; your phone and your computer can use it at the
        same time.
      </Paragraph>

      <Heading>2. Creating an account</Heading>
      <Paragraph>
        You never have to enter a phone number or an e-mail address. Open Linky
        and tap Create a profile. Enter the name you want to go by in Linky and
        tap Continue. The next page, “How will others see you?”, already has an
        avatar generated for you. You can swap it with New avatar, Upload photo,
        or Take a photo right away. All of this can be changed later in the
        Profile tab, so feel free to tap Confirm profile. Linky opens in the
        Contacts tab.
      </Paragraph>
      <ScreenshotFigure
        shot={shots.welcome}
        alt="The Linky welcome screen with the buttons Create a profile and I already have a profile"
        caption="The welcome screen. Create a new account with Create a profile, or restore one with I already have a profile."
      />
      <ScreenshotFigure
        shot={shots.picture}
        alt="The page How will others see you with an avatar and the buttons Upload photo, Take a photo and New avatar"
        caption="You get an avatar right away. Upload a photo now, or any time later."
      />
      <Paragraph>
        The button I already have a profile restores an account from its keys.
        We get to that in part 2.2.
      </Paragraph>

      <Subheading>2.1 The getting-started checklist</Subheading>
      <Paragraph>
        At the top of the Contacts page there is a checklist called Getting
        started, with your score, say Completed 1/8, and the task that is up
        next. You can use Linky right away; the tasks just walk you through the
        basics. The Show how button takes you step by step to the right place in
        the app. The first five tasks are the essentials:
      </Paragraph>
      <BulletList
        items={[
          "Add contact",
          "Send a message",
          "Receive bitcoin",
          "Back up keys",
          "Pay",
        ]}
      />
      <Paragraph>
        The remaining three, registering your own Linky name, contact groups and
        setting up proxy payments, can wait until you have found your way
        around. The Android app has a ninth task, turning on the beacon, which
        lets contacts nearby see you.
      </Paragraph>
      <ScreenshotFigure
        shot={shots.checklist}
        alt="The Contacts tab with the Getting started checklist, a score of 1/8 and the task Send a message"
        caption="The Getting started checklist on the Contacts page shows the task that is up next."
      />
      <Paragraph>
        You can hide the checklist with the cross in the top right corner. The
        dismissal is saved to your account, so it will not come back after a
        restart or on another device. The full list of tasks is always available
        in Settings under Tutorial, and you can have any of them shown again
        there.
      </Paragraph>
      <ScreenshotFigure
        shot={shots.tutorial}
        alt="The Tutorial page in Settings with a list of eight tasks and Show how buttons"
        caption="Tutorial in Settings: all the tasks in one place, each with a Show how button."
      />
      <Paragraph>
        The most important task is backing up your keys, so that comes next.
      </Paragraph>

      <Subheading>2.2 Keys and their backup</Subheading>
      <Paragraph>
        Linky created your keys itself when you created your profile; there is
        nothing to generate. You need them in three situations: when you move
        your profile to another phone, when your current phone stops working,
        gets lost or stolen, and when you use Log out in Settings. Logging out
        deletes Linky’s data from the phone, and without the keys you cannot get
        back to the account, and so to your money. As long as you do not log
        out, you open Linky simply by tapping its icon.
      </Paragraph>
      <Paragraph>
        The keys are in Settings, in the Security section under Master keys.
        They are 20 words. Show reveals them, Copy puts them on the clipboard,
        and Save to passwords hands them to the password manager on your phone,
        if you have one.
      </Paragraph>
      <ScreenshotFigure
        shot={shots.masterKeys}
        alt="The Master keys page with twenty hidden words and the buttons Copy, Show and Save to passwords"
        caption="Master keys in Settings. The words stay hidden until you tap Show."
      />
      <Paragraph>
        To restore on another device, tap I already have a profile. Either paste
        all the words at once with Paste from clipboard, or type them into the
        twenty fields one by one; Linky checks each of them. The third and
        fourth word of a Linky backup are always “academic”; that is not a typo.
        The same steps open Linky on a second device, say your computer, and
        both devices then run side by side.
      </Paragraph>
      <ScreenshotFigure
        shot={shots.restore}
        alt="The Welcome back page with the button Paste from clipboard and fields for 20 words"
        caption="Restoring an account: paste the words from the clipboard, or type them one by one."
      />
      <Paragraph>
        With a hardware wallet you must never store the keys (the seed)
        electronically, as text or as a photo, so that nobody unauthorised can
        get at them. In Linky the keys are generated on the phone, so storing
        them electronically, in a password manager for instance, does not make
        things much worse. The main thing is not to leave them only on the phone
        you are using now. If it gets damaged or lost, you would lose the
        ability to restore. We recommend also writing the keys down on paper and
        storing them, or using another, more durable backup.
      </Paragraph>
      <Paragraph>
        Linky is not meant for storing large amounts; that is what hardware
        wallets are for. Keep only smaller sums in Linky, a few thousand, as
        much as you used to carry in your wallet. When you know you will be
        buying something pricier or going to an event where you will pay with
        bitcoin, top Linky up with more. That is why it matters less that your
        keys are stored electronically. If somebody unauthorised got hold of
        them, it would not be a fatal loss.
      </Paragraph>

      <Heading>3. Wallet, contacts and messages</Heading>
      <Paragraph>
        Linky is a bitcoin wallet, but you also send your contacts messages,
        photos and PDF files in it. At the bottom of the screen is a bar with
        the tabs Profile (your avatar), Contacts, Wallet, Proxy payments and
        Settings. Linky opens in the Contacts tab. We skip proxy payments in
        this guide; you will not need them at first.
      </Paragraph>
      <Paragraph>
        Even though Linky is a wallet, we start with contacts, because you use
        them for payments too and for finishing the getting-started checklist.
      </Paragraph>

      <Subheading>3.1 Contacts</Subheading>
      <Paragraph>
        Contacts shows the people you message and pay in Linky. These are not
        the contacts with phone numbers from your phone; Linky does not read
        those. You add whoever you want to Linky. Each contact shows an avatar,
        a name, a time and a preview of the last message. Tapping a contact
        opens your conversation.
      </Paragraph>
      <DemoFigure
        screen="contacts"
        caption="The Contacts tab. The button in the bottom right adds a contact."
      />

      <Subheading>3.1.1 How to add a contact to Linky</Subheading>
      <Paragraph>
        In the bottom right there is a button with a person and a plus. It opens
        the Add contact page. At the top is a big Scan contact QR button, below
        it a search field, and at the bottom Suggestions: people nearby and new
        Linky users. Linky reminds you to add only trusted contacts you know in
        person.
      </Paragraph>
      <ScreenshotFigure
        shot={shots.contactNew}
        alt="The Add contact page with the button Scan contact QR, a search field and suggestions"
        caption="Add contact. The quickest way is to scan the other person’s QR code."
      />
      <Paragraph>
        When you are standing next to each other, scanning a QR code is the
        fastest. The other person opens their Profile tab, which shows their QR
        code, and you tap Scan contact QR. Or the other way round: show your
        profile and let them scan you.
      </Paragraph>
      <ScreenshotFigure
        shot={shots.profile}
        alt="The Profile tab with an avatar, a name, a QR code, the button Share profile and a Lightning address"
        caption="The Profile tab. The other person scans the QR code; you send the link with Share profile."
      />
      <Paragraph>
        When you are not together, start typing a name or nickname into the
        search field. Linky searches among people who use Linky or another
        client of the Nostr network, which Linky runs on. It often finds several
        people with the same name. When I typed “Petr”, it found six. You tell
        the right Petr by his avatar, and if that does not help, ask him. Next
        to the right name, tap Add and the contact is saved. Next to somebody
        you already have, the button says Open instead.
      </Paragraph>
      <ScreenshotFigure
        shot={shots.contactSearch}
        alt="The Add contact page with search results for the name Hynek and Add buttons"
        caption="Searching by name. Next to the person you found, tap Add."
      />
      <Paragraph>Instead of a name, the same field also takes:</Paragraph>
      <BulletList
        items={[
          <>
            An <b>npub</b>, a long string starting with npub1. It is the public
            identifier of an account, something like an account number, which
            the other person sends you. The icon on the right of the field
            pastes it from the clipboard.
          </>,
          <>
            A <b>NIP-05</b>, a verified name in the form name@domain.com, if the
            other person has set one up.
          </>,
          <>
            A <b>reserved name</b>, a name somebody has registered on linky.fit.
            Just type “alice”, for example.
          </>,
          <>
            The <b>Lightning address</b> of someone who does not have Linky.
            Linky offers Save lightning address, and you can then send them
            money even though you will not be messaging.
          </>,
        ]}
      />
      <Paragraph>
        When Linky finds nothing, it offers a Create contact button and you fill
        in the details by hand.
      </Paragraph>
      <Paragraph>
        From a distance, the most convenient thing is a profile link. Every
        Linky user has a page at linky.fit/p/… and sends it from the Profile tab
        with Share profile. Whoever opens the link taps Open in Linky and has
        you in their contacts, with a greeting already typed.
      </Paragraph>
      <DemoFigure
        screen="profile-open"
        caption="Mia opens the profile link, taps Open in Linky and says hi to Dave."
      />

      <Subheading>3.1.2 Contact details, groups and deleting</Subheading>
      <Paragraph>
        When you tap the pencil in the top right of a conversation, the Edit
        contact page opens with the fields Name, Identifier, Lightning address
        and Group. As soon as you change something, a Save changes button
        appears at the bottom.
      </Paragraph>
      <ScreenshotFigure
        shot={shots.contactEdit}
        alt="The Edit contact page with the fields Name, Identifier, Lightning address and Group and a bin icon in the top right"
        caption="Edit contact. The bin in the top right deletes the contact."
      />
      <Paragraph>
        Change the name however you like; Linky shows it only to you. Better
        leave the identifier alone; it is the npub by which Linky recognises the
        contact. For Linky users the Lightning address has the form
        npub…@linky.fit. If the contact registers their own name, say
        pepa@linky.fit, you will see that address. In the Group field type
        Family, for instance, and confirm with Enter. Typing a new name creates
        the group, and in Contacts you can then filter by group. Tapping an
        existing group adds the contact to it.
      </Paragraph>
      <Paragraph>
        The bin icon in the top right deletes the contact with one tap. Right
        after, an Undo button appears at the bottom in case you slipped. And if
        the deleted person writes to you again, the contact comes back on its
        own, so you will not miss the message.
      </Paragraph>

      <Subheading>3.2 Messages</Subheading>
      <Paragraph>
        To write to someone, tap their contact. The conversation opens with a
        Message field at the bottom. Next to it is the attachment button, which
        adds an image or a PDF. Careful: pick the attachment before you start
        typing. As soon as there is something in the field, the attachment
        button turns into Send. An image can be up to 20 MB, a PDF 2 MB.
      </Paragraph>
      <Paragraph>
        When you tap a message, Linky offers a row of emoji for a reaction (the
        plus opens the whole emoji catalogue) and the actions Reply, Copy and
        Delete. Your own text messages also get Edit. Deleting applies to both
        sides; in place of the message, both you and the other person see only
        “Message deleted”.
      </Paragraph>
      <ScreenshotFigure
        shot={shots.messageActions}
        alt="The message actions menu with reactions and the items Reply, Edit, Copy and Delete"
        caption="Tapping a message: reactions, Reply, Edit, Copy and Delete."
      />

      <Subheading>3.2.1 Payments between you and a contact</Subheading>
      <Paragraph>
        At the bottom of the conversation are the buttons Request and Pay.
        Whether Linky shows you euros or another currency, what gets sent is
        always sats, fractions of a bitcoin. You can still enter the amount in
        your currency, say 20 EUR, and Linky converts it. Tapping the amount
        switches between currencies. By default your local currency and sats are
        on; add more currencies in Settings under Units.
      </Paragraph>
      <Paragraph>
        Request asks a contact to pay you. On the Pay to contact page, tap in
        the amount, optionally add a note, and tap Request. A Payment request
        with the amount appears in the conversation. The other person pays it
        with one tap, or declines it, and you see Declined next to the request.
      </Paragraph>
      <ScreenshotFigure
        shot={shots.contactRequest}
        alt="The Pay to contact page with an amount, a number keypad and a Request button"
        caption="A payment request. Tap in the amount on the keypad and tap Request."
      />
      <DemoFigure
        screen="chat-request"
        caption="A payment request in a conversation. The other person confirms it with one tap."
      />
      <Paragraph>
        Pay sends a contact money. On the same Pay to contact page you see the
        recipient’s name, the available amount and a small icon next to the
        name. A bean means Cashu, a bolt means Lightning; tapping it switches
        between them. Do not worry about what Cashu and Lightning are for now;
        leave Cashu, it is simpler. Tap in the amount, tap Pay, and that is it.
        You do of course need enough funds in Linky; otherwise the Pay button is
        greyed out.
      </Paragraph>
      <DemoFigure
        screen="chat-payment"
        caption="A payment to a contact arrives in the conversation as a message."
      />

      <Subheading>3.3 Wallet</Subheading>
      <Paragraph>
        In the Wallet tab you see in the middle how much money you have. Tapping
        the amount switches currencies. Below it are the buttons Receive and
        Send and the link Show transactions. In the Wallet you send money into
        Linky, receive payments even from people who do not have Linky (they
        should fix that soon), and pay for goods and services.
      </Paragraph>
      <DemoFigure
        screen="wallet"
        caption="The Wallet tab: balance, Receive, Send and transactions."
      />

      <Subheading>3.3.1 Receiving money</Subheading>
      <Paragraph>
        Tap Receive and the Top-up your account page appears. Tap in the amount
        you want to receive, switching currencies by tapping the amount, and tap
        Show top-up invoice. An invoice is simply a request for a payment of a
        given amount; that is what it is called in bitcoin.
      </Paragraph>
      <ScreenshotFigure
        shot={shots.topup}
        alt="The Top-up your account page with an amount, a keypad and the buttons Show top-up invoice, Any amount and Paste"
        caption="Top-up your account. Tap in the amount and have the invoice shown."
      />
      <Paragraph>
        The Top-up invoice page shows the amount, a line Mint: cashu.cz (do not
        worry about the mint for now; it is the service that holds your sats in
        Linky) and a QR code with the payment details. If the payer is with you,
        show it to them; they scan it into their wallet and confirm the payment.
        The money arrives in your Linky practically immediately. If the payer is
        not with you, use the Copy button under the QR code. Then paste the
        invoice as text into whichever app you both use, Signal or e-mail for
        instance.
      </Paragraph>
      <ScreenshotFigure
        shot={shots.topupInvoice}
        alt="The Top-up invoice page with an amount, the mint cashu.cz, a QR code and a Copy button"
        caption="The top-up invoice. Show the QR code to the payer, or copy the invoice and send it."
      />
      <Paragraph>
        What exactly goes into the QR code is set by Receive method in Settings,
        in the Payments section. The options are:
      </Paragraph>
      <BulletList
        items={[
          <>
            <b>Lightning</b>: a regular Lightning invoice. Any bitcoin wallet
            with Lightning support pays it.
          </>,
          <>
            <b>Cashu</b>: a request for wallets that speak Cashu. The payment
            arrives directly as Cashu, with no Lightning fees.
          </>,
          <>
            <b>Universal</b>: both in one QR code. The payer’s wallet picks
            whichever it supports. That is why it is the default; leave it.
          </>,
        ]}
      />
      <Paragraph>
        To top up Linky yourself, the steps are the same. Create an invoice and
        pay it from another wallet. If that wallet is on another phone, show it
        the QR code. If it is on the same phone or on your computer, copy the
        invoice and paste it into the other wallet.
      </Paragraph>
      <Paragraph>
        The Any amount button shows the QR code of your Lightning address.
        Anybody can send any amount they choose to it, repeatedly too, and you
        do not have to create an invoice each time. The Paste button pastes from
        the clipboard either an amount or straight away an invoice or a Cashu
        token someone sent you.
      </Paragraph>
      <ScreenshotFigure
        shot={shots.topupNoAmount}
        alt="The Receive any amount page with a QR code and a Lightning address"
        caption="Any amount: the QR code of your Lightning address, to which anybody can send as much as they like."
      />

      <Subheading>3.3.2 Sending money</Subheading>
      <Paragraph>
        Tap Send. A QR code scanner opens, with Type recipient below it and the
        buttons Paste, Issue and Gallery. Most of the time you simply point the
        phone at a merchant’s or a friend’s QR code, Linky reads it, shows the
        amount and you confirm.
      </Paragraph>
      <ScreenshotFigure
        shot={shots.send}
        alt="The Send page with a QR code scanner, the item Type recipient and the buttons Paste, Issue and Gallery"
        caption="Send. The scanner reads a QR code; the buttons below handle the other cases."
      />
      <BulletList
        items={[
          <>
            <b>Type recipient</b> is for when someone sent you an invoice as
            text. Paste a Lightning address, an invoice, an LNURL or a Cashu
            request into the field. When you start typing a name, Linky suggests
            matching contacts.
          </>,
          <>
            <b>Paste</b> does the same straight from the clipboard. Copy the
            invoice or address from the message, tap Paste, and done.
          </>,
          <>
            <b>Gallery</b> reads a QR code from a saved image, a screenshot for
            instance.
          </>,
          <>
            <b>Issue</b> creates a Cashu token, sats as text or a QR code. It is
            handy for someone who does not have a wallet yet. Send it to them
            with any app, and Linky helps them claim the token.
          </>,
        ]}
      />
      <ScreenshotFigure
        shot={shots.manualPay}
        alt="The Send page with a Recipient field for a Lightning address, an invoice, an LNURL or a Cashu request"
        caption="Typing the recipient. The field takes a Lightning address, an invoice, an LNURL or a Cashu request."
      />
      <DemoFigure
        screen="token-share"
        caption="Send an issued token with any app, even to someone without Linky."
      />

      <Heading>What next</Heading>
      <Paragraph>
        This is enough to add your first contacts, top up a little and start
        paying. The rest, proxy payments, recurring payments or your own Linky
        name, you will discover when you need it; the Tutorial in Settings leads
        you there. And when something does not work, write to the authors
        directly in Linky: Settings has a Feedback item.
      </Paragraph>
    </>
  );
}
