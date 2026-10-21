from datetime import datetime

from .config import AppConfig
from .models import Evaluation, slugify
from .parser import make_evaluation


def retime(moment: datetime, value: str) -> datetime:
    hour, minute = (int(part) for part in value.split(":"))
    return moment.replace(hour=hour, minute=minute, second=0, microsecond=0)


def apply_overrides(
    event: Evaluation,
    overrides: dict,
    app_config: AppConfig,
    category_labels: dict[str, str],
    now: datetime,
) -> Evaluation:
    category_id = overrides.get("category", event.category_id)
    start_dt = event.start_dt
    if "start" in overrides:
        start_dt = retime(start_dt, overrides["start"])
    end_dt = event.end_dt
    if "end" in overrides:
        end_dt = retime(end_dt, overrides["end"])
    return make_evaluation(
        app_config=app_config,
        class_id=event.class_id,
        summary=overrides.get("title", event.summary),
        start_dt=start_dt,
        end_dt=end_dt,
        rooms=tuple(overrides["rooms"]) if "rooms" in overrides else event.rooms,
        teachers=tuple(overrides["teachers"]) if "teachers" in overrides else event.teachers,
        staff_markers=event.staff_markers,
        groups=event.groups,
        flags=event.flags,
        complementary=event.complementary_info,
        category_id=category_id,
        category_label=category_labels.get(category_id, ""),
        source_uid=event.occurrence_id,
        now=now,
    )


def apply_corrections(
    events_by_class: dict[str, list[Evaluation]],
    corrections: tuple[dict, ...],
    app_config: AppConfig,
) -> dict[str, list[Evaluation]]:
    category_labels = {category.id: category.label for category in app_config.categories}
    now = datetime.now(app_config.timezone)
    corrected: dict[str, list[Evaluation]] = {}
    for class_id, events in events_by_class.items():
        rebuilt: list[Evaluation] = []
        for event in events:
            matches = [
                entry
                for entry in corrections
                if entry["slug"] == slugify(event.summary) and entry["date"] == event.date_iso
            ]
            if any("remove" in entry for entry in matches):
                continue
            current = event
            for entry in matches:
                if "set" in entry:
                    current = apply_overrides(
                        current, entry["set"], app_config, category_labels, now
                    )
            rebuilt.append(current)
            for entry in matches:
                if "add_copy" in entry:
                    rebuilt.append(
                        apply_overrides(event, entry["add_copy"], app_config, category_labels, now)
                    )
        corrected[class_id] = rebuilt
    return corrected
