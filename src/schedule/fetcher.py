import time

import requests


def fetch_calendar(url: str, site_config: dict, class_label: str) -> bytes:
    ade = site_config["ade"]
    retries = ade["retry_attempts"]
    last_error = None
    with requests.Session() as session:
        session.headers.update({"User-Agent": ade["user_agent"]})
        for attempt in range(retries):
            try:
                response = session.get(url, timeout=ade["request_timeout_seconds"])
                response.raise_for_status()
                if b"BEGIN:VCALENDAR" not in response.content:
                    raise ValueError("ADE response is not an iCalendar document")
                return response.content
            except (requests.RequestException, ValueError) as error:
                last_error = error
            if attempt < retries - 1:
                time.sleep(ade["retry_delay_seconds"])
    raise RuntimeError(
        f"Failed to fetch ADE calendar for class {class_label} after {retries} "
        f"attempts: {last_error}"
    ) from last_error
