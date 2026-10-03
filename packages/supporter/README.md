# @linky-fit/supporter

What the web app and the supporter service (`apps/supporter`) must agree on: the supporter tiers and the payment that reaches each, the mints a supporter payment may come from, the Linky Bot npub and the rule for how long a supporter badge counts.

Both sides import these values instead of copying them. Env overrides for local development (`VITE_LINKY_BOT_NPUB`, `VITE_SUPPORTER_ACCEPTED_MINTS`, `VITE_SUPPORTER_VALIDITY_SECONDS`, `SUPPORTER_ACCEPTED_MINTS`) are read by the consumers, not here.
