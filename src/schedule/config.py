import json
from pathlib import Path
from dataclasses import dataclass
from zoneinfo import ZoneInfo
from .models import ClassConfig, ProgramConfig, CategoryConfig, DescriptionFlagConfig, SectionConfig

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
    return f"{base_url}?resources={resource_id}&projectId={project_id}&calType={cal_type}&firstDate={first_date}&lastDate={last_date}"

def validate_site_config(site: dict):
    custom_domain = site.get("custom_domain")
    base_path = site.get("base_path", "/")
    if custom_domain and isinstance(custom_domain, str) and custom_domain.strip():
        if base_path != "/":
            raise ValueError(
                f"Invalid configuration: custom_domain '{custom_domain}' requires base_path to be '/', but got '{base_path}'"
            )

def load_config(config_dir: str = "config") -> AppConfig:
    path = Path(config_dir)
    with open(path / "site.json", "r", encoding="utf-8") as f:
        site = json.load(f)
    validate_site_config(site)
    with open(path / "classes.json", "r", encoding="utf-8") as f:
        classes_data = json.load(f)
    with open(path / "categories.json", "r", encoding="utf-8") as f:
        categories_data = json.load(f)
    with open(path / "labels.json", "r", encoding="utf-8") as f:
        labels = json.load(f)
    with open(path / "sections.json", "r", encoding="utf-8") as f:
        sections_data = json.load(f)
    with open(path / "curriculum.json", "r", encoding="utf-8") as f:
        curriculum_data = json.load(f)
    with open(path / "calendar.json", "r", encoding="utf-8") as f:
        calendar_data = json.load(f)

    programs = []
    for p in classes_data["programs"]:
        cls_list = [
            ClassConfig(
                id=c["id"],
                label=c["label"],
                ade_group_code=c["ade_group_code"],
                resource_id=c["resource_id"],
                track=c["track"],
                status=c["status"]
            )
            for c in p["classes"]
        ]
        programs.append(ProgramConfig(id=p["id"], label=p["label"], classes=tuple(cls_list)))

    categories = [
        CategoryConfig(
            id=c["id"],
            label=c["label"],
            enabled=c["enabled"],
            exact_titles=tuple(c.get("exact_titles", [])),
            patterns=tuple(c.get("patterns", []))
        )
        for c in categories_data["categories"]
    ]

    flags = [
        DescriptionFlagConfig(
            id=flg["id"],
            label=flg["label"],
            patterns=tuple(flg.get("patterns", []))
        )
        for flg in categories_data.get("description_flags", [])
    ]

    sections = [
        SectionConfig(
            id=s["id"],
            label=s["label"],
            kind=s["kind"],
            file=s.get("file"),
            url=s.get("url")
        )
        for s in sections_data.get("sections", [])
    ]

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
        labels=labels,
        timezone=tz
    )
