// STUB: shared-core
// Deterministic: first definition, strip parentheses/labels, cut at a full sentence <= maxWords; kidFriendly if readability ok.
export function kidifyDefinition(raw: string, maxWords: number = 30): { text: string; kidFriendly: boolean } {
  void maxWords;
  return { text: raw.trim(), kidFriendly: false };
}
