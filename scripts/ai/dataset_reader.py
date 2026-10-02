"""
=============================================================================
MERIDIAN SCANLAB AI — DATASET READER & LOADER
=============================================================================
Directly interfaces with D:\\ScanLab_Datasets:
- Chest X-Ray: MIMIC-CXR parquet datasets (30,633 paired cases)
- MRI: MR-RATE / brain & knee multi-sequence scans
- CT: Thoracic and abdominal volumetric DICOM series
- PET: Whole-body PETWB-REP NIfTI volumes with SUV metrics
=============================================================================
"""

import os
import io
import json
import pandas as pd
from PIL import Image

DATASET_ROOT = os.environ.get("SCANLAB_DATA_ROOT", r"D:\ScanLab_Datasets")

class ScanLabDatasetReader:
    def __init__(self, root_dir=DATASET_ROOT):
        self.root_dir = root_dir
        self.cxr_data_dir = os.path.join(root_dir, "01_CHEST_XRAY", "MIMIC-CXR", "data")
        self.mri_data_dir = os.path.join(root_dir, "03_MRI", "batch26")
        self.ct_data_dir = os.path.join(root_dir, "02_CT")
        self.pet_data_dir = os.path.join(root_dir, "06_PET", "raw", "PETWB-REP")

    def get_cxr_parquet_files(self):
        if not os.path.exists(self.cxr_data_dir):
            return []
        return sorted([
            os.path.join(self.cxr_data_dir, f)
            for f in os.listdir(self.cxr_data_dir)
            if f.endswith(".parquet")
        ])

    def load_cxr_samples(self, split="train", limit=100):
        """
        Loads paired image bytes and reports from MIMIC-CXR parquet files.
        """
        files = self.get_cxr_parquet_files()
        target_files = [f for f in files if split in os.path.basename(f)]
        if not target_files:
            target_files = files

        samples = []
        for file_path in target_files:
            df = pd.read_parquet(file_path)
            for idx, row in df.iterrows():
                try:
                    img_data = row["image"]
                    img_bytes = img_data["bytes"]
                    report_text = str(row.get("reports", ""))
                    samples.append({
                        "case_id": f"CXR-{idx:05d}",
                        "image_bytes": img_bytes,
                        "report": report_text,
                        "source": os.path.basename(file_path),
                    })
                    if len(samples) >= limit:
                        return samples
                except Exception as e:
                    continue
        return samples

    def get_pet_summary(self):
        mapping_file = os.path.join(self.pet_data_dir, "PETWB-REP_master_mapping.csv")
        if os.path.exists(mapping_file):
            return pd.read_csv(mapping_file)
        return None

if __name__ == "__main__":
    reader = ScanLabDatasetReader()
    print("Checking ScanLab Dataset Reader...")
    cxr_files = reader.get_cxr_parquet_files()
    print(f"Found {len(cxr_files)} CXR Parquet files in: {reader.cxr_data_dir}")
    for f in cxr_files:
        print(" -", os.path.basename(f), f"({os.path.getsize(f) / (1024*1024):.1f} MB)")
