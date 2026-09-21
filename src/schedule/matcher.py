from dataclasses import replace

from .config import AppConfig
from .models import ClassConfig, ClassMatchState, Evaluation, slugify


def reconcile_shared_groups(
    events_by_class: dict[str, list[Evaluation]], all_classes: list[ClassConfig]
) -> dict[str, list[Evaluation]]:
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
    all_evaluations_by_class: dict[str, list[Evaluation]],
    all_classes: list[ClassConfig],
    app_config: AppConfig,
) -> dict[str, list[ClassMatchState]]:
    window_days = app_config.site["matching"]["alternate_date_window_days"]

    unique_occurrences: dict[str, Evaluation] = {}
    evals_by_slug_and_class: dict[str, dict[str, list[Evaluation]]] = {}

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

    matrix: dict[str, list[ClassMatchState]] = {}

    for occ_id, base_ev in unique_occurrences.items():
        t_slug = slugify(base_ev.summary)
        base_date = base_ev.start_dt.date()

        match_states = []

        for cls in all_classes:
            cls_evals = evals_by_slug_and_class.get(t_slug, {}).get(cls.id, [])

            same_candidates = [ev for ev in cls_evals if ev.date_iso == base_ev.date_iso]
            same_match = min(
                same_candidates,
                key=lambda ev: (
                    ev.occurrence_id != base_ev.occurrence_id,
                    abs((ev.start_dt - base_ev.start_dt).total_seconds()),
                    abs((ev.end_dt - base_ev.end_dt).total_seconds()),
                    ev.occurrence_id,
                ),
                default=None,
            )

            if same_match is not None:
                match_states.append(
                    ClassMatchState(
                        class_config=cls,
                        status="same",
                        evaluation=same_match,
                        alternate_date_iso=None,
                        alternate_date_formatted=None,
                    )
                )
            else:
                candidates = [
                    ev
                    for ev in cls_evals
                    if abs((ev.start_dt.date() - base_date).days) <= window_days
                ]
                alt_match = min(
                    candidates,
                    key=lambda ev: (
                        abs((ev.start_dt - base_ev.start_dt).total_seconds()),
                        ev.start_dt,
                        ev.occurrence_id,
                    ),
                    default=None,
                )

                if alt_match is not None:
                    match_states.append(
                        ClassMatchState(
                            class_config=cls,
                            status="alternate",
                            evaluation=alt_match,
                            alternate_date_iso=alt_match.date_iso,
                            alternate_date_formatted=alt_match.date_formatted,
                        )
                    )
                else:
                    match_states.append(
                        ClassMatchState(
                            class_config=cls,
                            status="absent",
                            evaluation=None,
                            alternate_date_iso=None,
                            alternate_date_formatted=None,
                        )
                    )

        matrix[occ_id] = match_states

    return matrix
