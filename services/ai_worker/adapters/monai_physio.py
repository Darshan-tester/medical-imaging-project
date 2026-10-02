"""
MONAI Physio Taxonomy and Anatomy Model Adapter.
Encapsulates anatomical hierarchies, structure definitions, colors,
and physiological metrics definitions from Project-MONAI/monai-physio.
"""

from __future__ import annotations

from typing import Dict, List, Any, Optional
from dataclasses import dataclass, field


@dataclass
class OrganDefinition:
    label_id: int
    name: str
    group: str
    color_hex: str
    color_rgb: List[float]  # 0.0 to 1.0
    opacity: float
    description: str


# Core anatomical taxonomy aligned with MONAI Physio / TotalSegmentator
TAXONOMY_MAP: Dict[str, OrganDefinition] = {
    # Lung structures
    "lung_left": OrganDefinition(
        label_id=1,
        name="Left Lung",
        group="lung",
        color_hex="#38BDF8",
        color_rgb=[0.22, 0.74, 0.97],
        opacity=0.35,
        description="Left lung parenchyma including upper and lower lobes",
    ),
    "lung_right": OrganDefinition(
        label_id=2,
        name="Right Lung",
        group="lung",
        color_hex="#0EA5E9",
        color_rgb=[0.05, 0.65, 0.91],
        opacity=0.35,
        description="Right lung parenchyma including upper, middle, and lower lobes",
    ),
    "airways": OrganDefinition(
        label_id=3,
        name="Trachea & Airways",
        group="lung",
        color_hex="#67E8F9",
        color_rgb=[0.40, 0.91, 0.98],
        opacity=0.85,
        description="Tracheobronchial tree",
    ),

    # Cardiovascular structures
    "heart": OrganDefinition(
        label_id=4,
        name="Heart",
        group="heart",
        color_hex="#F43F5E",
        color_rgb=[0.96, 0.25, 0.37],
        opacity=0.60,
        description="Cardiac muscle and chambers",
    ),
    "left_ventricle": OrganDefinition(
        label_id=5,
        name="Left Ventricle",
        group="heart",
        color_hex="#E11D48",
        color_rgb=[0.88, 0.11, 0.28],
        opacity=0.75,
        description="Left ventricular cavity for EDV/ESV/LVEF assessment",
    ),
    "right_ventricle": OrganDefinition(
        label_id=6,
        name="Right Ventricle",
        group="heart",
        color_hex="#BE123C",
        color_rgb=[0.75, 0.07, 0.24],
        opacity=0.75,
        description="Right ventricular chamber",
    ),
    "aorta": OrganDefinition(
        label_id=7,
        name="Aorta",
        group="major_vessels",
        color_hex="#EF4444",
        color_rgb=[0.94, 0.27, 0.27],
        opacity=0.80,
        description="Ascending aorta, aortic arch, and descending thoracic aorta",
    ),
    "pulmonary_artery": OrganDefinition(
        label_id=8,
        name="Pulmonary Artery",
        group="major_vessels",
        color_hex="#3B82F6",
        color_rgb=[0.23, 0.51, 0.96],
        opacity=0.75,
        description="Main and branch pulmonary arteries",
    ),

    # Abdominal Organs
    "liver": OrganDefinition(
        label_id=9,
        name="Liver",
        group="abdominal",
        color_hex="#F59E0B",
        color_rgb=[0.96, 0.62, 0.04],
        opacity=0.65,
        description="Hepatic parenchyma",
    ),
    "spleen": OrganDefinition(
        label_id=10,
        name="Spleen",
        group="abdominal",
        color_hex="#8B5CF6",
        color_rgb=[0.55, 0.36, 0.96],
        opacity=0.65,
        description="Splenic tissue",
    ),
    "kidney_left": OrganDefinition(
        label_id=11,
        name="Left Kidney",
        group="abdominal",
        color_hex="#10B981",
        color_rgb=[0.06, 0.73, 0.51],
        opacity=0.70,
        description="Left renal parenchyma",
    ),
    "kidney_right": OrganDefinition(
        label_id=12,
        name="Right Kidney",
        group="abdominal",
        color_hex="#059669",
        color_rgb=[0.02, 0.59, 0.41],
        opacity=0.70,
        description="Right renal parenchyma",
    ),

    # Skeletal structures
    "spine_ribs": OrganDefinition(
        label_id=13,
        name="Thoracic Skeleton & Spine",
        group="bone",
        color_hex="#E2E8F0",
        color_rgb=[0.89, 0.91, 0.94],
        opacity=0.85,
        description="Vertebrae, ribs, sternum, and shoulder girdle",
    ),
}


def get_taxonomy_summary() -> List[Dict[str, Any]]:
    """Returns a list of all anatomical structures supported by the pipeline."""
    return [
        {
            "id": k,
            "labelId": v.label_id,
            "name": v.name,
            "group": v.group,
            "color": v.color_hex,
            "opacity": v.opacity,
            "description": v.description,
        }
        for k, v in TAXONOMY_MAP.items()
    ]
