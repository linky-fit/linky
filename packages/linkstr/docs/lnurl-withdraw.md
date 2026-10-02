# LNURL-withdraw sessions

The experimental bridge helpers encode an API session and request/reply bodies for an online wallet. They execute no payments. Send the JSON bodies with `Chat.sendText` and receive them as authenticated `ChatMessageReceived` text facts on `WrapInbox`, using a dedicated throwaway identity rather than the user's conversation identity.

`makeLnurlWithdrawSession(options, secretKey, now)` signs a session locally. `readLnurlWithdrawSession(input, now)` checks its signature, purpose, schema and two-minute lifetime. The authorization is never published as a plain event. Keep the session key on the wallet device; the API receives only the signed event.

`parseLnurlWithdrawBridgeRequest(text)` and `parseLnurlWithdrawBridgeReply(text)` return a validated body or `null`. A probe asks the wallet to reply `ready`. A pay request carries the merchant's invoice. Its `accepted` reply means the wallet accepted responsibility, not that Lightning settled. Authenticate the sender, match the session and request ids, and honor the deadline before acting.

The wallet owns amount and fee authorization, durable session-to-invoice binding and payment recovery. Persist those before replying `accepted`. Duplicate requests reuse their outcome; another invoice cannot reuse the same session. A delivery timeout leaves the outcome unknown, so do not automatically pay a replacement invoice.

Use a real encrypted round trip to establish relay compatibility for the exact keys involved. The current default transport does not authenticate with NIP-42; relays requiring authentication or paid access may fail the probe. No relay advertisement guarantees delivery, and a relay's publish acknowledgement does not mean the wallet accepted a request.
