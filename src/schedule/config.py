import json
import math
import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path, PurePosixPath
from zoneinfo import ZoneInfo

from .curriculum import validate_curriculum_config
from .models import CategoryConfig, ClassConfig, DescriptionFlagConfig, ProgramConfig, SectionConfig


@dataclass
class AppConfig:
    site: dict
    programs: tuple[ProgramConfig, ...]
    categories_raw: dict
    categories: tuple[CategoryConfig, ...]
    description_flags: tuple[DescriptionFlagConfig, ...]
    sections: tuple[SectionConfig, ...]
    curriculum: dict
    calendar_config: dict
    absence_config: dict
    tasks_config: dict
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


def valid_public_id(value: object) -> bool:
    return isinstance(value, str) and re.fullmatch(r"[a-z0-9][a-z0-9_-]*", value) is not None


def valid_relative_file(value: object) -> bool:
    if not isinstance(value, str):
        return False
    path = PurePosixPath(value)
    return not path.is_absolute() and ".." not in path.parts and path.name not in ("", ".")


def validate_calendar_config(calendar: dict):
    if calendar["default_view"] not in ("day", "week", "year"):
        raise ValueError("Invalid default calendar view")
    days = calendar["days_of_week"]
    if (
        not days
        or any(type(day) is not int or not 1 <= day <= 7 for day in days)
        or days != sorted(set(days))
    ):
        raise ValueError("Calendar days must be distinct ISO weekdays in ascending order")
    if not set(calendar["comparison_options"]) <= {"same_only", "show_compared"}:
        raise ValueError("Invalid calendar comparison options")
    if (
        type(calendar["search_delay_ms"]) is not int
        or calendar["search_delay_ms"] < 0
        or type(calendar["time_marker_interval_ms"]) is not int
        or calendar["time_marker_interval_ms"] <= 0
        or type(calendar["max_comparison_events"]) is not int
        or calendar["max_comparison_events"] <= 0
    ):
        raise ValueError("Invalid calendar timers")


def validate_absence_config(
    config: dict, curriculum: dict | None = None, class_ids: set[str] | None = None
):
    from datetime import time

    boundary = time.fromisoformat(config["afternoon_start"])
    if boundary == time.min or len(config["afternoon_start"]) != 5:
        raise ValueError("Invalid absence afternoon boundary")
    if config["default_mode"] not in ("day", "half_day", "course", "range") or config[
        "default_period"
    ] not in ("morning", "afternoon"):
        raise ValueError("Invalid default absence selection")
    for key in (
        "max_import_bytes",
        "max_records",
        "max_courses_per_record",
        "max_id_length",
        "max_text_length",
        "max_name_length",
        "max_total_text_length",
        "export_format_version",
    ):
        if type(config[key]) is not int or config[key] <= 0:
            raise ValueError(f"Invalid absence setting: {key}")
    if not isinstance(config["legacy_export_format_versions"], list) or any(
        type(version) is not int or version <= 0 or version >= config["export_format_version"]
        for version in config["legacy_export_format_versions"]
    ):
        raise ValueError("Invalid legacy absence formats")
    sheet = config["sheet"]
    sheet_keys = {
        "program_label",
        "signature_place",
        "logo_path",
        "pdf_filename",
        "blob_revoke_delay_ms",
        "pdf_assets",
        "pdf_layout",
    }
    if not isinstance(sheet, dict) or set(sheet) != sheet_keys:
        raise ValueError("Invalid absence sheet configuration")
    if not all(
        isinstance(sheet[key], str) and sheet[key].strip()
        for key in (
            "program_label",
            "signature_place",
            "pdf_filename",
        )
    ):
        raise ValueError("Invalid absence sheet text")
    assets = sheet["pdf_assets"]
    asset_paths = [sheet["logo_path"]] + list(assets.values()) if isinstance(assets, dict) else []
    if (
        not isinstance(assets, dict)
        or set(assets) != {"library", "fontkit", "font_regular", "font_bold"}
        or any(
            not valid_relative_file(path) or PurePosixPath(path).parts[0] != "static"
            for path in asset_paths
        )
    ):
        raise ValueError("Invalid absence PDF assets")
    layout_keys = {
        "page_width",
        "page_height",
        "margin",
        "body_font_size",
        "body_line_height",
        "title_font_size",
        "notice_font_size",
        "notice_line_height",
        "section_heading_font_size",
        "annex_heading_font_size",
        "header_height",
        "logo_max_width",
        "logo_max_height",
        "header_gap",
        "section_gap",
        "paragraph_gap",
        "notice_padding",
        "cell_padding",
        "label_column_width",
        "rule_width",
        "bullet_indent",
        "signature_height",
        "footer_gap",
        "annex_section_gap",
    }
    layout = sheet["pdf_layout"]
    if (
        not isinstance(layout, dict)
        or set(layout) != layout_keys
        or any(
            type(value) not in (int, float) or not math.isfinite(value) or value <= 0
            for value in layout.values()
        )
    ):
        raise ValueError("Invalid absence PDF layout")
    if (
        layout["margin"] * 2 >= min(layout["page_width"], layout["page_height"])
        or layout["label_column_width"] >= layout["page_width"] - layout["margin"] * 2
        or layout["body_line_height"] <= layout["body_font_size"]
        or layout["notice_line_height"] <= layout["notice_font_size"]
    ):
        raise ValueError("Invalid absence PDF dimensions")
    if type(sheet["blob_revoke_delay_ms"]) is not int or sheet["blob_revoke_delay_ms"] <= 0:
        raise ValueError("Invalid absence PDF URL lifetime")


def validate_tasks_config(config: dict):
    expected = {
        "storage_key_prefix",
        "export_format",
        "export_format_version",
        "export_filename",
        "max_import_bytes",
        "max_items",
        "max_text_length",
        "max_total_text_length",
    }
    if not isinstance(config, dict) or set(config) != expected:
        raise ValueError("Invalid tasks configuration")
    if not all(
        isinstance(config[key], str) and config[key].strip()
        for key in ("storage_key_prefix", "export_format", "export_filename")
    ):
        raise ValueError("Invalid tasks text configuration")
    if any(
        type(config[key]) is not int or config[key] <= 0
        for key in (
            "export_format_version",
            "max_import_bytes",
            "max_items",
            "max_text_length",
            "max_total_text_length",
        )
    ):
        raise ValueError("Invalid tasks limits")
    if config["max_text_length"] > config["max_total_text_length"]:
        raise ValueError("Invalid tasks text limits")


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

    with open(path / "absences.json", encoding="utf-8") as f:
        absence_data = json.load(f)
    with open(path / "tasks.json", encoding="utf-8") as f:
        tasks_data = json.load(f)
    validate_curriculum_config(curriculum_data)
    validate_calendar_config(calendar_data)
    class_ids = {cls["id"] for program in classes_data["programs"] for cls in program["classes"]}
    validate_absence_config(absence_data, curriculum_data, class_ids)
    validate_tasks_config(tasks_data)
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
    if type(grades["decimals"]) is not int or not 0 <= grades["decimals"] <= 100:
        raise ValueError("Invalid grade precision")
    if any(
        type(grades[key]) is not int or grades[key] <= 0
        for key in ("max_import_bytes", "max_entries", "export_format_version")
    ):
        raise ValueError("Invalid grade limits")
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
        )
        for c in categories_data["categories"]
    ]
    if len({category.id for category in categories}) != len(categories) or any(
        not valid_public_id(category.id) for category in categories
    ):
        raise ValueError("Invalid or duplicate category IDs")

    flags = [
        DescriptionFlagConfig(
            id=flg["id"], label=flg["label"], patterns=tuple(flg.get("patterns", []))
        )
        for flg in categories_data.get("description_flags", [])
    ]

    sections = [
        SectionConfig(
            id=s["id"],
            label=s["label"],
            kind=s["kind"],
            file=s.get("file"),
            url=s.get("url"),
            statuses=tuple(s.get("statuses", [])),
        )
        for s in sections_data.get("sections", [])
    ]
    if len({section.id for section in sections}) != len(sections) or any(
        not valid_public_id(section.id) for section in sections
    ):
        raise ValueError("Invalid or duplicate section IDs")
    if any(set(section.statuses) - statuses for section in sections):
        raise ValueError("Unknown section status")
    section_files = [section.file for section in sections if section.file]
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
        sections=tuple(sections),
        curriculum=curriculum_data,
        calendar_config=calendar_data,
        absence_config=absence_data,
        tasks_config=tasks_data,
        labels=labels,
        timezone=tz,
    )
