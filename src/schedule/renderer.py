from datetime import date, datetime
from functools import partial
from pathlib import Path

from jinja2 import ChoiceLoader, Environment, FileSystemLoader, PrefixLoader, StrictUndefined

from .config import AppConfig, active_theme, theme_files
from .curriculum import (
    canonical_module_codes,
    get_class_grades_data,
    get_class_resources,
    module_code_variants,
    resolve_module_info,
)
from .exporter import serialize_events
from .feeds import write_class_feeds
from .matcher import build_matching_matrix
from .models import slugify
from .viewmodels import (
    long_date,
    prepare_evaluation_order,
    prepare_initial_week,
    prepare_module_progress,
    short_date,
)


def get_rel_path(current_page: str, target: str) -> str:
    if target.startswith("http://") or target.startswith("https://"):
        return target
    curr_parts = [p for p in current_page.split("/") if p]
    depth = len(curr_parts) - 1
    if depth > 0:
        prefix = "../" * depth
    else:
        prefix = ""
    return f"{prefix}{target}"


def get_404_url(target: str, base_path: str) -> str:
    if target.startswith("http://") or target.startswith("https://"):
        return target
    base = base_path.rstrip("/")
    if base:
        return f"{base}/{target.lstrip('/')}"
    return f"/{target.lstrip('/')}"


STATIC_TEMPLATE_PREFIX = "static"


def render_site(
    app_config: AppConfig,
    events_by_class: dict,
    matching_matrix: dict | None = None,
    active_favicons: list | None = None,
    now_str: str = "",
    base_path: str = "",
    output_dir: str = "dist",
    templates_dir: str = "templates",
    static_dir: str = "static",
    today: date | None = None,
):
    out_path = Path(output_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    if active_favicons is None:
        fav_candidates = app_config.site.get("favicons", [])
        src_static = Path(static_dir)
        active_favicons = [
            f for f in fav_candidates if (src_static / f.get("filename", "")).is_file()
        ]

    now = datetime.now(app_config.timezone)
    if not now_str:
        formats = app_config.site["formats"]
        now_str = formats["footer_timestamp"].format(
            date=now.strftime(formats["date_absolute"]),
            connector=app_config.labels["footer"]["time_connector"],
            time=now.strftime(formats["time"]),
        )

    env = Environment(
        loader=ChoiceLoader(
            [
                FileSystemLoader(templates_dir),
                PrefixLoader({STATIC_TEMPLATE_PREFIX: FileSystemLoader(static_dir)}),
            ]
        ),
        autoescape=True,
        undefined=StrictUndefined,
    )
    env.globals.update(
        icon_sprite_template=f"{STATIC_TEMPLATE_PREFIX}/{app_config.site['icons']['sprite']}"
    )

    files_by_theme = {
        theme["id"]: theme_files(app_config.themes, theme) for theme in app_config.themes["themes"]
    }
    for files in files_by_theme.values():
        for file in (files["stylesheet"], *files["preload_images"]):
            if not (Path(static_dir) / file).is_file():
                raise ValueError(f"Missing theme file: {file}")
    theme = active_theme(app_config.themes, today or now.date())
    active_files = files_by_theme[theme["id"]] if theme else {}

    section_files = {section.id: section.file for section in app_config.sections if section.file}
    env.globals.update(
        generated_iso=now.isoformat(timespec="seconds"),
        theme_id=theme["id"] if theme else "",
        theme_stylesheet=active_files.get("stylesheet", ""),
        theme_preload_images=active_files.get("preload_images", []),
        section_files=section_files,
        programs=app_config.programs,
        category_tones={
            category.id: category.tone for category in app_config.categories if category.tone
        },
        content_security_policy="; ".join(
            f"{directive} {' '.join(sources)}"
            for directive, sources in app_config.site["content_security_policy"].items()
        ),
        grade_empty=app_config.labels["grades"]["empty_mark"],
        grade_label=app_config.labels["grades"]["grade_input_column"].format(
            **app_config.site["grades"]
        ),
    )
    all_classes = [c for p in app_config.programs for c in p.classes]
    if matching_matrix is None:
        evaluations_only_by_class = {
            cls_id: [ev for ev in ev_list if ev.category_id]
            for cls_id, ev_list in events_by_class.items()
        }
        matching_matrix = build_matching_matrix(evaluations_only_by_class, all_classes, app_config)

    cat_map = {c.id: c.label for c in app_config.categories}
    module_labels: dict[str, str] = {}
    module_kinds: dict[str, str] = {}
    module_codes = canonical_module_codes(app_config.curriculum)
    for code, module in module_code_variants(app_config.curriculum):
        module_labels.setdefault(code, module["label"])
        module_kinds.setdefault(code, module["kind"])
    env.filters["canonical_code"] = lambda code: module_codes.get(code, code)

    env.globals.update(
        short_date=partial(short_date, app_config.labels),
        long_date=partial(long_date, app_config.labels),
    )
    kinds = app_config.curriculum.get("kinds", [])
    kind_labels = {kind["id"]: kind["label"] for kind in kinds}
    kind_rank = {kind["id"]: index for index, kind in enumerate(kinds)}
    module_info = resolve_module_info(
        app_config.curriculum,
        sorted(
            {
                ev.module_code
                for class_events in events_by_class.values()
                for ev in class_events
                if ev.module_code
            }
        ),
        app_config.site["chamilo"],
    )

    configured_group_codes = {
        cls_item.ade_group_code
        for prg in app_config.programs
        for cls_item in prg.classes
        if cls_item.ade_group_code
    }
    all_classes_label = app_config.labels["groups_all"]

    def format_groups(groups):
        if not groups:
            return []
        groups_set = set(groups)
        if configured_group_codes and configured_group_codes.issubset(groups_set):
            remaining = [g for g in groups if g not in configured_group_codes]
            return [all_classes_label] + remaining
        return list(groups)

    tpl_index = env.get_template("index.html.j2")
    tpl_notice = env.get_template("notice.html.j2")
    tpl_404 = env.get_template("404.html.j2")
    tpl_redirect = env.get_template("redirect.html.j2")

    index_page_path = "index.html"
    html_index = tpl_index.render(
        site=app_config.site,
        labels=app_config.labels,
        sections=app_config.sections,
        favicons=active_favicons,
        generated_at=now_str,
        url_for=lambda target, p=index_page_path: get_rel_path(p, target),
    )
    with open(out_path / "index.html", "w", encoding="utf-8") as f:
        f.write(html_index)

    notice_page_path = section_files["notice"]
    html_notice = tpl_notice.render(
        site=app_config.site,
        labels=app_config.labels,
        sections=app_config.sections,
        class_config=None,
        favicons=active_favicons,
        generated_at=now_str,
        url_for=lambda target, p=notice_page_path: get_rel_path(p, target),
    )
    with open(out_path / notice_page_path, "w", encoding="utf-8") as f:
        f.write(html_notice)

    if not base_path:
        base_path = app_config.site.get("base_path", "/")

    html_404 = tpl_404.render(
        site=app_config.site,
        labels=app_config.labels,
        sections=app_config.sections,
        favicons=active_favicons,
        generated_at=now_str,
        get_404_url=lambda target: get_404_url(target, base_path),
    )
    with open(out_path / "404.html", "w", encoding="utf-8") as f:
        f.write(html_404)

    robots_content = app_config.site.get("robots_txt")
    robots_path = out_path / "robots.txt"
    if robots_content and isinstance(robots_content, str):
        with open(robots_path, "w", encoding="utf-8") as f:
            f.write(robots_content)
    elif robots_path.is_file():
        robots_path.unlink()

    custom_domain = app_config.site.get("custom_domain")
    cname_path = out_path / "CNAME"
    if custom_domain and isinstance(custom_domain, str) and custom_domain.strip():
        with open(cname_path, "w", encoding="utf-8") as f:
            f.write(f"{custom_domain.strip()}\n")
    elif cname_path.is_file():
        cname_path.unlink()

    class_evals_tpl = env.get_template("class.html.j2")
    calendar_tpl = env.get_template("calendar.html.j2")
    grades_tpl = env.get_template("grades.html.j2")
    resources_tpl = env.get_template("resources.html.j2")
    eval_detail_tpl = env.get_template("evaluation.html.j2")

    categories_json = [
        {"id": c.id, "label": c.label, "tone": c.tone} for c in app_config.categories
    ]
    session_marks_json = [{"id": m.id, "label": m.label} for m in app_config.session_marks]

    for prog in app_config.programs:
        for cls in prog.classes:
            class_sections = tuple(
                section
                for section in app_config.sections
                if not section.statuses or cls.status in section.statuses
            )
            class_dir = out_path / "classes" / cls.id
            class_dir.mkdir(parents=True, exist_ok=True)

            all_cls_events = events_by_class.get(cls.id, [])
            evals = [ev for ev in all_cls_events if ev.category_id]

            months_map = {}
            for ev in evals:
                if ev.month_key not in months_map:
                    months_map[ev.month_key] = {"label": ev.month_label, "evaluations": []}
                months_map[ev.month_key]["evaluations"].append(ev)

            months_grouped = [
                (k, months_map[k]["label"], months_map[k]["evaluations"])
                for k in sorted(months_map.keys())
            ]

            present_cat_ids = {ev.category_id for ev in evals}
            active_categories = [
                c for c in app_config.categories if c.id in present_cat_ids and c.enabled
            ]
            active_modules = sorted(
                (
                    {
                        "code": code,
                        "label": module_labels.get(code, ""),
                        "group": kind_labels.get(module_kinds.get(code), ""),
                    }
                    for code in {
                        module_codes.get(ev.module_code, ev.module_code)
                        for ev in evals
                        if ev.module_code
                    }
                ),
                key=lambda option: (
                    kind_rank.get(module_kinds.get(option["code"]), len(kind_rank)),
                    option["code"],
                ),
            )

            cls_evals_page_path = f"classes/{cls.id}/{section_files['evaluations']}"
            cls_evals_html = class_evals_tpl.render(
                site=app_config.site,
                labels=app_config.labels,
                class_config=cls,
                sections=class_sections,
                evaluations=evals,
                months_grouped=months_grouped,
                active_categories=[
                    {"id": c.id, "label": c.label, "tone": c.tone} for c in active_categories
                ],
                active_modules=active_modules,
                module_labels=module_labels,
                category_map=cat_map,
                categories=app_config.categories,
                favicons=active_favicons,
                generated_at=now_str,
                format_groups=format_groups,
                url_for=lambda target, p=cls_evals_page_path: get_rel_path(p, target),
            )
            with open(class_dir / section_files["evaluations"], "w", encoding="utf-8") as f:
                f.write(cls_evals_html)

            initial_payload = serialize_events(app_config, cls.id, all_cls_events)
            write_class_feeds(app_config, cls, initial_payload["events"], class_dir, now)
            initial_week_days = prepare_initial_week(app_config, all_cls_events)

            cal_page_path = f"classes/{cls.id}/{section_files['calendar']}"
            cal_html = calendar_tpl.render(
                site=app_config.site,
                labels=app_config.labels,
                class_config=cls,
                sections=class_sections,
                categories_json=categories_json,
                session_marks_json=session_marks_json,
                calendar_labels={
                    **app_config.labels["calendar"],
                    "days": app_config.labels["days"],
                    "months": app_config.labels["months"],
                    "days_short": app_config.labels["days_short"],
                    "months_short": app_config.labels["months_short"],
                    "list_separator": app_config.labels["list_separator"],
                    "groups_all": app_config.labels["groups_all"],
                },
                calendar_config=app_config.calendar_config,
                module_info=module_info,
                initial_payload=initial_payload,
                initial_week_days=initial_week_days,
                favicons=active_favicons,
                generated_at=now_str,
                url_for=lambda target, p=cal_page_path: get_rel_path(p, target),
            )
            with open(class_dir / section_files["calendar"], "w", encoding="utf-8") as f:
                f.write(cal_html)

            for section in class_sections:
                for previous_file in section.previous_files:
                    redirect_html = tpl_redirect.render(
                        site=app_config.site, section=section, target=section.file
                    )
                    with open(class_dir / previous_file, "w", encoding="utf-8") as f:
                        f.write(redirect_html)

            cls_notice_page_path = f"classes/{cls.id}/{section_files['notice']}"
            cls_notice_html = tpl_notice.render(
                site=app_config.site,
                labels=app_config.labels,
                sections=class_sections,
                class_config=cls,
                favicons=active_favicons,
                generated_at=now_str,
                url_for=lambda target, p=cls_notice_page_path: get_rel_path(p, target),
            )
            with open(class_dir / section_files["notice"], "w", encoding="utf-8") as f:
                f.write(cls_notice_html)

            grades_data = get_class_grades_data(cls, app_config.curriculum, app_config.labels)
            grades_page_path = f"classes/{cls.id}/{section_files['grades']}"
            grades_html = grades_tpl.render(
                site=app_config.site,
                labels=app_config.labels,
                class_config=cls,
                sections=class_sections,
                grades_data=grades_data,
                mobile_media_query=app_config.calendar_config["mobile_media_query"],
                categories=app_config.categories,
                favicons=active_favicons,
                generated_at=now_str,
                url_for=lambda target, p=grades_page_path: get_rel_path(p, target),
            )
            with open(class_dir / section_files["grades"], "w", encoding="utf-8") as f:
                f.write(grades_html)

            resource_groups = get_class_resources(
                cls, app_config.curriculum, app_config.site["chamilo"], app_config.labels
            )
            resources_page_path = f"classes/{cls.id}/{section_files['resources']}"
            resources_html = resources_tpl.render(
                site=app_config.site,
                labels=app_config.labels,
                class_config=cls,
                sections=class_sections,
                resource_groups=resource_groups,
                module_progress=prepare_module_progress(all_cls_events, module_codes, now),
                categories=app_config.categories,
                favicons=active_favicons,
                generated_at=now_str,
                url_for=lambda target, p=resources_page_path: get_rel_path(p, target),
            )
            with open(class_dir / section_files["resources"], "w", encoding="utf-8") as f:
                f.write(resources_html)

            eval_dir = class_dir / "evaluations"
            eval_dir.mkdir(parents=True, exist_ok=True)

            for ev in evals:
                match_states = matching_matrix.get(ev.occurrence_id, [])

                detail_page_path = f"classes/{cls.id}/evaluations/{ev.occurrence_id}.html"
                eval_html = eval_detail_tpl.render(
                    site=app_config.site,
                    labels=app_config.labels,
                    class_config=cls,
                    sections=class_sections,
                    evaluation=ev,
                    order_slots=prepare_evaluation_order(app_config, cls, ev, match_states),
                    module_labels=module_labels,
                    category_map=cat_map,
                    categories=app_config.categories,
                    favicons=active_favicons,
                    generated_at=now_str,
                    format_groups=format_groups,
                    url_for=lambda target, p=detail_page_path: get_rel_path(p, target),
                )
                with open(eval_dir / f"{ev.occurrence_id}.html", "w", encoding="utf-8") as f:
                    f.write(eval_html)

            legacy_groups = {}
            for ev in evals:
                legacy_id = f"{slugify(ev.summary)}--{ev.date_iso}"
                legacy_groups.setdefault(legacy_id, []).append(ev)
            for legacy_id, slots in legacy_groups.items():
                page_path = f"classes/{cls.id}/evaluations/{legacy_id}.html"
                legacy_html = env.get_template("evaluation_slots.html.j2").render(
                    site=app_config.site,
                    labels=app_config.labels,
                    class_config=cls,
                    sections=class_sections,
                    favicons=active_favicons,
                    generated_at=now_str,
                    slots=slots,
                    url_for=lambda target, p=page_path: get_rel_path(p, target),
                )
                (eval_dir / f"{legacy_id}.html").write_text(legacy_html, encoding="utf-8")
