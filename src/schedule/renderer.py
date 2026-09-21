from datetime import datetime
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, StrictUndefined

from .config import AppConfig
from .curriculum import get_class_grades_data, get_class_resources
from .exporter import serialize_events
from .matcher import build_matching_matrix
from .models import slugify
from .viewmodels import prepare_evaluation_comparison, prepare_initial_week


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
):
    out_path = Path(output_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    if active_favicons is None:
        fav_candidates = app_config.site.get("favicons", [])
        src_static = Path(static_dir)
        active_favicons = [
            f for f in fav_candidates if (src_static / f.get("filename", "")).is_file()
        ]

    if not now_str:
        now = datetime.now(app_config.timezone)
        formats = app_config.site["formats"]
        now_str = formats["footer_timestamp"].format(
            date=now.strftime(formats["date_absolute"]),
            connector=app_config.labels["footer"]["time_connector"],
            time=now.strftime(formats["time"]),
        )

    env = Environment(
        loader=FileSystemLoader(templates_dir), autoescape=True, undefined=StrictUndefined
    )

    section_files = {section.id: section.file for section in app_config.sections if section.file}
    env.globals.update(
        section_files=section_files,
        grade_empty=app_config.labels["grades"]["empty_value"].format(**app_config.site["grades"]),
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
    track_aliases = {
        t["id"]: t.get("ade_aliases", [])
        for t in app_config.curriculum.get("tracks", [])
        if "id" in t
    }
    module_labels: dict[str, str] = {}
    for m in app_config.curriculum.get("modules", []):
        code = m.get("code")
        if not code:
            continue
        module_labels.setdefault(code, m["label"])
        for track_id, aliases in track_aliases.items():
            if track_id in code:
                for alias in aliases:
                    module_labels.setdefault(code.replace(track_id, alias), m["label"])

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

    index_page_path = "index.html"
    html_index = tpl_index.render(
        site=app_config.site,
        labels=app_config.labels,
        programs=app_config.programs,
        sections=app_config.sections,
        favicons=active_favicons,
        generated_at=now_str,
        page_wide=False,
        url_for=lambda target, p=index_page_path: get_rel_path(p, target),
    )
    with open(out_path / "index.html", "w", encoding="utf-8") as f:
        f.write(html_index)

    notice_page_path = section_files["notice"]
    html_notice = tpl_notice.render(
        site=app_config.site,
        labels=app_config.labels,
        sections=app_config.sections,
        favicons=active_favicons,
        generated_at=now_str,
        page_wide=False,
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
        page_wide=False,
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

    class_home_tpl = env.get_template("class_home.html.j2")
    class_evals_tpl = env.get_template("class.html.j2")
    calendar_tpl = env.get_template("calendar.html.j2")
    grades_tpl = env.get_template("grades.html.j2")
    tasks_tpl = env.get_template("tasks.html.j2")
    resources_tpl = env.get_template("resources.html.j2")
    eval_detail_tpl = env.get_template("evaluation.html.j2")

    categories_json = [{"id": c.id, "label": c.label} for c in app_config.categories]

    class_labels_json = {
        cls_item.id: cls_item.label for prg in app_config.programs for cls_item in prg.classes
    }

    for prog in app_config.programs:
        for cls in prog.classes:
            class_sections = tuple(
                section
                for section in app_config.sections
                if not section.statuses or cls.status in section.statuses
            )
            class_dir = out_path / "classes" / cls.id
            class_dir.mkdir(parents=True, exist_ok=True)

            cls_home_page_path = f"classes/{cls.id}/{section_files['home']}"
            cls_home_html = class_home_tpl.render(
                site=app_config.site,
                labels=app_config.labels,
                class_config=cls,
                sections=class_sections,
                categories=app_config.categories,
                favicons=active_favicons,
                generated_at=now_str,
                page_wide=False,
                url_for=lambda target, p=cls_home_page_path: get_rel_path(p, target),
            )
            with open(class_dir / section_files["home"], "w", encoding="utf-8") as f:
                f.write(cls_home_html)

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
            active_modules = sorted(list({ev.module_code for ev in evals if ev.module_code}))

            cls_evals_page_path = f"classes/{cls.id}/{section_files['evaluations']}"
            cls_evals_html = class_evals_tpl.render(
                site=app_config.site,
                labels=app_config.labels,
                class_config=cls,
                sections=class_sections,
                evaluations=evals,
                months_grouped=months_grouped,
                active_categories=[{"id": c.id, "label": c.label} for c in active_categories],
                active_modules=active_modules,
                module_labels=module_labels,
                category_map=cat_map,
                categories=app_config.categories,
                favicons=active_favicons,
                generated_at=now_str,
                format_groups=format_groups,
                page_wide=False,
                url_for=lambda target, p=cls_evals_page_path: get_rel_path(p, target),
            )
            with open(class_dir / section_files["evaluations"], "w", encoding="utf-8") as f:
                f.write(cls_evals_html)

            initial_payload = serialize_events(app_config, cls.id, all_cls_events)
            initial_week_days = prepare_initial_week(app_config, all_cls_events)

            cal_page_path = f"classes/{cls.id}/{section_files['calendar']}"
            cal_html = calendar_tpl.render(
                site=app_config.site,
                labels=app_config.labels,
                class_config=cls,
                sections=class_sections,
                programs=app_config.programs,
                categories_json=categories_json,
                calendar_labels={
                    **app_config.labels["calendar"],
                    "days": app_config.labels["days"],
                    "months": app_config.labels["months"],
                    "list_separator": app_config.labels["list_separator"],
                    "groups_all": app_config.labels["groups_all"],
                },
                calendar_config=app_config.calendar_config,
                class_labels_json=class_labels_json,
                initial_payload=initial_payload,
                initial_week_days=initial_week_days,
                favicons=active_favicons,
                generated_at=now_str,
                page_wide=True,
                url_for=lambda target, p=cal_page_path: get_rel_path(p, target),
            )
            with open(class_dir / section_files["calendar"], "w", encoding="utf-8") as f:
                f.write(cal_html)

            grades_data = get_class_grades_data(cls, app_config.curriculum, app_config.labels)
            grades_page_path = f"classes/{cls.id}/{section_files['grades']}"
            grades_html = grades_tpl.render(
                site=app_config.site,
                labels=app_config.labels,
                class_config=cls,
                sections=class_sections,
                grades_data=grades_data,
                categories=app_config.categories,
                favicons=active_favicons,
                generated_at=now_str,
                page_wide=False,
                url_for=lambda target, p=grades_page_path: get_rel_path(p, target),
            )
            with open(class_dir / section_files["grades"], "w", encoding="utf-8") as f:
                f.write(grades_html)

            tasks_page_path = f"classes/{cls.id}/{section_files['tasks']}"
            tasks_html = tasks_tpl.render(
                site=app_config.site,
                labels=app_config.labels,
                class_config=cls,
                sections=class_sections,
                favicons=active_favicons,
                generated_at=now_str,
                page_wide=False,
                tasks_payload={
                    "classId": cls.id,
                    "schoolYear": app_config.site["school_year"]["label"],
                    "config": app_config.tasks_config,
                    "labels": app_config.labels["tasks"],
                },
                url_for=lambda target, p=tasks_page_path: get_rel_path(p, target),
            )
            with open(class_dir / section_files["tasks"], "w", encoding="utf-8") as f:
                f.write(tasks_html)

            if any(section.id == "absences" for section in class_sections):
                absence_page_path = f"classes/{cls.id}/{section_files['absences']}"
                sheet = app_config.absence_config["sheet"]
                pdf_assets = {
                    key: get_rel_path(absence_page_path, path)
                    for key, path in {"logo": sheet["logo_path"], **sheet["pdf_assets"]}.items()
                }
                absence_html = env.get_template("absences.html.j2").render(
                    site=app_config.site,
                    labels=app_config.labels,
                    class_config=cls,
                    sections=class_sections,
                    favicons=active_favicons,
                    generated_at=now_str,
                    page_wide=False,
                    absence_payload={
                        "classId": cls.id,
                        "classLabel": cls.label,
                        "year": app_config.site["school_year"],
                        "timezone": app_config.site["timezone"],
                        "locale": app_config.site["language"],
                        "config": app_config.absence_config,
                        "labels": app_config.labels["absences"],
                        "events": initial_payload["events"],
                        "categories": cat_map,
                        "pdfAssets": pdf_assets,
                    },
                    url_for=lambda target, p=absence_page_path: get_rel_path(p, target),
                )
                (class_dir / section_files["absences"]).write_text(absence_html, encoding="utf-8")

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
                categories=app_config.categories,
                favicons=active_favicons,
                generated_at=now_str,
                page_wide=False,
                url_for=lambda target, p=resources_page_path: get_rel_path(p, target),
            )
            with open(class_dir / section_files["resources"], "w", encoding="utf-8") as f:
                f.write(resources_html)

            eval_dir = class_dir / "evaluations"
            eval_dir.mkdir(parents=True, exist_ok=True)

            for ev in evals:
                match_states = matching_matrix.get(ev.occurrence_id, [])
                comparison = prepare_evaluation_comparison(app_config, cls, ev, match_states)

                detail_page_path = f"classes/{cls.id}/evaluations/{ev.occurrence_id}.html"
                eval_html = eval_detail_tpl.render(
                    site=app_config.site,
                    labels=app_config.labels,
                    class_config=cls,
                    sections=class_sections,
                    evaluation=ev,
                    match_states_by_program=comparison["match_states_by_program"],
                    diff_cols=comparison["diff_cols"],
                    total_cols=comparison["total_cols"],
                    module_labels=module_labels,
                    category_map=cat_map,
                    categories=app_config.categories,
                    favicons=active_favicons,
                    generated_at=now_str,
                    format_groups=format_groups,
                    page_wide=False,
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
                    page_wide=False,
                    slots=slots,
                    url_for=lambda target, p=page_path: get_rel_path(p, target),
                )
                (eval_dir / f"{legacy_id}.html").write_text(legacy_html, encoding="utf-8")
