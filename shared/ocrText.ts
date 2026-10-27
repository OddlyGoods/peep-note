// Treat OCR whitespace as word separators, including incorrectly detected
// paragraph boundaries. Also used when displaying previously saved results.
export function normalizeOcrText(text: string): string {
  return text.replace(/\s+/gu, ' ').trim()
}
