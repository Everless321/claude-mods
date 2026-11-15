# claude-translator-mod

Personal Claude Code mods & plugins marketplace by [@Everless321](https://github.com/Everless321).

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

| Plugin | Description |
| :--- | :--- |
| [bilingual-translator](./bilingual-translator) | Translates Chinese prompts to English before sending (zero context leakage) and translates Claude's final English responses back to Chinese via an external OpenAI-compatible model. |
