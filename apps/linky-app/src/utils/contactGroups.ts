export const normalizeContactGroups = (groups: readonly string[]): string[] => {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const value of groups) {
    const group = value.trim();
    const key = group.toLocaleLowerCase();
    if (!group || seen.has(key)) continue;
    seen.add(key);
    result.push(group);
  }

  return result;
};

export const getContactGroups = (contact: {
  groupName?: unknown;
  groupNamesJson?: unknown;
}): string[] => {
  const legacyGroup =
    typeof contact.groupName === "string" ? contact.groupName.trim() : "";
  const json =
    typeof contact.groupNamesJson === "string"
      ? contact.groupNamesJson.trim()
      : "";

  if (!json) return normalizeContactGroups([legacyGroup]);

  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return normalizeContactGroups([legacyGroup]);
    const groups = parsed.filter(
      (value): value is string => typeof value === "string",
    );
    return normalizeContactGroups([...groups, legacyGroup]);
  } catch {
    return normalizeContactGroups([legacyGroup]);
  }
};

export const serializeContactGroups = (groups: readonly string[]): string =>
  JSON.stringify(normalizeContactGroups(groups));
