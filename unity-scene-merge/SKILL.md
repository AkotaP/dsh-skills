---
name: unity-scene-merge
description: 解决 Unity 场景与预制体资源（.unity / .prefab / .asset）的 Git 三方合并冲突。适用于 merge / rebase / cherry-pick 的 Unity YAML 冲突或合并后的场景损坏。使用 UnityYAMLMerge 做 fileID 级语义合并，检查结构、字段与引用后再写回。
---

# Unity 场景合并

优先使用 Unity 自带的 **UnityYAMLMerge（Smart Merge）**，不要直接拼接冲突块，也不要把“无冲突标记”“文档数相同”当作合并正确的证明。二进制 .asset 不适用此流程。

## 工具与环境

| 资源 | 用途 |
| --- | --- |
| `scripts/scenetool.py` | 字节保真导出冲突阶段、结构检查、三方 ID 检查、文档 diff/show、物体树、CRLF 转换 |
| `scripts/test_scenetool.py` | 零第三方依赖回归测试 |

Python ≥ 3.9，无第三方依赖。脚本路径应相对 skill 工具返回的 **Base directory** 解析，不要硬编码 `.claude` 或当前工作区。以下示例使用原生 Windows PowerShell；`$Python` 换成运行环境提供的 Python 绝对路径（或已确认可用的 `python`）。

```powershell
$Python = 'python'
$SkillRoot = if ($env:DSH_HOME) { Join-Path $env:DSH_HOME 'skills\unity-scene-merge' } else { Join-Path $env:USERPROFILE '.dsh\skills\unity-scene-merge' }
$SceneTool = Join-Path $SkillRoot 'scripts\scenetool.py'
# 如果 skill Base directory 不同，以其为准设置 $SceneTool。
```

在 DSH 内使用 read/glob/grep 检查文本和路径，使用 pwsh 执行工具。写入范围受沙箱约束，遇预期的工作区外写入拒绝，应申请权限，不要绕过。

## 1. 确认状态与取舍规则

```powershell
git status --short
git diff --name-only --diff-filter=U
git ls-files --unmerged
```

先确认用户要保留哪边的哪些行为；**禁止擅自整文件选 ours/theirs、提交、清空索引或 abort 操作**。

合并中的权威三方输入是 Git index：stage 1 = base，stage 2 = ours / LOCAL，stage 3 = theirs / REMOTE。不要只用 `merge-base HEAD MERGE_HEAD` 重建输入：复杂合并的 base 可能不同，重命名的路径也可能不同。

- merge：ours 通常是当前分支，theirs 是合入分支。
- rebase：ours 通常是正在变基到的分支，theirs 是被重放的提交；与用户直觉的“我的分支”可能相反。
- cherry-pick：ours 是当前工作线，theirs 是被选中的提交。
- add/add、delete/modify、重命名等可能缺少某一阶段或使用不同路径。先查 `git ls-files --unmerged`，缺阶段就暂停普通三文件流程，明确取舍；不要伪造空 YAML。

已经 `git add` 或提交后，index 阶段消失。此时明确相关提交和历史路径再分别导出，不能把当前 HEAD 一概当作原 ours。不要为了恢复阶段覆盖用户改动。

## 2. 定位 UnityYAMLMerge

读取项目 `ProjectSettings\ProjectVersion.txt` 的 `m_EditorVersion`，优先找匹配编辑器版本的工具。Windows 常见路径为 `<Unity版本目录>\Editor\Data\Tools\UnityYAMLMerge.exe`，例如安装在 `D:\Soft\Unity\Editor` 时可用 glob 搜索 `*\Editor\Data\Tools\UnityYAMLMerge.exe`。找不到可查：

```powershell
Get-ChildItem 'HKLM:\SOFTWARE\Unity Technologies\Installer' | ForEach-Object {
  (Get-ItemProperty $_.PSPath).'Location x64'
}
```

macOS 常见路径为 `/Applications/Unity/Hub/Editor/<版本>/Unity.app/Contents/Tools/UnityYAMLMerge`。本任务在 Windows 上时，不要转换成 Unix 路径或依赖 bash。

**不要承诺跨版本兼容**。无匹配版本时说明差异，取得同意后才尝试其他版本，并加强 Unity 内验证。先查看本机工具帮助，确认支持下列参数；无工具时明确报告，不能把结构检查冒充实际合并测试。

## 3. 保字节导出三方

在仓库根目录运行，`$Scene` 必须是仓库根目录相对路径：

```powershell
$Repo = (Get-Location).Path
$Scene = 'Assets/Scenes/SomeScene.unity'
# 临时目录放工作区内，避免默认临时目录不在沙箱写入范围。
$Tmp = Join-Path $Repo ('.scenemerge-' + [guid]::NewGuid().ToString('N'))
& $Python $SceneTool export $Repo $Scene $Tmp
if ($LASTEXITCODE -ne 0) { throw '三方导出失败，不能继续' }
$Base = Join-Path $Tmp 'Scene.base.unity'
$Ours = Join-Path $Tmp 'Scene.ours.unity'
$Theirs = Join-Path $Tmp 'Scene.theirs.unity'
$Merged = Join-Path $Tmp 'merged.unity'
```

`export` 用 `git cat-file blob :1/2/3:<path>`，stdout 直接写二进制文件，不经 PowerShell 文本管道。Git 失败、缺阶段或非受支持 YAML 会返回非零，失败输出不能使用。不要把 `git show | Out-File` 当作字节保真导出。PowerShell 各版本重定向行为不同；即使新版本能保留字节，也优先使用这里的跨版本方案。

## 4. 执行 Smart Merge

常见位置参数顺序是 `<base> <left> <right> [dest]`；这里明确约定 left = theirs / REMOTE，right = ours / LOCAL：

```powershell
$Tool = '<已确认的 UnityYAMLMerge.exe 绝对路径>'
& $Tool merge -p -h --fallback none $Base $Theirs $Ours $Merged
$MergeExit = $LASTEXITCODE
```

- `-p`（premerge）、`-l`（偏 left）、`-r`（偏 right）互斥。用户明确批准偏向某侧后，才可把 `-p` 换为 `-l` 或 `-r`。
- 支持的版本中 `-h` 为 headless，`--fallback none` 禁止调用外部 fallback。以实际工具帮助为准，避免自动化挂起。
- **任何非零退出码都需要调查**。某些版本以 2 表示冲突，但不能跨版本保证含义，更不能保证存在可用输出。检查 stdout/stderr、结果文件与冲突字段。
- 即使退出码为 0，也必须验证。报告 Left/Right 冲突而无文本标记，不代表取值符合用户要求；不要假设默认必取 base。

## 5. 必做验证

```powershell
& $Python $SceneTool verify $Base $Ours $Theirs $Merged
if ($LASTEXITCODE -ne 0) { throw '结构检查失败' }
& $Python $SceneTool merge-check $Base $Ours $Theirs $Merged
# 非零：缺失、意外 ID、删除/修改冲突、新增悬空引用或重复 ID；必须先调查。
& $Python $SceneTool diff $Ours $Merged
& $Python $SceneTool diff $Theirs $Merged
& $Python $SceneTool show $Ours $Merged '<文档ID>'
& $Python $SceneTool tree $Merged '<物体名或 GameObject ID>'
```

检查含义与边界：

1. `verify` 拒绝 BOM、UTF-16、非法 UTF-8、缺 `%YAML ` 文件头、无文档块、残留冲突标记、不支持的文档头和重复 ID。它是轻量文本结构检查，**不是完整 YAML 语法解析器**。
2. 无 guid 的内联 `{fileID: ...}` 按本地引用核对，带 guid 的视为外部引用；不会整块跳过 PrefabInstance。悬空引用**可以为 0**；须比较具体 ID，数量相同不能证明没问题。多行引用、引号内伪引用、特殊序列化和资源 GUID 是否存在不在此轻量检查的保证范围内。
3. **`ours + theirs - base` 不是通用正确公式**。双方新增同一 ID、合法删除、删除/修改冲突都会使它失效。`merge-check` 检查 ID 集合：保留双方都在的 ID、保留双方新增；一方删除且另一方未改时接受删除；删除/修改冲突返回非零，交由人工确认。
4. `merge-check` 同时报告结果中相对三方新增的无 guid 悬空引用。PASS **仅是结构门槛，不是无损证明**；同一 ID 的新增碰撞、标量/组件内容冲突、字段丢失等仍需 diff/show。
5. 合法修改和删除不是一律错误，不能要求结果只有新增。按用户规则核对每项变动；保留父子链、组件、Prefab override 与资源引用的一致性。
6. `tree` 是依据本文件 Transform 的 `m_Father` 还原的辅助树，不保证 Prefab 内部完整层级，也不代表 `m_Children` 的序列化/渲染顺序。名字支持常见 `\uXXXX` 转义，不是完整 YAML 字符串解析器。

Prefab 子树尤其要核对：Transform/RectTransform 的 `m_Father` 与 `m_Children`、PrefabInstance 的修改和新增对象记录、组件脚本引用、SceneRoots（若存在）。**不能按 fileID 位宽判断场景/Prefab 身份，也不能假定所有版本都使用固定 SceneRoots ID。**

## 6. 写回与交付

通过检查、取舍明确后才写回；写回前保留原始冲突文件备份，不得覆盖现有备份：

```powershell
$Backup = Join-Path $Tmp 'original.unity'
if (Test-Path -LiteralPath $Backup) { throw '备份已存在' }
Copy-Item -LiteralPath (Join-Path $Repo $Scene) -Destination $Backup
# 检查 .gitattributes、git ls-files --eol 与工作区换行规则；不要一律转 CRLF。
# 若项目要求 CRLF：
$Final = Join-Path $Tmp 'final.unity'
& $Python $SceneTool to-crlf $Merged $Final
if ($LASTEXITCODE -ne 0) { throw '换行转换失败' }
# 若项目要求 LF，则 $Final = $Merged。
Copy-Item -LiteralPath $Final -Destination (Join-Path $Repo $Scene)
```

保留无 BOM UTF-8。`to-crlf` 校验基本编码/文件头与冲突标记，去 UTF-8 BOM，但不会修复 YAML 语义错误。

在 Unity 打开场景/Prefab，确认无反序列化错误、关键物体/脚本/字段/布局正常。没有编辑器或 MCP 时直说“未做 Unity 内验证”，不要声称完整验证。只有任务授权处理冲突并且检查通过后才 `git add -- <资源路径>`；**除非明确要求，不提交**。不要把 `git checkout HEAD -- <file>` 或 `git merge --abort` 当作无损撤销，它们可能丢弃其他工作；恢复须用已核对的备份与明确授权。

场景打不开也不一定是 BOM：同时查 YAML/冲突标记、编辑器版本、资源缺失、脚本编译与序列化错误。null 引用须区分真实场景引用丢失与代码未判空。

## 回归测试

```powershell
& $Python (Join-Path $SkillRoot 'scripts\test_scenetool.py')
```

测试覆盖脚本结构与 Git 字节保真导出；**不代替 UnityYAMLMerge 与 Unity 编辑器的集成验证**。
