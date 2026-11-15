# claude-translator-mod

Personal Claude Code mods & plugins marketplace (`everless-mods`) maintained by [@Everless321](https://github.com/Everless321).

> **中文用户**：主要使用与配置文档请优先阅读英文主说明，核心功能为「中文输入自动译英发送（原文不进 Claude 请求）+ 最终英文回复自动译中展示」。

## Install

In Claude Code (v2.1.275+):

```text
/plugin install bilingual-translator --marketplace Everless321/claude-translator-mod
```

Or via CLI:

```bash
claude plugin marketplace add Everless321/claude-translator-mod
claude plugin install bilingual-translator@everless-mods
claude plugin configure bilingual-translator@everless-mods
```

## Plugins

| Plugin | Description | Docs |
| :--- | :--- | :--- |
| `bilingual-translator` | Translates Chinese prompts to English before sending (zero context leakage) and translates Claude's final English responses back to Chinese via an external OpenAI-compatible model (`deepseek-flash` with thinking disabled by default), with full-session disambiguation and code-block masking. | [bilingual-translator/README.md](./bilingual-translator/README.md) |

## Adding a New Plugin

1. Create a plugin directory at the repository root (e.g. `my-new-mod/`) with `.claude-plugin/plugin.json`, `hooks/`, etc.
2. Register it under `plugins` in [.claude-plugin/marketplace.json](./.claude-plugin/marketplace.json):
   ```json
   {
     "name": "my-new-mod",
     "source": "./my-new-mod",
     "description": "Short plugin description"
   }
   ```
3. Validate and test locally:
   ```bash
   claude plugin validate .
   claude plugin test ./my-new-mod
   ```
4. Push to `main`, then run `claude plugin marketplace update everless-mods` to pull updates.
