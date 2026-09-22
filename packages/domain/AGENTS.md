# @linky/domain

Shared branded ids only. Add an id here when a second package needs to name the same rows as `@linky/linksync`; keep domain logic, schemas and repositories in their own packages. A brand defined here is never widened to `string` in another package's public types — if a package needs the id, it depends on this package.
