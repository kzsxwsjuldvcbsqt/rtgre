from datetime import datetime, timedelta


def prepare_initial_week(app_config, events):
    first_date = datetime.fromisoformat(app_config.site["school_year"]["first_date"]).date()
    last_date = datetime.fromisoformat(app_config.site["school_year"]["last_date"]).date()
    today = datetime.now(app_config.timezone).date()
    initial_date = min(max(today, first_date), last_date)
    week_start = initial_date - timedelta(days=initial_date.weekday())
    formats = app_config.site["formats"]
    result = []
    for weekday in app_config.calendar_config["days_of_week"]:
        day = week_start + timedelta(days=weekday - 1)
        if not first_date <= day <= last_date:
            continue
        day_events = [event for event in events if event.start_dt.date() == day]
        result.append(
            {
                "iso_date": day.isoformat(),
                "day_of_week": weekday,
                "heading": formats["day_title"].format(
                    day_name=app_config.labels["days"][weekday - 1],
                    day_num=day.day,
                    month_name=app_config.labels["months"][day.month - 1],
                    year=day.year,
                ),
                "events": [
                    {
                        "start_time": event.start_dt.strftime(formats["time"]),
                        "end_time": event.end_dt.strftime(formats["time"]),
                        "summary": event.summary,
                        "category_id": event.category_id,
                        "category_label": event.category_label,
                        "rooms": event.rooms,
                        "teachers": event.teachers,
                        "staff_markers": event.staff_markers,
                        "groups": event.groups,
                    }
                    for event in day_events
                ],
            }
        )
    return result


def short_date(labels, moment):
    return labels["calendar"]["day_title_short"].format(
        day_name=labels["days_short"][moment.weekday()],
        day_num=moment.day,
        month_name=labels["months_short"][moment.month - 1],
    )


def long_date(labels, moment):
    return labels["calendar"]["day_title"].format(
        day_name=labels["days"][moment.weekday()],
        day_num=moment.day,
        month_name=labels["months"][moment.month - 1],
        year=moment.year,
    )


def prepare_evaluation_order(app_config, class_config, evaluation, match_states):
    labels = app_config.labels["evaluation_page"]
    separator = app_config.labels["list_separator"]
    empty = app_config.labels["empty_value"]
    show_teachers = app_config.site["teachers"]["display_mode"] != "hidden"
    class_rank = {
        item.id: index
        for index, item in enumerate(
            item for program in app_config.programs for item in program.classes
        )
    }
    others = [
        state
        for state in match_states
        if state.class_config.id != class_config.id and state.status != "absent"
    ]
    if not others:
        return []

    def staff(event):
        return event.teachers + event.staff_markers

    def difference(event):
        parts = []
        if sorted(event.rooms) != sorted(evaluation.rooms):
            rooms = [room for room in event.rooms if room != empty]
            if not rooms:
                parts.append(labels["order_no_room"])
            else:
                key = "order_room_one" if len(rooms) == 1 else "order_room_many"
                parts.append(labels[key].format(value=separator.join(rooms)))
        if show_teachers and sorted(staff(event)) != sorted(staff(evaluation)):
            parts.append(
                labels["order_teachers"].format(value=separator.join(staff(event)))
                if staff(event)
                else labels["order_no_teacher"]
            )
        return labels["order_note_separator"].join(parts)

    entries = [(class_config, evaluation)] + [
        (state.class_config, state.evaluation) for state in others
    ]
    entries.sort(key=lambda entry: (entry[0].id != class_config.id, class_rank[entry[0].id]))
    slots = {}
    for cls, event in entries:
        slot = slots.setdefault(
            (event.start_dt, event.end_dt),
            {
                "time_range": event.time_range,
                "date_label": short_date(app_config.labels, event.start_dt)
                if event.date_iso != evaluation.date_iso
                else "",
                "date_target": f"classes/{cls.id}/evaluations/{event.occurrence_id}.html",
                "is_current": False,
                "classes": [],
                "differences": {},
            },
        )
        is_current = cls.id == class_config.id
        slot["is_current"] = slot["is_current"] or is_current
        slot["classes"].append({"label": cls.label, "is_current": is_current})
        note = "" if is_current else difference(event)
        if note:
            slot["differences"].setdefault(note, []).append(cls.label)

    result = []
    for _, slot in sorted(slots.items(), key=lambda item: item[0]):
        differences = slot.pop("differences")
        slot["notes"] = [
            note
            if len(class_labels) == len(slot["classes"])
            else labels["order_class_note"].format(classes=separator.join(class_labels), note=note)
            for note, class_labels in differences.items()
        ]
        result.append(slot)
    return result
