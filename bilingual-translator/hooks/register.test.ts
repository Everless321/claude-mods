import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { hasChinese, isMostlyChinese, maskCode, translateText } from './translator'
import type { HttpFetch, TranslatorConfig } from './translator'

const TEST_CONFIG: TranslatorConfig = {
  apiBaseUrl: 'https://api.deepseek.com/v1',
  apiKey: 'test-key',
  model: 'deepseek-flash',
  disableThinking: true,
  enableInputTranslate: true,
  enableOutputTranslate: true,
  timeoutMs: 5000,
}

const PROMPT_BASE = { wait: false, origin: { kind: 'composer' as const } }
const SESSION_START = { cwd: '/tmp', surface: 'terminal' as const, isInteractive: true }

function setupEnv(on: On, apiKey = 'test-key', historyMessages: Array<{ role: string; text: string }> = []) {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: undefined as never }))
  on('env.get', () => ({ value: undefined }))
  on('fs.read', () => ({ value: '' }))
  on('session.messages', () => ({ value: historyMessages as never }))
  on('store.get', (_, e) => {
    if (e.key === 'runtimeConfig') return { value: { apiKey } }
    return { value: undefined }
  })
  on('store.set', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
}

test('maskCode preserves fenced and inline code spans across translation', () => {
  const input = '请帮我修复 `fooBar()` 和\n```ts\nconst x = "你好"\n```\n里的报错'
  const { masked, restore } = maskCode(input)
  expect(masked).toContain('[[CODE_0]]')
  expect(masked).toContain('[[CODE_1]]')
  expect(masked).not.toContain('fooBar()')
  expect(restore('Please fix the error in [[CODE_0]] and\n[[CODE_1]]')).toBe(
    'Please fix the error in `fooBar()` and\n```ts\nconst x = "你好"\n```',
  )
})

test('hasChinese and isMostlyChinese detect languages accurately', () => {
  expect(hasChinese('帮我看下这个 bug')).toBe(true)
  expect(hasChinese('fix this bug in src/app.ts')).toBe(false)
  expect(isMostlyChinese('这是一个纯中文回复，用来验证语言检测逻辑。')).toBe(true)
  expect(isMostlyChinese('Here is the root cause and the fix in `src/app.ts`.')).toBe(false)
})

test('translateText sends OpenAI-compatible payload and restores code blocks', async () => {
  let seenUrl = ''
  let seenBody = ''
  const fakeFetch: HttpFetch = async (url, init) => {
    seenUrl = url
    seenBody = init.body
    return {
      ok: true,
      status: 200,
      text: JSON.stringify({
        choices: [{ message: { content: 'Fix the bug in [[CODE_0]]' } }],
      }),
    }
  }

  const res = await translateText(fakeFetch, TEST_CONFIG, 'zh2en', '修复 `src/main.ts` 里的 bug')
  expect(seenUrl).toBe('https://api.deepseek.com/v1/chat/completions')
  expect(seenBody).toContain('deepseek-flash')
  expect(seenBody).toContain('"thinking":{"type":"disabled"}')
  expect(res.ok).toBe(true)
  if (res.ok) {
    expect(res.text).toBe('Fix the bug in `src/main.ts`')
  }
})

test('prompt.submit translates Chinese to English without leaking original text into request and UserMessage renders bilingual', async ($, on) => {
  setupEnv(on, 'test-key')
  let forwardedText = ''
  let forwardedContext: unknown
  let fetchCalled = 0
  let renderedUserText = ''

  on('http.fetch', () => {
    fetchCalled += 1
    return {
      value: {
        ok: true,
        status: 200,
        headers: {},
        text: JSON.stringify({
          choices: [{ message: { content: 'Explain how the mod system works' } }],
        }),
      },
    }
  })

  on('prompt.submit', (_, e) => {
    forwardedText = e.text
    forwardedContext = (e as { context?: unknown }).context
    return e
  })

  on('ui.render', { component: 'UserMessage' }, (_, e) => {
    renderedUserText = String((e.props as { text?: unknown }).text ?? '')
    return { type: 'Text', props: {}, children: [renderedUserText] }
  })

  await $.session.start(SESSION_START)
  await $.prompt.submit({ ...PROMPT_BASE, text: '解释一下 mod 系统是怎么工作的' })

  expect(fetchCalled).toBe(1)
  expect(forwardedText).toBe('Explain how the mod system works')
  expect(hasChinese(forwardedText)).toBe(false)
  expect(forwardedContext).toBeUndefined()

  await $.ui.render({
    surface: 'terminal',
    component: 'UserMessage',
    requestId: 'u1',
    props: { text: 'Explain how the mod system works', origin: { kind: 'composer' }, isExpanded: true },
  })
  expect(renderedUserText).toContain('[原文] 解释一下 mod 系统是怎么工作的')
  expect(renderedUserText).toContain('[已发送] Explain how the mod system works')
})

test('prompt.submit skips slash commands and pure English prompts', async ($, on) => {
  setupEnv(on, 'test-key')
  let fetchCalled = 0
  on('http.fetch', () => {
    fetchCalled += 1
    return { value: { ok: true, status: 200, headers: {}, text: '{}' } }
  })
  on('prompt.submit', (_, e) => e)

  await $.session.start(SESSION_START)
  await $.prompt.submit({ ...PROMPT_BASE, text: '/compact' })
  await $.prompt.submit({ ...PROMPT_BASE, text: 'Explain this function' })
  expect(fetchCalled).toBe(0)
})

test('turn.complete translates main English answer and AssistantMessage renders bilingual', async ($, on) => {
  setupEnv(on, 'test-key')
  let fetchCalled = 0
  let renderedAssistantText = ''

  on('http.fetch', () => {
    fetchCalled += 1
    return {
      value: {
        ok: true,
        status: 200,
        headers: {},
        text: JSON.stringify({
          choices: [{ message: { content: '构建成功，所有单元测试均已通过。' } }],
        }),
      },
    }
  })
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('ui.render', { component: 'AssistantMessage' }, (_, e) => {
    renderedAssistantText = String((e.props as { text?: unknown }).text ?? '')
    return { type: 'Text', props: {}, children: [renderedAssistantText] }
  })

  await $.session.start(SESSION_START)

  // Subagent turn should be skipped
  await $.turn.complete({
    answer: 'Subagent finished checking files.',
    durationMs: 10,
    isAborted: false,
    turnId: 't-sub',
    agentId: 'sub-1',
    reason: 'answer',
  })
  expect(fetchCalled).toBe(0)

  // Aborted turn should be skipped
  await $.turn.complete({
    answer: 'Partial response before abort.',
    durationMs: 10,
    isAborted: true,
    turnId: 't-abort',
    reason: 'aborted',
  })
  expect(fetchCalled).toBe(0)

  // Main turn should trigger translation
  const mainAnswer = 'The build succeeded and all unit tests passed.'
  await $.turn.complete({
    answer: mainAnswer,
    durationMs: 10,
    isAborted: false,
    turnId: 't-main',
    reason: 'answer',
  })
  expect(fetchCalled).toBe(1)

  await $.ui.render({
    surface: 'terminal',
    component: 'AssistantMessage',
    requestId: 'a1',
    props: { text: mainAnswer, isFirstOfReply: true },
  })
  expect(renderedAssistantText).toContain(mainAnswer)
  expect(renderedAssistantText).toContain('[中文译文]')
  expect(renderedAssistantText).toContain('构建成功，所有单元测试均已通过。')
})

test('prompt.submit forwards full session.messages history to translator and falls back without history on error', async ($, on) => {
  setupEnv(on, 'test-key', [
    { role: 'user', text: 'Inspect the authentication middleware.' },
    { role: 'assistant', text: 'The middleware chain validates JWT tokens in auth.ts.' },
  ])

  const bodies: string[] = []
  on('http.fetch', (_, e) => {
    bodies.push(typeof e.init?.body === 'string' ? e.init.body : '')
    if (bodies.length === 1) {
      return { value: { ok: false, status: 400, headers: {}, text: '{"error":"context_length_exceeded"}' } }
    }
    return {
      value: {
        ok: true,
        status: 200,
        headers: {},
        text: JSON.stringify({
          choices: [{ message: { content: 'Make the middleware chain async.' } }],
        }),
      },
    }
  })

  let forwardedText = ''
  on('prompt.submit', (_, e) => {
    forwardedText = e.text
    return e
  })

  await $.session.start(SESSION_START)
  await $.prompt.submit({ ...PROMPT_BASE, text: '把那个链路改成异步的' })

  expect(bodies.length).toBe(2)
  expect(bodies[0]).toContain('<conversation_history>')
  expect(bodies[0]).toContain('The middleware chain validates JWT tokens in auth.ts.')
  expect(bodies[1]).not.toContain('<conversation_history>')
  expect(forwardedText).toBe('Make the middleware chain async.')
})

test('translateText sends reasoning_effort when thinking is enabled and effort is set', async () => {
  let seenBody = ''
  const fakeFetch: HttpFetch = async (_url, init) => {
    seenBody = init.body
    return {
      ok: true,
      status: 200,
      text: JSON.stringify({ choices: [{ message: { content: 'Hello' } }] }),
    }
  }

  await translateText(
    fakeFetch,
    { ...TEST_CONFIG, disableThinking: false, reasoningEffort: 'low' },
    'zh2en',
    '你好',
  )
  expect(seenBody).not.toContain('"thinking"')
  expect(seenBody).toContain('"reasoning_effort":"low"')
})

test('/tr off persists across new sessions via $.store', async ($, on) => {
  const store: Record<string, unknown> = { runtimeConfig: { apiKey: 'test-key' } }
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: undefined as never }))
  on('env.get', () => ({ value: undefined }))
  on('fs.read', () => ({ value: '' }))
  on('session.messages', () => ({ value: [] }))
  on('store.get', (_, e) => ({ value: store[e.key] }))
  on('store.set', (_, e) => {
    store[e.key] = e.value
    return { value: undefined }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))

  let fetchCalled = 0
  on('http.fetch', () => {
    fetchCalled += 1
    return { value: { ok: true, status: 200, headers: {}, text: '{}' } }
  })
  on('prompt.submit', (_, e) => e)

  await $.session.start(SESSION_START)
  await $.command.run({
    command: 'tr',
    args: 'off',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 120 },
  })

  // Simulate opening a fresh session reading from persisted $.store
  await $.session.start(SESSION_START)
  await $.prompt.submit({ ...PROMPT_BASE, text: '你好，测试全局关闭' })
  expect(fetchCalled).toBe(0)
})
