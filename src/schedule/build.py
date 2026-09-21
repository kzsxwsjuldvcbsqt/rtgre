import fcntl
import os
import re
import shutil
import tempfile
from contextlib import contextmanager
from pathlib import Path

from .config import build_ade_url, load_config
from .exporter import export_data_files
from .fetcher import fetch_calendar
from .matcher import build_matching_matrix, reconcile_shared_groups
from .parser import parse_calendar
from .renderer import render_site
from .sitecheck import validate_site

GENERATED_MARKER = ".schedule-generated"


def output_path(value: str, project_root: Path) -> Path:
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", value) or value in {
        "config",
        "src",
        "static",
        "templates",
        "tests",
    }:
        raise ValueError("Unsafe output directory")
    path = project_root / value
    if path.is_symlink() or (path.exists() and not path.is_dir()):
        raise ValueError("Unsafe output directory")
    if path.exists() and value != "dist" and not (path / GENERATED_MARKER).is_file():
        raise ValueError("Refusing to replace an unmanaged directory")
    return path


def source_path(value: str, project_root: Path) -> Path:
    path = (project_root / value).resolve()
    if not path.is_relative_to(project_root.resolve()) or not path.is_dir():
        raise ValueError("Invalid static directory")
    return path


@contextmanager
def build_lock(target: Path):
    descriptor = os.open(
        target.with_name(f".{target.name}.lock"), os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600
    )
    try:
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise RuntimeError("Another build is publishing this output directory") from error
        yield
    finally:
        os.close(descriptor)


def publish_site(app_config, events_by_class, matching_matrix, project_root: Path | None = None):
    root = (project_root or Path.cwd()).resolve()
    target = output_path(app_config.site["output_directory"], root)
    with build_lock(target):
        _publish_site(app_config, events_by_class, matching_matrix, root)


def _publish_site(app_config, events_by_class, matching_matrix, project_root: Path | None = None):
    root = (project_root or Path.cwd()).resolve()
    target = output_path(app_config.site["output_directory"], root)
    static = source_path(app_config.site["static_directory"], root)
    staging = Path(tempfile.mkdtemp(prefix=f".{target.name}-", dir=target.parent))
    backup = target.with_name(f".{target.name}-previous")
    try:
        render_site(
            app_config=app_config,
            events_by_class=events_by_class,
            matching_matrix=matching_matrix,
            output_dir=str(staging),
            static_dir=str(static),
        )
        export_data_files(app_config, events_by_class, str(staging))
        dist_static = staging / "static"
        dist_static.mkdir(parents=True, exist_ok=True)
        for source in static.rglob("*"):
            if source.is_file() and not source.is_symlink():
                relative = source.relative_to(static)
                dest = dist_static / relative
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, dest)
        validate_site(staging, app_config.site.get("base_path", "/"))
        (staging / GENERATED_MARKER).write_text("schedule\n", encoding="utf-8")
        if backup.exists():
            if not backup.is_dir() or not (backup / GENERATED_MARKER).is_file():
                raise ValueError("Refusing to replace an unmanaged backup directory")
            shutil.rmtree(backup)
        if target.exists():
            os.replace(target, backup)
        try:
            os.replace(staging, target)
        except Exception:
            if backup.exists() and not target.exists():
                os.replace(backup, target)
            raise
        if backup.exists():
            shutil.rmtree(backup)
    finally:
        if staging.exists():
            shutil.rmtree(staging)


def main():
    app_config = load_config()
    all_classes = [cls for program in app_config.programs for cls in program.classes]
    events_by_class = {}
    for class_config in all_classes:
        url = build_ade_url(app_config.site, class_config.resource_id)
        raw_bytes = fetch_calendar(url, app_config.site, class_config.label)
        events_by_class[class_config.id] = parse_calendar(raw_bytes, class_config, app_config)

    events_by_class = reconcile_shared_groups(events_by_class, all_classes)
    evaluations = {
        class_id: [event for event in events if event.category_id]
        for class_id, events in events_by_class.items()
    }
    matching_matrix = build_matching_matrix(evaluations, all_classes, app_config)
    publish_site(app_config, events_by_class, matching_matrix)


if __name__ == "__main__":
    main()
