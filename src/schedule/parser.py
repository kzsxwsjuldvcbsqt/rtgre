import datetime
import re
import unicodedata

from icalendar import Calendar

from .classifier import classify_event, match_session_marks
from .config import AppConfig
from .models import ClassConfig, Evaluation, format_teacher_name, make_occurrence_id


def normalize_room_name(raw_room: str, rooms_config: dict) -> str:
    cleaned = raw_room.strip()
    if not cleaned:
        return raw_room

    strip_prefixes = rooms_config.get("strip_prefixes", [])
    result = cleaned
    for prefix in strip_prefixes:
        if result.startswith(prefix):
            result = result[len(prefix) :].strip()
            break

    if rooms_config.get("drop_lowercase_suffix", False):
        parts = result.rsplit(" ", 1)
        if len(parts) == 2 and parts[1].islower():
            result = parts[0].strip()

    if not result:
        return cleaned
    return result


def make_evaluation(
    app_config: AppConfig,
    class_id: str,
    summary: str,
    start_dt: datetime.datetime,
    end_dt: datetime.datetime,
    rooms: tuple[str, ...],
    teachers: tuple[str, ...],
    staff_markers: tuple[str, ...],
    groups: tuple[str, ...],
    flags: tuple[str, ...],
    complementary: tuple[str, ...],
    category_id: str,
    category_label: str,
    source_uid: str,
    now: datetime.datetime,
) -> Evaluation:
    formats = app_config.site["formats"]
    months_labels = app_config.labels.get("months", [])

    month_index = start_dt.month - 1
    month_name = (
        months_labels[month_index] if 0 <= month_index < len(months_labels) else str(start_dt.month)
    )

    if "-" in summary:
        module_code = summary.split("-")[0].strip()
    else:
        module_code = summary.split()[0].strip() if summary else ""

    search_raw = " ".join([summary, module_code, *rooms, *teachers, *staff_markers, *groups])
    normalized_search = "".join(
        c for c in unicodedata.normalize("NFD", search_raw) if unicodedata.category(c) != "Mn"
    ).lower()

    return Evaluation(
        occurrence_id=make_occurrence_id(summary, start_dt, end_dt, source_uid, class_id),
        class_id=class_id,
        start_dt=start_dt,
        end_dt=end_dt,
        summary=summary,
        module_code=module_code,
        category_id=category_id,
        category_label=category_label,
        rooms=tuple(rooms),
        teachers=tuple(teachers),
        staff_markers=tuple(staff_markers),
        groups=tuple(groups),
        flags=tuple(flags),
        complementary_info=tuple(complementary),
        date_iso=start_dt.strftime("%Y-%m-%d"),
        date_formatted=start_dt.strftime(formats["date_absolute"]),
        time_range=formats["time_range"].format(
            start=start_dt.strftime(formats["time"]), end=end_dt.strftime(formats["time"])
        ),
        month_key=start_dt.strftime("%Y-%m"),
        month_label=formats["month_title"].format(
            month_name=month_name.capitalize(), year=start_dt.year
        ),
        search_index=normalized_search,
        is_past=end_dt < now,
    )


def parse_calendar(
    raw_bytes: bytes, class_config: ClassConfig, app_config: AppConfig
) -> list[Evaluation]:
    cal = Calendar.from_ical(raw_bytes)
    tz = app_config.timezone
    labels = app_config.labels
    display_mode = app_config.site["teachers"]["display_mode"]
    unknown_marker = app_config.site["teachers"]["unknown_marker"]
    name_overrides = app_config.site["teachers"].get("name_overrides", {})
    rooms_config = app_config.site.get("rooms", {})
    non_name_patterns = app_config.categories_raw.get("non_name_lines", [])

    parser_config = app_config.site["parser"]
    now = datetime.datetime.now(tz)
    events = []
    seen_occurrences = set()

    for component in cal.walk("VEVENT"):
        summary = str(component.get("SUMMARY", "") or "").strip()
        if not summary:
            continue

        dtstart = component.get("DTSTART")
        if not dtstart:
            continue

        start_val = dtstart.dt
        if isinstance(start_val, datetime.datetime):
            if start_val.tzinfo is None:
                start_dt = start_val.replace(tzinfo=tz)
            else:
                start_dt = start_val.astimezone(tz)
        elif isinstance(start_val, datetime.date):
            start_dt = datetime.datetime.combine(start_val, datetime.time.min, tzinfo=tz)
        else:
            continue

        dtend = component.get("DTEND")
        if dtend:
            end_val = dtend.dt
            if isinstance(end_val, datetime.datetime):
                if end_val.tzinfo is None:
                    end_dt = end_val.replace(tzinfo=tz)
                else:
                    end_dt = end_val.astimezone(tz)
            elif isinstance(end_val, datetime.date):
                end_dt = datetime.datetime.combine(end_val, datetime.time.min, tzinfo=tz)
            else:
                end_dt = start_dt
        else:
            duration = component.get("DURATION")
            if duration:
                end_dt = start_dt + duration.dt
            else:
                end_dt = start_dt

        if end_dt <= start_dt:
            continue

        location_raw = str(component.get("LOCATION", "") or "")
        location_raw = location_raw.replace(r"\,", ",")
        raw_room_parts = [r.strip() for r in location_raw.split(",") if r.strip()]

        unique_rooms = []
        for r in raw_room_parts:
            norm_r = normalize_room_name(r, rooms_config)
            if norm_r and norm_r.lower() not in [x.lower() for x in unique_rooms]:
                unique_rooms.append(norm_r)

        if not unique_rooms:
            unique_rooms = [labels["empty_value"]]

        description_raw = str(component.get("DESCRIPTION", "") or "")
        description_raw = (
            description_raw.replace(r"\n", "\n").replace(r"\,", ",").replace(r"\;", ";")
        )
        lines = [line.strip() for line in description_raw.splitlines() if line.strip()]

        groups = []
        teachers = []
        staff_markers = []
        complementary = []

        for line in lines:
            if any(
                line.startswith(prefix) for prefix in parser_config["ignored_description_prefixes"]
            ):
                continue

            cleaned_line = line.strip("_").strip()
            if not cleaned_line:
                continue

            is_non_name = False
            for pat in non_name_patterns:
                if re.search(pat, cleaned_line, re.IGNORECASE):
                    is_non_name = True
                    break

            if is_non_name:
                if cleaned_line not in staff_markers:
                    staff_markers.append(cleaned_line)
                continue

            if re.match(parser_config["group_pattern"], cleaned_line):
                if cleaned_line.lower() not in [g.lower() for g in groups]:
                    groups.append(cleaned_line)
                continue

            if re.match(parser_config["module_line_pattern"], cleaned_line, re.IGNORECASE):
                continue

            if (
                display_mode != "hidden"
                and re.match(parser_config["teacher_pattern"], cleaned_line)
                and not any(c.isdigit() for c in cleaned_line)
            ):
                formatted_teacher = format_teacher_name(
                    cleaned_line, display_mode, unknown_marker, name_overrides
                )
                if formatted_teacher and formatted_teacher.lower() not in [
                    t.lower() for t in teachers
                ]:
                    teachers.append(formatted_teacher)
                    continue

            if cleaned_line not in complementary:
                complementary.append(cleaned_line)

        cat_config, flags = classify_event(summary, lines, app_config)
        cat_id = cat_config.id if cat_config else ""
        cat_label = cat_config.label if cat_config else ""

        ev = make_evaluation(
            app_config=app_config,
            class_id=class_config.id,
            summary=summary,
            start_dt=start_dt,
            end_dt=end_dt,
            rooms=tuple(unique_rooms),
            teachers=tuple(teachers),
            staff_markers=tuple(staff_markers),
            groups=tuple(groups),
            flags=flags + match_session_marks(summary, tuple(unique_rooms), app_config),
            complementary=tuple(complementary),
            category_id=cat_id,
            category_label=cat_label,
            source_uid=str(component.get("UID", "")),
            now=now,
        )
        if ev.occurrence_id in seen_occurrences:
            continue
        seen_occurrences.add(ev.occurrence_id)
        events.append(ev)

    events.sort(key=lambda x: x.start_dt)
    return events
