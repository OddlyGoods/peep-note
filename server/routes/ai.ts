import { Hono } from 'hono'
import { queryOne, queryAll, run, generateId } from '../db'
import { LOCAL_PROFILE_ID } from '../localProfile'
import fs from 'fs'
import { parseAiSummaryResult } from '../../shared/aiSummary'
import { DEFAULT_AI_MODELS, type AiProvider } from '../../shared/aiModels'

const ai = new Hono()
const MAX_SUMMARY_TOKENS = 3000

const SYSTEM_PROMPT = '당신은 업무 기록을 읽기 쉽게 정리하는 AI 어시스턴트입니다. 기록에 있는 사실·명령어·URL·결정 사항·할 일·날짜·수치는 가능한 한 보존하세요. 기록에 없는 내용은 추측하거나 만들어내지 마세요. 불확실한 내용은 단정하지 마세요. 단순 축약보다 구조화가 목적입니다. 관련 내용을 주제별로 묶고, 필요할 때 제목, 불릿 목록, 번호 목록, 코드 블록을 사용해 마크다운으로 작성하세요. 스크린샷이 포함되면 화면에서 명확히 확인되는 정보만 함께 반영하세요. 반드시 JSON 객체만 반환하세요. 코드 블록이나 다른 설명은 붙이지 마세요. {"title":"짧고 구체적인 제목","summary":"마크다운 형식의 상세 요약"}'


async function callOpenAI(apiKey: string, logsText: string, images: string[], model: string): Promise<string> {
  const reasoningModel = /^(gpt-[56](?:[.-]|$)|o[134](?:-|$))/.test(model)
  const userContent: any[] = [
    { type: 'text', text: `다음 기록들을 정리해줘:\n\n${logsText}` },
    ...images.map(b64 => ({ type: 'image_url', image_url: { url: `data:image/png;base64,${b64}`, detail: 'low' } }))
  ]
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userContent }],
      ...(reasoningModel
        ? { max_completion_tokens: MAX_SUMMARY_TOKENS, reasoning_effort: 'low' }
        : { max_tokens: MAX_SUMMARY_TOKENS, temperature: 0.5 }),
      response_format: { type: 'json_object' }
    })
  })
  if (!res.ok) { const e = await res.json() as any; throw new Error(e.error?.message ?? 'OpenAI 오류') }
  const data = await res.json() as any
  return data.choices?.[0]?.message?.content ?? '{}'
}

async function callQwen(apiKey: string, logsText: string, images: string[], model: string, baseUrl?: string | null): Promise<string> {
  const userContent: any[] = [
    { type: 'text', text: `다음 기록들을 정리해줘:\n\n${logsText}` },
    ...images.map(b64 => ({ type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } }))
  ]
  const endpoint = `${(baseUrl || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1').replace(/\/+$/, '')}/chat/completions`
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userContent }],
      max_tokens: MAX_SUMMARY_TOKENS,
      temperature: 0.5
    })
  })
  if (!res.ok) { const e = await res.json() as any; throw new Error(e.error?.message ?? 'Qwen 오류') }
  const data = await res.json() as any
  return data.choices?.[0]?.message?.content ?? '{}'
}

async function callAnthropic(apiKey: string, logsText: string, images: string[], model: string): Promise<string> {
  const parts: any[] = [
    { type: 'text', text: `다음 기록들을 정리해줘:\n\n${logsText}` },
    ...images.map(b64 => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: b64 } }))
  ]
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: MAX_SUMMARY_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: parts }]
    })
  })
  if (!res.ok) { const e = await res.json() as any; throw new Error(e.error?.message ?? 'Anthropic 오류') }
  const data = await res.json() as any
  return data.content?.filter((part: any) => part.type === 'text').map((part: any) => part.text).join('') || '{}'
}

async function callGemini(apiKey: string, logsText: string, images: string[], model: string): Promise<string> {
  const parts: any[] = [
    { text: `다음 기록들을 정리해줘:\n\n${logsText}` },
    ...images.map(b64 => ({ inline_data: { mime_type: 'image/png', data: b64 } }))
  ]
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ parts }],
        generationConfig: { maxOutputTokens: MAX_SUMMARY_TOKENS, temperature: 0.5, responseMimeType: 'application/json' }
      })
    }
  )
  if (!res.ok) { const e = await res.json() as any; throw new Error(e.error?.message ?? 'Gemini 오류') }
  const data = await res.json() as any
  return data.candidates?.[0]?.content?.parts?.filter((part: any) => !part.thought && typeof part.text === 'string').map((part: any) => part.text).join('') || '{}'
}

// POST /api/ai/summarize  { group_id }
ai.post('/summarize', async (c) => {
  const userId = LOCAL_PROFILE_ID

  const { group_id } = await c.req.json()
  if (!group_id) return c.json({ error: 'group_id 필요' }, 400)

  // 설정 조회
  const settings = queryOne<any>(
    'SELECT ai_provider, ai_model, openai_api_key, anthropic_api_key, gemini_api_key, qwen_api_key, qwen_base_url FROM settings WHERE user_id = ?',
    [userId]
  )
  const provider = settings?.ai_provider || 'openai'
  const apiKey =
    provider === 'anthropic' ? settings?.anthropic_api_key :
    provider === 'gemini'    ? settings?.gemini_api_key :
    provider === 'qwen'      ? settings?.qwen_api_key :
    settings?.openai_api_key
  if (!apiKey) return c.json({ error: 'NO_API_KEY' }, 400)
  const model = settings?.ai_model || DEFAULT_AI_MODELS[provider as AiProvider] || DEFAULT_AI_MODELS.openai

  // 그룹 확인
  const group = queryOne<any>('SELECT * FROM log_groups WHERE id = ? AND user_id = ?', [group_id, userId])
  if (!group) return c.json({ error: '그룹을 찾을 수 없습니다' }, 404)

  // 그룹 내 로그 조회
  const logs = queryAll<any>(
    "SELECT id, title, content, log_type, file_path FROM logs WHERE deleted_at IS NULL AND group_id = ? AND user_id = ? AND log_type != 'summary' AND is_secret = 0 ORDER BY created_at ASC",
    [group_id, userId]
  )
  if (logs.length === 0) return c.json({ error: '정리할 기록이 없습니다' }, 400)

  // 텍스트 구성
  const logsText = logs.map((l, i) => {
    const typeLabel = l.log_type === 'note' ? '노트' : l.log_type === 'screenshot' ? '스크린샷' : '동영상'
    return `[${i + 1}] (${typeLabel}) ${l.title || '(제목 없음)'}\n${l.content || ''}`
  }).join('\n\n')

  // 스크린샷 이미지 수집
  const images: string[] = []
  for (const l of logs) {
    if (l.log_type === 'screenshot' && l.file_path && images.length < 10) {
      try { images.push(fs.readFileSync(l.file_path).toString('base64')) } catch {}
    }
  }

  let raw = ''
  try {
    if (provider === 'anthropic') raw = await callAnthropic(apiKey, logsText, images, model)
    else if (provider === 'gemini') raw = await callGemini(apiKey, logsText, images, model)
    else if (provider === 'qwen') raw = await callQwen(apiKey, logsText, images, model, settings?.qwen_base_url)
    else raw = await callOpenAI(apiKey, logsText, images, model)
  } catch (e: any) {
    return c.json({ error: e.message }, 502)
  }

  // A group can be deleted or ungrouped while the remote request is running.
  // Do not create an active summary of records that have since left the group.
  const currentGroup = queryOne<any>('SELECT id, workspace_id FROM log_groups WHERE id = ? AND user_id = ?', [group_id, userId])
  if (!currentGroup
    || logs.some(log => !queryOne('SELECT id FROM logs WHERE id = ? AND user_id = ? AND group_id = ? AND deleted_at IS NULL AND is_secret = 0', [log.id, userId, group_id]))) {
    return c.json({ error: '기록이 변경되었습니다. 목록을 새로고침해 주세요.' }, 409)
  }

  const { title: summaryTitle, summary } = parseAiSummaryResult(raw)

  // 요약 로그 저장
  const existing = queryOne<any>(
    "SELECT id FROM logs WHERE deleted_at IS NULL AND group_id = ? AND user_id = ? AND log_type = 'summary' LIMIT 1",
    [group_id, userId]
  )
  const now = Math.floor(Date.now() / 1000)
  const latestLog = queryOne<any>(
    "SELECT created_at FROM logs WHERE deleted_at IS NULL AND group_id = ? AND user_id = ? AND log_type != 'summary' AND is_secret = 0 ORDER BY created_at DESC LIMIT 1",
    [group_id, userId]
  )
  const summaryCreatedAt = latestLog?.created_at ?? now
  const summaryWorkspaceId = currentGroup.workspace_id ?? queryOne<{ workspace_id: string | null }>(
    "SELECT workspace_id FROM logs WHERE deleted_at IS NULL AND group_id = ? AND user_id = ? AND log_type != 'summary' ORDER BY created_at ASC LIMIT 1",
    [group_id, userId]
  )?.workspace_id ?? null

  if (existing) {
    run('UPDATE logs SET title = ?, content = ?, workspace_id = ?, created_at = ?, updated_at = ? WHERE id = ?',
      [summaryTitle, summary, summaryWorkspaceId, summaryCreatedAt, now, existing.id])
  } else {
    run(
      'INSERT INTO logs (id, user_id, title, content, log_type, content_format, tags, attachments, pinned, workspace_id, group_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [generateId(), userId, summaryTitle, summary, 'summary', 'text', '[]', '[]', 0, summaryWorkspaceId, group_id, summaryCreatedAt, now]
    )
  }

  return c.json({ ok: true, summary, title: summaryTitle })
})

// GET /api/ai/key-status
ai.get('/key-status', async (c) => {
  const userId = LOCAL_PROFILE_ID
  const settings = queryOne<any>(
    'SELECT ai_provider, openai_api_key, anthropic_api_key, gemini_api_key, qwen_api_key FROM settings WHERE user_id = ?',
    [userId]
  )
  const provider = settings?.ai_provider || 'openai'
  const key =
    provider === 'anthropic' ? settings?.anthropic_api_key :
    provider === 'gemini'    ? settings?.gemini_api_key :
    provider === 'qwen'      ? settings?.qwen_api_key :
    settings?.openai_api_key
  return c.json({ has_key: !!key, provider })
})

export default ai
