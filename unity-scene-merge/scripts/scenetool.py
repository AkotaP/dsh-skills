#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Unity 场景 / 预制体（.unity / .prefab / .asset）结构分析与合并验证工具。

配合 UnityYAMLMerge 使用：合并前导出三方、合并后在这里验证结构完整性。
用法见 `python scenetool.py <子命令> -h`，或上级目录的 SKILL.md。

设计前提：Unity 的 YAML 里每个对象是一个文档块，以 `--- !u!<type> &<fileID>`
开头。本工具按文档 ID 做结构检查；删除/修改冲突需要人工选择，
文档集合正确也不代表字段、层级和外部资源引用在 Unity 中一定正确。
"""

from __future__ import annotations

import argparse
import re
import sys
import subprocess
from pathlib import Path

# --- 解析用的正则 ---

# 文档头：--- !u!<type> &<fileID> [stripped]
DOC_RE = re.compile(r"^--- !u!(\d+) &(-?\d+)( stripped)?\s*$")
# 任意 fileID 引用（组件列表、父子链、脚本字段……）
REF_RE = re.compile(r"\bfileID:\s*(-?\d+)")
MAPPING_RE = re.compile(r"\{[^{}\r\n]*\}")
GUID_RE = re.compile(r"\bguid\s*:")
CONFLICT_RE = re.compile(r"^(?:<{7}|={7}|>{7}|\|{7})(?:\s|$)", re.M)
# GameObject 的名字
NAME_RE = re.compile(r"^  m_Name: (.*?)\s*$")
# Unity 把非 ASCII 名字写成 "\uXXXX"，这里还原成人可读形式
UNIESC_RE = re.compile(r"\\u([0-9a-fA-F]{4})")
# Transform 的父子关系
GO_REF_RE = re.compile(r"^  m_GameObject: \{fileID: (-?\d+)\}", re.M)
FATHER_RE = re.compile(r"^  m_Father: \{fileID: (-?\d+)\}", re.M)

GAMEOBJECT_TYPE = 1
TRANSFORM_TYPES = (4, 224)    # Transform、RectTransform

# 文档类型名（用于没有 m_Name 的文档显示得更可读）
TYPE_NAMES = {
    1: "GameObject", 4: "Transform", 20: "Camera", 23: "MeshRenderer",
    33: "MeshFilter", 65: "BoxCollider", 108: "Light", 114: "MonoBehaviour",
    198: "ParticleSystem", 199: "ParticleSystemRenderer", 222: "CanvasRenderer",
    223: "Canvas", 224: "RectTransform", 225: "CanvasGroup", 1001: "PrefabInstance",
    1660057539: "SceneRoots",
}


def decode(name: str) -> str:
    """把 Unity 序列化的名字还原成人可读形式（剥外层引号、解 \\uXXXX）。"""
    if len(name) >= 2 and name[0] == '"' and name[-1] == '"':
        name = name[1:-1]
    return UNIESC_RE.sub(lambda m: chr(int(m.group(1), 16)), name)


def read_head(path, n=8) -> bytes:
    with open(path, "rb") as f:
        return f.read(n)


class Scene:
    """一份场景 / 预制体的文档集合。"""

    def __init__(self, path: str):
        self.path = path
        self.lines = 0
        self.docs = {}     # id -> {type, name, text, stripped, line}
        self.order = []    # 文档出现顺序
        self.dups = []     # 重复出现的 ID
        self.refs = set()  # 无 guid 的内联 fileID 引用（含 PrefabInstance 中本地引用）
        self._parse()

    def _parse(self):
        cur_id = cur_type = None
        cur_name = ""
        cur_stripped = False
        cur_line = 0
        buf: list[str] = []
        data = Path(self.path).read_bytes()
        if data.startswith((b"\xef\xbb\xbf", b"\xff\xfe", b"\xfe\xff")):
            raise ValueError(f"{self.path}: 必须使用 UTF-8 无 BOM")
        text = data.decode("utf-8", errors="strict")
        if not text.startswith("%YAML ") or "\x00" in text:
            raise ValueError(f"{self.path}: 不是受支持的 Unity 文本 YAML（缺 %YAML 头或含 NUL）")
        if CONFLICT_RE.search(text):
            raise ValueError(f"{self.path}: 残留 Git 冲突标记")

        def commit():
            if cur_id is None:
                return
            if cur_id in self.docs:
                self.dups.append(cur_id)
                return
            self.docs[cur_id] = {
                "type": cur_type,
                "name": decode(cur_name),
                "text": "".join(buf),
                "stripped": cur_stripped,
                "line": cur_line,
            }
            self.order.append(cur_id)

        for i, line in enumerate(text.splitlines(), 1):
            self.lines = i
            m = DOC_RE.match(line)
            if m:
                commit()
                cur_type = int(m.group(1))
                cur_id = int(m.group(2))
                cur_stripped = bool(m.group(3))
                cur_name = ""
                cur_line = i
                buf = []
                continue
            if line.startswith("---"):
                raise ValueError(f"{self.path}:{i}: 不支持的文档头")
            if cur_id is None:
                continue
            buf.append(line + "\n")
            if cur_name == "":
                nm = NAME_RE.match(line)
                if nm:
                    cur_name = nm.group(1)
            for mapping in MAPPING_RE.findall(line):
                if not GUID_RE.search(mapping):
                    for rm in REF_RE.finditer(mapping):
                        self.refs.add(int(rm.group(1)))
        commit()
        if not self.docs:
            raise ValueError(f"{self.path}: 没有 Unity 文档块")

    # ---- 派生信息 ----

    def dangling(self) -> list[int]:
        """无 guid 的内联引用中，找不到对应文档的 ID（排除 0）。
        这是轻量文本检查；内置资源与特殊序列化须结合基线逐个核对。"""
        return sorted(r for r in self.refs if r != 0 and r not in self.docs)

    def label(self, doc_id: int) -> str:
        d = self.docs.get(doc_id)
        if d is None:
            return "?"
        if d["name"]:
            return d["name"]
        return TYPE_NAMES.get(d["type"], f"!u!{d['type']}")

    def only_in(self, other: "Scene") -> list[int]:
        return [i for i in self.order if i not in other.docs]

    def changed_vs(self, other: "Scene") -> list[int]:
        return [i for i in self.order
                if i in other.docs and self.signature(i) != other.signature(i)]

    def signature(self, doc_id):
        d = self.docs[doc_id]
        return d["type"], d["stripped"], d["text"]

    def boms(self) -> str:
        head = read_head(self.path, 3)
        if head.startswith(b"\xef\xbb\xbf"):
            return "UTF-8 BOM  <== Unity 读不了，必须去掉！"
        if head.startswith((b"\xff\xfe", b"\xfe\xff")):
            return "UTF-16  <== Unity 读不了，必须转成 UTF-8 无 BOM！"
        return "OK（UTF-8 无 BOM）"

    def go(self) -> dict[int, str]:
        """GameObject 的 id -> 名字。"""
        return {i: d["name"] for i, d in self.docs.items()
                if d["type"] == GAMEOBJECT_TYPE}

    def hierarchy(self):
        """从 Transform 的 m_GameObject / m_Father 还原层级。

        返回 (go -> tr, tr -> go, tr -> 父 tr, tr -> [子 tr])。
        """
        go_tr, tr_go, father, children = {}, {}, {}, {}
        for i, d in self.docs.items():
            if d["type"] not in TRANSFORM_TYPES:
                continue
            gm = GO_REF_RE.search(d["text"])
            if gm:
                go_id = int(gm.group(1))
                go_tr[go_id] = i
                tr_go[i] = go_id
            fm = FATHER_RE.search(d["text"])
            if fm:
                f = int(fm.group(1))
                father[i] = f
                children.setdefault(f, []).append(i)
        return go_tr, tr_go, father, children


# ---------------------------------------------------------------- 子命令

def cmd_verify(args):
    scenes = [Scene(p) for p in args.files]
    w = max(len(Path(s.path).name) for s in scenes)
    print(f"{'文件'.ljust(w)}  {'行数':>8}  {'文档':>6}  {'重复ID':>7}  {'悬空引用':>8}  编码")
    print("-" * (w + 50))
    bad = False
    for s in scenes:
        d = len(s.dangling())
        print(f"{Path(s.path).name.ljust(w)}  {s.lines:>8}  {len(s.docs):>6}  "
              f"{len(s.dups):>7}  {d:>8}  {s.boms()}")
        if s.dups:
            bad = True
            print(f"    !! 重复 ID {len(s.dups)} 个: {s.dups[:10]}")
        if s.dangling():
            print(f"    待核对的无 guid 引用 ID: {s.dangling()[:20]}")
    print()
    print("判断标准：重复 ID 必须为 0；外部 guid 引用不计入。悬空引用可以为 0；"
          "须逐个比较三方 ID，不能只比较数量。此工具不验证完整 YAML/字段/资源 GUID。")
    if bad:
        sys.exit(1)


def cmd_merge_check(args):
    b, o, t, r = (Scene(p) for p in (args.base, args.ours, args.theirs, args.result))
    base, ours, theirs, result = map(lambda s: set(s.docs), (b, o, t, r))
    required = (ours & theirs) | ((ours | theirs) - base)
    conflicts = set()
    for i in base & (ours ^ theirs):
        survivor = o if i in ours else t
        if survivor.signature(i) != b.signature(i):
            conflicts.add(i)
    missing = required - result
    unexpected = result - (required | conflicts)
    print(f"文档数 base={len(base)} ours={len(ours)} theirs={len(theirs)} result={len(result)}")
    for label, ids in (("缺失必需 ID", missing), ("意外/复活 ID", unexpected),
                       ("删除/修改冲突（必须人工确认）", conflicts)):
        print(f"{label}: {sorted(ids)}")
    new_dangling = set(r.dangling()) - set(b.dangling()) - set(o.dangling()) - set(t.dangling())
    print(f"新增待核对的无 guid 悬空引用: {sorted(new_dangling)}")
    bad = bool(missing or unexpected or conflicts or new_dangling or
               any(s.dups for s in (b, o, t, r)))
    print("FAIL / 需人工检查" if bad else "PASS（仅 ID 集合与新增悬空引用检查）")
    print("即使 PASS 也不保证字段、层级或资源完整；必须 diff/show 并在 Unity 中确认。")
    if bad:
        sys.exit(1)


def cmd_diff(args):
    a, b = Scene(args.a), Scene(args.b)
    na, nb = Path(args.a).name, Path(args.b).name
    print(f"{na}: {len(a.docs)} 文档    {nb}: {len(b.docs)} 文档\n")

    only_a = a.only_in(b)
    only_b = b.only_in(a)
    changed = a.changed_vs(b)

    print(f"===== 只在 {na} 有 ({len(only_a)}) =====")
    for i in only_a:
        print(f"  {i:>22}  [{a.label(i)}]")

    print(f"\n===== 只在 {nb} 有 ({len(only_b)}) =====")
    for i in only_b:
        print(f"  {i:>22}  [{b.label(i)}]")

    print(f"\n===== 两边都有、内容不同 ({len(changed)}) =====")
    print("（这些是重点：要逐个确认是「叠加新增」还是「覆盖」；"
          "用 show 子命令看逐行差异）")
    for i in changed:
        print(f"  {i:>22}  A=[{a.label(i)}]  B=[{b.label(i)}]")


def cmd_show(args):
    a, b = Scene(args.a), Scene(args.b)
    doc_a = a.docs.get(args.id)
    doc_b = b.docs.get(args.id)
    if doc_a is None and doc_b is None:
        print(f"ID {args.id} 在两个文件里都不存在", file=sys.stderr)
        sys.exit(1)
    def doc_lines(doc):
        if doc is None:
            return []
        header = f"--- !u!{doc['type']} &{args.id}" + (" stripped" if doc["stripped"] else "")
        return [header] + doc["text"].splitlines()
    la, lb = doc_lines(doc_a), doc_lines(doc_b)
    print(f"===== {Path(args.a).name} ({len(la)} 行)  vs  "
          f"{Path(args.b).name} ({len(lb)} 行) =====")
    if doc_a is None:
        print(f"  (A 里没有这个文档)")
    if doc_b is None:
        print(f"  (B 里没有这个文档)")
    import difflib
    for line in difflib.unified_diff(la, lb, lineterm="",
                                     fromfile=Path(args.a).name,
                                     tofile=Path(args.b).name):
        print("  " + line)


def cmd_tree(args):
    s = Scene(args.file)
    go = s.go()
    go_tr, tr_go, father, children = s.hierarchy()

    # 选中目标：纯数字当 go ID，否则按名字（先精确、再模糊）
    if args.selector.lstrip("-").isdigit():
        targets = [int(args.selector)]
        if targets[0] not in go:
            print(f"GameObject ID {targets[0]} 不存在（请勿传 Transform ID）", file=sys.stderr)
            sys.exit(1)
    else:
        want = args.selector
        targets = [i for i, n in go.items() if n == want]
        if not targets:
            targets = [i for i, n in go.items() if want in n]
        if not targets:
            print(f"找不到名字含「{want}」的物体", file=sys.stderr)
            sys.exit(1)
        if len(targets) > 1:
            print(f"匹配到 {len(targets)} 个，逐个列出：\n")

    def walk(go_id, depth, seen):
        if go_id in seen or depth > 24:
            return
        seen.add(go_id)
        tr = go_tr.get(go_id)
        if depth == 0:
            parent = "?"
            if tr is not None and tr in father:
                f = father[tr]
                parent = "<scene root>" if f == 0 else s.label(tr_go.get(f, -1))
            print(f"{go.get(go_id, '?')}  [go={go_id}]  父={parent}")
        else:
            print("  " * depth + f"{go.get(go_id, '?')}  [go={go_id}]")
        if tr is None:
            return
        for c in children.get(tr, []):
            child_go = tr_go.get(c)
            if child_go is not None:
                walk(child_go, depth + 1, seen)

    for t in targets:
        walk(t, 0, set())
        print()


def cmd_to_crlf(args):
    data = Path(args.src).read_bytes()
    if data.startswith(b"\xef\xbb\xbf"):
        print("警告：源文件带 UTF-8 BOM，已去除", file=sys.stderr)
        data = data[3:]
    if data.startswith((b"\xff\xfe", b"\xfe\xff")):
        print("错误：源文件是 UTF-16，请先用无 BOM 的 UTF-8 重新导出", file=sys.stderr)
        sys.exit(1)
    text = data.decode("utf-8", errors="strict")
    if not text.startswith("%YAML ") or "\x00" in text or CONFLICT_RE.search(text):
        raise ValueError("源文件不是可写回的 Unity 文本 YAML")
    data = data.replace(b"\r\n", b"\n").replace(b"\n", b"\r\n")
    Path(args.dst).write_bytes(data)
    print(f"{args.src} -> {args.dst}  ({len(data)} 字节，CRLF，UTF-8 无 BOM)")
    print(f"首字节: {data[:6].hex(' ').upper()}  (应为 25 59 41 4D 4C 20 = '%YAML ')")


def cmd_export(args):
    """直接导出 Git index 的冲突阶段；不经 shell 文本重定向/管道。"""
    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    paths = [out / f"Scene.{side}.unity" for side in ("base", "ours", "theirs")]
    if any(p.exists() for p in paths):
        raise ValueError("输出文件已存在，请使用新的临时目录")
    scene = args.scene.replace("\\", "/")
    for stage, dest in enumerate(paths, 1):
        with dest.open("wb") as stream:
            subprocess.run(["git", "-C", args.repo, "cat-file", "blob", f":{stage}:{scene}"],
                           stdout=stream, check=True)
        Scene(str(dest))
        print(f"stage {stage} -> {dest}")
    print("已导出 index stages 1/2/3；若阶段不存在（如 add/delete 冲突），命令失败，勿使用不完整输出。")


# ---------------------------------------------------------------- 主入口

def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    ap = argparse.ArgumentParser(
        prog="scenetool.py",
        description="Unity 场景/prefab 结构分析与合并验证工具")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("verify", help="结构校验：重复 ID、悬空引用、编码（可传多个文件做对比）")
    p.add_argument("files", nargs="+")
    p.set_defaults(func=cmd_verify)

    p = sub.add_parser("export", help="字节保真导出冲突 index stages 1/2/3（merge/rebase/cherry-pick）")
    p.add_argument("repo", help="仓库根目录")
    p.add_argument("scene", help="仓库根目录相对的资源路径")
    p.add_argument("out_dir", help="不含既有输出的新目录")
    p.set_defaults(func=cmd_export)

    p = sub.add_parser("merge-check", help="三方 ID 集合与新增悬空引用检查（不是无损证明）")
    p.add_argument("base")
    p.add_argument("ours")
    p.add_argument("theirs")
    p.add_argument("result")
    p.set_defaults(func=cmd_merge_check)

    p = sub.add_parser("diff", help="文档级差异：只在谁有、以及内容不同的")
    p.add_argument("a")
    p.add_argument("b")
    p.set_defaults(func=cmd_diff)

    p = sub.add_parser("show", help="逐行对比某个文档 ID 在两个文件中的内容")
    p.add_argument("a")
    p.add_argument("b")
    p.add_argument("id", type=int)
    p.set_defaults(func=cmd_show)

    p = sub.add_parser("tree", help="打印某个物体的层级（按名字或 go ID）")
    p.add_argument("file")
    p.add_argument("selector")
    p.set_defaults(func=cmd_tree)

    p = sub.add_parser("to-crlf", help="转成 UTF-8 无 BOM + CRLF 后写回（写回工作区前用）")
    p.add_argument("src")
    p.add_argument("dst")
    p.set_defaults(func=cmd_to_crlf)

    args = ap.parse_args()
    try:
        args.func(args)
    except (OSError, ValueError, subprocess.CalledProcessError) as exc:
        print(f"错误：{exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
