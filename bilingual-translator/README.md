# Bilingual Translator Mod for Claude Code

A Claude Code in-process mod (`bilingual-translator`) that translates Chinese user prompts into English before they reach Claude, and translates Claude's final English responses back into Chinese for bilingual display in the CLI.

## Features

- **Input Translation (ZH -> EN):** Intercepts `prompt.submit`, masks fenced/inline code spans, translates Chinese natural language to English using an external OpenAI-compatible model, and forwards **only** the English translation to Claude.
- **Zero Context Leakage:** Original Chinese prompts are kept strictly in local mod memory and `$.store`, never injected into `e.text` or `e.context`.
- **Bilingual CLI Display:** Uses `ui.render` on `UserMessage` and `AssistantMessage` to show `[原文]` + `[已发送]` for user prompts and English original + `[中文译文]` for final assistant replies.
- **Slash Control:** Use `/tr [status | on | off | in | out]` to inspect status or toggle input/output translation at runtime.

## Configuration

Configure via `claude plugin configure bilingual-translator` (or in `~/.claude/settings.json` under `pluginConfigs`):

- `apiBaseUrl`: OpenAI-compatible API base URL (default: `https://api.deepseek.com/v1`)
- `apiKey`: API key for your external translation model
- `model`: External model ID (default: `deepseek-chat`)
- `enableInputTranslate`: Enable ZH -> EN prompt translation (default: `true`)
- `enableOutputTranslate`: Enable EN -> ZH final reply translation (default: `true`)
- `timeoutMs`: Request timeout in milliseconds (default: `15000`)
