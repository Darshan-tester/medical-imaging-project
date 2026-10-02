"""
Asynchronous AI Job Manager and Cache Engine for Meridian.
Manages job states (queued, preparing, running, completed, failed, cancelled),
progress, stages, and SHA-256 caching of derived anatomical outputs.
"""

from __future__ import annotations

import os
import sys
import json
import time
import hashlib
import threading
from pathlib import Path
from typing import Dict, Any, List, Optional
from dataclasses import dataclass, asdict

from .outputs.manifest import get_derived_root, get_study_derived_dir, read_study_manifest


JOBS_DIR = get_derived_root() / ".jobs"
JOBS_DIR.mkdir(parents=True, exist_ok=True)
_LOCK = threading.Lock()


def compute_cache_key(study_uid: str, series_uid: str, pipeline: str, model_version: str = "2.0.0") -> str:
    """
    Computes deterministic SHA256 processing cache key (Section 25).
    """
    raw_key = f"{study_uid}:{series_uid}:{pipeline}:{model_version}:v1"
    return hashlib.sha256(raw_key.encode("utf-8")).hexdigest()[:16]


@dataclass
class JobRecord:
    jobId: str
    studyId: str
    seriesId: str
    pipeline: str
    status: str  # "queued" | "preparing" | "running" | "completed" | "failed" | "cancelled"
    progress: int  # 0 to 100
    stage: str
    cacheKey: str
    createdAt: str
    updatedAt: str
    startedAt: Optional[str] = None
    completedAt: Optional[str] = None
    processingTimeMs: int = 0
    error: Optional[str] = None
    result: Optional[Dict[str, Any]] = None
    options: Optional[Dict[str, Any]] = None


class JobManager:
    @staticmethod
    def create_job(
        study_id: str,
        series_id: str,
        pipeline: str,
        options: Optional[Dict[str, Any]] = None,
    ) -> JobRecord:
        """
        Creates and persists a new job record.
        """
        job_id = f"job-{int(time.time())}-{hashlib.md5(f'{study_id}:{pipeline}:{time.time()}'.encode()).hexdigest()[:6]}"
        cache_key = compute_cache_key(study_id, series_id, pipeline)
        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

        # Check if study is already processed
        cached_manifest = read_study_manifest(study_id)
        if cached_manifest and cached_manifest.get("status") == "completed" and pipeline == "segmentation":
            # Cache hit: instantaneous completion
            rec = JobRecord(
                jobId=job_id,
                studyId=study_id,
                seriesId=series_id,
                pipeline=pipeline,
                status="completed",
                progress=100,
                stage="cached_output_ready",
                cacheKey=cache_key,
                createdAt=now,
                updatedAt=now,
                startedAt=now,
                completedAt=now,
                processingTimeMs=0,
                result=cached_manifest,
                options=options or {},
            )
            JobManager._save_job(rec)
            return rec

        rec = JobRecord(
            jobId=job_id,
            studyId=study_id,
            seriesId=series_id,
            pipeline=pipeline,
            status="queued",
            progress=0,
            stage="queued_in_worker",
            cacheKey=cache_key,
            createdAt=now,
            updatedAt=now,
            options=options or {},
        )
        JobManager._save_job(rec)
        return rec

    @staticmethod
    def get_job(job_id: str) -> Optional[JobRecord]:
        job_file = JOBS_DIR / f"{job_id}.json"
        if not job_file.exists():
            return None
        with _LOCK:
            try:
                with open(job_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    valid_keys = set(JobRecord.__dataclass_fields__.keys())
                    filtered = {k: v for k, v in data.items() if k in valid_keys}
                    return JobRecord(**filtered)
            except Exception:
                return None

    @staticmethod
    def list_jobs(study_id: Optional[str] = None) -> List[JobRecord]:
        jobs = []
        valid_keys = set(JobRecord.__dataclass_fields__.keys())
        with _LOCK:
            for p in JOBS_DIR.glob("*.json"):
                try:
                    with open(p, "r", encoding="utf-8") as f:
                        data = json.load(f)
                        if study_id is None or data.get("studyId") == study_id:
                            filtered = {k: v for k, v in data.items() if k in valid_keys}
                            jobs.append(JobRecord(**filtered))
                except Exception:
                    pass
        jobs.sort(key=lambda j: j.createdAt, reverse=True)
        return jobs

    @staticmethod
    def update_job(
        job_id: str,
        status: Optional[str] = None,
        progress: Optional[int] = None,
        stage: Optional[str] = None,
        error: Optional[str] = None,
        result: Optional[Dict[str, Any]] = None,
    ) -> Optional[JobRecord]:
        rec = JobManager.get_job(job_id)
        if not rec:
            return None

        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        rec.updatedAt = now

        if status:
            rec.status = status
            if status == "running" and not rec.startedAt:
                rec.startedAt = now
            elif status in ("completed", "failed", "cancelled"):
                rec.completedAt = now
                if rec.startedAt:
                    try:
                        t0 = time.mktime(time.strptime(rec.startedAt, "%Y-%m-%dT%H:%M:%SZ"))
                        t1 = time.time()
                        rec.processingTimeMs = int((t1 - t0) * 1000)
                    except Exception:
                        pass

        if progress is not None:
            rec.progress = max(0, min(100, progress))
        if stage:
            rec.stage = stage
        if error:
            rec.error = error
        if result:
            rec.result = result

        JobManager._save_job(rec)
        return rec

    @staticmethod
    def _save_job(rec: JobRecord):
        job_file = JOBS_DIR / f"{rec.jobId}.json"
        with _LOCK:
            with open(job_file, "w", encoding="utf-8") as f:
                json.dump(asdict(rec), f, indent=2)
