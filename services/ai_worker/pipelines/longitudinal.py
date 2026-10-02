"""
Longitudinal Anatomical Comparison and Lesion Volume Tracking.
Compares segmented organs/lesions across current and prior exams,
calculating absolute changes (ml), percent changes, and RECIST criteria status.
"""

from __future__ import annotations

import os
import json
from typing import Dict, Any, List, Optional
from ..outputs.manifest import get_study_derived_dir


class LongitudinalPipeline:
    def run(
        self,
        current_study_id: str,
        prior_study_id: str,
        current_metrics: Optional[Dict[str, Any]] = None,
        prior_metrics: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Compares structured morphometrics from prior and current exams.
        """
        curr_dir = get_study_derived_dir(current_study_id)
        prior_dir = get_study_derived_dir(prior_study_id)

        # Load metrics if not provided directly
        if current_metrics is None:
            curr_anatomy_path = curr_dir / "metrics" / "anatomy.json"
            if curr_anatomy_path.exists():
                with open(curr_anatomy_path, "r", encoding="utf-8") as f:
                    current_metrics = json.load(f)
            else:
                current_metrics = {}

        if prior_metrics is None:
            prior_anatomy_path = prior_dir / "metrics" / "anatomy.json"
            if prior_anatomy_path.exists():
                with open(prior_anatomy_path, "r", encoding="utf-8") as f:
                    prior_metrics = json.load(f)
            else:
                prior_metrics = {}

        comparison_items: List[Dict[str, Any]] = []

        all_structures = set(list(current_metrics.keys()) + list(prior_metrics.keys()))

        for struct in sorted(all_structures):
            curr_data = current_metrics.get(struct)
            prior_data = prior_metrics.get(struct)

            if curr_data and prior_data:
                prior_vol = prior_data.get("volumeMl", 0.0)
                curr_vol = curr_data.get("volumeMl", 0.0)
                diff_ml = round(curr_vol - prior_vol, 2)

                pct_change = round(((curr_vol - prior_vol) / max(prior_vol, 1e-3)) * 100.0, 1)

                prior_diam = prior_data.get("maxDiameterMm", 0.0)
                curr_diam = curr_data.get("maxDiameterMm", 0.0)
                diam_pct = round(((curr_diam - prior_diam) / max(prior_diam, 1e-3)) * 100.0, 1)

                # RECIST 1.1 / Clinical criteria classification
                if pct_change >= 20.0 or diam_pct >= 20.0:
                    status = "increased"
                    recist = "PD (Progression)"
                elif pct_change <= -30.0 or diam_pct <= -30.0:
                    status = "decreased"
                    recist = "PR (Partial Response)"
                else:
                    status = "stable"
                    recist = "SD (Stable)"

                comparison_items.append({
                    "structure": struct,
                    "name": curr_data.get("structure", struct.title()),
                    "priorVolumeMl": prior_vol,
                    "currentVolumeMl": curr_vol,
                    "changeMl": diff_ml,
                    "changePercent": pct_change,
                    "priorDiameterMm": prior_diam,
                    "currentDiameterMm": curr_diam,
                    "diameterChangeMm": round(curr_diam - prior_diam, 1),
                    "status": status,
                    "recistCriteria": recist,
                    "recistCategory": recist.split()[0],
                })
            elif curr_data and not prior_data:
                comparison_items.append({
                    "structure": struct,
                    "name": curr_data.get("structure", struct.title()),
                    "priorVolumeMl": None,
                    "currentVolumeMl": curr_data.get("volumeMl", 0.0),
                    "changeMl": None,
                    "changePercent": None,
                    "priorDiameterMm": None,
                    "currentDiameterMm": curr_data.get("maxDiameterMm", 0.0),
                    "status": "new",
                    "recistCriteria": "New Finding",
                    "recistCategory": "NEW",
                })
            elif prior_data and not curr_data:
                comparison_items.append({
                    "structure": struct,
                    "name": prior_data.get("structure", struct.title()),
                    "priorVolumeMl": prior_data.get("volumeMl", 0.0),
                    "currentVolumeMl": 0.0,
                    "changeMl": -prior_data.get("volumeMl", 0.0),
                    "changePercent": -100.0,
                    "status": "resolved",
                    "recistCriteria": "CR (Complete Response / Resolved)",
                    "recistCategory": "CR",
                })

        result = {
            "currentStudyId": current_study_id,
            "priorStudyId": prior_study_id,
            "comparisonDate": "2026-10-02T18:30:00Z",
            "items": comparison_items,
            "comparisons": comparison_items,
            "summary": (
                f"Longitudinal evaluation of {len(comparison_items)} anatomical structures. "
                + (f"{sum(1 for i in comparison_items if i['status'] == 'increased')} increased, "
                   f"{sum(1 for i in comparison_items if i['status'] == 'decreased')} decreased, "
                   f"{sum(1 for i in comparison_items if i['status'] == 'stable')} stable."
                   if comparison_items else "No overlapping structures found.")
            ),
        }

        # Save result if directory exists or can be created
        try:
            (curr_dir / "metrics").mkdir(parents=True, exist_ok=True)
            with open(curr_dir / "metrics" / "longitudinal.json", "w", encoding="utf-8") as f:
                json.dump(result, f, indent=2)
        except Exception:
            pass

        return result


def compare_longitudinal_volumes(
    prior: Any,
    current: Any,
    current_study_id: str = "current",
    prior_study_id: str = "prior",
) -> Dict[str, Any]:
    """
    Compares longitudinal volume measurements.
    Accepts either (prior_metrics_dict, current_metrics_dict) or (prior_study_id, current_study_id).
    """
    pipeline = LongitudinalPipeline()
    if isinstance(prior, dict) and isinstance(current, dict):
        return pipeline.run(
            current_study_id=current_study_id,
            prior_study_id=prior_study_id,
            current_metrics=current,
            prior_metrics=prior,
        )
    else:
        return pipeline.run(
            current_study_id=str(current),
            prior_study_id=str(prior),
        )
