from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit


class PageReferences(HTMLParser):
    def __init__(self):
        super().__init__()
        self.identifiers = set()
        self.references = []

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        identifier = attributes.get("id")
        if identifier:
            if identifier in self.identifiers:
                raise ValueError(f"Duplicate HTML ID: {identifier}")
            self.identifiers.add(identifier)
        for attribute in ("href", "src"):
            if attributes.get(attribute):
                self.references.append(attributes[attribute])


def validate_site(directory: Path, base_path: str = "/") -> tuple[int, int]:
    root = directory.resolve()
    pages = {}
    for filename in root.rglob("*.html"):
        page = PageReferences()
        page.feed(filename.read_text(encoding="utf-8"))
        pages[filename.resolve()] = page
    checked = 0
    prefix = "/" + base_path.strip("/") if base_path.strip("/") else ""
    for filename, page in pages.items():
        for reference in page.references:
            parsed = urlsplit(reference)
            if parsed.scheme or parsed.netloc:
                continue
            path = unquote(parsed.path)
            if path.startswith("/"):
                if prefix and (path == prefix or path.startswith(prefix + "/")):
                    path = path[len(prefix) :]
                target = root / path.lstrip("/")
            else:
                target = filename.parent / path if path else filename
            target = target.resolve()
            if target.is_dir():
                target /= "index.html"
            if not target.is_relative_to(root) or not target.is_file():
                raise ValueError(f"Missing or unsafe reference in {filename.name}: {reference}")
            fragment = unquote(parsed.fragment)
            if fragment and "=" not in fragment and target in pages:
                if fragment not in pages[target].identifiers:
                    raise ValueError(f"Missing fragment in {filename.name}: {reference}")
            checked += 1
    return len(pages), checked
