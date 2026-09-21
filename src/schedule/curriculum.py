import math

from .models import ClassConfig


def build_chamilo_url(module_data: dict, chamilo_config: dict) -> str | None:
    if "chamilo_course" in module_data:
        course = module_data["chamilo_course"]
        if course is None:
            return None
        if course.startswith("http://") or course.startswith("https://"):
            return course
        return f"{chamilo_config['course_base_url']}{course}"

    clean_code = module_data["code"].replace(".", "").upper()
    return f"{chamilo_config['course_base_url']}{chamilo_config['course_prefix']}{clean_code}"


def validate_curriculum_config(curriculum_data: dict):
    def index_unique(key, field="id"):
        items = curriculum_data[key]
        result = {item[field]: item for item in items}
        if len(result) != len(items):
            raise ValueError(f"Duplicate {field} in {key}")
        return result

    def positive_number(value):
        return type(value) in (int, float) and math.isfinite(value) and value > 0

    modules = index_unique("modules", "code")
    units = index_unique("units")
    tracks = index_unique("tracks")
    statuses = index_unique("statuses")
    semesters = index_unique("semesters")
    kinds = index_unique("kinds")
    annual_units = index_unique("annual_units")
    coefficients = curriculum_data["coefficients"]
    for module in modules.values():
        if module["kind"] not in kinds or (
            module["semester"] is not None and module["semester"] not in semesters
        ):
            raise ValueError(f"Invalid semester or kind for {module['code']}")
        if (
            not set(module["tracks"]) <= tracks.keys()
            or not set(module["statuses"]) <= statuses.keys()
        ):
            raise ValueError(f"Invalid track or status for {module['code']}")
    annual_slots = set()
    for unit in units.values():
        if (
            unit["semester"] not in semesters
            or unit["annual"] not in annual_units
            or not set(unit["tracks"]) <= tracks.keys()
        ):
            raise ValueError(f"Invalid references for unit {unit['id']}")
        if not positive_number(unit["weight"]):
            raise ValueError(f"Invalid weight for unit {unit['id']}")
        for track in unit["tracks"]:
            if track not in annual_units[unit["annual"]].get("tracks", tracks):
                raise ValueError(f"Invalid annual track for unit {unit['id']}")
            slot = (track, unit["semester"], unit["annual"])
            if slot in annual_slots:
                raise ValueError(f"Duplicate annual unit mapping: {slot}")
            annual_slots.add(slot)
    if not coefficients.keys() <= tracks.keys():
        raise ValueError("Unknown coefficient track")
    for track in tracks:
        status_coefficients = coefficients.get(track, {})
        if not status_coefficients.keys() <= statuses.keys():
            raise ValueError(f"Unknown coefficient status for {track}")
        for status in statuses:
            selected = {
                code: module
                for code, module in modules.items()
                if module.get("graded", True)
                and track in module["tracks"]
                and status in module["statuses"]
            }
            mapping = status_coefficients.get(status, {})
            if mapping.keys() != selected.keys():
                raise ValueError(
                    f"Coefficient modules differ from graded modules for {track}/{status}: "
                    f"{mapping.keys() ^ selected.keys()}"
                )
            covered = set()
            for code, unit_coefficients in mapping.items():
                if not unit_coefficients:
                    raise ValueError(f"No coefficients for {code} in {track}/{status}")
                for unit_id, coefficient in unit_coefficients.items():
                    unit = units.get(unit_id)
                    if (
                        not unit
                        or unit["semester"] != selected[code]["semester"]
                        or track not in unit["tracks"]
                    ):
                        raise ValueError(f"Invalid unit {unit_id} for {code} in {track}/{status}")
                    if not positive_number(coefficient):
                        raise ValueError(f"Invalid coefficient for {code}/{unit_id}")
                    covered.add(unit_id)
            expected = {unit_id for unit_id, unit in units.items() if track in unit["tracks"]}
            if covered != expected:
                raise ValueError(
                    f"Units without coefficients for {track}/{status}: {expected - covered}"
                )


def get_class_resources(
    class_config: ClassConfig, curriculum_data: dict, chamilo_config: dict, labels: dict
) -> list[tuple[dict, list[tuple[dict, list[dict]]]]]:
    semesters = curriculum_data.get("semesters", [])
    kinds = curriculum_data.get("kinds", [])
    modules = curriculum_data.get("modules", [])

    semester_kinds = [kind["id"] for kind in kinds if kind["group_by_semester"]]
    filtered_modules = []
    for m in modules:
        if class_config.track in m.get("tracks", []) and class_config.status in m.get(
            "statuses", []
        ):
            chamilo_url = build_chamilo_url(m, chamilo_config)
            mod_copy = dict(m)
            mod_copy["chamilo_url"] = chamilo_url
            filtered_modules.append(mod_copy)

    semester_labels = {s["id"]: s["label"] for s in semesters}
    kind_labels = {k["id"]: k["label"] for k in kinds}

    result = []
    for sem in semesters:
        sem_id = sem["id"]
        sem_modules = [
            m
            for m in filtered_modules
            if m.get("semester") == sem_id and m.get("kind") in semester_kinds
        ]
        if not sem_modules:
            continue

        sem_info = {"id": sem_id, "label": semester_labels.get(sem_id, sem_id)}
        kinds_grouped = []
        for k_id in semester_kinds:
            k_modules = [m for m in sem_modules if m.get("kind") == k_id]
            if not k_modules:
                continue

            k_modules.sort(key=lambda x: x["code"])
            k_info = {"id": k_id, "label": kind_labels.get(k_id, k_id)}
            kinds_grouped.append((k_info, k_modules))

        if kinds_grouped:
            result.append((sem_info, kinds_grouped))

    comp_modules = [
        m
        for m in filtered_modules
        if m.get("kind") not in semester_kinds or m.get("semester") is None
    ]
    if comp_modules:
        comp_modules.sort(key=lambda x: x["code"])
        comp_label = labels["resources"]["no_semester"]
        comp_sem_info = {"id": "complementary", "label": comp_label}
        comp_kind_info = {"id": "complementary", "label": ""}
        result.append((comp_sem_info, [(comp_kind_info, comp_modules)]))

    return result


def get_class_grades_data(class_config: ClassConfig, curriculum_data: dict, labels: dict) -> dict:
    track = class_config.track
    status = class_config.status
    coeffs_map = curriculum_data.get("coefficients", {}).get(track, {}).get(status, {})
    all_units = curriculum_data.get("units", [])
    annual_units = curriculum_data.get("annual_units", [])
    semesters = curriculum_data.get("semesters", [])
    raw_modules = curriculum_data.get("modules", [])
    module_dict = {m["code"]: m for m in raw_modules if "code" in m}

    semesters_data = []
    kind_order = {kind["id"]: index for index, kind in enumerate(curriculum_data["kinds"])}

    for sem in semesters:
        sem_id = sem["id"]
        sem_units = [
            u for u in all_units if u["semester"] == sem_id and track in u.get("tracks", [])
        ]

        sem_mods = [
            module_dict[code]
            for code in coeffs_map.keys()
            if code in module_dict and module_dict[code].get("semester") == sem_id
        ]
        sem_mods.sort(key=lambda x: (kind_order[x["kind"]], x["code"]))

        subjects = []
        for m in sem_mods:
            code = m["code"]
            subj_coeffs = coeffs_map[code]
            coeffs_by_unit = {}
            for u in sem_units:
                u_id = u["id"]
                coeffs_by_unit[u_id] = subj_coeffs.get(u_id, None)

            subjects.append(
                {"code": code, "label": m["label"], "kind": m.get("kind"), "coeffs": coeffs_by_unit}
            )

        semesters_data.append(
            {
                "id": sem_id,
                "label": sem["label"],
                "short_label": sem["short_label"],
                "units": sem_units,
                "subjects": subjects,
            }
        )

    annual_units_data = []
    for au in annual_units:
        if "tracks" in au and track not in au["tracks"]:
            continue

        au_id = au["id"]
        semester_units = {
            sem["id"]: next(
                (
                    u
                    for u in all_units
                    if u["semester"] == sem["id"]
                    and u.get("annual") == au_id
                    and track in u["tracks"]
                ),
                None,
            )
            for sem in semesters
        }
        if any(semester_units.values()):
            annual_units_data.append(
                {
                    "id": au_id,
                    "label": au["label"],
                    "units": {
                        sem_id: unit["id"] for sem_id, unit in semester_units.items() if unit
                    },
                    "weight": next(unit["weight"] for unit in semester_units.values() if unit),
                }
            )

    return {
        "semesters": semesters_data,
        "annual_units": annual_units_data,
        "coefficients_raw": coeffs_map,
    }
