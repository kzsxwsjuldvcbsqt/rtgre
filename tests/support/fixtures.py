from datetime import datetime, timedelta

from icalendar import Calendar, Event

from schedule.parser import parse_calendar


def calendar_bytes(entries):
    calendar = Calendar()
    calendar.add("version", "2.0")
    calendar.add("prodid", "schedule-tests")
    for entry in entries:
        event = Event()
        for key, value in entry.items():
            event.add(key, value)
        calendar.add_component(event)
    return calendar.to_ical()


def sample_events(config, class_config):
    start = datetime(2026, 9, 8, 8, tzinfo=config.timezone)
    return parse_calendar(
        calendar_bytes(
            [
                {
                    "uid": "morning",
                    "summary": "R501-DS",
                    "dtstart": start,
                    "dtend": start + timedelta(hours=2),
                },
                {
                    "uid": "afternoon",
                    "summary": "R501-DS",
                    "dtstart": start + timedelta(hours=6),
                    "dtend": start + timedelta(hours=8),
                },
            ]
        ),
        class_config,
        config,
    )
