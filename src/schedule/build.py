import shutil
from pathlib import Path

from .config import load_config, build_ade_url
from .fetcher import fetch_calendar
from .parser import parse_calendar
from .matcher import build_matching_matrix, reconcile_shared_groups
from .exporter import export_data_files
from .renderer import render_site

def main():
    app_config = load_config()

    all_classes = []
    for prog in app_config.programs:
        for cls in prog.classes:
            all_classes.append(cls)

    events_by_class = {}

    for cls in all_classes:
        url = build_ade_url(app_config.site, cls.resource_id)
        raw_bytes = fetch_calendar(url, app_config.site, cls.label)
        evs = parse_calendar(raw_bytes, cls, app_config)
        events_by_class[cls.id] = evs

    events_by_class = reconcile_shared_groups(events_by_class, all_classes)

    evaluations_only_by_class = {
        cls_id: [ev for ev in ev_list if ev.category_id]
        for cls_id, ev_list in events_by_class.items()
    }

    matching_matrix = build_matching_matrix(evaluations_only_by_class, all_classes, app_config)

    output_dir = app_config.site.get("output_directory", "dist")
    static_dir = app_config.site.get("static_directory", "static")

    render_site(
        app_config=app_config,
        events_by_class=events_by_class,
        matching_matrix=matching_matrix,
        output_dir=output_dir,
        static_dir=static_dir
    )

    export_data_files(app_config, events_by_class, output_dir)

    dist_static = Path(output_dir) / "static"
    dist_static.mkdir(parents=True, exist_ok=True)
    src_static = Path(static_dir)
    for f in src_static.iterdir():
        if f.is_file():
            shutil.copy2(f, dist_static / f.name)

if __name__ == "__main__":
    main()
