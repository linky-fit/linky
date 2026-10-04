# @linky-fit/keryx

- Clean room: implement from the Keryx specification only. The upstream keryx repository and its packages are GPL-3.0 and this package is 0BSD, so never read, fetch or copy their code; the demo publisher's published JSON and media are data and fine to use.
- `src/__fixtures__/` holds the demo publisher's files byte for byte, since their hashes and signatures are under test. Refresh them with `bun run capture-fixtures`; the tests take `now` from `capture.json`.
