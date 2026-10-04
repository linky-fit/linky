# @linky-fit/keryx

Client for Keryx, signed one-way broadcasts from a company to its customers over HTTPS, verified with TUF metadata and Ed25519. It parses join URLs, pairs with a company by its join origin, refreshes channels and private feeds, and returns only announcements that verified.

Protocol logic only: no React, no storage, no clock, no global `fetch`. The app passes `now` and `fetch` to every call and persists the returned state through the exported Schemas.

Read [the guide](./docs/keryx.md) before using it.
