from datetime import UTC, datetime, timedelta

from icalendar import Calendar, Event, vDuration

from .config import AppConfig
from .models import ClassConfig


def build_feed(
    app_config: AppConfig,
    class_config: ClassConfig,
    events: list[dict],
    name: str,
    stamp: datetime,
) -> bytes:
    settings = app_config.site["feeds"]
    labels = app_config.labels["feeds"]
    separator = app_config.labels["list_separator"]
    categories = {category.id: category.label for category in app_config.categories}
    refresh = vDuration(timedelta(minutes=settings["refresh_minutes"]))

    calendar = Calendar()
    calendar.add("prodid", settings["product_id"])
    calendar.add("version", "2.0")
    calendar.add("x-wr-calname", name)
    calendar.add("x-wr-timezone", app_config.site["timezone"])
    calendar.add("refresh-interval", refresh, parameters={"value": "DURATION"})
    calendar.add("x-published-ttl", refresh)
    for event in events:
        title = " ".join(part for part in (event["code"], event["session"]) if part)
        title = title or event["title"]
        if event["category"] in categories:
            title = labels["evaluation_summary"].format(
                category=categories[event["category"]], name=title
            )
        details = [
            labels[key].format(names=separator.join(event[key]))
            for key in ("teachers", "groups")
            if event[key]
        ]
        item = Event()
        item.add("uid", f"{class_config.id}-{event['occurrence_id']}@{settings['uid_domain']}")
        item.add("dtstamp", stamp.astimezone(UTC))
        item.add("dtstart", datetime.fromisoformat(event["start"]).astimezone(UTC))
        item.add("dtend", datetime.fromisoformat(event["end"]).astimezone(UTC))
        item.add("summary", title)
        if event["rooms"]:
            item.add("location", separator.join(event["rooms"]))
        if details:
            item.add("description", "\n".join(details))
        calendar.add_component(item)
    return calendar.to_ical()


def write_class_feeds(
    app_config: AppConfig,
    class_config: ClassConfig,
    events: list[dict],
    directory,
    stamp: datetime,
) -> None:
    settings = app_config.site["feeds"]
    labels = app_config.labels["feeds"]
    names = {"site": app_config.site["title"], "class": class_config.label}
    feeds = (
        (settings["calendar_file"], labels["calendar_name"], events),
        (
            settings["evaluations_file"],
            labels["evaluations_name"],
            [event for event in events if event["category"]],
        ),
    )
    for filename, name, selection in feeds:
        content = build_feed(app_config, class_config, selection, name.format(**names), stamp)
        (directory / filename).write_bytes(content)
