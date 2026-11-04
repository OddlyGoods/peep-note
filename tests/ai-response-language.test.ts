import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AI_RESPONSE_LANGUAGES, resolveAiResponseLanguage, normalizeAiResponseLanguage, aiResponseLanguageName } from '../shared/aiResponseLanguage'
import { capturePrompt } from '../shared/captureAnalysis'

test('response language defaults follow the app language and explicit selections stay independent', () => {
  for (const ui of ['en', 'ko', 'ja', 'zh']) assert.equal(resolveAiResponseLanguage('auto', ui), ui)
  assert.equal(resolveAiResponseLanguage('fr', 'ko'), 'fr')
  assert.equal(resolveAiResponseLanguage('ar', 'en'), 'ar')
  assert.equal(resolveAiResponseLanguage(null, 'ja'), 'ja')
  assert.equal(resolveAiResponseLanguage('auto', 'unsupported'), 'en')
  assert.equal(normalizeAiResponseLanguage('unsupported'), 'auto')
  assert.equal(new Set(AI_RESPONSE_LANGUAGES.map(option => option.value)).size, AI_RESPONSE_LANGUAGES.length)
})

test('Magic Pen preserves interface language while all supported reply languages reach the prompt', () => {
  for (const language of AI_RESPONSE_LANGUAGES) {
    const prompt = capturePrompt('ko', [{ question: 'Earlier question', answer: 'Earlier answer', elapsedMs: 1 }], 'New question', language.value)
    assert.ok(prompt.includes(`Reply in ${aiResponseLanguageName(language.value)}.`))
    assert.ok(prompt.includes('Earlier answer'))
  }
  assert.match(capturePrompt('ja', [], 'Explain'), /Reply in Japanese/)
})
