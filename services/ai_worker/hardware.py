"""
Hardware and runtime environment detection for Meridian AI Worker.
Identifies GPU capability, VRAM, CUDA runtime, and MONAI ecosystem packages.
"""

from __future__ import annotations

import os
import sys
import platform
from typing import Dict, Any


def detect_hardware() -> Dict[str, Any]:
    """
    Scans the runtime host for compute accelerators and MONAI components.
    Gracefully degrades to CPU if CUDA is unavailable.
    """
    info: Dict[str, Any] = {
        "platform": platform.platform(),
        "pythonVersion": platform.python_version(),
        "gpuAvailable": False,
        "gpuName": "None (CPU Execution)",
        "cudaAvailable": False,
        "cudaVersion": None,
        "vramGb": 0.0,
        "device": "cpu",
        "monaiAvailable": False,
        "monaiVersion": None,
        "totalSegmentatorAvailable": False,
        "vista3dAvailable": False,
        "monaiPhysioAvailable": False,
        "torchVersion": None,
        "notice": None,
    }

    # Check PyTorch and CUDA
    try:
        import torch
        info["torchVersion"] = torch.__version__
        if torch.cuda.is_available():
            info["gpuAvailable"] = True
            info["cudaAvailable"] = True
            info["cudaVersion"] = torch.version.cuda
            info["gpuName"] = torch.cuda.get_device_name(0)
            props = torch.cuda.get_device_properties(0)
            info["vramGb"] = round(props.total_memory / (1024 ** 3), 2)
            info["device"] = "cuda:0"
        else:
            info["notice"] = (
                "GPU unavailable or running CPU build. Using CPU processing. "
                "Some 3D AI operations may utilize multi-threaded CPU SIMD instructions."
            )
    except Exception as e:
        info["notice"] = f"PyTorch detection note: {e}"

    # Check MONAI
    try:
        import monai
        info["monaiAvailable"] = True
        info["monaiVersion"] = getattr(monai, "__version__", "unknown")
    except ImportError:
        info["monaiAvailable"] = False

    # Check TotalSegmentator
    try:
        import totalsegmentator
        info["totalSegmentatorAvailable"] = True
    except ImportError:
        info["totalSegmentatorAvailable"] = False

    # Check VISTA-3D
    try:
        from monai.apps import vista3d
        info["vista3dAvailable"] = True
    except Exception:
        info["vista3dAvailable"] = False

    # Check MONAI Physio
    try:
        import monai_physio
        info["monaiPhysioAvailable"] = True
    except ImportError:
        info["monaiPhysioAvailable"] = False

    return info


if __name__ == "__main__":
    import json
    print(json.dumps(detect_hardware(), indent=2))
