const isShapingCharacter = (character: string): boolean => {
  const codePoint = character.codePointAt(0) ?? 0;
  return (
    codePoint === 0x200c ||
    codePoint === 0x200d ||
    (codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
    (codePoint >= 0xe0100 && codePoint <= 0xe01ef)
  );
};

export const normalizeProfileName = (value: string): string => {
  const normalized = value
    .slice(0, 4096)
    .normalize("NFC")
    .replace(/\s+/gu, " ")
    .replace(/[\p{Cc}\p{Default_Ignorable_Code_Point}]/gu, (character) =>
      isShapingCharacter(character) ? character : "",
    )
    .trim();
  const bounded = Array.from(normalized).slice(0, 80).join("").trim();
  return /[\p{L}\p{N}\p{P}\p{S}]/u.test(bounded) ? bounded : "";
};
