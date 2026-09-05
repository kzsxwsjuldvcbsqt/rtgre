import time
import requests

def fetch_calendar(url: str, site_config: dict, class_label: str) -> bytes:
    ade = site_config["ade"]
    user_agent = ade["user_agent"]
    timeout = ade["request_timeout_seconds"]
    retries = ade["retry_attempts"]
    delay = ade["retry_delay_seconds"]

    headers = {"User-Agent": user_agent}
    session = requests.Session()

    for attempt in range(retries):
        try:
            response = session.get(url, headers=headers, timeout=timeout)
            if response.status_code == 200 and b"BEGIN:VCALENDAR" in response.content:
                return response.content
        except Exception:
            pass
        if attempt < retries - 1:
            time.sleep(delay)

    raise RuntimeError(f"Failed to fetch ADE calendar for class {class_label} after {retries} attempts.")
