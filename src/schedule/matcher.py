from dataclasses import replace
from datetime import datetime
from typing import Dict, List
from .models import Evaluation, ClassConfig, ClassMatchState, slugify
from .config import AppConfig

def reconcile_shared_groups(
    events_by_class: Dict[str, List[Evaluation]],
    all_classes: List[ClassConfig]
) -> Dict[str, List[Evaluation]]:
    cls_map = {cls.id: cls.label for cls in all_classes}
    slot_classes = {}
    for cls_id, ev_list in events_by_class.items():
        cls_label = cls_map.get(cls_id, cls_id)
        for ev in ev_list:
            slot_key = (ev.start_dt, ev.end_dt, ev.summary.strip())
            if slot_key not in slot_classes:
                slot_classes[slot_key] = set()
            slot_classes[slot_key].add(cls_label)

    updated_events_by_class = {}
    for cls_id, ev_list in events_by_class.items():
        updated_list = []
        for ev in ev_list:
            slot_key = (ev.start_dt, ev.end_dt, ev.summary.strip())
            shared = slot_classes.get(slot_key, set())
            merged_groups = set(ev.groups).union(shared)
            sorted_groups = tuple(sorted(merged_groups))
            if sorted_groups != ev.groups:
                updated_list.append(replace(ev, groups=sorted_groups))
            else:
                updated_list.append(ev)
        updated_events_by_class[cls_id] = updated_list
    return updated_events_by_class

def build_matching_matrix(
    all_evaluations_by_class: Dict[str, List[Evaluation]],
    all_classes: List[ClassConfig],
    app_config: AppConfig
) -> Dict[str, List[ClassMatchState]]:
    window_days = app_config.site["matching"]["alternate_date_window_days"]

    unique_occurrences: Dict[str, Evaluation] = {}
    evals_by_slug_and_class: Dict[str, Dict[str, List[Evaluation]]] = {}

    for cls_id, evals in all_evaluations_by_class.items():
        for ev in evals:
            if ev.occurrence_id not in unique_occurrences:
                unique_occurrences[ev.occurrence_id] = ev

            t_slug = slugify(ev.summary)
            if t_slug not in evals_by_slug_and_class:
                evals_by_slug_and_class[t_slug] = {}
            if cls_id not in evals_by_slug_and_class[t_slug]:
                evals_by_slug_and_class[t_slug][cls_id] = []
            evals_by_slug_and_class[t_slug][cls_id].append(ev)

    matrix: Dict[str, List[ClassMatchState]] = {}

    for occ_id, base_ev in unique_occurrences.items():
        t_slug = slugify(base_ev.summary)
        base_date = base_ev.start_dt.date()

        match_states = []

        for cls in all_classes:
            cls_evals = evals_by_slug_and_class.get(t_slug, {}).get(cls.id, [])

            same_match = None
            for ev in cls_evals:
                if ev.date_iso == base_ev.date_iso:
                    same_match = ev
                    break

            if same_match is not None:
                match_states.append(ClassMatchState(
                    class_config=cls,
                    status="same",
                    evaluation=same_match,
                    alternate_date_iso=None,
                    alternate_date_formatted=None
                ))
            else:
                alt_match = None
                for ev in cls_evals:
                    diff_days = abs((ev.start_dt.date() - base_date).days)
                    if diff_days <= window_days:
                        alt_match = ev
                        break

                if alt_match is not None:
                    match_states.append(ClassMatchState(
                        class_config=cls,
                        status="alternate",
                        evaluation=alt_match,
                        alternate_date_iso=alt_match.date_iso,
                        alternate_date_formatted=alt_match.date_formatted
                    ))
                else:
                    match_states.append(ClassMatchState(
                        class_config=cls,
                        status="absent",
                        evaluation=None,
                        alternate_date_iso=None,
                        alternate_date_formatted=None
                    ))

        matrix[occ_id] = match_states

    return matrix
