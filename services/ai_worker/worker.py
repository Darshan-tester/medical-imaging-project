"""
Meridian AI Worker Service Executable.
Handles job dispatch, pipeline execution, CLI commands, and worker daemon loop.
"""

from __future__ import annotations

import os
import sys
import json
import time
import argparse
from pathlib import Path
from typing import Dict, Any, List, Optional

from .hardware import detect_hardware
from .jobs import JobManager, JobRecord
from .pipelines.segmentation import SegmentationPipeline
from .pipelines.registration import RegistrationPipeline
from .pipelines.longitudinal import LongitudinalPipeline
from .pipelines.motion import MotionPipeline
from .pipelines.qc import AnatomicalQCPipeline


def run_pipeline(
    pipeline_name: str,
    study_id: str,
    series_id: str = "",
    input_files: Optional[List[str]] = None,
    modality: str = "CT",
    prior_study_id: Optional[str] = None,
    prior_files: Optional[List[str]] = None,
    findings: Optional[List[Dict[str, Any]]] = None,
    job_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Executes the specified pipeline with progress updates to JobManager.
    """
    input_files = input_files or []
    hw = detect_hardware()

    def progress_cb(stage: str, pct: int, msg: str = ""):
        if job_id:
            JobManager.update_job(job_id, status="running", progress=pct, stage=f"{stage}: {msg}")

    if job_id:
        JobManager.update_job(job_id, status="running", progress=5, stage="initializing_pipeline")

    try:
        if pipeline_name in ("segmentation", "heart", "lungs", "brain", "all"):
            pipeline = SegmentationPipeline(hw)
            result = pipeline.run(
                study_id=study_id,
                series_id=series_id,
                input_files=input_files,
                modality=modality,
                progress_cb=progress_cb,
            )
        elif pipeline_name == "registration":
            if not prior_study_id or not prior_files:
                raise ValueError("Prior study ID and prior files must be provided for registration")
            pipeline = RegistrationPipeline(hw)
            result = pipeline.run(
                current_study_id=study_id,
                current_files=input_files,
                prior_study_id=prior_study_id,
                prior_files=prior_files,
                progress_cb=progress_cb,
            )
        elif pipeline_name == "longitudinal":
            pipeline = LongitudinalPipeline()
            result = pipeline.run(
                current_study_id=study_id,
                prior_study_id=prior_study_id or "",
            )
        elif pipeline_name in ("motion", "motion4d"):
            pipeline = MotionPipeline(hw)
            result = pipeline.run(
                study_id=study_id,
                series_id=series_id,
                input_files=input_files,
                progress_cb=progress_cb,
            )
        elif pipeline_name == "qc":
            pipeline = AnatomicalQCPipeline()
            result = pipeline.run(
                study_id=study_id,
                findings=findings or [],
            )
        else:
            raise ValueError(f"Unknown pipeline: '{pipeline_name}'")

        if job_id:
            JobManager.update_job(job_id, status="completed", progress=100, stage="finished", result=result)

        return result

    except Exception as e:
        err_msg = str(e)
        if job_id:
            JobManager.update_job(job_id, status="failed", stage="error", error=err_msg)
        return {
            "status": "failed",
            "studyId": study_id,
            "pipeline": pipeline_name,
            "error": err_msg,
        }


def main():
    parser = argparse.ArgumentParser(description="Meridian AI Worker Service")
    parser.add_argument("--pipeline", choices=["segmentation", "heart", "lungs", "brain", "registration", "longitudinal", "motion", "motion4d", "qc", "all", "hardware"])
    parser.add_argument("--study", default="", help="Current study ID")
    parser.add_argument("--series", default="", help="Current series ID")
    parser.add_argument("--modality", default="CT", help="Modality (CT or MRI)")
    parser.add_argument("--files", nargs="*", default=[], help="Input files")
    parser.add_argument("--files-file", default="", help="Path to JSON file containing list of input files")
    parser.add_argument("--prior-study", default="", help="Prior study ID")
    parser.add_argument("--prior-files", nargs="*", default=[], help="Prior files")
    parser.add_argument("--prior-files-file", default="", help="Path to JSON file containing list of prior files")
    parser.add_argument("--findings-json", default="", help="JSON string or path of findings for QC")
    parser.add_argument("--job-id", default="", help="Job ID if tracking asynchronously")
    parser.add_argument("--hardware", action="store_true", help="Print detected hardware info")

    args = parser.parse_args()

    if args.hardware or args.pipeline == "hardware":
        info = detect_hardware()
        print(json.dumps(info, indent=2))
        sys.exit(0)

    findings = []
    if args.findings_json:
        if os.path.exists(args.findings_json):
            with open(args.findings_json, "r", encoding="utf-8") as f:
                findings = json.load(f)
        else:
            try:
                findings = json.loads(args.findings_json)
            except Exception:
                pass

    input_files = list(args.files)
    if args.files_file and os.path.exists(args.files_file):
        try:
            with open(args.files_file, "r", encoding="utf-8") as f:
                loaded = json.load(f)
                if isinstance(loaded, list):
                    input_files = loaded
        except Exception as e:
            print(f"Warning: Failed to load files from {args.files_file}: {e}", file=sys.stderr)

    prior_files = list(args.prior_files)
    if args.prior_files_file and os.path.exists(args.prior_files_file):
        try:
            with open(args.prior_files_file, "r", encoding="utf-8") as f:
                loaded = json.load(f)
                if isinstance(loaded, list):
                    prior_files = loaded
        except Exception as e:
            print(f"Warning: Failed to load prior files from {args.prior_files_file}: {e}", file=sys.stderr)

    if not args.pipeline:
        parser.print_help()
        sys.exit(1)

    result = run_pipeline(
        pipeline_name=args.pipeline,
        study_id=args.study,
        series_id=args.series,
        input_files=input_files,
        modality=args.modality,
        prior_study_id=args.prior_study,
        prior_files=prior_files,
        findings=findings,
        job_id=args.job_id,
    )

    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
