---
name: dsh-session-log-decode
description: 解码 DSH 会话日志（session[.vN].jsonl.zstd 多帧 zstd 拼接）为 JSONL 或可读对话记录，用于检索、统计与复盘历史会话。
whenToUse: 需要查看、检索或分析本机 DSH 会话历史（~/.dsh/sessions 下的 session.vN.jsonl.zstd）时。
---

# DSH 会话日志解码

## 关键事实

- 位置：`<dshHome>/sessions/<编码工作区>/<session-id>/`；`dshHome` = `$DSH_HOME` 或 `~/.dsh`，编码工作区形如 `--E-Data-Project-Other-AgentStart--`（路径分隔符与冒号变成 `-`，两端加 `--`）。归档会话可能在 `~/.dsh/archived-sessions`。
- 文件名按代际：v0 = `session.jsonl[.zstd]`（旧版），vN = `session.vN.jsonl[.zstd]`；当前是 **v4**。迁移后同一目录可能并存多代，**取 N 最大的一份，不要拼接多代**。
- 文件是**多个独立 zstd 帧首尾拼接**：每帧压缩一批持久化事件（带校验和），第一帧是 header 行。对整文件调用一次 `zstdDecompressSync` 只会得到第一帧，必须按帧边界扫描。
- 结尾残帧（崩溃或正在写入）不是错误：解到最后一个完整帧为止，脚本会在 stderr 报告残帧起始字节。
- 每行是一条记录 `{type, seq, time, data}`，`seq` 单调递增；header 行含 `version / id / createdAt / cwd / isSeeded / delegationDepth`。常见 `type`：`user/message`、`assistant/message`、`tool/call`、`tool/result`、`tool/ptc-dispatch-start`、`tool/ptc-dispatch`、`step/start`、`step/end`、`turn/start`。
- 当前 harness 里 agent 只直接调 `run_code`，真正的 `write/edit/pwsh` 调用记在代码内派发事件里（`tool/ptc-dispatch-start` 是调用、`tool/ptc-dispatch` 带结果）——统计工具用量或找"谁写了哪个文件"时要看它们，别只看 `tool/call`。

## 用法

脚本就放在本 skill 目录下：`scripts/decode-session.mjs`（零依赖，Node ≥ 22 的 `node:zlib` 自带 zstd）。
`skill` 工具结果里的 Base directory 就是本目录，**相对路径按它解析**，不需要把代码复制到工作区：

```powershell
$S = "<base>/scripts/decode-session.mjs"
node $S "$env:USERPROFILE/.dsh/sessions/<编码工作区>/<session-id>" --text
```

非 Windows 把 `$env:USERPROFILE` 换成 `~/.dsh`，其余相同。

### 参数（跟在输入路径后面，可任意顺序）

| 参数 | 作用 |
|---|---|
| `--text` | 可读对话（user/assistant 文本 + 工具名） |
| `--full` | 在 `--text` 基础上带工具入参（截断 400 字）与工具结果（截断 300 字） |
| `--last N` | 只要最后 N 条事件记录 |
| `--grep REGEX` | 只保留原始 JSON 命中正则的记录（JS 正则，大小写敏感） |
| `--version` / `--help` | 打印版本 / 用法 |
| 第二个位置参数 | 输出 JSONL 到文件（不给则打 stdout） |

### 约定

- 默认输出 JSONL；**第一行 header 始终保留**（`--grep` / `--last` 也保留），所以导出的文件仍是完整形状的日志。
- 摘要与警告走 stderr，记录走 stdout，可直接管道给 `Select-String`。
- 退出码：**0** 正常（残帧只是警告）、**1** 读取或解码失败、**2** 用法错误。
- `--full` 会把同一次内层调用的 `-start` 与结果两条记录合并显示一次。

### 示例

```powershell
node $S $dir --text                          # 读对话
node $S $dir --full --last 20                # 最近 20 条事件，带工具细节
node $S $dir --grep 'ptc-dispatch' out.jsonl # 只导出内层派发记录
node $S $dir --grep 'file_path' --text       # 只看涉及文件路径的片段
```

## 排错

| 现象 | 说明 |
|---|---|
| `error: input not found` | 路径不对。会话目录形如 `<dshHome>/sessions/--E-...--/session-xxxx/` |
| `no session[.vN].jsonl[.zstd] under ...` | 该目录下没有日志文件 |
| `note: older generation also present` | 同目录有多代日志，工具自动取 N 最大的一份（正常提示） |
| `[torn tail from byte N ignored]` | 结尾残帧，属正常；前面的记录完好 |
| `invalid Zstandard frame magic at byte N` | 文件不是本工具认识的日志，或已损坏 |

## 维护

- **唯一真相是本目录的 `scripts/decode-session.mjs`**；仓库 `E:/Data/Project/dsh/dsh-session-log-decode` 里那份只是备份（同步过去，不从这里引用）。
- 改脚本后跑一次冒烟：`--version`、一个真实会话的 `--text`、一个不存在的路径（应 exit 1）、一个错误参数（应 exit 2）。
- 同步到备份仓库：把本目录的 `scripts/decode-session.mjs` 复制到 `E:/Data/Project/dsh/dsh-session-log-decode/`，两侧 SHA-256 一致才算完成。
- 目录下其他文件（`scripts/`、`references/` 等）不会被扫描成新 skill，改它们也不会触发 skill 目录刷新。
