import base64
import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
import unittest
from dataclasses import replace
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from support.fixtures import sample_events

from schedule.config import load_config
from schedule.exporter import export_data_files
from schedule.renderer import render_site


class BrowserTests(unittest.TestCase):
    def test_interactions_and_responsive(self):
        browser = (
            os.environ.get("CHROME_BIN")
            or shutil.which("chromium")
            or shutil.which("google-chrome")
        )
        if not browser and os.environ.get("CI"):
            self.fail("Chrome or Chromium must be installed in CI")
        if not browser:
            self.skipTest("Chromium or Chrome is required for browser tests")
        if os.environ.get("CI"):
            for tool in ("pdfinfo", "pdftotext", "pdffonts"):
                self.assertIsNotNone(shutil.which(tool), f"{tool} must be installed in CI")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = load_config()
            classes = [c for p in config.programs for c in p.classes]
            events = {c.id: sample_events(config, c) for c in classes}
            first = events[classes[0].id][0]
            events[classes[0].id].append(
                replace(
                    first,
                    occurrence_id="injection-test",
                    category_id="",
                    summary="</script><script>window.injected=1</script>",
                )
            )
            render_site(config, events, output_dir=str(root))
            export_data_files(config, events, str(root))
            shutil.copytree("static", root / "static")
            for script in Path("tests/browser").glob("*.js"):
                shutil.copy(script, root / script.name)
            (root / "runner.html").write_text(
                '<!doctype html><html><head><meta charset="utf-8"></head><body>'
                '<script src="harness.js"></script><script src="browser-report.js"></script>'
                '<script src="browser.js"></script></body></html>'
            )
            (root / "absence-runner.html").write_text(
                '<!doctype html><html><head><meta charset="utf-8"></head><body>'
                '<script src="harness.js"></script><script src="browser-report.js"></script>'
                '<script src="absence-browser.js"></script>'
                '<script src="absence-runner.js"></script></body></html>'
            )
            (root / "cross-browser.html").write_text(
                '<!doctype html><html><head><meta charset="utf-8"></head><body>'
                '<script src="harness.js"></script><script src="browser-report.js"></script>'
                '<script src="absence-browser.js"></script>'
                '<script src="cross-browser.js"></script></body></html>'
            )
            calendar = root / "classes" / classes[0].id / "calendar.html"
            disabled = calendar.read_text().replace(
                "<script ", '<script type="application/disabled" '
            )
            (calendar.parent / "no-js.html").write_text(disabled)
            config.calendar_config["days_of_week"] = [1, 2, 3, 4, 5, 6, 7]
            config.calendar_config["default_view"] = "day"
            render_site(config, events, output_dir=str(root / "custom"))
            shutil.copytree("static", root / "custom" / "static")
            for page in root.rglob("*.html"):
                content = page.read_text(encoding="utf-8")
                capture = (
                    "<script>window.__testErrors=[];"
                    'addEventListener("error",e=>__testErrors.push(e.message));'
                    'addEventListener("unhandledrejection",'
                    "e=>__testErrors.push(String(e.reason)));</script>"
                )
                page.write_text(content.replace("<head>", "<head>" + capture, 1), encoding="utf-8")
            browser_result = {}
            completed = threading.Event()

            class BrowserHandler(SimpleHTTPRequestHandler):
                def do_POST(self):
                    if self.path != "/__browser_result__":
                        self.send_error(404)
                        return
                    payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                    browser_result.update(payload)
                    self.send_response(204)
                    self.end_headers()
                    completed.set()

                def log_message(self, format, *args):
                    pass

            def run_browser(name, command):
                completed.clear()
                browser_result.clear()
                log_path = root / f"{name}.log"
                with log_path.open("w") as log:
                    process = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT)
                    deadline = time.monotonic() + 60
                    try:
                        while not completed.wait(0.1):
                            if process.poll() is not None or time.monotonic() >= deadline:
                                break
                    finally:
                        process.terminate()
                        try:
                            process.wait(timeout=5)
                        except subprocess.TimeoutExpired:
                            process.kill()
                            process.wait(timeout=5)
                html = browser_result.get("html", "")
                if not completed.is_set() or browser_result.get("status") != "passed":
                    artifacts = Path(os.environ.get("BROWSER_ARTIFACTS_DIR", "test-artifacts"))
                    artifacts.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(log_path, artifacts / log_path.name)
                    (artifacts / f"{name}.html").write_text(html, encoding="utf-8")
                    self.fail(
                        f"{name}: "
                        + ("tests failed" if completed.is_set() else "no completion report")
                        + "\n"
                        + html[-16000:]
                        + "\n"
                        + log_path.read_text()[-4000:]
                    )
                return html

            handler = partial(BrowserHandler, directory=str(root))
            server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                results = {}
                for name in ("runner", "absence-runner"):
                    results[name] = run_browser(
                        name,
                        [
                            browser,
                            "--headless",
                            "--no-sandbox",
                            "--disable-dev-shm-usage",
                            "--disable-gpu",
                            "--no-first-run",
                            "--no-default-browser-check",
                            "--user-data-dir=" + str(root / f"profile-{name}"),
                            f"http://127.0.0.1:{server.server_port}/{name}.html",
                        ],
                    )
                firefox = os.environ.get("FIREFOX_BIN") or shutil.which("firefox")
                if not firefox and os.environ.get("CI"):
                    self.fail("Firefox must be installed in CI")
                if firefox:
                    for theme, preference in (("light", 0), ("dark", 1)):
                        profile = root / f"firefox-profile-{theme}"
                        profile.mkdir()
                        (profile / "user.js").write_text(
                            f'user_pref("ui.systemUsesDarkTheme", {preference});\n'
                        )
                        run_browser(
                            f"firefox-{theme}",
                            [
                                firefox,
                                "--headless",
                                "--no-remote",
                                "--profile",
                                str(profile),
                                f"http://127.0.0.1:{server.server_port}/cross-browser.html?theme={theme}",
                            ],
                        )

            finally:
                server.shutdown()
                server.server_close()
                thread.join()
            result = results["absence-runner"]
            encoded_pdf = re.search(r'<output id="absence-pdf-data">([^<]+)</output>', result)
            self.assertIsNotNone(encoded_pdf)
            pdf_bytes = base64.b64decode(encoded_pdf.group(1))
            pdf_path = root / "absence-test.pdf"
            pdf_path.write_bytes(pdf_bytes)
            if os.environ.get("ABSENCE_PDF_OUTPUT"):
                Path(os.environ["ABSENCE_PDF_OUTPUT"]).write_bytes(pdf_bytes)
            if shutil.which("pdfinfo"):
                info = subprocess.run(
                    ["pdfinfo", str(pdf_path)], capture_output=True, text=True, check=True
                ).stdout
                self.assertIn("Pages:           1", info)
                self.assertIn("595.28 x 841.89 pts (A4)", info)
            if shutil.which("pdftotext"):
                text = subprocess.run(
                    ["pdftotext", "-layout", str(pdf_path), "-"],
                    capture_output=True,
                    text=True,
                    check=True,
                ).stdout
                for expected in (
                    "ABSENCE - Département RT",
                    "A déposer dans la boîte d’absence",
                    "Rappels :",
                    "Année",
                    "Nom Prénom",
                    "Motif : cœur, œuvre • l’étudiant — délai.",
                    "Saint-Martin-d’Hères, le",
                    "Signature :",
                ):
                    self.assertIn(expected, text)
                self.assertNotIn("http://", text)
            if shutil.which("pdffonts"):
                fonts = subprocess.run(
                    ["pdffonts", str(pdf_path)], capture_output=True, text=True, check=True
                ).stdout
                self.assertGreaterEqual(fonts.count("DejaVuSans"), 2)
            encoded_annex = re.search(
                r'<output id="absence-pdf-annex-data">([^<]+)</output>', result
            )
            self.assertIsNotNone(encoded_annex)
            annex_path = root / "absence-annex-test.pdf"
            annex_path.write_bytes(base64.b64decode(encoded_annex.group(1)))
            if shutil.which("pdfinfo"):
                info = subprocess.run(
                    ["pdfinfo", str(annex_path)], capture_output=True, text=True, check=True
                ).stdout
                self.assertNotIn("Pages:           1", info)
            if shutil.which("pdftotext"):
                text = subprocess.run(
                    ["pdftotext", "-layout", str(annex_path), "-"],
                    capture_output=True,
                    text=True,
                    check=True,
                ).stdout
                self.assertIn("Voir l’annexe.", text)
                self.assertIn("Annexe", text)
                self.assertGreaterEqual(
                    " ".join(text.split()).count(
                        "Motif détaillé avec œuvre, cœur et délai — contenu conservé."
                    ),
                    80,
                )
