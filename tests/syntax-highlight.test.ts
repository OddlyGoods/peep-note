import assert from 'node:assert/strict'
import test from 'node:test'
import { highlightSource } from '../src/lib/syntaxHighlight'

function originalSource(highlighted: string) {
  const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#x27': "'" }
  return highlighted.replace(/<\/?span\b[^>]*>/g, '').replace(/&(amp|lt|gt|quot|#x27);/g, (_, key) => entities[key])
}

test('HTML highlights names, attributes and values while preserving original text', () => {
  const source = '<!DOCTYPE html>\n<div class="note" title="한글 &amp; 日本語">Hello</div>\n'
  const highlighted = highlightSource(source, 'html')
  for (const token of ['hljs-name', 'hljs-attr', 'hljs-string']) assert.ok(highlighted.includes(token))
  assert.equal(originalSource(highlighted), source)
})

test('Code automatically highlights common programming languages without changing whitespace', () => {
  for (const source of [
    'def greet(name):\n\t# Greeting\n\treturn "Hello " + name\n',
    'const answer = 42;\nfunction greet(name) { return "Hello " + name; }\n',
    'SELECT name FROM users WHERE id = 42;'
  ]) {
    const highlighted = highlightSource(source, 'code')
    assert.match(highlighted, /class="hljs-/)
    assert.equal(originalSource(highlighted), source)
  }
})

test('scripts and event handlers stay escaped text in both source formats', () => {
  const source = '<script>alert("test")</script>\n<img src=x onerror="alert(1)">\n<!-- </code></pre> -->'
  for (const format of ['html', 'code'] as const) {
    const highlighted = highlightSource(source, format)
    assert.doesNotMatch(highlighted, /<(?!\/?span\b)[^>]*>/)
    assert.equal(originalSource(highlighted), source)
  }
})

test('empty, incomplete and oversized snippets remain readable without dropping content', () => {
  for (const source of ['', '<div class="incomplete', '<img onerror="test">' + 'x'.repeat(100_001)]) {
    for (const format of ['html', 'code'] as const) {
      assert.equal(originalSource(highlightSource(source, format)), source)
    }
  }
  assert.doesNotMatch(highlightSource('x'.repeat(100_001), 'code'), /<span/)
})
