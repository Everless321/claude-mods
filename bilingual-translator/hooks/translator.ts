export type TranslateDirection = 'zh2en' | 'en2zh'

export interface TranslatorConfig {
  apiBaseUrl: string
  apiKey: string
  model: string
  disableThinking?: boolean
  reasoningEffort?: string
  enableInputTranslate: boolean
  enableOutputTranslate: boolean
  timeoutMs: number
}

const CJK_CHAR = /[\u4e00-\u9fff]/
const CJK_GLOBAL = /[\u4e00-\u9fff]/g
const ASCII_WORD = /[A-Za-z]{2,}/g

// Match fenced code blocks (``` or ~~~) or inline code spans (`...`).
const CODE_SPAN = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`)/g

export function hasChinese(text: string): boolean {
  return CJK_CHAR.test(text)
}

/** Skip output translation if the assistant already replied predominantly in Chinese. */
export function isMostlyChinese(text: string): boolean {
  const stripped = text.replace(CODE_SPAN, '').trim()
  if (stripped === '') return true
  const cjkCount = stripped.match(CJK_GLOBAL)?.length ?? 0
  const enWordCount = stripped.match(ASCII_WORD)?.length ?? 0
  return cjkCount > 0 && cjkCount >= enWordCount * 2
}

export function maskCode(text: string): { masked: string; restore: (translated: string) => string } {
  const blocks: string[] = []
  const masked = text.replace(CODE_SPAN, match => {
    const token = `[[CODE_${blocks.length}]]`
    blocks.push(match)
    return token
  })
  return {
    masked,
    restore: (translated: string) =>
      translated.replace(/\[\[CODE_(\d+)\]\]/g, (full, idx) => blocks[Number(idx)] ?? full),
  }
}

export function buildEndpoint(apiBaseUrl: string): string {
  const trimmed = apiBaseUrl.trim().replace(/\/+$/, '')
  if (trimmed.endsWith('/chat/completions')) return trimmed
  return `${trimmed}/chat/completions`
}

export interface HistoryTurn {
  role: 'user' | 'assistant'
  text: string
}

export function systemPromptFor(direction: TranslateDirection, history: HistoryTurn[] = []): string {
  const base =
    direction === 'zh2en'
      ? [
          'You are a precise technical translator.',
          'Translate the user prompt from Chinese into clear, natural, concise English for an AI coding assistant.',
          'Rules:',
          '1. Keep every placeholder like [[CODE_0]] completely unchanged.',
          '2. Keep file paths, URLs, CLI flags, identifiers, and technical terms accurate.',
          '3. Output ONLY the translated English text of the CURRENT input. Do not add quotes, notes, or explanations.',
        ]
      : [
          'You are a precise technical translator.',
          'Translate the AI coding assistant response from English into natural, concise Simplified Chinese.',
          'Rules:',
          '1. Keep Markdown structure and every placeholder like [[CODE_0]] completely unchanged.',
          '2. Keep file paths, symbol names, CLI commands, and technical terms accurate.',
          '3. Output ONLY the Simplified Chinese translation of the CURRENT input.',
        ]

  if (history.length === 0) return base.join('\n')

  const formattedHistory = history
    .map(turn => `[${turn.role}]: ${turn.text}`)
    .join('\n\n')

  return [
    ...base,
    '',
    'Reference conversation history (use ONLY for resolving pronouns, context, and consistent terminology; do NOT translate or repeat the history itself):',
    '<conversation_history>',
    formattedHistory,
    '</conversation_history>',
  ].join('\n')
}

export function buildChatPayload(
  config: TranslatorConfig,
  direction: TranslateDirection,
  text: string,
  history: HistoryTurn[] = [],
): string {
  const payload: Record<string, unknown> = {
    model: config.model,
    temperature: 0.1,
    messages: [
      { role: 'system', content: systemPromptFor(direction, history) },
      { role: 'user', content: text },
    ],
  }
  if (config.disableThinking !== false) {
    payload.thinking = { type: 'disabled' }
  } else if (typeof config.reasoningEffort === 'string' && config.reasoningEffort.trim() !== '') {
    payload.reasoning_effort = config.reasoningEffort.trim()
  }
  return JSON.stringify(payload)
}

export function extractTranslatedText(rawBody: string): string | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const choices = (parsed as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) return undefined
  const first = choices[0] as { message?: { content?: unknown } } | undefined
  const content = first?.message?.content
  if (typeof content !== 'string') return undefined
  const trimmed = content.trim()
  return trimmed === '' ? undefined : trimmed
}

export type HttpFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; timeoutMs: number },
) => Promise<{ ok: boolean; status: number; text: string }>

export async function translateText(
  httpFetch: HttpFetch,
  config: TranslatorConfig,
  direction: TranslateDirection,
  source: string,
  history: HistoryTurn[] = [],
): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
  if (config.apiKey.trim() === '' && !config.apiBaseUrl.includes('localhost') && !config.apiBaseUrl.includes('127.0.0.1')) {
    return { ok: false, reason: 'missing apiKey' }
  }

  const { masked, restore } = maskCode(source)
  if (masked.trim() === '') return { ok: true, text: source }

  const headers: Record<string, string> = {
    'content-type': 'application/json',
  }
  if (config.apiKey.trim() !== '') {
    headers['authorization'] = `Bearer ${config.apiKey.trim()}`
  }

  const attempt = async (ctx: HistoryTurn[]): Promise<{ ok: true; text: string } | { ok: false; reason: string }> => {
    let res: { ok: boolean; status: number; text: string }
    try {
      res = await httpFetch(buildEndpoint(config.apiBaseUrl), {
        method: 'POST',
        headers,
        body: buildChatPayload(config, direction, masked, ctx),
        timeoutMs: config.timeoutMs,
      })
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) }
    }

    if (!res.ok) {
      return { ok: false, reason: `HTTP ${res.status}` }
    }

    const extracted = extractTranslatedText(res.text)
    if (extracted === undefined) {
      return { ok: false, reason: 'empty or invalid translation response' }
    }

    return { ok: true, text: restore(extracted) }
  }

  const first = await attempt(history)
  if (first.ok || history.length === 0) return first
  // Fallback without history if full context exceeds endpoint limits.
  return attempt([])
}
