// STUB: shared-core
import type { TextBlock } from '../types/domain';

export interface LayoutLine { text: string; top: number; height: number; left: number; fontSize?: number }

// Paragraphs from vertical gaps/indents; titles from fontSize/uppercase/short isolated lines. Stub: one paragraph.
export function buildBlocksFromLines(lines: LayoutLine[]): TextBlock[] {
  const text = lines.map((l) => l.text.trim()).filter((t) => t.length > 0).join(' ');
  return text.length > 0 ? [{ kind: 'paragraph', text }] : [];
}

export function blocksToPlainText(blocks: TextBlock[]): string {
  return blocks.map((b) => b.text).join('\n\n');
}
