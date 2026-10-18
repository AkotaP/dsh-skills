# dsh-skills

个人自用的 DeepSeek Harness (DSH) skills 集合。每个 skill 是一个独立目录，入口为 `SKILL.md`，由 DSH 的 `skill` 工具按需加载；不依赖外部服务，clone 下来即可用。

## 已收录

| Skill | 说明 | 依赖 |
| --- | --- | --- |
| [`dsh-session-log-decode`](dsh-session-log-decode/SKILL.md) | 解码 DSH 会话日志（`session[.vN].jsonl.zstd`，多帧 zstd 拼接）为 JSONL 或可读对话，用于检索、统计与复盘历史会话。 | Node.js ≥ 22（`node:zlib` 自带 zstd），零第三方依赖 |
| [`dsh-plugin-development`](dsh-plugin-development/SKILL.md) | 开发/安装/调试 DSH 插件：bundle 清单、宿主半（Node ESM）、客户端 UI 半与槽位、volatile 配置通道、HMR 热更新（默认启用，装插件通常无需重启）与离线测试。含本机实测的 86 个槽位清单与坑清单。 | Node.js ≥ 20；脚手架零依赖 |
| [`plain-doc-writing`](plain-doc-writing/SKILL.md) | 编写或修改文档时使用的客观精简写作规范：第三人称、直陈事实与结论、去人设/寒暄/重复解释，避免角色语气渗入正文。 | 无 |
| [`unity-scene-merge`](unity-scene-merge/SKILL.md) | Unity 场景/Prefab 三方语义合并流程；含字节保真导出、结构检查与回归测试。 | Python ≥ 3.9、Git；实际合并需匹配版本的 UnityYAMLMerge |

## 使用

DSH 的 skills 目录默认为 `$DSH_HOME/skills`，`$DSH_HOME` 未设置时即 `~/.dsh/skills`。

```bash
git clone https://github.com/AkotaP/dsh-skills.git
cd dsh-skills

# 把需要的 skill 复制/链接进 DSH 的 skills 目录
cp -r dsh-session-log-decode "$HOME/.dsh/skills/"     # Windows: %USERPROFILE%\.dsh\skills
```

整仓也可以直接当作 skills 目录使用。加载后按 `SKILL.md` 里的用法调用，例如：

```powershell
node "$HOME/.dsh/skills/dsh-session-log-decode/scripts/decode-session.mjs" "<会话目录>" --text
```

## 约定

- 目录结构固定为 `<skill-name>/SKILL.md`；可选 `<skill-name>/scripts/`（零依赖脚本）与 `<skill-name>/references/`（按需加载的细节文档，SKILL.md 里用表格指路）。新增 skill 保持同样形状即可被自动扫描。
- 脚本尽量零依赖，随 skill 目录一起走；仓库里不放生成物和缓存。

## 许可

个人自用仓库，未附许可证。需要的话直接取用，风险自负。
