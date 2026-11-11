import json
import math
import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path, PurePosixPath
from zoneinfo import ZoneInfo

from .curriculum import validate_curriculum_config
from .models import (
    CategoryConfig,
    ClassConfig,
    DescriptionFlagConfig,
    ProgramConfig,
    SectionConfig,
    SessionMarkConfig,
    SessionMarkRule,
)


@dataclass
class AppConfig:
    site: dict
    programs: tuple[ProgramConfig, ...]
    categories_raw: dict
    categories: tuple[CategoryConfig, ...]
    description_flags: tuple[DescriptionFlagConfig, ...]
    session_marks: tuple[SessionMarkConfig, ...]
    sections: tuple[SectionConfig, ...]
    curriculum: dict
    calendar_config: dict
    corrections: tuple[dict, ...]
    labels: dict
    timezone: ZoneInfo


def build_ade_url(site_config: dict, resource_id: int) -> str:
    ade = site_config["ade"]
    school_year = site_config["school_year"]
    base_url = ade["base_url"]
    project_id = ade["project_id"]
    cal_type = ade["calendar_type"]
    first_date = school_year["first_date"]
    last_date = school_year["last_date"]
    return (
        f"{base_url}?resources={resource_id}&projectId={project_id}&calType={cal_type}"
        f"&firstDate={first_date}&lastDate={last_date}"
    )


def validate_site_config(site: dict):
    custom_domain = site.get("custom_domain")
    base_path = site.get("base_path", "/")
    if custom_domain and isinstance(custom_domain, str) and custom_domain.strip():
        if base_path != "/":
            raise ValueError(
                f"Invalid configuration: custom_domain '{custom_domain}' requires "
                f"base_path to be '/', but got '{base_path}'"
            )
    for key in ("output_directory", "static_directory"):
        path = PurePosixPath(site[key])
        if path.is_absolute() or len(path.parts) != 1 or path.name in ("", ".", ".."):
            raise ValueError(f"Invalid configured directory: {key}")
    policy = site.get("content_security_policy")
    if (
        not isinstance(policy, dict)
        or not policy
        or not all(
            re.fullmatch(r"[a-z-]+", directive)
            and isinstance(sources, list)
            and sources
            and all(isinstance(s, str) and s and not re.search(r"[\s;,]", s) for s in sources)
            for directive, sources in policy.items()
        )
    ):
        raise ValueError("Invalid configuration: content_security_policy")


def valid_public_id(value: object) -> bool:
    return isinstance(value, str) and re.fullmatch(r"[a-z0-9][a-z0-9_-]*", value) is not None


def validate_bulletin_config(bulletin):
    text_keys = (
        "producer_marker",
        "title_marker",
        "formation_marker",
        "program_marker",
        "ue_section",
        "note_header",
        "footer_marker",
        "missing_grade",
        "module_pattern",
    )
    if (
        not isinstance(bulletin, dict)
        or any(
            not isinstance(bulletin.get(key), str) or not bulletin[key].strip() for key in text_keys
        )
        or any(
            not isinstance(bulletin.get(key), list)
            or not all(isinstance(item, str) and item.strip() for item in bulletin[key])
            for key in ("evaluation_sections", "ignored_texts")
        )
        or not bulletin["evaluation_sections"]
        or any(
            type(bulletin.get(key)) is not int or bulletin[key] <= 0
            for key in ("max_bytes", "max_pages")
        )
        or any(
            type(bulletin.get(key)) not in (int, float)
            or not math.isfinite(bulletin[key])
            or bulletin[key] < 0
            for key in ("row_tolerance", "column_tolerance", "wrap_gap")
        )
    ):
        raise ValueError("Invalid bulletin configuration")
    try:
        re.compile(bulletin["module_pattern"])
    except re.error as error:
        raise ValueError("Invalid bulletin module pattern") from error


def validate_evaluation_details(curriculum_data: dict):
    details = curriculum_data.get("evaluation_details", {})
    coefficients = curriculum_data["coefficients"]
    if not isinstance(details, dict) or not details.keys() <= coefficients.keys():
        raise ValueError("Unknown evaluation detail track")
    for track, by_status in details.items():
        if not isinstance(by_status, dict) or not by_status.keys() <= coefficients[track].keys():
            raise ValueError(f"Unknown evaluation detail status for {track}")
        for status, by_module in by_status.items():
            if not isinstance(by_module, dict):
                raise ValueError(f"Invalid evaluation details for {track}/{status}")
            for code, evaluations in by_module.items():
                if code not in coefficients[track][status]:
                    raise ValueError(f"Evaluation details for ungraded {code} in {track}/{status}")
                if not isinstance(evaluations, list) or not evaluations:
                    raise ValueError(f"No evaluations for {code} in {track}/{status}")
                ids = [item.get("id") if isinstance(item, dict) else None for item in evaluations]
                if len(set(ids)) != len(ids) or not all(valid_public_id(i) for i in ids):
                    raise ValueError(f"Invalid evaluation ids for {code} in {track}/{status}")
                for item in evaluations:
                    weight = item.get("weight")
                    label = item.get("label")
                    if (
                        not isinstance(label, str)
                        or not label.strip()
                        or type(weight) not in (int, float)
                        or not math.isfinite(weight)
                        or weight <= 0
                    ):
                        raise ValueError(f"Invalid evaluation {item['id']} for {code}")


def valid_relative_file(value: object) -> bool:
    if not isinstance(value, str):
        return False
    path = PurePosixPath(value)
    return not path.is_absolute() and ".." not in path.parts and path.name not in ("", ".")


def validate_session_marks(session_marks, reserved_ids: set[str]):
    ids = [mark.id for mark in session_marks]
    if len(set(ids)) != len(ids) or any(
        not valid_public_id(mark_id) or mark_id in reserved_ids for mark_id in ids
    ):
        raise ValueError("Invalid or duplicate session mark IDs")
    for mark in session_marks:
        if not mark.label or not mark.rules:
            raise ValueError(f"Invalid session mark: {mark.id}")
        for rule in mark.rules:
            try:
                re.compile(rule.title)
            except re.error as error:
                raise ValueError(f"Invalid session mark pattern: {rule.title}") from error
            if any(not isinstance(room, str) or not room for room in rule.rooms):
                raise ValueError(f"Invalid session mark rooms: {mark.id}")


def validate_calendar_config(calendar: dict):
    if calendar["default_view"] not in ("day", "week", "year"):
        raise ValueError("Invalid default calendar view")
    if calendar["phone_default_view"] not in ("day", "week", "year"):
        raise ValueError("Invalid phone calendar view")
    if calendar["default_layout"] not in ("grid", "list"):
        raise ValueError("Invalid default calendar layout")
    for key in ("phone_media_query", "mobile_media_query"):
        if not isinstance(calendar[key], str) or not calendar[key].strip():
            raise ValueError(f"Invalid calendar media query: {key}")
    days = calendar["days_of_week"]
    if (
        not days
        or any(type(day) is not int or not 1 <= day <= 7 for day in days)
        or days != sorted(set(days))
    ):
        raise ValueError("Calendar days must be distinct ISO weekdays in ascending order")
    if (
        type(calendar["search_delay_ms"]) is not int
        or calendar["search_delay_ms"] < 0
        or type(calendar["time_marker_interval_ms"]) is not int
        or calendar["time_marker_interval_ms"] <= 0
    ):
        raise ValueError("Invalid calendar timers")
    from datetime import time

    for entry in calendar.get("breaks", []):
        if not isinstance(entry, dict) or set(entry) != {"boundary", "before", "after"}:
            raise ValueError("Invalid calendar break definition")
        for value in entry.values():
            if not isinstance(value, str) or len(value) != 5:
                raise ValueError("Invalid calendar break time")
            time.fromisoformat(value)


def validate_correction_overrides(overrides: object, category_ids: set[str]):
    from datetime import time

    allowed = {"category", "rooms", "teachers", "title", "start", "end"}
    if not isinstance(overrides, dict) or not overrides or set(overrides) - allowed:
        raise ValueError("Invalid correction overrides")
    if "category" in overrides and overrides["category"] not in category_ids:
        raise ValueError("Unknown correction category")
    if "title" in overrides and (
        not isinstance(overrides["title"], str) or not overrides["title"].strip()
    ):
        raise ValueError("Invalid correction title")
    for key in ("rooms", "teachers"):
        if key in overrides and (
            not isinstance(overrides[key], list)
            or any(not isinstance(value, str) or not value.strip() for value in overrides[key])
        ):
            raise ValueError(f"Invalid correction {key}")
    for key in ("start", "end"):
        if key in overrides:
            value = overrides[key]
            if not isinstance(value, str) or len(value) != 5:
                raise ValueError(f"Invalid correction {key}")
            time.fromisoformat(value)


def validate_corrections_config(corrections: dict, category_ids: set[str]):
    if not isinstance(corrections, dict) or set(corrections) != {"events"}:
        raise ValueError("Invalid corrections configuration")
    entries = corrections["events"]
    if not isinstance(entries, list):
        raise ValueError("Invalid corrections entries")
    operations = {"remove", "set", "add_copy"}
    for entry in entries:
        if not isinstance(entry, dict) or set(entry) - ({"slug", "date"} | operations):
            raise ValueError("Invalid correction entry")
        if not isinstance(entry.get("slug"), str) or not entry["slug"].strip():
            raise ValueError("Invalid correction slug")
        try:
            date.fromisoformat(entry.get("date", ""))
        except (TypeError, ValueError):
            raise ValueError("Invalid correction date") from None
        if len(operations & set(entry)) != 1:
            raise ValueError("A correction must define exactly one operation")
        if "remove" in entry and entry["remove"] is not True:
            raise ValueError("Invalid correction remove flag")
        for key in ("set", "add_copy"):
            if key in entry:
                validate_correction_overrides(entry[key], category_ids)


def load_config(config_dir: str = "config") -> AppConfig:
    path = Path(config_dir)
    with open(path / "site.json", encoding="utf-8") as f:
        site = json.load(f)
    validate_site_config(site)
    with open(path / "classes.json", encoding="utf-8") as f:
        classes_data = json.load(f)
    with open(path / "categories.json", encoding="utf-8") as f:
        categories_data = json.load(f)
    with open(path / "labels.json", encoding="utf-8") as f:
        labels = json.load(f)
    with open(path / "sections.json", encoding="utf-8") as f:
        sections_data = json.load(f)
    with open(path / "curriculum.json", encoding="utf-8") as f:
        curriculum_data = json.load(f)
    with open(path / "calendar.json", encoding="utf-8") as f:
        calendar_data = json.load(f)

    with open(path / "corrections.json", encoding="utf-8") as f:
        corrections_data = json.load(f)
    validate_curriculum_config(curriculum_data)
    validate_evaluation_details(curriculum_data)
    validate_calendar_config(calendar_data)
    first_date = date.fromisoformat(site["school_year"]["first_date"])
    last_date = date.fromisoformat(site["school_year"]["last_date"])
    if first_date > last_date:
        raise ValueError("Invalid school year date range")
    grades = site["grades"]
    if (
        any(
            type(grades[key]) not in (int, float) or not math.isfinite(grades[key])
            for key in ("minimum", "maximum")
        )
        or grades["minimum"] >= grades["maximum"]
    ):
        raise ValueError("Invalid grade bounds")
    if (
        type(grades["pass_mark"]) not in (int, float)
        or not math.isfinite(grades["pass_mark"])
        or not grades["minimum"] <= grades["pass_mark"] <= grades["maximum"]
    ):
        raise ValueError("Invalid grade pass mark")
    if type(grades["decimals"]) is not int or not 0 <= grades["decimals"] <= 100:
        raise ValueError("Invalid grade precision")
    if any(
        type(grades[key]) is not int or grades[key] <= 0
        for key in (
            "max_import_bytes",
            "max_entries",
            "export_format_version",
            "message_duration_ms",
        )
    ):
        raise ValueError("Invalid grade limits")
    validate_bulletin_config(grades["bulletin"])
    if (
        site["ade"]["retry_attempts"] < 1
        or site["ade"]["request_timeout_seconds"] <= 0
        or site["ade"]["retry_delay_seconds"] < 0
    ):
        raise ValueError("Invalid ADE retry configuration")
    if site["teachers"]["display_mode"] not in ("full", "initials", "given_name_initial", "hidden"):
        raise ValueError("Invalid teacher display mode")
    if len(labels["days"]) != 7 or len(labels["months"]) != 12:
        raise ValueError("Invalid calendar labels")

    programs = []
    for p in classes_data["programs"]:
        if not valid_public_id(p["id"]):
            raise ValueError("Invalid program ID")
        cls_list = [
            ClassConfig(
                id=c["id"],
                label=c["label"],
                ade_group_code=c["ade_group_code"],
                resource_id=c["resource_id"],
                track=c["track"],
                status=c["status"],
            )
            for c in p["classes"]
        ]
        programs.append(ProgramConfig(id=p["id"], label=p["label"], classes=tuple(cls_list)))

    all_classes = [cls for program in programs for cls in program.classes]
    if len({cls.id for cls in all_classes}) != len(all_classes):
        raise ValueError("Duplicate class IDs")
    if any(not valid_public_id(cls.id) for cls in all_classes):
        raise ValueError("Invalid class ID")
    if len({cls.resource_id for cls in all_classes}) != len(all_classes):
        raise ValueError("Duplicate class resource IDs")
    tracks = {track["id"] for track in curriculum_data["tracks"]}
    statuses = {status["id"] for status in curriculum_data["statuses"]}
    if any(cls.track not in tracks or cls.status not in statuses for cls in all_classes):
        raise ValueError("Invalid class track or status")

    categories = [
        CategoryConfig(
            id=c["id"],
            label=c["label"],
            enabled=c["enabled"],
            exact_titles=tuple(c.get("exact_titles", [])),
            patterns=tuple(c.get("patterns", [])),
            tone=c.get("tone"),
        )
        for c in categories_data["categories"]
    ]
    if len({category.id for category in categories}) != len(categories) or any(
        not valid_public_id(category.id) for category in categories
    ):
        raise ValueError("Invalid or duplicate category IDs")
    if any(
        category.tone is not None and not valid_public_id(category.tone) for category in categories
    ):
        raise ValueError("Invalid category tone")

    validate_corrections_config(corrections_data, {category.id for category in categories})

    flags = [
        DescriptionFlagConfig(
            id=flg["id"], label=flg["label"], patterns=tuple(flg.get("patterns", []))
        )
        for flg in categories_data.get("description_flags", [])
    ]

    session_marks = [
        SessionMarkConfig(
            id=mark["id"],
            label=mark["label"],
            rules=tuple(
                SessionMarkRule(title=rule["title"], rooms=tuple(rule["rooms"]))
                for rule in mark["rules"]
            ),
        )
        for mark in categories_data.get("session_marks", [])
    ]
    validate_session_marks(session_marks, {flg.id for flg in flags})

    sections = [
        SectionConfig(
            id=s["id"],
            label=s["label"],
            kind=s["kind"],
            file=s.get("file"),
            url=s.get("url"),
            icon=s.get("icon"),
            short_label=s.get("short_label"),
            statuses=tuple(s.get("statuses", [])),
            previous_files=tuple(s.get("previous_files", [])),
        )
        for s in sections_data.get("sections", [])
    ]
    if len({section.id for section in sections}) != len(sections) or any(
        not valid_public_id(section.id) for section in sections
    ):
        raise ValueError("Invalid or duplicate section IDs")
    if any(set(section.statuses) - statuses for section in sections):
        raise ValueError("Unknown section status")
    if any(
        section.kind != "external" and not valid_public_id(section.icon) for section in sections
    ):
        raise ValueError("Missing section icon")
    if any(
        section.short_label is not None
        and (not isinstance(section.short_label, str) or not section.short_label.strip())
        for section in sections
    ):
        raise ValueError("Invalid section short label")
    if any(section.previous_files and section.kind != "internal" for section in sections):
        raise ValueError("Previous files require an internal section")
    section_files = [
        filename
        for section in sections
        for filename in ((section.file,) if section.file else ()) + section.previous_files
    ]
    if len(set(section_files)) != len(section_files) or any(
        not valid_relative_file(filename) for filename in section_files
    ):
        raise ValueError("Invalid or duplicate section files")

    tz = ZoneInfo(site["timezone"])

    return AppConfig(
        site=site,
        programs=tuple(programs),
        categories_raw=categories_data,
        categories=tuple(categories),
        description_flags=tuple(flags),
        session_marks=tuple(session_marks),
        sections=tuple(sections),
        curriculum=curriculum_data,
        calendar_config=calendar_data,
        corrections=tuple(corrections_data["events"]),
        labels=labels,
        timezone=tz,
    )
