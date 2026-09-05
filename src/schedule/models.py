import unicodedata
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Optional

def strip_accents(text: str) -> str:
    normalized = unicodedata.normalize('NFD', text)
    return ''.join(c for c in normalized if unicodedata.category(c) != 'Mn')

def slugify(text: str) -> str:
    cleaned = strip_accents(text).lower()
    slugged = re.sub(r'[^a-z0-9]+', '-', cleaned)
    return slugged.strip('-')

def make_occurrence_id(summary: str, date_iso: str) -> str:
    title_slug = slugify(summary)
    return f"{title_slug}--{date_iso}"

def title_case_name(name_str: str) -> str:
    parts = name_str.lower().split("-")
    return "-".join(p.capitalize() for p in parts)

def format_teacher_name(
    raw_name: str,
    display_mode: str,
    unknown_marker: str = "prof manquant",
    name_overrides: Optional[dict[str, str]] = None
) -> Optional[str]:
    if not raw_name:
        return None

    cleaned = raw_name.strip()
    if not cleaned:
        return None

    if cleaned.lower() == unknown_marker.lower():
        return None

    if display_mode == "hidden":
        return None

    if name_overrides and cleaned in name_overrides:
        return name_overrides[cleaned]

    if display_mode == "full":
        return cleaned.upper()

    words = cleaned.split()
    if display_mode == "initials":
        return " ".join(f"{w[0].upper()}." for w in words if w)

    if display_mode == "given_name_initial":
        if len(words) == 1:
            return title_case_name(words[0])

        first_name = title_case_name(words[-1])
        last_name_words = words[:-1]
        initial = last_name_words[0][0].upper() + "."
        return f"{first_name} {initial}"

    return cleaned

@dataclass(frozen=True)
class ClassConfig:
    id: str
    label: str
    ade_group_code: str
    resource_id: int
    track: str
    status: str

@dataclass(frozen=True)
class ProgramConfig:
    id: str
    label: str
    classes: tuple[ClassConfig, ...]

@dataclass(frozen=True)
class CategoryConfig:
    id: str
    label: str
    enabled: bool
    exact_titles: tuple[str, ...]
    patterns: tuple[str, ...]

@dataclass(frozen=True)
class DescriptionFlagConfig:
    id: str
    label: str
    patterns: tuple[str, ...]

@dataclass(frozen=True)
class SectionConfig:
    id: str
    label: str
    kind: str
    file: Optional[str] = None
    url: Optional[str] = None

@dataclass(frozen=True)
class Evaluation:
    occurrence_id: str
    class_id: str
    start_dt: datetime
    end_dt: datetime
    summary: str
    module_code: str
    category_id: str
    category_label: str
    rooms: tuple[str, ...]
    teachers: tuple[str, ...]
    staff_markers: tuple[str, ...]
    groups: tuple[str, ...]
    flags: tuple[str, ...]
    complementary_info: tuple[str, ...]
    date_iso: str
    date_formatted: str
    time_range: str
    month_key: str
    month_label: str
    search_index: str
    is_past: bool

@dataclass(frozen=True)
class ClassMatchState:
    class_config: ClassConfig
    status: str
    evaluation: Optional[Evaluation]
    alternate_date_iso: Optional[str]
    alternate_date_formatted: Optional[str]
