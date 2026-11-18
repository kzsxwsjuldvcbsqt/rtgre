import re
from pathlib import Path

LAYER_IMPORT = re.compile(r'@import url\("(?P<file>[^"/]+\.css)"\) layer\((?P<layer>[a-z-]+)\);\n')


def bundle_stylesheet(entry: Path) -> None:
    inlined = []

    def inline(match: re.Match) -> str:
        source = entry.with_name(match["file"])
        content = source.read_text(encoding="utf-8")
        if "@import" in content:
            raise ValueError(f"Nested stylesheet import in {source.name}")
        inlined.append(source)
        return f"@layer {match['layer']} {{\n{content}}}\n"

    bundle = LAYER_IMPORT.sub(inline, entry.read_text(encoding="utf-8"))
    if "@import" in bundle:
        raise ValueError(f"Unsupported stylesheet import in {entry.name}")
    entry.write_text(bundle, encoding="utf-8")
    for source in inlined:
        source.unlink()
