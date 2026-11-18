import copy
import json
import os
import re
import shutil
import tempfile
import unittest
from dataclasses import replace
from datetime import date, datetime, timedelta
from pathlib import Path
from unittest.mock import patch

import requests
from support.fixtures import calendar_bytes, sample_events

from schedule.build import build_lock, output_path, publish_site, run
from schedule.classifier import match_session_marks
from schedule.config import (
    active_theme,
    load_config,
    validate_bulletin_config,
    validate_calendar_config,
    validate_evaluation_details,
    validate_session_marks,
    validate_site_config,
    validate_themes_config,
)
from schedule.curriculum import (
    canonical_module_codes,
    get_class_grades_data,
    resolve_module_info,
    split_event_title,
    validate_curriculum_config,
)
from schedule.exporter import serialize_events
from schedule.fetcher import CalendarUnavailable, fetch_calendar
from schedule.matcher import build_matching_matrix
from schedule.parser import normalize_room_name, parse_calendar
from schedule.renderer import render_site
from schedule.sitecheck import validate_site
from schedule.stylesheets import bundle_stylesheet
from schedule.viewmodels import prepare_evaluation_order


class ScheduleTests(unittest.TestCase):
    def setUp(self):
        self.config = load_config()
        self.classes = [c for p in self.config.programs for c in p.classes]

    def test_distinct_slots_and_matching(self):
        events = {c.id: sample_events(self.config, c) for c in self.classes}
        identifiers = [e.occurrence_id for values in events.values() for e in values]
        self.assertEqual(len(identifiers), len(set(identifiers)))
        matrix = build_matching_matrix(events, self.classes, self.config)
        for values in events.values():
            for event in values:
                for match in matrix[event.occurrence_id]:
                    self.assertEqual(match.evaluation.start_dt, event.start_dt)

    def order_with(self, **changes):
        from schedule.models import ClassMatchState

        base = replace(
            sample_events(self.config, self.classes[0])[0],
            rooms=("T22", "T25"),
            teachers=("Jerome M.", "Cleo B."),
        )
        other = replace(base, class_id=self.classes[1].id, **changes)
        state = ClassMatchState(self.classes[1], "same", other)
        return prepare_evaluation_order(self.config, self.classes[0], base, [state])

    def test_order_ignores_room_order(self):
        self.assertEqual(self.order_with(rooms=("T25", "T22"))[0]["notes"], [])
        self.assertEqual(
            self.order_with(rooms=("T25", "T24"))[0]["notes"],
            [f"{self.classes[1].label} : salles T25, T24"],
        )

    def test_order_ignores_teacher_order(self):
        self.assertEqual(self.order_with(teachers=("Cleo B.", "Jerome M."))[0]["notes"], [])
        self.assertEqual(
            self.order_with(teachers=("Cleo B.",))[0]["notes"],
            [f"{self.classes[1].label} : avec Cleo B."],
        )

    def test_order_sorts_slots_and_marks_current_class(self):
        base = sample_events(self.config, self.classes[0])[0]
        slots = self.order_with(
            start_dt=base.start_dt - timedelta(hours=2),
            end_dt=base.end_dt - timedelta(hours=2),
            time_range="06:00 - 08:00",
        )
        self.assertEqual([slot["time_range"] for slot in slots], ["06:00 - 08:00", base.time_range])
        self.assertEqual([slot["is_current"] for slot in slots], [False, True])
        self.assertEqual(slots[0]["classes"][0]["label"], self.classes[1].label)
        self.assertEqual(self.order_with()[0]["classes"][0]["is_current"], True)

    def test_nearest_alternate_match(self):
        from dataclasses import replace

        base = sample_events(self.config, self.classes[0])[0]
        other = sample_events(self.config, self.classes[1])[0]
        far = replace(
            other,
            occurrence_id="far",
            start_dt=other.start_dt - timedelta(days=6),
            date_iso="2026-09-02",
        )
        near = replace(
            other,
            occurrence_id="near",
            start_dt=other.start_dt + timedelta(days=1),
            date_iso="2026-09-09",
        )
        matrix = build_matching_matrix(
            {self.classes[0].id: [base], self.classes[1].id: [far, near]}, self.classes, self.config
        )
        self.assertEqual(matrix[base.occurrence_id][1].evaluation.occurrence_id, "near")

    def test_rejects_invalid_coefficients(self):
        for mapping in (
            {"missing": 6},
            {"ue6.1": 6},
            {"ue5.cy.4": 6},
            {"ue5.1": -1},
            {"ue5.1": True},
            {"ue5.1": float("nan")},
            {},
        ):
            with self.subTest(mapping=mapping):
                config = copy.deepcopy(self.config.curriculum)
                config["coefficients"]["dc"]["fi"]["R501"] = mapping
                with self.assertRaises(ValueError):
                    validate_curriculum_config(config)

    def test_bulletin_config_is_validated(self):
        valid = load_config().site["grades"]["bulletin"]
        validate_bulletin_config(copy.deepcopy(valid))
        for key, value in (
            ("module_prefixes", []),
            ("note_header", " "),
            ("evaluation_sections", []),
            ("max_pages", 0),
            ("wrap_gap", -1),
        ):
            broken = copy.deepcopy(valid)
            broken[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                validate_bulletin_config(broken)

    def test_evaluation_details_are_validated(self):
        valid = [{"id": "ds", "label": "DS", "weight": 1}]
        for track, status, code, evaluations in (
            ("xx", "fi", "R501", valid),
            ("dc", "xx", "R501", valid),
            ("dc", "fi", "R6cy04", valid),
            ("dc", "fi", "R501", []),
            ("dc", "fi", "R501", [{"id": "ds", "label": "DS", "weight": 0}]),
            ("dc", "fi", "R501", [{"id": "DS!", "label": "DS", "weight": 1}]),
            ("dc", "fi", "R501", [{"id": "ds", "label": " ", "weight": 1}]),
            ("dc", "fi", "R501", valid + valid),
        ):
            with self.subTest(track=track, status=status, code=code, evaluations=evaluations):
                config = copy.deepcopy(self.config.curriculum)
                config["evaluation_details"] = {track: {status: {code: evaluations}}}
                with self.assertRaises(ValueError):
                    validate_evaluation_details(config)

    def test_only_detailed_classes_expose_evaluations(self):
        detailed = {
            cls.id: get_class_grades_data(cls, self.config.curriculum, self.config.labels)[
                "has_details"
            ]
            for cls in self.classes
        }
        self.assertTrue(detailed["b3dc3"])
        self.assertFalse(detailed["b3dcc"])

    def test_rejects_duplicate_modules(self):
        config = copy.deepcopy(self.config.curriculum)
        config["modules"].append(copy.deepcopy(config["modules"][0]))
        with self.assertRaises(ValueError):
            validate_curriculum_config(config)

    def test_semester_ids_are_configurable(self):
        config = copy.deepcopy(self.config.curriculum)
        old_id = config["semesters"][0]["id"]
        config["semesters"][0]["id"] = "custom-semester"
        for item in config["modules"] + config["units"]:
            if item["semester"] == old_id:
                item["semester"] = "custom-semester"
        validate_curriculum_config(config)
        grades = get_class_grades_data(self.classes[0], config, self.config.labels)
        self.assertIn("custom-semester", grades["annual_units"][0]["units"])

    def test_semester_units_carry_annual_labels(self):
        annual = {item["id"]: item for item in self.config.curriculum["annual_units"]}
        for cls in self.classes:
            grades = get_class_grades_data(cls, self.config.curriculum, self.config.labels)
            for semester in grades["semesters"]:
                with self.subTest(class_id=cls.id, semester=semester["id"]):
                    self.assertEqual(
                        [(unit["short_label"], unit["title"]) for unit in semester["units"]],
                        [
                            (annual[unit["annual"]]["short_label"], annual[unit["annual"]]["label"])
                            for unit in semester["units"]
                        ],
                    )
                    self.assertEqual(
                        len({unit["short_label"] for unit in semester["units"]}),
                        len(semester["units"]),
                    )

    def test_event_titles_split_into_code_and_session(self):
        codes = canonical_module_codes(self.config.curriculum)
        for summary, expected in (
            ("R5devcloud11-TP-ProgInfra", ("R5dc11", "TP ProgInfra")),
            ("SAE5dc03-Projet", ("SAE5dc03", "Projet")),
            ("R505-Discussion Test", ("R505", "Discussion Test")),
            ("Réunion de rentrée BUT3-FI", ("", "Réunion de rentrée BUT3-FI")),
        ):
            with self.subTest(summary=summary):
                module_code = summary.split("-")[0].strip()
                self.assertEqual(split_event_title(summary, module_code, codes), expected)

    def test_module_kinds_follow_curriculum(self):
        info = resolve_module_info(
            self.config.curriculum, ["R5cyber09", "SAE501", "SAE502", "SAE5Porfolio", "Forum"]
        )
        self.assertEqual(info.keys(), {"R5cyber09", "SAE501", "SAE502", "SAE5Porfolio"})
        self.assertEqual(info["R5cyber09"]["kind"], "resource")
        self.assertEqual(
            info["SAE5Porfolio"], resolve_module_info(self.config.curriculum, ["SAE5"])["SAE5"]
        )
        self.assertNotEqual(info["SAE501"]["tone"], info["SAE502"]["tone"])
        config = copy.deepcopy(self.config.curriculum)
        config["modules"][0]["ade_codes"] = [""]
        with self.assertRaises(ValueError):
            validate_curriculum_config(config)

    def test_room_names_drop_configured_prefixes_and_suffixes(self):
        rooms = self.config.site["rooms"]
        for raw, expected in (
            ("Campus_C215", "C215"),
            ("IUT1_Campus_AMPHI CHARTREUSE", "AMPHI CHARTREUSE"),
            ("121_RT", "121"),
            ("T22", "T22"),
            ("120b", "120b"),
            ("Campus_", "Campus_"),
        ):
            with self.subTest(raw=raw):
                self.assertEqual(normalize_room_name(raw, rooms), expected)

    def test_session_marks_match_title_and_rooms(self):
        self.assertEqual(
            match_session_marks("R504-TD-ProjInf", ("T22",), self.config), ("tp-note",)
        )
        self.assertEqual(match_session_marks("R504-TD-ProjInf", ("T32",), self.config), ())
        self.assertEqual(match_session_marks("R501-TP-VirtualBox", (), self.config), ())
        for marks in (
            [replace(self.config.session_marks[0], id="scolarite")],
            [replace(self.config.session_marks[0], rules=())],
            [
                replace(
                    self.config.session_marks[0],
                    rules=(replace(self.config.session_marks[0].rules[0], title="("),),
                )
            ],
        ):
            with self.subTest(marks=marks), self.assertRaises(ValueError):
                validate_session_marks(marks, {"scolarite"})

    def test_calendar_rejects_invalid_days(self):
        for days in ([], [1, 1], [0], [8], [True], [2, 1]):
            with self.subTest(days=days), self.assertRaises(ValueError):
                validate_calendar_config({**self.config.calendar_config, "days_of_week": days})

    def test_external_links_follow_navigation_order(self):
        external_urls = {
            section.id: section.url
            for section in self.config.sections
            if section.kind == "external"
        }
        with tempfile.TemporaryDirectory() as directory:
            render_site(self.config, {}, output_dir=directory)
            for cls in self.classes:
                html = (Path(directory) / "classes" / cls.id / "notes.html").read_text()
                self.assertIn(external_urls["gitlab-im2ag"], html)
                self.assertIn(external_urls["gitlab-gricad"], html)
                self.assertLess(
                    html.index(external_urls["webmail"]),
                    html.index(external_urls["gitlab-im2ag"]),
                )
                self.assertLess(
                    html.index(external_urls["gitlab-im2ag"]),
                    html.index(external_urls["gitlab-gricad"]),
                )

    def test_safe_json_hidden_teachers_and_configured_grades(self):
        from dataclasses import replace

        config = self.config
        config.site["teachers"]["display_mode"] = "hidden"
        config.site["grades"].update(
            maximum=100, decimals=3, storage_key_prefix="custom", export_format_version=2
        )
        event = sample_events(config, self.classes[0])[0]
        event = replace(
            event,
            summary="R501-DS </script><script>window.injected=1</script>",
            module_code='R"501',
            teachers=("Test Teacher",),
        )
        with tempfile.TemporaryDirectory() as directory:
            render_site(config, {self.classes[0].id: [event]}, output_dir=directory)
            root = Path(directory) / "classes" / self.classes[0].id
            calendar = (root / "index.html").read_text()
            notice = (root / "a-savoir.html").read_text()
            self.assertIn('href="../../classes/' + self.classes[0].id + '/notes.html"', notice)
            self.assertIn('content="0; url=index.html"', (root / "calendar.html").read_text())
            self.assertNotIn("</script><script>window.injected=1</script>", calendar)
            embedded = calendar.split('id="class-events-data">', 1)[1].split("</script>", 1)[0]
            self.assertEqual(
                json.loads(embedded), serialize_events(config, self.classes[0].id, [event])
            )
            self.assertEqual(json.loads(embedded)["events"][0]["teachers"], [])
            evaluations = (root / "evaluations.html").read_text()
            self.assertNotIn('class="col-teachers"', evaluations)
            self.assertNotIn("Test Teacher", evaluations)
            notes = (root / "notes.html").read_text()
            for value in (
                'data-max="100"',
                'data-decimals="3"',
                'data-storage-prefix="custom"',
                'data-format-version="2"',
                "Note / 100",
            ):
                self.assertIn(value, notes)
            self.assertNotIn("static/filters.js", notes)

    def test_legacy_links_keep_both_slots(self):
        events = sample_events(self.config, self.classes[0])
        with tempfile.TemporaryDirectory() as directory:
            render_site(self.config, {self.classes[0].id: events}, output_dir=directory)
            root = Path(directory) / "classes" / self.classes[0].id / "evaluations"
            legacy = (root / "r501-ds--2026-09-08.html").read_text()
            for event in events:
                self.assertTrue((root / (event.occurrence_id + ".html")).exists())
                self.assertIn(event.occurrence_id, legacy)

    def test_configured_date_formats(self):
        self.config.site["formats"].update(time="%Hh%M", time_range="{start} / {end}")
        event = sample_events(self.config, self.classes[0])[0]
        self.assertEqual(event.time_range, "08h00 / 10h00")

    def test_fetch_preserves_network_error(self):
        error = requests.ConnectionError("test connection failure")
        with (
            patch("schedule.fetcher.requests.Session") as session,
            patch("schedule.fetcher.time.sleep"),
        ):
            client = session.return_value.__enter__.return_value
            client.get.side_effect = error
            with self.assertRaises(CalendarUnavailable) as raised:
                fetch_calendar("https://example.invalid", self.config.site, "test")
            self.assertIs(raised.exception.__cause__, error)
            self.assertEqual(client.get.call_count, self.config.site["ade"]["retry_attempts"])

    def test_theme_applies_only_within_its_enabled_period(self):
        themes = {
            "directory": "themes",
            "stylesheet": "theme.css",
            "themes": [
                {
                    "id": "first",
                    "label": "First",
                    "enabled": False,
                    "first_date": "2026-11-01",
                    "last_date": "2026-11-30",
                },
                {
                    "id": "second",
                    "label": "Second",
                    "enabled": True,
                    "first_date": "2026-11-10",
                    "last_date": "2026-11-20",
                },
            ],
        }
        validate_themes_config(themes)
        for day, expected in (
            ("2026-11-09", None),
            ("2026-11-10", "second"),
            ("2026-11-20", "second"),
            ("2026-11-21", None),
        ):
            with self.subTest(day=day):
                theme = active_theme(themes, date.fromisoformat(day))
                self.assertEqual(theme and theme["id"], expected)
        for change in (
            {"id": "Bad Id"},
            {"id": "first"},
            {"enabled": "yes"},
            {"label": " "},
            {"first_date": "2026-11-21"},
            {"last_date": "soon"},
        ):
            with self.subTest(change=change):
                broken = copy.deepcopy(themes)
                broken["themes"][1].update(change)
                with self.assertRaises(ValueError):
                    validate_themes_config(broken)
        for key, value in (("directory", "../themes"), ("stylesheet", "/theme.css")):
            with self.subTest(key=key):
                broken = copy.deepcopy(themes)
                broken[key] = value
                with self.assertRaises(ValueError):
                    validate_themes_config(broken)

    def test_pages_load_the_stylesheet_of_the_active_theme_only(self):
        themes = {
            "directory": "themes",
            "stylesheet": "theme.css",
            "themes": [
                {
                    "id": "sample",
                    "label": "Sample",
                    "enabled": True,
                    "first_date": "2026-11-10",
                    "last_date": "2026-11-20",
                }
            ],
        }
        config = replace(self.config, themes=themes)
        link = 'static/themes/sample/theme.css"'
        with (
            tempfile.TemporaryDirectory() as static,
            tempfile.TemporaryDirectory() as directory,
        ):
            shutil.copytree("static/icons", Path(static) / "icons")
            stylesheet = Path(static) / "themes" / "sample" / "theme.css"
            stylesheet.parent.mkdir(parents=True)
            stylesheet.touch()
            page = Path(directory) / "classes" / self.classes[0].id / "index.html"

            def render(day):
                render_site(
                    config,
                    {},
                    output_dir=directory,
                    static_dir=static,
                    today=date.fromisoformat(day),
                )
                return page.read_text()

            themed = render("2026-11-20")
            self.assertIn('data-theme="sample"', themed)
            self.assertIn(link, themed)
            plain = render("2026-11-21")
            self.assertNotIn("data-theme", plain)
            self.assertNotIn(link, plain)
            stylesheet.unlink()
            with self.assertRaises(ValueError):
                render("2026-11-21")

    def test_stylesheet_imports_are_bundled_into_their_layers(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            entry = root / "style.css"
            entry.write_text(
                "@layer base, pages;\n\n"
                '@import url("base.css") layer(base);\n'
                '@import url("first.css") layer(pages);\n'
                '@import url("second.css") layer(pages);\n\n'
                "@font-face {\n  font-family: Sample;\n}\n"
            )
            (root / "base.css").write_text("a {\n  color: red;\n}\n")
            (root / "first.css").write_text("b {\n  color: blue;\n}\n")
            (root / "second.css").write_text("i {\n  color: green;\n}\n")
            bundle_stylesheet(entry)
            self.assertEqual(
                entry.read_text(),
                "@layer base, pages;\n\n"
                "@layer base {\na {\n  color: red;\n}\n}\n"
                "@layer pages {\nb {\n  color: blue;\n}\n}\n"
                "@layer pages {\ni {\n  color: green;\n}\n}\n\n"
                "@font-face {\n  font-family: Sample;\n}\n",
            )
            self.assertEqual([path.name for path in root.iterdir()], ["style.css"])
            for broken in ('@import "other.css";\n', '@import url("../x.css") layer(base);\n'):
                with self.subTest(broken=broken):
                    entry.write_text(broken)
                    with self.assertRaises(ValueError):
                        bundle_stylesheet(entry)
            entry.write_text('@import url("outer.css") layer(base);\n')
            (root / "outer.css").write_text('@import url("inner.css") layer(base);\n')
            with self.assertRaises(ValueError):
                bundle_stylesheet(entry)
        bundled = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, bundled)
        shutil.copytree("static/css", bundled / "css")
        bundle_stylesheet(bundled / self.config.site["stylesheet"])
        self.assertEqual([path.name for path in (bundled / "css").iterdir()], ["style.css"])

    def test_unreachable_calendar_ends_the_build_as_a_temporary_failure(self):
        with (
            patch("schedule.build.fetch_calendar", side_effect=CalendarUnavailable("down")),
            patch("schedule.build.publish_site") as publish,
            patch("sys.stderr"),
        ):
            self.assertEqual(run(), os.EX_TEMPFAIL)
            publish.assert_not_called()
        with patch("schedule.build.main"):
            self.assertEqual(run(), os.EX_OK)
        with patch("schedule.build.main", side_effect=ValueError("broken")):
            with self.assertRaises(ValueError):
                run()

    def test_all_page_families_render_with_safe_links(self):
        events = sample_events(self.config, self.classes[0])
        with tempfile.TemporaryDirectory() as directory:
            render_site(self.config, {self.classes[0].id: events}, output_dir=directory)
            root = Path(directory)
            shutil.copytree("static", root / "static")
            pages, references = validate_site(root)
            self.assertGreater(pages, 10)
            self.assertGreater(references, pages)
            (root / "static" / "js" / "utils.js").unlink()
            with self.assertRaisesRegex(ValueError, "Missing"):
                validate_site(root)

    def test_pages_declare_a_content_security_policy_without_inline_scripts(self):
        events = sample_events(self.config, self.classes[0])
        with tempfile.TemporaryDirectory() as directory:
            render_site(self.config, {self.classes[0].id: events}, output_dir=directory)
            pages = list(Path(directory).rglob("*.html"))
            self.assertGreater(len(pages), 10)
            for page in pages:
                html = page.read_text()
                with self.subTest(page=page.name):
                    policy = html.split('http-equiv="Content-Security-Policy" content="', 1)[1]
                    self.assertIn("script-src &#39;self&#39;", policy.split('"', 1)[0])
                    scripts = re.findall(r"<script\b[^>]*>", html)
                    for tag in scripts:
                        self.assertTrue("src=" in tag or 'type="application/json"' in tag, tag)
                    if scripts:
                        self.assertLess(
                            html.index("Content-Security-Policy"), html.index("<script")
                        )

    def test_content_security_policy_configuration_is_validated(self):
        for policy in ({}, {"script-src": []}, {"script-src": ["'self'; img-src *"]}):
            site = copy.deepcopy(self.config.site)
            site["content_security_policy"] = policy
            with self.subTest(policy=policy), self.assertRaises(ValueError):
                validate_site_config(site)

    def test_repeated_publish_removes_only_stale_generated_files(self):
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory)
            shutil.copytree("static", project / "static")
            config = copy.deepcopy(self.config)
            config.site["output_directory"] = "site-output"
            config.site["static_directory"] = "static"
            events = {self.classes[0].id: sample_events(config, self.classes[0])}
            publish_site(config, events, None, project)
            occurrence = events[self.classes[0].id][0].occurrence_id
            stale = project / "site-output" / "classes" / self.classes[0].id / "evaluations"
            self.assertTrue((stale / f"{occurrence}.html").exists())
            publish_site(config, {}, None, project)
            self.assertFalse((stale / f"{occurrence}.html").exists())
            unmanaged = project / "unmanaged"
            unmanaged.mkdir()
            with self.assertRaises(ValueError):
                output_path("unmanaged", project)

    def test_invalid_calendar_occurrences_are_skipped(self):
        start = datetime(2026, 9, 8, 8, tzinfo=self.config.timezone)
        events = parse_calendar(
            calendar_bytes(
                [
                    {
                        "uid": "invalid",
                        "summary": "R501-invalid",
                        "dtstart": start,
                        "dtend": start,
                    }
                ]
            ),
            self.classes[0],
            self.config,
        )
        self.assertEqual(events, [])

    def test_build_lock_excludes_a_second_publisher(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "dist"
            with build_lock(target):
                with self.assertRaisesRegex(RuntimeError, "Another build"):
                    with build_lock(target):
                        self.fail("Concurrent publisher acquired the lock")
            with build_lock(target):
                self.assertFalse(target.exists())

    def test_failed_publication_restores_the_previous_site(self):
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory)
            shutil.copytree("static", project / "static")
            config = copy.deepcopy(self.config)
            config.site["output_directory"] = "site-output"
            publish_site(config, {}, None, project)
            target = project / "site-output"
            original = (target / "index.html").read_bytes()
            from os import replace as replace_path

            def fail_new_publication(source, destination):
                if Path(destination) == target and Path(source).name != ".site-output-previous":
                    raise OSError("Publication failed")
                replace_path(source, destination)

            with patch("schedule.build.os.replace", side_effect=fail_new_publication):
                with self.assertRaisesRegex(OSError, "Publication failed"):
                    publish_site(config, {}, None, project)
            self.assertEqual((target / "index.html").read_bytes(), original)
            self.assertFalse((project / ".site-output-previous").exists())

    def test_site_references_include_assets_queries_fragments_and_base_path(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "index.html").write_text('<a href="/project/other.html?x=1#target">Link</a>')
            (root / "other.html").write_text(
                '<p id="target">Target</p><script src="app.js?v=1"></script>'
            )
            (root / "app.js").write_text("")
            self.assertEqual(validate_site(root, "/project/"), (2, 2))
            (root / "other.html").write_text('<p id="wrong">Wrong</p>')
            with self.assertRaisesRegex(ValueError, "fragment"):
                validate_site(root, "/project/")
