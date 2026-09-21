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


def prepare_evaluation_comparison(app_config, class_config, evaluation, match_states):
    active_states = [
        state
        for state in match_states
        if state.class_config.id != class_config.id and state.status != "absent"
    ]
    processed = {}
    differences = {"date": False, "time": False, "rooms": False, "teachers": False}
    for state in active_states:
        flags = {
            "date": state.status == "alternate",
            "time": state.evaluation.time_range != evaluation.time_range,
            "rooms": state.evaluation.rooms != evaluation.rooms,
            "teachers": app_config.site["teachers"]["display_mode"] != "hidden"
            and (state.evaluation.teachers + state.evaluation.staff_markers)
            != (evaluation.teachers + evaluation.staff_markers),
        }
        for key, value in flags.items():
            differences[key] = differences[key] or value
        fields = [app_config.labels["fields"][key] for key, value in flags.items() if value]
        label = (
            app_config.labels["list_separator"].join(fields)
            if fields
            else app_config.labels["evaluation_page"]["same_all"]
        )
        processed[state.class_config.id] = {
            "state_obj": state,
            "d_date": flags["date"],
            "d_time": flags["time"],
            "d_rooms": flags["rooms"],
            "d_teachers": flags["teachers"],
            "state_label": label,
        }
    by_program = []
    for program in app_config.programs:
        states = [
            processed[item.id]
            for item in program.classes
            if item.id != class_config.id and item.id in processed
        ]
        if states:
            by_program.append((program, states))
    return {
        "match_states_by_program": by_program,
        "diff_cols": differences,
        "total_cols": 2 + sum(differences.values()),
    }
