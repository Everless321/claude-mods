import { atom, read, update } from 'claude-code'
import type { PluginOptions, Register } from 'claude-code'

import { BoundedCache } from './cache'
import { hasChinese, isMostlyChinese, translateText } from './translator'
import type { HistoryTurn, HttpFetch, TranslatorConfig } from './translator'
import type { TranslatorUiState } from '../types'

const INPUT_STORE_KEY = 'inputOriginals'
const OUTPUT_STORE_KEY = 'outputTranslations'
const CONFIG_STORE_KEY = 'runtimeConfig'
const COMMAND_NAME = 'tr'

const uiAtom = atom(
  { plugin: 'bilingual-translator', key: 'ui' } as const,
  { inputEnabled: true, outputEnabled: true, lastRevision: 0 },
  { shape: 'tr-ui-1' },
)

function parseConfig(raw: PluginOptions): TranslatorConfig {
  return {
    apiBaseUrl: typeof raw.apiBaseUrl === 'string' && raw.apiBaseUrl.trim() !== ''
      ? raw.apiBaseUrl.trim()
      : 'https://api.deepseek.com/v1',
    apiKey: typeof raw.apiKey === 'string' ? raw.apiKey : '',
    model: typeof raw.model === 'string' && raw.model.trim() !== ''
      ? raw.model.trim()
      : 'deepseek-flash',
    disableThinking: raw.disableThinking !== false,
    enableInputTranslate: raw.enableInputTranslate !== false,
    enableOutputTranslate: raw.enableOutputTranslate !== false,
    timeoutMs: typeof raw.timeoutMs === 'number' && Number.isFinite(raw.timeoutMs) && raw.timeoutMs > 0
      ? raw.timeoutMs
      : 15000,
  }
}

function extractHistory(rawMessages: unknown): HistoryTurn[] {
  if (!Array.isArray(rawMessages)) return []
  const turns: HistoryTurn[] = []
  for (const m of rawMessages) {
    if (typeof m !== 'object' || m === null) continue
    const msg = m as { role?: unknown; text?: unknown }
    if ((msg.role === 'user' || msg.role === 'assistant') && typeof msg.text === 'string' && msg.text.trim() !== '') {
      turns.push({ role: msg.role, text: msg.text.trim() })
    }
  }
  return turns
}

function formatUserBilingual(originalZh: string, sentEn: string): string {
  return `[原文] ${originalZh}\n[已发送] ${sentEn}`
}

function formatAssistantBilingual(originalEn: string, translatedZh: string): string {
  return `${originalEn}\n\n---\n**[中文译文]**\n${translatedZh}`
}

export const register: Register = (on, options) => {
  const baseConfig = parseConfig(options)
  let runtimeInputEnabled = baseConfig.enableInputTranslate
  let runtimeOutputEnabled = baseConfig.enableOutputTranslate

  const inputOriginals = new BoundedCache(100)
  const outputTranslations = new BoundedCache(100)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND_NAME,
      description: 'Toggle or inspect bilingual CLI translation (/tr status|on|off|in|out)',
      argumentHint: 'status | on | off | in | out',
    }).catch(() => undefined)

    const home = await $.env.get('HOME').catch(() => undefined)
    const localConfigPath = home ? `${home}/.claude/bilingual-translator.local.json` : undefined

    const [savedIn, savedOut, localRaw, savedCfg] = await Promise.all([
      $.store.get(INPUT_STORE_KEY).catch(() => undefined),
      $.store.get(OUTPUT_STORE_KEY).catch(() => undefined),
      localConfigPath ? $.fs.read(localConfigPath).catch(() => undefined) : Promise.resolve(undefined),
      $.store.get(CONFIG_STORE_KEY).catch(() => undefined),
    ])
    inputOriginals.load(savedIn)
    outputTranslations.load(savedOut)
    if (typeof localRaw === 'string') {
      try {
        const localCfg = JSON.parse(localRaw) as Partial<TranslatorConfig>
        if (typeof localCfg.apiKey === 'string' && localCfg.apiKey.trim() !== '' && baseConfig.apiKey === '') {
          baseConfig.apiKey = localCfg.apiKey.trim()
        }
        if (typeof localCfg.apiBaseUrl === 'string' && localCfg.apiBaseUrl.trim() !== '') {
          baseConfig.apiBaseUrl = localCfg.apiBaseUrl.trim()
        }
        if (typeof localCfg.model === 'string' && localCfg.model.trim() !== '') {
          baseConfig.model = localCfg.model.trim()
        }
        if (typeof localCfg.disableThinking === 'boolean') {
          baseConfig.disableThinking = localCfg.disableThinking
        }
      } catch {
        // Ignore malformed local override file
      }
    }
    if (typeof savedCfg === 'object' && savedCfg !== null) {
      const c = savedCfg as Partial<TranslatorConfig>
      if (typeof c.apiKey === 'string' && c.apiKey.trim() !== '') baseConfig.apiKey = c.apiKey.trim()
      if (typeof c.apiBaseUrl === 'string' && c.apiBaseUrl.trim() !== '') baseConfig.apiBaseUrl = c.apiBaseUrl.trim()
      if (typeof c.model === 'string' && c.model.trim() !== '') baseConfig.model = c.model.trim()
    }

    await update($, uiAtom, (u): TranslatorUiState => ({
      ...u,
      inputEnabled: runtimeInputEnabled,
      outputEnabled: runtimeOutputEnabled,
    })).catch(() => undefined)

    return next(e)
  })

  on('command.run', { command: COMMAND_NAME }, async ($, e) => {
    const rawArgs = e.args.trim()
    const arg = rawArgs.toLowerCase()
    if (arg === 'on') {
      runtimeInputEnabled = true
      runtimeOutputEnabled = true
    } else if (arg === 'off') {
      runtimeInputEnabled = false
      runtimeOutputEnabled = false
    } else if (arg === 'in') {
      runtimeInputEnabled = !runtimeInputEnabled
    } else if (arg === 'out') {
      runtimeOutputEnabled = !runtimeOutputEnabled
    } else if (arg.startsWith('set ')) {
      const rest = rawArgs.slice(4).trim()
      const spaceIdx = rest.indexOf(' ')
      const field = spaceIdx === -1 ? '' : rest.slice(0, spaceIdx).trim().toLowerCase()
      const value = spaceIdx === -1 ? '' : rest.slice(spaceIdx + 1).trim()
      if (value === '' || (field !== 'key' && field !== 'url' && field !== 'model')) {
        return { text: 'Usage: /tr set <key|url|model> <value>' }
      }
      if (field === 'key') baseConfig.apiKey = value
      if (field === 'url') baseConfig.apiBaseUrl = value
      if (field === 'model') baseConfig.model = value
      await $.store.set(CONFIG_STORE_KEY, {
        apiKey: baseConfig.apiKey,
        apiBaseUrl: baseConfig.apiBaseUrl,
        model: baseConfig.model,
      }).catch(() => undefined)
      const shown = field === 'key' ? '***' : value
      return { text: `Updated ${field}=${shown}` }
    } else if (arg !== '' && arg !== 'status') {
      return { text: 'Usage: /tr [status | on | off | in | out | set <key|url|model> <value>]' }
    }

    await update($, uiAtom, (u): TranslatorUiState => ({
      inputEnabled: runtimeInputEnabled,
      outputEnabled: runtimeOutputEnabled,
      lastRevision: u.lastRevision + 1,
    })).catch(() => undefined)
    $.ui.invalidate('ui.render')

    const keyHint = baseConfig.apiKey.trim() === '' ? 'missing apiKey' : 'apiKey set'
    return {
      text: [
        `Translator: input(ZH->EN)=${runtimeInputEnabled ? 'ON' : 'OFF'}`,
        `output(EN->ZH)=${runtimeOutputEnabled ? 'ON' : 'OFF'}`,
        `model=${baseConfig.model}`,
        `endpoint=${baseConfig.apiBaseUrl}`,
        keyHint,
      ].join(' | '),
    }
  }).catch((_, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    if (!runtimeInputEnabled) return next(e)
    const rawText = e.text
    if (rawText.trim() === '' || rawText.trimStart().startsWith('/') || !hasChinese(rawText)) {
      return next(e)
    }

    const historyMessages = await $.session.messages().catch(() => [])
    const history = extractHistory(historyMessages)
    const httpFetch: HttpFetch = (url, init) => $.http.fetch(url, init)
    const res = await translateText(httpFetch, baseConfig, 'zh2en', rawText, history)
    if (!res.ok) {
      $.ui.toast(`翻译失败，已直接发送原文 (${res.reason})`, { timeoutMs: 3000 })
      return next(e)
    }

    const translated = res.text
    if (translated !== rawText) {
      // Keep original Chinese strictly in local mod storage; never put it into e.text or e.context.
      inputOriginals.set(translated, rawText)
      await $.store.set(INPUT_STORE_KEY, inputOriginals.export()).catch(() => undefined)
    }
    return next({ ...e, text: translated })
  }).catch((_, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (!runtimeOutputEnabled || e.agentId !== undefined || e.isAborted) {
      return next(e)
    }
    const answer = e.answer
    if (answer.trim() === '' || isMostlyChinese(answer)) {
      return next(e)
    }

    const historyMessages = await $.session.messages().catch(() => [])
    const history = extractHistory(historyMessages)
    const httpFetch: HttpFetch = (url, init) => $.http.fetch(url, init)
    const result = await translateText(httpFetch, baseConfig, 'en2zh', answer, history)
    if (!result.ok) {
      $.ui.log(`claude-translator: output translation skipped (${result.reason})`)
      return next(e)
    }

    outputTranslations.set(answer, result.text)
    await $.store.set(OUTPUT_STORE_KEY, outputTranslations.export()).catch(() => undefined)
    await update($, uiAtom, (u): TranslatorUiState => ({
      ...u,
      lastRevision: u.lastRevision + 1,
    })).catch(() => undefined)
    $.ui.invalidate('ui.render')

    return next(e)
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    await read($, uiAtom).catch(() => undefined)
    const text = (e.props as { text?: unknown }).text
    if (typeof text !== 'string') return next(e)
    const originalZh = inputOriginals.get(text)
    if (originalZh === undefined) return next(e)
    return next({
      ...e,
      props: {
        ...e.props,
        text: formatUserBilingual(originalZh, text),
      },
    })
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    await read($, uiAtom).catch(() => undefined)
    const text = (e.props as { text?: unknown }).text
    if (typeof text !== 'string') return next(e)
    const translatedZh = outputTranslations.get(text)
    if (translatedZh === undefined) return next(e)
    return next({
      ...e,
      props: {
        ...e.props,
        text: formatAssistantBilingual(text, translatedZh),
      },
    })
  })
}
