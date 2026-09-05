from typing import Optional
from .models import ClassConfig

def build_chamilo_url(module_data: dict, chamilo_config: dict) -> Optional[str]:
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
    raw_modules = curriculum_data.get("modules", [])
    module_dict = {m["code"]: m for m in raw_modules if "code" in m}
    coeffs_data = curriculum_data.get("coefficients", {})
    all_units = curriculum_data.get("units", [])

    for track in ["cy", "dc"]:
        for status in ["fi", "fa"]:
            track_status_coeffs = coeffs_data.get(track, {}).get(status, {})

            for code in track_status_coeffs.keys():
                if code not in module_dict:
                    raise ValueError(f"Orphan coefficient key '{code}' for track '{track}', status '{status}' not found in declared modules")

            class_modules = [
                m for m in raw_modules
                if m.get("graded", True) and m.get("kind") in ("resource", "sae") and track in m.get("tracks", []) and status in m.get("statuses", [])
            ]
            for m in class_modules:
                code = m["code"]
                if code not in track_status_coeffs or not track_status_coeffs[code]:
                    raise ValueError(f"Graded module '{code}' has no coefficients for track '{track}', status '{status}'")

            track_units = [u for u in all_units if track in u.get("tracks", [])]
            for u in track_units:
                u_id = u["id"]
                has_coeff = False
                for code, u_map in track_status_coeffs.items():
                    if u_map.get(u_id) is not None and u_map.get(u_id) > 0:
                        has_coeff = True
                        break
                if not has_coeff:
                    raise ValueError(f"Unit '{u_id}' receives no coefficients for track '{track}', status '{status}'")

def get_class_resources(class_config: ClassConfig, curriculum_data: dict, chamilo_config: dict, labels: dict) -> list[tuple[dict, list[tuple[dict, list[dict]]]]]:
    semesters = curriculum_data.get("semesters", [])
    kinds = curriculum_data.get("kinds", [])
    modules = curriculum_data.get("modules", [])

    filtered_modules = []
    for m in modules:
        if class_config.track in m.get("tracks", []) and class_config.status in m.get("statuses", []):
            chamilo_url = build_chamilo_url(m, chamilo_config)
            mod_copy = dict(m)
            mod_copy["chamilo_url"] = chamilo_url
            filtered_modules.append(mod_copy)

    semester_labels = {s["id"]: s["label"] for s in semesters}
    kind_labels = {k["id"]: k["label"] for k in kinds}

    result = []
    for sem in semesters:
        sem_id = sem["id"]
        sem_modules = [m for m in filtered_modules if m.get("semester") == sem_id and m.get("kind") in ("resource", "sae")]
        if not sem_modules:
            continue

        sem_info = {"id": sem_id, "label": semester_labels.get(sem_id, sem_id)}
        kinds_grouped = []
        for k_id in ["resource", "sae"]:
            k_modules = [m for m in sem_modules if m.get("kind") == k_id]
            if not k_modules:
                continue

            k_modules.sort(key=lambda x: x["code"])
            k_info = {"id": k_id, "label": kind_labels.get(k_id, k_id)}
            kinds_grouped.append((k_info, k_modules))

        if kinds_grouped:
            result.append((sem_info, kinds_grouped))

    comp_modules = [m for m in filtered_modules if m.get("kind") == "complementary" or m.get("semester") is None]
    if comp_modules:
        comp_modules.sort(key=lambda x: x["code"])
        comp_label = labels.get("resources", {}).get("no_semester", "Complémentaires")
        comp_sem_info = {"id": "complementary", "label": comp_label}
        comp_kind_info = {"id": "complementary", "label": ""}
        result.append((comp_sem_info, [(comp_kind_info, comp_modules)]))

    return result

def get_class_grades_data(class_config: ClassConfig, curriculum_data: dict, labels: dict) -> dict:
    validate_curriculum_config(curriculum_data)

    track = class_config.track
    status = class_config.status
    coeffs_map = curriculum_data.get("coefficients", {}).get(track, {}).get(status, {})
    all_units = curriculum_data.get("units", [])
    annual_units = curriculum_data.get("annual_units", [])
    semesters = curriculum_data.get("semesters", [])
    raw_modules = curriculum_data.get("modules", [])
    module_dict = {m["code"]: m for m in raw_modules if "code" in m}

    semesters_data = []
    kind_order = {"resource": 1, "sae": 2, "complementary": 3}

    for sem in semesters:
        sem_id = sem["id"]
        sem_units = [u for u in all_units if u["semester"] == sem_id and track in u.get("tracks", [])]

        sem_mods = [
            module_dict[code] for code in coeffs_map.keys()
            if code in module_dict and module_dict[code].get("semester") == sem_id
        ]
        sem_mods.sort(key=lambda x: (kind_order.get(x.get("kind"), 4), x["code"]))

        subjects = []
        for m in sem_mods:
            code = m["code"]
            subj_coeffs = coeffs_map[code]
            coeffs_by_unit = {}
            for u in sem_units:
                u_id = u["id"]
                coeffs_by_unit[u_id] = subj_coeffs.get(u_id, None)

            subjects.append({
                "code": code,
                "label": m["label"],
                "kind": m.get("kind"),
                "coeffs": coeffs_by_unit
            })

        semesters_data.append({
            "id": sem_id,
            "label": sem["label"],
            "units": sem_units,
            "subjects": subjects
        })

    annual_units_data = []
    for au in annual_units:
        if "tracks" in au and track not in au["tracks"]:
            continue

        au_id = au["id"]
        s5_u = next((u for u in all_units if u["semester"] == "s5" and u.get("annual") == au_id and track in u.get("tracks", [])), None)
        s6_u = next((u for u in all_units if u["semester"] == "s6" and u.get("annual") == au_id and track in u.get("tracks", [])), None)

        if s5_u or s6_u:
            annual_units_data.append({
                "id": au_id,
                "label": au["label"],
                "s5_unit_id": s5_u["id"] if s5_u else None,
                "s6_unit_id": s6_u["id"] if s6_u else None,
                "s5_weight": s5_u.get("weight", 1) if s5_u else 0,
                "s6_weight": s6_u.get("weight", 1) if s6_u else 0
            })

    return {
        "semesters": semesters_data,
        "annual_units": annual_units_data,
        "coefficients_raw": coeffs_map
    }
