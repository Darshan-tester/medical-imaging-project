"""
Test script to run the Meridian AI Worker Segmentation and Mesh pipeline
on real local CT data from D:\\ScanLab_Datasets.
"""

import sys
import os

sys.path.insert(0, os.path.abspath("."))

import json
import time

from services.ai_worker.worker import run_pipeline

def main():
    # Read manifest to get files for study 5e565c4924a7610a
    manifest_path = ".scanlab/manifest.json"
    if not os.path.exists(manifest_path):
        print("Manifest not found")
        sys.exit(1)

    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    ct = next((s for s in manifest["studies"] if s["id"] == "5e565c4924a7610a"), None)
    if not ct:
        print("CT study 5e565c4924a7610a not found in manifest")
        sys.exit(1)

    vol = list(ct["volumes"].values())[0]
    files = vol["files"]
    print(f"Loaded CT study with {len(files)} slice files.")

    # Run on a sampled subset (every 4th slice = ~140 slices) for fast verification on CPU
    sampled_files = files[::4]
    print(f"Sampling {len(sampled_files)} slices for fast CPU verification test...")

    t0 = time.time()
    result = run_pipeline(
        pipeline_name="segmentation",
        study_id="5e565c4924a7610a",
        series_id=ct["series"][0]["id"],
        input_files=sampled_files,
        modality="CT",
    )
    t1 = time.time()

    print(f"Pipeline executed in {t1 - t0:.2f} seconds.")
    print("Status:", result.get("status"))
    print("Segmented structures count:", len(result.get("segments", [])))
    for seg in result.get("segments", []):
        print(f"  - {seg['name']} ({seg['id']}): Volume = {seg['volumeMl']} ml, Diameter = {seg['maxDiameterMm']} mm")

    print("\nMeshes generated count:", len(result.get("meshes", [])))
    for m in result.get("meshes", []):
        print(f"  - {m['name']}: {m['vertexCount']} vertices, {m['faceCount']} faces -> {m['meshPath']}")

if __name__ == "__main__":
    main()
