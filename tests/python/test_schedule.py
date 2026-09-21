import copy
import json
import shutil
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

import requests
from support.fixtures import calendar_bytes, sample_events

from schedule.build import build_lock, output_path, publish_site
from schedule.config import load_config, validate_calendar_config, validate_tasks_config
from schedule.curriculum import get_class_grades_data, validate_curriculum_config
from schedule.exporter import serialize_events
from schedule.fetcher import fetch_calendar
from schedule.matcher import build_matching_matrix
from schedule.parser import parse_calendar
from schedule.renderer import render_site
from schedule.sitecheck import validate_site


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

    def test_calendar_rejects_invalid_days(self):
        for days in ([], [1, 1], [0], [8], [True], [2, 1]):
            with self.subTest(days=days), self.assertRaises(ValueError):
                validate_calendar_config({**self.config.calendar_config, "days_of_week": days})

    def test_tasks_configuration_and_pages(self):
        valid = self.config.tasks_config
        for candidate in (
            {**valid, "max_items": 0},
            {**valid, "max_text_length": valid["max_total_text_length"] + 1},
            {key: value for key, value in valid.items() if key != "export_format"},
        ):
            with self.subTest(candidate=candidate), self.assertRaises(ValueError):
                validate_tasks_config(candidate)
        external_urls = {
            section.id: section.url
            for section in self.config.sections
            if section.kind == "external"
        }
        with tempfile.TemporaryDirectory() as directory:
            render_site(self.config, {}, output_dir=directory)
            for cls in self.classes:
                root = Path(directory) / "classes" / cls.id
                html = (root / "a-faire.html").read_text()
                payload = json.loads(html.split('id="tasks-data">', 1)[1].split("</script>", 1)[0])
                self.assertEqual(payload["classId"], cls.id)
                self.assertEqual(payload["config"], valid)
                self.assertIn("tasks-model.js", html)
                self.assertIn("a-faire.html", (root / "index.html").read_text())
                self.assertIn(external_urls["gitlab"], html)
                self.assertLess(
                    html.index(external_urls["webmail"]),
                    html.index(external_urls["gitlab"]),
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
            calendar = (root / "calendar.html").read_text()
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
        self.config.site["formats"].update(
            date_absolute="%Y.%m.%d", time="%Hh%M", time_range="{start} / {end}"
        )
        event = sample_events(self.config, self.classes[0])[0]
        self.assertEqual(event.date_formatted, "2026.09.08")
        self.assertEqual(event.time_range, "08h00 / 10h00")

    def test_fetch_preserves_network_error(self):
        error = requests.ConnectionError("test connection failure")
        with (
            patch("schedule.fetcher.requests.Session") as session,
            patch("schedule.fetcher.time.sleep"),
        ):
            client = session.return_value.__enter__.return_value
            client.get.side_effect = error
            with self.assertRaises(RuntimeError) as raised:
                fetch_calendar("https://example.invalid", self.config.site, "test")
            self.assertIs(raised.exception.__cause__, error)
            self.assertEqual(client.get.call_count, self.config.site["ade"]["retry_attempts"])

    def test_absence_page_uses_shared_calendar_and_configuration(self):
        eligible = next(cls for cls in self.classes if cls.status == "fi")
        config = self.config
        events = sample_events(config, eligible)
        with tempfile.TemporaryDirectory() as directory:
            render_site(
                config,
                {eligible.id: events},
                output_dir=directory,
            )
            root = Path(directory) / "classes" / eligible.id
            html = (root / "absences.html").read_text()
            payload = json.loads(html.split('id="absence-data">', 1)[1].split("</script>", 1)[0])
            self.assertEqual(
                payload["events"],
                serialize_events(config, eligible.id, events)["events"],
            )
            self.assertEqual(payload["config"], config.absence_config)
            self.assertEqual(payload["classId"], eligible.id)
            self.assertEqual(payload["year"], config.site["school_year"])
            self.assertEqual(payload["pdfAssets"]["logo"], "../../static/images/IUT1-UGA.png")
            self.assertEqual(
                payload["pdfAssets"]["library"],
                "../../static/vendor/pdf-lib-1.17.1.min.js",
            )
            self.assertIn(">Tout effacer</button>", html)
            self.assertNotIn("built-in method", html)
            self.assertNotIn("Enregistrer le suivi", html)
            self.assertIn("À partir du matin", html)
            self.assertIn("Jusqu’à la fin de la journée", html)
            self.assertIn(">Télécharger le PDF</button>", html)
            self.assertIn(">Ouvrir le PDF</button>", html)
            self.assertNotIn("window.print", (Path("static") / "js" / "absences.js").read_text())
            self.assertNotIn("absence-print-sheet", html)
            self.assertIn("absences.html", (root / "index.html").read_text())
            self.assertNotIn("static/absences.js", (root / "notes.html").read_text())

    def test_absence_configuration_rejects_invalid_boundaries(self):
        from schedule.config import validate_absence_config

        for value in ("00:00", "24:00", "12:99", "12:00:00"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_absence_config({**self.config.absence_config, "afternoon_start": value})

    def test_absence_sheet_configuration_is_validated(self):
        from schedule.config import validate_absence_config

        valid = self.config.absence_config
        for sheet in [
            {**valid["sheet"], "blob_revoke_delay_ms": 0},
            {**valid["sheet"], "logo_path": "favicon.png"},
            {**valid["sheet"], "pdf_assets": {**valid["sheet"]["pdf_assets"], "font_bold": ""}},
            {**valid["sheet"], "pdf_layout": {**valid["sheet"]["pdf_layout"], "rule_width": 0}},
            {key: value for key, value in valid["sheet"].items() if key != "logo_path"},
        ]:
            with self.subTest(sheet=sheet), self.assertRaises(ValueError):
                validate_absence_config({**valid, "sheet": sheet})

    def test_absence_configuration_has_no_semester_dependency(self):
        eligible = next(cls for cls in self.classes if cls.status == "fi")
        self.assertNotIn("semester_periods", self.config.absence_config)
        with tempfile.TemporaryDirectory() as directory:
            render_site(
                self.config,
                {eligible.id: sample_events(self.config, eligible)},
                output_dir=directory,
            )
            payload = json.loads(
                (Path(directory) / "classes" / eligible.id / "absences.html")
                .read_text()
                .split('id="absence-data">', 1)[1]
                .split("</script>", 1)[0]
            )
            self.assertNotIn("semesterPeriods", payload)

    def test_absences_are_only_generated_and_linked_for_eligible_classes(self):
        with tempfile.TemporaryDirectory() as directory:
            render_site(self.config, {}, output_dir=directory)
            for cls in self.classes:
                root = Path(directory) / "classes" / cls.id
                eligible = cls.status == "fi"
                self.assertEqual((root / "absences.html").exists(), eligible)
                for page in ("index.html", "calendar.html", "notes.html", "evaluations.html"):
                    self.assertEqual("absences.html" in (root / page).read_text(), eligible)

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
