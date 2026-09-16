// STUB: shared-core
// Heuristics: plurals, feminine forms, common verb endings, elisions; first = the word itself lowercased.
export function lemmaCandidates(word: string): string[] {
  return [word.toLowerCase()];
}
