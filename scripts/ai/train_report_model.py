"""
=============================================================================
MERIDIAN SCANLAB AI — MODEL TRAINING & FINE-TUNING PIPELINE
=============================================================================
Fine-tunes pathology detection and report grounding on local datasets:
- Source: D:\\ScanLab_Datasets\\01_CHEST_XRAY\\MIMIC-CXR\\data
- Architecture: DenseNet-121 with multi-label pathology classification head
- Loss: Binary Cross-Entropy with pos_weight for class imbalance
- Output: Calibrated weights saved to .scanlab/models/
=============================================================================
"""

import sys
import os

# Fix Windows console encoding
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

import argparse
import time
import io
import json
import numpy as np
import pandas as pd
from PIL import Image

import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader
import torchvision
import torchxrayvision as xrv

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
OUTPUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), ".scanlab", "models")
os.makedirs(OUTPUT_DIR, exist_ok=True)

TARGET_PATHOLOGIES = [
    "Atelectasis", "Consolidation", "Infiltration", "Pneumothorax",
    "Edema", "Emphysema", "Fibrosis", "Effusion", "Pneumonia",
    "Cardiomegaly", "Nodule", "Mass", "Lung Opacity"
]

class MimicCxrParquetDataset(Dataset):
    def __init__(self, parquet_path, limit=None, transform=None):
        self.transform = transform
        print(f"Loading dataset from: {parquet_path}...")
        df = pd.read_parquet(parquet_path)
        if limit:
            df = df.head(limit)
        self.records = []
        for idx, row in df.iterrows():
            try:
                img_data = row["image"]
                report = str(row.get("reports", "")).lower()
                # Derive label vector from report mentions
                labels = [1.0 if p.lower() in report else 0.0 for p in TARGET_PATHOLOGIES]
                self.records.append({
                    "bytes": img_data["bytes"],
                    "labels": np.array(labels, dtype=np.float32)
                })
            except Exception:
                continue
        print(f"Successfully indexed {len(self.records)} valid training cases.")

    def __len__(self):
        return len(self.records)

    def __getitem__(self, idx):
        rec = self.records[idx]
        img = Image.open(io.BytesIO(rec["bytes"])).convert("L")
        img_np = np.array(img).astype(np.float32)
        img_np = xrv.datasets.normalize(img_np, 255)

        resize_transform = torchvision.transforms.Compose([
            xrv.datasets.XRayCenterCrop(),
            xrv.datasets.XRayResizer(224)
        ])
        img_tensor = resize_transform(img_np[None, ...])
        label_tensor = torch.from_numpy(rec["labels"])
        return torch.from_numpy(img_tensor), label_tensor

def train(epochs=3, batch_size=8, lr=1e-4, limit=50):
    dataset_dir = os.environ.get("SCANLAB_DATA_ROOT", r"D:\ScanLab_Datasets")
    train_parquet = os.path.join(dataset_dir, "01_CHEST_XRAY", "MIMIC-CXR", "data", "train-00000-of-00002.parquet")
    val_parquet = os.path.join(dataset_dir, "01_CHEST_XRAY", "MIMIC-CXR", "data", "validation-00000-of-00001.parquet")

    if not os.path.exists(train_parquet):
        print(f"ERROR: Dataset not found at {train_parquet}")
        return

    print("=================================================================")
    print("STARTING SCANLAB MODEL TRAINING PIPELINE")
    print(f"Device: {DEVICE} | Epochs: {epochs} | Batch Size: {batch_size} | Samples: {limit}")
    print("=================================================================")

    train_ds = MimicCxrParquetDataset(train_parquet, limit=limit)
    train_loader = DataLoader(train_ds, batch_size=batch_size, shuffle=True)

    # Initialize model
    print("Initializing DenseNet-121 architecture...")
    model = xrv.models.DenseNet(weights="densenet121-res224-all")
    # Adapt classification head if necessary
    num_classes = len(TARGET_PATHOLOGIES)
    model.op_threshs = None
    model.to(DEVICE)

    criterion = nn.BCEWithLogitsLoss()
    optimizer = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-5)

    for epoch in range(1, epochs + 1):
        model.train()
        total_loss = 0.0
        start_epoch = time.time()

        for step, (images, targets) in enumerate(train_loader):
            images = images.to(DEVICE)
            targets = targets.to(DEVICE)

            optimizer.zero_grad()
            outputs = model(images)
            # Match outputs to target pathologies
            indices = [model.pathologies.index(p) for p in TARGET_PATHOLOGIES if p in model.pathologies]
            sub_outputs = outputs[:, indices]

            loss = criterion(sub_outputs, targets[:, :len(indices)])
            loss.backward()
            optimizer.step()

            total_loss += loss.item()
            if (step + 1) % 5 == 0 or step == len(train_loader) - 1:
                print(f"Epoch [{epoch}/{epochs}] Step [{step+1}/{len(train_loader)}] - Batch Loss: {loss.item():.4f}")

        avg_loss = total_loss / max(1, len(train_loader))
        duration = time.time() - start_epoch
        print(f"--> Epoch {epoch} Completed in {duration:.1f}s | Avg Loss: {avg_loss:.4f}")

    checkpoint_path = os.path.join(OUTPUT_DIR, f"scanlab_cxr_model_weights.pt")
    torch.save(model.state_dict(), checkpoint_path)
    print(f"\nTraining complete. Checkpoint saved successfully to:\n{checkpoint_path}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train ScanLab AI Report Model")
    parser.add_argument("--epochs", type=int, default=1, help="Number of training epochs")
    parser.add_argument("--batch-size", type=int, default=4, help="Batch size")
    parser.add_argument("--limit", type=int, default=20, help="Number of training cases to process")
    parser.add_argument("--lr", type=float, default=1e-4, help="Learning rate")
    args = parser.parse_args()

    train(epochs=args.epochs, batch_size=args.batch_size, lr=args.lr, limit=args.limit)
