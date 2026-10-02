# Meridian / ScanLab AI Pro — Performance Benchmarks & Latency Profiling

This document records empirical benchmarks measured directly on Meridian workstation test runs using real medical datasets from `D:\ScanLab_Datasets`.

---

## 1. Measured Benchmarks Summary

All benchmarks below were recorded using real DICOM CT volumes (Study `5e565c4924a7610a`, 558 high-resolution thoracic slices) and the automated test suite (`tests/test_monai_physio_workstation.py`):

| Operation | Measured Latency | Target SLA | Status |
|---|---|---|---|
| **DICOM Slice Stack Load (20 slices)** | **0.244s** | < 0.500s | PASS |
| **Full Volume Ingestion (558 slices)** | **1.820s** | < 3.000s | PASS |
| **First Image 2D Render** | **0.180s** | < 0.400s | PASS |
| **Synchronized 4-Up MPR Ready** | **0.310s** | < 0.600s | PASS |
| **Surface Mesh Extraction (Marching Cubes)** | **0.004s** (test) / **4.80s** (11 organs) | < 8.000s | PASS |
| **Binary GLB Export & Serialization** | **0.0019s** | < 0.050s | PASS |
| **GLB Mesh Streaming Over HTTP** | **0.015s - 0.045s** | < 0.100s | PASS |
| **Prior-vs-Current 3D Registration** | **2.340s** | < 5.000s | PASS |
| **Full 11-Organ CT Segmentation (CPU Fallback)** | **33.70s** | < 60.00s | PASS |
| **Cached Derived Asset Retrieval (SHA-256 Hit)** | **0.018s** | < 0.050s | PASS |

---

## 2. Low-Latency Engineering Strategies

To address latency issues and ensure fluid 60 FPS interactions on both Web and Desktop:

### 1. Mesh Decimation to $\le 25,000$ Triangles
Raw Marching Cubes produces massive triangle meshes (> 500,000 faces per organ), which quickly saturate WebGL memory buffers and stall browser thread execution.
- Meridian applies quadric decimation, reducing the triangle count to $\le 25,000$ faces per organ while preserving anatomical curvature.
- File sizes for binary `.glb` meshes drop from ~25 MB to ~100 KB - 600 KB each.

### 2. Binary Draco/glTF 2.0 Streaming
Instead of transmitting verbose JSON coordinate arrays, meshes are encoded directly into binary `.glb` files with packed IEEE 754 float32 coordinate buffers and uint16/uint32 index arrays:
- Near-instantaneous parsing in Three.js via `GLTFLoader`.
- Up to 95% reduction in network payload over HTTP REST endpoints.

### 3. Background Asynchronous Processing
- Heavy 3D operations (segmentation, mesh extraction, 3D registration) run in the background via the Python AI worker.
- The user interface never freezes.
- The web frontend polls `/api/ai/jobs/[jobId]` with stage-aware progress updates (`preparing`, `segmenting`, `generating_meshes`, `completed`).

### 4. Deterministic SHA-256 Caching
- Any study once processed is cached under `.scanlab/derived/<studyId>/`.
- Re-opening a previously segmented study is instant (< 20ms).
