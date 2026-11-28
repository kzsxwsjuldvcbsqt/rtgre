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
from icalendar import Calendar
from markupsafe import escape
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
from schedule.viewmodels import (
    prepare_evaluation_order,
    prepare_module_groups,
    prepare_module_progress,
)


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
            ("status_markers", {"fi": "FI", "fa": "FI"}),
            ("status_markers", {"fi": " "}),
            ("code_suffixes", ["A"]),
        ):
            broken = copy.deepcopy(valid)
            broken[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                validate_bulletin_config(broken)

    def test_bulletin_classes_and_statuses_must_exist(self):
        for key, value in (
            ("classes", ["inconnue"]),
            ("status_markers", {"fi": "FI"}),
            ("code_suffixes", {"xx": "A"}),
        ):
            with self.subTest(key=key), tempfile.TemporaryDirectory() as directory:
                config_dir = Path(directory) / "config"
                shutil.copytree("config", config_dir)
                site_path = config_dir / "site.json"
                site = json.loads(site_path.read_text())
                site["grades"]["bulletin"][key] = value
                site_path.write_text(json.dumps(site))
                with self.assertRaises(ValueError):
                    load_config(str(config_dir))

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
        self.assertTrue(detailed["b3dcc"])
        self.assertFalse(detailed["b3cya"])

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
        chamilo = self.config.site["chamilo"]
        info = resolve_module_info(
            self.config.curriculum,
            ["R5cyber09", "SAE501", "SAE502", "SAE5Porfolio", "Forum"],
            chamilo,
        )
        self.assertEqual(info.keys(), {"R5cyber09", "SAE501", "SAE502", "SAE5Porfolio"})
        self.assertEqual(info["R5cyber09"]["kind"], "resource")
        self.assertEqual(
            info["SAE5Porfolio"],
            resolve_module_info(self.config.curriculum, ["SAE5"], chamilo)["SAE5"],
        )
        self.assertTrue(info["R5cyber09"]["url"].startswith(chamilo["course_base_url"]))
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

    def test_calendar_rejects_invalid_year_load_hours(self):
        for steps in ([], [0], [4, 2], [2, 2], ["2"], None):
            with self.subTest(steps=steps), self.assertRaises(ValueError):
                validate_calendar_config({**self.config.calendar_config, "year_load_hours": steps})

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
            "choices": {"seasonal": "auto", "classic": "classic"},
            "accents": [{"id": "yellow", "label": "Jaune"}, {"id": "blue", "label": "Bleu"}],
            "themes": [
                {
                    "id": "first",
                    "label": "First",
                    "enabled": False,
                    "preload_images": [],
                    "first_date": "2026-11-01",
                    "last_date": "2026-11-30",
                },
                {
                    "id": "second",
                    "label": "Second",
                    "enabled": True,
                    "preload_images": ["cover.webp"],
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
            {"id": "auto"},
            {"id": "classic"},
            {"enabled": "yes"},
            {"label": " "},
            {"preload_images": ["../cover.webp"]},
            {"first_date": "2026-11-21"},
            {"last_date": "soon"},
        ):
            with self.subTest(change=change):
                broken = copy.deepcopy(themes)
                broken["themes"][1].update(change)
                with self.assertRaises(ValueError):
                    validate_themes_config(broken)
        for key, value in (
            ("directory", "../themes"),
            ("stylesheet", "/theme.css"),
            ("choices", {"seasonal": "same", "classic": "same"}),
            ("choices", {"seasonal": "auto"}),
            ("accents", []),
            ("accents", [{"id": "blue", "label": "Bleu"}, {"id": "blue", "label": "Bleu"}]),
            ("accents", [{"id": "Bleu ciel", "label": "Bleu"}]),
            ("accents", [{"id": "blue", "label": " "}]),
        ):
            with self.subTest(key=key):
                broken = copy.deepcopy(themes)
                broken[key] = value
                with self.assertRaises(ValueError):
                    validate_themes_config(broken)

    def test_pages_load_every_enabled_theme_and_start_on_the_seasonal_one(self):
        themes = {
            "directory": "themes",
            "stylesheet": "theme.css",
            "choices": {"seasonal": "auto", "classic": "classic"},
            "accents": [{"id": "yellow", "label": "Jaune"}, {"id": "blue", "label": "Bleu"}],
            "themes": [
                {
                    "id": "sample",
                    "label": "Sample",
                    "enabled": True,
                    "preload_images": ["cover.webp"],
                    "first_date": "2026-11-10",
                    "last_date": "2026-11-20",
                },
                {
                    "id": "retired",
                    "label": "Retired",
                    "enabled": False,
                    "preload_images": [],
                    "first_date": "2026-11-10",
                    "last_date": "2026-11-20",
                },
            ],
        }
        config = replace(self.config, themes=themes)
        link = (
            'static/themes/sample/theme.css" data-theme-id="sample"'
            " data-preload-images='[\"cover.webp\"]'"
        )
        with (
            tempfile.TemporaryDirectory() as static,
            tempfile.TemporaryDirectory() as directory,
        ):
            shutil.copytree("static/icons", Path(static) / "icons")
            stylesheet = Path(static) / "themes" / "sample" / "theme.css"
            stylesheet.parent.mkdir(parents=True)
            stylesheet.write_text('[data-theme="sample"] {}')
            cover = stylesheet.with_name("cover.webp")
            cover.touch()
            retired = Path(static) / "themes" / "retired" / "theme.css"
            retired.parent.mkdir()
            retired.write_text('[data-theme="retired"] {}')
            root = Path(directory) / "classes" / self.classes[0].id
            page = root / "index.html"
            settings = root / next(s.file for s in config.sections if s.id == "settings")

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
            self.assertIn('<html lang="fr" data-theme="sample">', themed)
            self.assertIn(link, themed)
            self.assertIn('data-swatch="sample"></span>De saison', settings.read_text())
            plain = render("2026-11-21")
            self.assertIn('<html lang="fr">', plain)
            self.assertIn(link, plain)
            self.assertIn('data-swatch="classic"></span>De saison', settings.read_text())
            for html in (plain, settings.read_text()):
                self.assertNotIn("retired", html)
            self.assertEqual(
                re.findall(
                    r'data-value="([^"]+)"[^>]*data-umami-event="Thème"', settings.read_text()
                ),
                ["auto", "classic", "sample"],
            )
            self.assertEqual(
                re.findall(
                    r'data-value="([^"]+)"[^>]*data-umami-event="Couleur"', settings.read_text()
                ),
                ["yellow", "blue"],
            )
            self.assertIn('data-accents="yellow blue"', plain)
            stylesheet.write_text(".app-sidebar {}")
            with self.assertRaises(ValueError):
                render("2026-11-20")
            cover.unlink()
            with self.assertRaises(ValueError):
                render("2026-11-21")
            cover.touch()
            stylesheet.unlink()
            with self.assertRaises(ValueError):
                render("2026-11-21")

    def test_bulletin_import_is_offered_to_configured_classes_only(self):
        offered = set(self.config.site["grades"]["bulletin"]["classes"])
        self.assertTrue(offered)
        with tempfile.TemporaryDirectory() as directory:
            render_site(self.config, {}, output_dir=directory)
            for cls in self.classes:
                with self.subTest(class_id=cls.id):
                    html = (Path(directory) / "classes" / cls.id / "notes.html").read_text()
                    for marker in ('id="grades-bulletin-btn"', "bulletin-model.js"):
                        self.assertEqual(marker in html, cls.id in offered)
                    notice = str(escape(self.config.labels["grades"]["bulletin_notice"]))
                    self.assertEqual(notice in html, cls.id in offered)

    def test_module_progress_counts_sessions_and_keeps_upcoming_ones(self):
        cls = self.classes[0]
        events = sample_events(self.config, cls)
        codes = canonical_module_codes(self.config.curriculum)
        first, second = sorted(events, key=lambda event: event.start_dt)
        for now, upcoming in (
            (first.start_dt - timedelta(hours=1), [first, second]),
            (first.end_dt, [second]),
            (second.end_dt, []),
        ):
            with self.subTest(now=now):
                progress = prepare_module_progress(reversed(events), codes, now)
                self.assertEqual(progress, {"R501": {"total": 2, "upcoming": upcoming}})
        unknown = replace(first, module_code="Forum")
        self.assertEqual(prepare_module_progress([unknown], codes, first.start_dt), {})
        with tempfile.TemporaryDirectory() as directory:
            render_site(self.config, {cls.id: events}, output_dir=directory)
            html = (Path(directory) / "classes" / cls.id / "ressources.html").read_text()
        self.assertIn('href="https://chamilo.univ-grenoble-alpes.fr/courses/IUT1RT3R501"', html)
        self.assertNotIn("#view=year", html)

    def test_module_groups_open_on_what_is_in_progress(self):
        def group(group_id, *codes):
            return ({"id": group_id, "label": group_id}, [({}, [{"code": c} for c in codes])])

        groups = [group("s5", "R501", "R502"), group("s6", "R601"), group("extra", "GIT")]
        session = object()

        def opened(progress):
            return [g["id"] for g in prepare_module_groups(groups, progress) if g["open"]]

        started = {"total": 3, "upcoming": [session]}
        waiting = {"total": 2, "upcoming": [session, session]}
        over = {"total": 2, "upcoming": []}
        self.assertEqual(opened({"R501": started, "R601": waiting}), ["s5"])
        self.assertEqual(opened({"R501": waiting, "R601": waiting}), ["s5"])
        self.assertEqual(opened({"R501": over, "R601": waiting}), ["s6"])
        self.assertEqual(opened({"R501": started, "R601": started}), ["s5", "s6"])
        self.assertEqual(opened({"R501": over}), ["s5", "s6", "extra"])
        modules = prepare_module_groups(groups, {"R501": started})[0]["modules"]
        self.assertEqual([module["code"] for module in modules], ["R501", "R502"])

    def test_each_class_publishes_calendar_feeds(self):
        cls = self.classes[0]
        events = sample_events(self.config, cls)
        feeds = self.config.site["feeds"]
        with tempfile.TemporaryDirectory() as directory:
            render_site(self.config, {cls.id: events}, output_dir=directory)
            root = Path(directory) / "classes" / cls.id
            full = Calendar.from_ical((root / feeds["calendar_file"]).read_bytes())
            graded = Calendar.from_ical((root / feeds["evaluations_file"]).read_bytes())
        entries = full.walk("VEVENT")
        self.assertEqual(len(entries), len(events))
        self.assertEqual(len({str(entry["UID"]) for entry in entries}), len(events))
        self.assertIn(cls.label, str(full["X-WR-CALNAME"]))
        self.assertEqual(
            sorted(entry["DTSTART"].dt for entry in entries),
            sorted(event.start_dt for event in events),
        )
        evaluations = [event for event in events if event.category_id]
        self.assertTrue(evaluations)
        self.assertEqual(len(graded.walk("VEVENT")), len(evaluations))
        for entry in graded.walk("VEVENT"):
            self.assertIn(
                str(entry["SUMMARY"]).split(" · ")[0],
                {event.category_label for event in evaluations},
            )
            self.assertTrue(str(entry["UID"]).endswith("@" + feeds["uid_domain"]))

    def test_every_configured_accent_has_its_colours(self):
        stylesheet = Path("static/css/accents.css").read_text()
        declared = set(re.findall(r'\[data-accent="([^"]+)"\]', stylesheet))
        self.assertEqual(declared, {accent["id"] for accent in self.config.themes["accents"]})

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

    def test_pages_load_the_audience_script_only_when_it_is_configured(self):
        events = sample_events(self.config, self.classes[0])
        tag = re.compile(r'<script defer src="[^"]*static/js/audience\.js"[^>]*>')
        for configured in (True, False):
            config = copy.deepcopy(self.config)
            if not configured:
                del config.site["audience"]
            with self.subTest(configured=configured), tempfile.TemporaryDirectory() as directory:
                render_site(config, {self.classes[0].id: events}, output_dir=directory)
                for page in Path(directory).rglob("*.html"):
                    html = page.read_text()
                    if "static/js/utils.js" not in html:
                        continue
                    found = tag.search(html)
                    self.assertEqual(bool(found), configured, page.name)
                    if found:
                        audience = config.site["audience"]
                        self.assertIn(f'data-tracker="{audience["tracker"]}"', found.group())
                        self.assertIn(f'data-website-id="{audience["website_id"]}"', found.group())
                        self.assertIn(f'data-domain="{audience["domain"]}"', found.group())
                files = {section.id: section.file for section in config.sections}
                settings = list(Path(directory).rglob(files["settings"]))
                notices = list(Path(directory).rglob(files["notice"]))
                self.assertEqual(len(settings), len(self.classes) + 1)
                self.assertEqual(len(notices), len(settings))
                for page in settings:
                    html = page.read_text()
                    self.assertIn("data-color-scheme-choice", html)
                    self.assertEqual("data-audience-choice" in html, configured)
                for page in notices:
                    html = page.read_text()
                    self.assertNotIn("data-color-scheme-choice", html)
                    self.assertEqual(
                        str(escape(self.config.labels["notice"]["p6_audience"])) in html,
                        configured,
                    )
                    self.assertEqual(f'{files["settings"]}#audience"' in html, configured)

    def test_audience_only_talks_to_the_site_itself(self):
        policy = self.config.site["content_security_policy"]
        self.assertEqual(policy["connect-src"], ["'self'"])
        self.assertEqual(policy["script-src"], ["'self'"])
        self.assertTrue(self.config.site["audience"]["tracker"].startswith("/"))

    def test_audience_configuration_is_validated(self):
        valid = self.config.site["audience"]
        for change in (
            {"tracker": "https://example.org/script.js"},
            {"tracker": "mesure.js"},
            {"website_id": "not-an-identifier"},
            {"domain": "rtgre.fr/path"},
            {"domain": ""},
        ):
            site = copy.deepcopy(self.config.site)
            site["audience"] = {**valid, **change}
            with self.subTest(change=change), self.assertRaises(ValueError):
                validate_site_config(site)
        site = copy.deepcopy(self.config.site)
        site["audience"] = "rtgre.fr"
        with self.assertRaises(ValueError):
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

    def test_published_site_is_readable_by_another_user(self):
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory)
            shutil.copytree("static", project / "static")
            config = copy.deepcopy(self.config)
            config.site["output_directory"] = "site-output"
            publish_site(config, {}, None, project)
            self.assertEqual((project / "site-output").stat().st_mode & 0o777, 0o755)

    def test_output_root_publishes_the_site_outside_the_project(self):
        with tempfile.TemporaryDirectory() as directory, tempfile.TemporaryDirectory() as output:
            project = Path(directory)
            shutil.copytree("static", project / "static")
            config = copy.deepcopy(self.config)
            config.site["output_directory"] = "site-output"
            with patch.dict(os.environ, {"SCHEDULE_OUTPUT_ROOT": output}):
                publish_site(config, {}, None, project)
            self.assertTrue((Path(output) / "site-output" / "index.html").is_file())
            self.assertFalse((project / "site-output").exists())
            self.assertEqual(
                sorted(path.name for path in Path(output).iterdir()),
                [".site-output.lock", "site-output"],
            )
            for invalid in ("relative/path", str(project / "missing")):
                with (
                    self.subTest(root=invalid),
                    patch.dict(os.environ, {"SCHEDULE_OUTPUT_ROOT": invalid}),
                ):
                    with self.assertRaisesRegex(ValueError, "SCHEDULE_OUTPUT_ROOT"):
                        publish_site(config, {}, None, project)

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
