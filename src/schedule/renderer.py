import json
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, Any, Optional
from jinja2 import Environment, FileSystemLoader, StrictUndefined

from .config import AppConfig
from .matcher import build_matching_matrix
from .curriculum import get_class_resources, get_class_grades_data
from .models import slugify

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
    matching_matrix: Optional[dict] = None,
    active_favicons: Optional[list] = None,
    now_str: str = "",
    base_path: str = "",
    output_dir: str = "dist",
    templates_dir: str = "templates",
    static_dir: str = "static"
):
    out_path = Path(output_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    if active_favicons is None:
        fav_candidates = app_config.site.get("favicons", [])
        src_static = Path(static_dir)
        active_favicons = [
            f for f in fav_candidates
            if (src_static / f.get("filename", "")).is_file()
        ]

    if not now_str:
        now_str = datetime.now().strftime("%d/%m/%Y à %H:%M")

    env = Environment(
        loader=FileSystemLoader(templates_dir),
        autoescape=True,
        undefined=StrictUndefined
    )

    all_classes = [c for p in app_config.programs for c in p.classes]
    if matching_matrix is None:
        evaluations_only_by_class = {
            cls_id: [ev for ev in ev_list if ev.category_id]
            for cls_id, ev_list in events_by_class.items()
        }
        matching_matrix = build_matching_matrix(evaluations_only_by_class, all_classes, app_config)

    cat_map = {c.id: c.label for c in app_config.categories}

    configured_group_codes = {
        cls_item.ade_group_code
        for prg in app_config.programs
        for cls_item in prg.classes
        if cls_item.ade_group_code
    }
    all_classes_label = app_config.labels.get("groups_all", "Toutes les classes")

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
        url_for=lambda target, p=index_page_path: get_rel_path(p, target)
    )
    with open(out_path / "index.html", "w", encoding="utf-8") as f:
        f.write(html_index)

    notice_page_path = "a-savoir.html"
    html_notice = tpl_notice.render(
        site=app_config.site,
        labels=app_config.labels,
        sections=app_config.sections,
        favicons=active_favicons,
        generated_at=now_str,
        page_wide=False,
        url_for=lambda target, p=notice_page_path: get_rel_path(p, target)
    )
    with open(out_path / "a-savoir.html", "w", encoding="utf-8") as f:
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
        get_404_url=lambda target: get_404_url(target, base_path)
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
    notes_tpl = env.get_template("notes.html.j2")
    resources_tpl = env.get_template("resources.html.j2")
    eval_detail_tpl = env.get_template("evaluation.html.j2")

    display_mode = app_config.site.get("teachers", {}).get("display_mode", "full")
    unknown_marker = app_config.site.get("teachers", {}).get("unknown_marker", "")
    empty_val = app_config.labels.get("empty_value", "")

    categories_json = [
        {"id": c.id, "label": c.label}
        for c in app_config.categories
    ]

    class_labels_json = {
        cls_item.id: cls_item.label
        for prg in app_config.programs
        for cls_item in prg.classes
    }

    for prog in app_config.programs:
        for cls in prog.classes:
            class_dir = out_path / "classes" / cls.id
            class_dir.mkdir(parents=True, exist_ok=True)

            cls_home_page_path = f"classes/{cls.id}/index.html"
            cls_home_html = class_home_tpl.render(
                site=app_config.site,
                labels=app_config.labels,
                class_config=cls,
                sections=app_config.sections,
                categories=app_config.categories,
                favicons=active_favicons,
                generated_at=now_str,
                page_wide=False,
                url_for=lambda target, p=cls_home_page_path: get_rel_path(p, target)
            )
            with open(class_dir / "index.html", "w", encoding="utf-8") as f:
                f.write(cls_home_html)

            all_cls_events = events_by_class.get(cls.id, [])
            evals = [ev for ev in all_cls_events if ev.category_id]

            months_map = {}
            for ev in evals:
                if ev.month_key not in months_map:
                    months_map[ev.month_key] = {
                        "label": ev.month_label,
                        "evaluations": []
                    }
                months_map[ev.month_key]["evaluations"].append(ev)

            months_grouped = [
                (k, months_map[k]["label"], months_map[k]["evaluations"])
                for k in sorted(months_map.keys())
            ]

            present_cat_ids = {ev.category_id for ev in evals}
            active_categories = [c for c in app_config.categories if c.id in present_cat_ids and c.enabled]
            active_modules = sorted(list({ev.module_code for ev in evals if ev.module_code}))

            cls_evals_page_path = f"classes/{cls.id}/evaluations.html"
            cls_evals_html = class_evals_tpl.render(
                site=app_config.site,
                labels=app_config.labels,
                class_config=cls,
                sections=app_config.sections,
                evaluations=evals,
                months_grouped=months_grouped,
                active_categories=active_categories,
                active_modules=active_modules,
                category_map=cat_map,
                categories=app_config.categories,
                favicons=active_favicons,
                generated_at=now_str,
                format_groups=format_groups,
                page_wide=False,
                url_for=lambda target, p=cls_evals_page_path: get_rel_path(p, target)
            )
            with open(class_dir / "evaluations.html", "w", encoding="utf-8") as f:
                f.write(cls_evals_html)

            exported_events = []
            for ev in all_cls_events:
                if display_mode == "hidden":
                    clean_teachers = []
                else:
                    clean_teachers = [
                        t for t in ev.teachers
                        if t != empty_val and t.lower() != unknown_marker.lower()
                    ]
                clean_markers = [m for m in ev.staff_markers if m != empty_val]
                clean_rooms = [r for r in ev.rooms if r != empty_val]
                exported_events.append({
                    "start": ev.start_dt.isoformat(),
                    "end": ev.end_dt.isoformat(),
                    "title": ev.summary,
                    "slug": slugify(ev.summary),
                    "module": ev.module_code,
                    "category": ev.category_id if ev.category_id else None,
                    "rooms": clean_rooms,
                    "teachers": clean_teachers,
                    "staff_markers": clean_markers,
                    "groups": list(ev.groups),
                    "flags": list(ev.flags)
                })

            initial_payload = {"class": cls.id, "events": exported_events}
            initial_events_json = json.dumps(initial_payload, ensure_ascii=False)

            first_dt_str = app_config.site["school_year"]["first_date"]
            first_dt_iso = first_dt_str
            initial_events_first_week = [
                ev for ev in all_cls_events
                if ev.start_dt.isoformat()[:10] >= first_dt_iso
            ]
            initial_events_first_week.sort(key=lambda x: x.start_dt)

            day_names = app_config.labels.get("days", [])
            month_names = app_config.labels.get("months", [])

            initial_week_days = []
            if initial_events_first_week:
                w_start = initial_events_first_week[0].start_dt
                for i in range(7):
                    d_dt = w_start + timedelta(days=i)
                    day_iso = d_dt.isoformat()[:10]
                    day_evs = [ev for ev in initial_events_first_week if ev.start_dt.isoformat()[:10] == day_iso]
                    formatted_evs = []
                    for ev in day_evs:
                        cat_lbl = cat_map.get(ev.category_id, "") if ev.category_id else ""
                        formatted_evs.append({
                            "time_range": ev.time_range,
                            "start_time": ev.start_dt.strftime("%H:%M"),
                            "end_time": ev.end_dt.strftime("%H:%M"),
                            "summary": ev.summary,
                            "category_id": ev.category_id,
                            "category_label": cat_lbl,
                            "rooms": ev.rooms,
                            "teachers": ev.teachers,
                            "staff_markers": ev.staff_markers,
                            "groups": ev.groups
                        })
                    day_name = day_names[d_dt.isoweekday() - 1]
                    day_heading = f"{day_name} {d_dt.day} {month_names[d_dt.month - 1]} {d_dt.year}"
                    initial_week_days.append({
                        "iso_date": day_iso,
                        "day_of_week": d_dt.isoweekday(),
                        "heading": day_heading,
                        "events": formatted_evs
                    })

            cal_page_path = f"classes/{cls.id}/calendar.html"
            cal_html = calendar_tpl.render(
                site=app_config.site,
                labels=app_config.labels,
                class_config=cls,
                sections=app_config.sections,
                programs=app_config.programs,
                categories_json=categories_json,
                calendar_labels=app_config.labels["calendar"],
                class_labels_json=class_labels_json,
                initial_events_json=initial_events_json,
                initial_week_days=initial_week_days,
                favicons=active_favicons,
                generated_at=now_str,
                page_wide=True,
                url_for=lambda target, p=cal_page_path: get_rel_path(p, target)
            )
            with open(class_dir / "calendar.html", "w", encoding="utf-8") as f:
                f.write(cal_html)

            grades_data = get_class_grades_data(cls, app_config.curriculum, app_config.labels)
            notes_page_path = f"classes/{cls.id}/notes.html"
            notes_html = notes_tpl.render(
                site=app_config.site,
                labels=app_config.labels,
                class_config=cls,
                sections=app_config.sections,
                grades_data=grades_data,
                categories=app_config.categories,
                favicons=active_favicons,
                generated_at=now_str,
                page_wide=False,
                url_for=lambda target, p=notes_page_path: get_rel_path(p, target)
            )
            with open(class_dir / "notes.html", "w", encoding="utf-8") as f:
                f.write(notes_html)

            resource_groups = get_class_resources(cls, app_config.curriculum, app_config.site["chamilo"], app_config.labels)
            resources_page_path = f"classes/{cls.id}/ressources.html"
            resources_html = resources_tpl.render(
                site=app_config.site,
                labels=app_config.labels,
                class_config=cls,
                sections=app_config.sections,
                resource_groups=resource_groups,
                categories=app_config.categories,
                favicons=active_favicons,
                generated_at=now_str,
                page_wide=False,
                url_for=lambda target, p=resources_page_path: get_rel_path(p, target)
            )
            with open(class_dir / "ressources.html", "w", encoding="utf-8") as f:
                f.write(resources_html)

            eval_dir = class_dir / "evaluations"
            eval_dir.mkdir(parents=True, exist_ok=True)

            for ev in evals:
                match_states = matching_matrix.get(ev.occurrence_id, [])
                active_states = [ms for ms in match_states if ms.class_config.id != cls.id and ms.status != "absent"]

                differs_date = False
                differs_time = False
                differs_rooms = False
                differs_teachers = False

                processed_states_by_id = {}
                for ms in active_states:
                    d_date = (ms.status == "alternate")
                    d_time = (ms.evaluation.time_range != ev.time_range)
                    d_rooms = (ms.evaluation.rooms != ev.rooms)
                    d_teachers = ((ms.evaluation.teachers or ms.evaluation.staff_markers) != (ev.teachers or ev.staff_markers))

                    if d_date: differs_date = True
                    if d_time: differs_time = True
                    if d_rooms: differs_rooms = True
                    if d_teachers: differs_teachers = True

                    diff_fields = []
                    if d_date: diff_fields.append(app_config.labels["fields"]["date"])
                    if d_time: diff_fields.append(app_config.labels["fields"]["time"])
                    if d_rooms: diff_fields.append(app_config.labels["fields"]["rooms"])
                    if d_teachers: diff_fields.append(app_config.labels["fields"]["teachers"])

                    if diff_fields:
                        state_label = app_config.labels["list_separator"].join(diff_fields)
                    else:
                        state_label = app_config.labels["evaluation_page"].get("same_all", "Tout est identique")

                    processed_states_by_id[ms.class_config.id] = {
                        "state_obj": ms,
                        "d_date": d_date,
                        "d_time": d_time,
                        "d_rooms": d_rooms,
                        "d_teachers": d_teachers,
                        "state_label": state_label
                    }

                diff_cols = {
                    "date": differs_date,
                    "time": differs_time,
                    "rooms": differs_rooms,
                    "teachers": differs_teachers
                }
                total_cols = 2 + (1 if differs_date else 0) + (1 if differs_time else 0) + (1 if differs_rooms else 0) + (1 if differs_teachers else 0)

                match_states_by_program = []
                for prg in app_config.programs:
                    prog_cls_ids = [c.id for c in prg.classes if c.id != cls.id]
                    prog_item_states = [processed_states_by_id[cid] for cid in prog_cls_ids if cid in processed_states_by_id]
                    if prog_item_states:
                        match_states_by_program.append((prg, prog_item_states))

                detail_page_path = f"classes/{cls.id}/evaluations/{ev.occurrence_id}.html"
                eval_html = eval_detail_tpl.render(
                    site=app_config.site,
                    labels=app_config.labels,
                    class_config=cls,
                    sections=app_config.sections,
                    evaluation=ev,
                    match_states_by_program=match_states_by_program,
                    diff_cols=diff_cols,
                    total_cols=total_cols,
                    category_map=cat_map,
                    categories=app_config.categories,
                    favicons=active_favicons,
                    generated_at=now_str,
                    format_groups=format_groups,
                    page_wide=False,
                    url_for=lambda target, p=detail_page_path: get_rel_path(p, target)
                )
                with open(eval_dir / f"{ev.occurrence_id}.html", "w", encoding="utf-8") as f:
                    f.write(eval_html)
