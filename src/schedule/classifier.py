import re
from typing import Optional
from .models import CategoryConfig
from .config import AppConfig

def classify_event(summary: str, description_lines: list[str], app_config: AppConfig) -> tuple[Optional[CategoryConfig], tuple[str, ...]]:
    clean_summary = summary.strip()
    matched_category = None

    for cat in app_config.categories:
        if not cat.enabled:
            continue

        exact_match = False
        for title in cat.exact_titles:
            if clean_summary == title.strip():
                exact_match = True
                break

        if exact_match:
            matched_category = cat
            break

        pattern_match = False
        for pat in cat.patterns:
            if re.search(pat, clean_summary, re.IGNORECASE):
                pattern_match = True
                break

        if pattern_match:
            matched_category = cat
            break

    if matched_category is None:
        policy = app_config.categories_raw.get("unmatched_policy", "exclude")
        if policy == "exclude":
            return None, ()

    flags = []
    for line in description_lines:
        line_clean = line.strip()
        for flg in app_config.description_flags:
            for pat in flg.patterns:
                if re.search(pat, line_clean, re.IGNORECASE):
                    if flg.id not in flags:
                        flags.append(flg.id)

    return matched_category, tuple(flags)
