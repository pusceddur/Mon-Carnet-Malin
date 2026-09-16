// STUB: shared-core
// Joins lines; "pho-\ntosynthèse" -> "photosynthèse" when both sides are lowercase. Stub: joins with a space.
export function joinOcrLines(lines: string[]): string {
  return lines.map((l) => l.trim()).filter((l) => l.length > 0).join(' ');
}
