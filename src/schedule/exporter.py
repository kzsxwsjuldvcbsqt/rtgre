from .config import AppConfig
from .models import Evaluation, slugify


def serialize_events(app_config: AppConfig, class_id: str, events: list[Evaluation]) -> dict:
    display_mode = app_config.site["teachers"]["display_mode"]
    unknown_marker = app_config.site["teachers"]["unknown_marker"].casefold()
    empty_value = app_config.labels["empty_value"]
    return {
        "class": class_id,
        "events": [
            {
                "occurrence_id": ev.occurrence_id,
                "start": ev.start_dt.isoformat(),
                "end": ev.end_dt.isoformat(),
                "title": ev.summary,
                "slug": slugify(ev.summary),
                "module": ev.module_code,
                "category": ev.category_id or None,
                "rooms": [r for r in ev.rooms if r != empty_value],
                "teachers": [
                    t for t in ev.teachers if t != empty_value and t.casefold() != unknown_marker
                ]
                if display_mode != "hidden"
                else [],
                "staff_markers": [m for m in ev.staff_markers if m != empty_value],
                "groups": list(ev.groups),
                "flags": list(ev.flags),
            }
            for ev in events
        ],
    }
