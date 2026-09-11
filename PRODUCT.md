# Linky

<!-- impeccable:product-schema 1 -->

## Platform

web

Linky is a mobile-first PWA with Capacitor native shells. The shared UI supports web and React Native; a wrapper alone does not imply a separate native design language.

## Users

Bitcoiners are the first target audience. They already understand Bitcoin; many also know Nostr and Cashu, but that familiarity is not universal.

The broader product is for everyday people chatting and paying friends. Core tasks must work without learning wallet infrastructure, while remaining useful to people who already use Bitcoin. Protocol knowledge is optional, not a prerequisite for finding a contact, chatting, or making a payment.

## Product purpose

Linky brings contacts, private messages, and bitcoin payments together. A person should be able to find a friend, chat, send or receive money, and understand what happened.

## Positioning

Contact-based payments and encrypted chat share a relationship context. Nostr provides messaging and identity; Lightning and Cashu provide payment flows. Local-first storage lets people retain their data and sync it between devices.

## Operating context

People use Linky in mobile browsers, as an installed PWA, and through native shells. Local data access and remote message or payment completion are distinct states.

Common tasks include adding or finding contacts, sharing a profile by QR, chatting, paying a contact, receiving funds, and reviewing payment history. The app supports Czech, English, and German.

## Capabilities and constraints

- Contacts support editing, grouping, and QR scanning and sharing.
- Private chat supports encrypted messages, images, PDFs, replies, and reactions.
- Payments include Lightning invoices and addresses, Cashu payments to contacts, payment requests, and proxy payment offers for supported bank QR codes.
- Wallet workflows include top-up, history, token import and issuance, mint management, and recovery of pending operations.
- Sign-in uses a Nostr secret key or a 20-word SLIP-39 recovery share. An email address or phone number is not required.
- Recovery and advanced infrastructure controls remain available to people who need them.

Preserve the actual meaning of payment and delivery states. Starting an operation does not establish completion. Pending or issued tokens are not necessarily available funds. Read the current implementation and relevant sections of `docs/architecture.md` before changing behavior.

## Current redesign scope

Build and refine the component library in `packages/ui` and its working examples in `apps/ui-book`. Dave wants a good component library before app integration. Until he authorizes that next phase, UI implementation work stays in these two directories.

The production app is `apps/web-app`. It retains its existing components and plain CSS. Use it as evidence for product behavior while developing the next UI separately.

Reusable presentation belongs in `packages/ui`. `apps/ui-book` exercises the real exports with fictional fixtures and local state. App consumers own payments, messaging, validation, persistence, navigation, and platform integration, as documented in `docs/architecture.md`.

## Brand commitments

The product name is Linky. The earlier design work records Dave's decision to retain its identity. Continue from the current shared UI and approved prototype when refining the library.

`packages/ui` holds the current implementation. The earlier prototype at `/Users/kaladivo/workspace/temp/linky-design` provides design history through `DESIGN-BRIEF.md` and `DESIGN.md`. Its screen decisions and sample interactions do not establish production behavior or authorize app integration.

## Evidence on hand

- `README.md` describes the product and supported workflows.
- `apps/web-app/src/pages/`, `apps/web-app/src/types/route.ts`, and `apps/web-app/src/i18n/` provide existing screens, routes, and terminology.
- `packages/ui/README.md` documents the component contracts; `packages/ui/src/` contains the current components and tokens.
- `apps/ui-book/` provides interactive examples, both themes, narrow-width previews, and catalog tests.
- `docs/architecture.md` records behavior and ownership constraints.
- `/Users/kaladivo/workspace/temp/linky-design/PRODUCT.md` records the earlier product interview. The audience and implementation scope in this document supersede that draft.

The prototype and catalog use illustrative people and simulated operations. No user-research results or usability measurements were supplied during initialization.

## Product principles

- Start with bitcoiners' real needs while making everyday tasks understandable without protocol knowledge.
- Organize conversations and payments around people.
- Keep the recipient, amount, and actual outcome clear before and after an action.
- Preserve recovery and advanced controls without requiring their use before chatting or paying a friend.

## Open decisions

- Which app screens to integrate first, after the component library is ready.
- Any product-specific accessibility requirements beyond the existing keyboard, touch, text-scaling, and localization expectations.
