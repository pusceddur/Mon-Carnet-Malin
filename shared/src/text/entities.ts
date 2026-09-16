// STUB: shared-core
export interface Entities { numbers: string[]; years: string[]; properNouns: string[] }

export function extractEntities(text: string, isKnownWord: (w: string) => boolean): Entities {
  void text;
  void isKnownWord;
  return { numbers: [], years: [], properNouns: [] };
}
