#!/usr/bin/env python3
"""Zero-dependency regression tests; no Unity installation required."""
import argparse
import contextlib
import io
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
import scenetool as tool

HEADER = '%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n'


def doc(i, name=None, kind=1, extra='', stripped=False):
    return (f'--- !u!{kind} &{i}' + (' stripped' if stripped else '') + '\n'
            f'Object:\n  m_Name: {name or str(i)}\n' + extra)


class SceneTests(unittest.TestCase):
    def setUp(self):
        # Confine all generated files and the disposable Git index to this skill.
        self.temp = tempfile.TemporaryDirectory(prefix='.scenetool-test-', dir=Path(__file__).resolve().parents[1])
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def scene(self, name, body):
        path = self.root / name
        path.write_bytes((HEADER + body).encode('utf-8'))
        return str(path)

    def quiet(self, fn, **kwargs):
        stream = io.StringIO()
        with contextlib.redirect_stdout(stream), contextlib.redirect_stderr(stream):
            fn(argparse.Namespace(**kwargs))
        return stream.getvalue()

    def merge(self, b, o, t, r):
        return self.quiet(tool.cmd_merge_check,
                          **dict(zip(('base', 'ours', 'theirs', 'result'),
                                     [self.scene(n + '.unity', body) for n, body in zip('botr', (b, o, t, r))])))

    def test_valid_scene(self):
        p = self.scene('ok.unity', doc(1))
        self.assertEqual(tool.Scene(p).dangling(), [])
        self.quiet(tool.cmd_verify, files=[p])

    def test_stripped_and_negative_id(self):
        p = self.scene('stripped.unity', doc(-9, kind=224, stripped=True))
        self.assertTrue(tool.Scene(p).docs[-9]['stripped'])

    def test_unicode_name(self):
        p = self.scene('name.unity', doc(1, '"\\u4e2d\\u6587"'))
        self.assertEqual(tool.Scene(p).label(1), '中文')

    def test_duplicate_rejected_by_verify(self):
        p = self.scene('dup.unity', doc(1) + doc(1))
        with self.assertRaises(SystemExit):
            self.quiet(tool.cmd_verify, files=[p])

    def test_invalid_encodings(self):
        for data in (b'\xef\xbb\xbf' + HEADER.encode(), HEADER.encode('utf-16'),
                     HEADER.encode() + b'\xff', HEADER.encode('utf-16-le')):
            with self.subTest(data=data[:8]):
                p = self.root / 'bad.unity'
                p.write_bytes(data)
                with self.assertRaises(ValueError):
                    tool.Scene(str(p))

    def test_empty_and_non_yaml(self):
        for data in ('', HEADER, 'random text\n'):
            p = self.root / 'empty.unity'
            p.write_bytes(data.encode())
            with self.assertRaises(ValueError):
                tool.Scene(str(p))

    def test_conflict_markers(self):
        for marker in ('<<<<<<< ours', '=======', '>>>>>>> theirs', '||||||| base'):
            p = self.scene('conflict.unity', doc(1) + marker + '\n')
            with self.assertRaises(ValueError):
                tool.Scene(p)

    def test_malformed_doc_header(self):
        p = self.scene('badheader.unity', doc(1) + '--- !u!4 &oops\nTransform:\n')
        with self.assertRaises(ValueError):
            tool.Scene(p)

    def test_external_refs_excluded_and_prefab_local_included(self):
        p = self.scene('refs.unity', doc(1) + doc(2, kind=1001, extra=(
            '  m_TransformParent: {fileID: 99}\n'
            '  target: {fileID: 100, guid: abc123, type: 3}\n'
            '  root: {fileID: 1}\n  empty: {fileID: 0}\n')))
        self.assertEqual(tool.Scene(p).dangling(), [99])

    def test_disjoint_additions(self):
        self.assertIn('PASS', self.merge(doc(1), doc(1) + doc(2), doc(1) + doc(3), doc(1) + doc(2) + doc(3)))

    def test_same_count_wrong_ids(self):
        with self.assertRaises(SystemExit):
            self.merge(doc(1), doc(1) + doc(2), doc(1), doc(1) + doc(99))

    def test_same_addition_both_sides(self):
        # The old arithmetic formula would incorrectly demand three documents.
        self.assertIn('PASS', self.merge(doc(1), doc(1) + doc(2), doc(1) + doc(2), doc(1) + doc(2)))

    def test_both_delete(self):
        self.assertIn('PASS', self.merge(doc(1) + doc(2), doc(1), doc(1), doc(1)))

    def test_delete_unchanged(self):
        self.assertIn('PASS', self.merge(doc(1) + doc(2), doc(1), doc(1) + doc(2), doc(1)))

    def test_resurrection_rejected(self):
        with self.assertRaises(SystemExit):
            self.merge(doc(1) + doc(2), doc(1), doc(1) + doc(2), doc(1) + doc(2))

    def test_delete_modify_needs_review(self):
        for result in (doc(1), doc(1) + doc(2, 'changed')):
            with self.assertRaises(SystemExit):
                self.merge(doc(1) + doc(2), doc(1), doc(1) + doc(2, 'changed'), result)

    def test_new_dangling_ref_rejected(self):
        with self.assertRaises(SystemExit):
            self.merge(doc(1), doc(1), doc(1), doc(1, extra='  target: {fileID: 123}\n'))

    def test_header_changes_visible(self):
        a = self.scene('a.unity', doc(1))
        b = self.scene('b.unity', doc(1, kind=4, stripped=True))
        self.assertEqual(tool.Scene(a).changed_vs(tool.Scene(b)), [1])
        output = self.quiet(tool.cmd_show, a=a, b=b, id=1)
        self.assertIn('!u!4', output)
        self.assertIn('stripped', output)

    def test_crlf_conversion(self):
        p = self.scene('lf.unity', doc(1))
        original = Path(p).read_bytes()
        Path(p).write_bytes(b'\xef\xbb\xbf' + original)
        dst = str(self.root / 'crlf.unity')
        self.quiet(tool.cmd_to_crlf, src=p, dst=dst)
        expected = original.replace(b'\n', b'\r\n')
        self.assertEqual(Path(dst).read_bytes(), expected)
        self.quiet(tool.cmd_to_crlf, src=dst, dst=dst)
        self.assertEqual(Path(dst).read_bytes(), expected)

    def test_crlf_rejects_invalid_input_without_writing(self):
        src, dst = self.root / 'bad.unity', self.root / 'out.unity'
        for data in (b'garbage', HEADER.encode() + b'\xff', (HEADER + doc(1) + '=======\n').encode()):
            src.write_bytes(data)
            with self.assertRaises(ValueError):
                self.quiet(tool.cmd_to_crlf, src=str(src), dst=str(dst))
            self.assertFalse(dst.exists())

    def test_tree(self):
        p = self.scene('tree.unity', doc(1, 'Parent') + doc(2, 'Child') +
                       doc(11, kind=4, extra='  m_GameObject: {fileID: 1}\n  m_Father: {fileID: 0}\n') +
                       doc(12, kind=4, extra='  m_GameObject: {fileID: 2}\n  m_Father: {fileID: 11}\n'))
        output = self.quiet(tool.cmd_tree, file=p, selector='Parent')
        self.assertIn('Child', output)
        with self.assertRaises(SystemExit):
            self.quiet(tool.cmd_tree, file=p, selector='11')

    def test_cli_errors_return_nonzero(self):
        p = self.root / 'bad.unity'
        p.write_bytes(b'not yaml')
        with patch.object(sys, 'argv', ['scenetool.py', 'verify', str(p)]):
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit) as caught:
                    tool.main()
        self.assertEqual(caught.exception.code, 1)

    @unittest.skipUnless(shutil.which('git'), 'Git required for byte-fidelity integration test')
    def test_git_export_bytes_and_no_overwrite(self):
        repo = self.root / 'repo'
        repo.mkdir()
        def git(*args, **kwargs):
            subprocess.run(['git', '-C', str(repo), *args], check=True,
                           stdout=kwargs.pop('stdout', subprocess.DEVNULL), **kwargs)
        git('init', '-q')
        scene = 'Assets/含 空格.unity'
        entries, expected = [], []
        for stage in (1, 2, 3):
            data = (HEADER + doc(stage, '中文')).encode('utf-8').replace(b'\n', b'\r\n')
            blob = repo / f'blob{stage}'
            blob.write_bytes(data)
            digest = repo / f'hash{stage}'
            with digest.open('wb') as stream:
                git('hash-object', '-w', '--no-filters', str(blob), stdout=stream)
            entries.append(f'100644 {digest.read_text().strip()} {stage}\t{scene}\n')
            expected.append(data)
        info = repo / 'index-info'
        info.write_bytes(''.join(entries).encode('utf-8'))
        with info.open('rb') as stream:
            git('update-index', '--index-info', stdin=stream)
        out = self.root / 'exported'
        self.quiet(tool.cmd_export, repo=str(repo), scene=scene, out_dir=str(out))
        for side, data in zip(('base', 'ours', 'theirs'), expected):
            self.assertEqual((out / f'Scene.{side}.unity').read_bytes(), data)
        with self.assertRaises(ValueError):
            self.quiet(tool.cmd_export, repo=str(repo), scene=scene, out_dir=str(out))
        with contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(subprocess.CalledProcessError):
                self.quiet(tool.cmd_export, repo=str(repo), scene='missing.unity', out_dir=str(self.root / 'missing'))


if __name__ == '__main__':
    unittest.main(verbosity=2)
