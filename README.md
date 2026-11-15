# claude-translator-mod

个人 Claude Code Mod / 插件仓库（Marketplace：`everless-mods`），由 [@Everless321](https://github.com/Everless321) 维护。

## 安装使用

在 Claude Code（v2.1.275+）内直接执行：

```text
/plugin install bilingual-translator --marketplace Everless321/claude-translator-mod
```

或通过终端 CLI 安装并配置：

```bash
claude plugin marketplace add Everless321/claude-translator-mod
claude plugin install bilingual-translator@everless-mods
claude plugin configure bilingual-translator@everless-mods
```

## 插件列表

| 插件 | 说明 | 文档 |
| :--- | :--- | :--- |
| `bilingual-translator` | 输入中文自动译英发送（原文不进 Claude 请求，界面双语对照）、最终英文回复自动译中展示；支持独立 OpenAI 兼容模型、关闭思考、全量会话历史消歧与代码块保护。 | [bilingual-translator/README.md](./bilingual-translator/README.md) |

## 向本仓库新增插件

1. 在仓库根目录新建插件目录（例如 `my-new-mod/`），包含 `.claude-plugin/plugin.json`、`hooks/` 等文件。
2. 在 [.claude-plugin/marketplace.json](./.claude-plugin/marketplace.json) 的 `plugins` 数组中追加一条：
   ```json
   {
     "name": "my-new-mod",
     "source": "./my-new-mod",
     "description": "插件简介"
   }
   ```
3. 本地校验与测试：
   ```bash
   claude plugin validate .
   claude plugin test ./my-new-mod
   ```
4. 推送到 `main` 后，在 Claude Code 中执行 `claude plugin marketplace update everless-mods` 即可同步更新。
