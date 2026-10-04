import { canonicalJsonBytes } from "./canonicalJson";

const text = (value: unknown) => {
  const bytes = canonicalJsonBytes(value);
  return bytes === null ? null : new TextDecoder().decode(bytes);
};

describe("canonicalJsonBytes", () => {
  it("sorts keys, drops whitespace and escapes only quote and backslash", () => {
    expect(text({ b: [1, true, null], a: 'say "hi" \\ 3–5 €\n', "": {} })).toBe(
      '{"":{},"a":"say \\"hi\\" \\\\ 3–5 €\n","b":[1,true,null]}',
    );
  });

  it("orders keys by code point", () => {
    expect(text({ "\u{1F600}": 1, "�": 2 })).toBe('{"�":2,"\u{1F600}":1}');
  });

  it("refuses non-integer numbers", () => {
    expect(text({ a: 1.5 })).toBeNull();
  });
});
