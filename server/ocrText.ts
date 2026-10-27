import { normalizeOcrText } from '../shared/ocrText'

type RecognizedParagraph = { text: string; lines?: { text: string }[] }
type RecognizedBlock = { paragraphs: RecognizedParagraph[] }

export function formatOcrText(text: string, blocks?: RecognizedBlock[] | null): string {
  const paragraphs = blocks?.flatMap(block => block.paragraphs)
  const recognized = paragraphs?.length
    ? paragraphs.flatMap(paragraph => paragraph.lines?.length
      ? paragraph.lines.map(line => line.text)
      : [paragraph.text]).join(' ')
    : text
  return normalizeOcrText(recognized)
}
