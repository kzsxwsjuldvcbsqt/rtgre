import json
from pathlib import Path
from .models import Evaluation, slugify
from .config import AppConfig

def export_data_files(
    app_config: AppConfig,
    events_by_class: dict[str, list[Evaluation]],
    output_dir: str = "dist"
):
    out_path = Path(output_dir) / "data"
    out_path.mkdir(parents=True, exist_ok=True)

    display_mode = app_config.site.get("teachers", {}).get("display_mode", "full")
    unknown_marker = app_config.site.get("teachers", {}).get("unknown_marker", "")
    empty_val = app_config.labels.get("empty_value", "")

    for cls_id, ev_list in events_by_class.items():
        exported_events = []
        for ev in ev_list:
            if display_mode == "hidden":
                clean_teachers = []
            else:
                clean_teachers = [
                    t for t in ev.teachers
                    if t != empty_val and t.lower() != unknown_marker.lower()
                ]

            clean_markers = [m for m in ev.staff_markers if m != empty_val]
            clean_rooms = [r for r in ev.rooms if r != empty_val]

            event_dict = {
                "start": ev.start_dt.isoformat(),
                "end": ev.end_dt.isoformat(),
                "title": ev.summary,
                "slug": slugify(ev.summary),
                "module": ev.module_code,
                "category": ev.category_id if ev.category_id else None,
                "rooms": clean_rooms,
                "teachers": clean_teachers,
                "staff_markers": clean_markers,
                "groups": list(ev.groups),
                "flags": list(ev.flags)
            }
            exported_events.append(event_dict)

        data_payload = {
          "class": cls_id,
          "events": exported_events
        }

        file_path = out_path / f"{cls_id}.json"
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(data_payload, f, ensure_ascii=False, indent=2)
