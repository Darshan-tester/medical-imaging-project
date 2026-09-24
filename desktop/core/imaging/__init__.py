"""Imaging: a numpy port of the web renderer's pixel arithmetic.

Nothing in here imports Qt, so every function is testable headless and the
same code runs inside the UI worker threads.
"""

from .gray import GrayImage, downscale_nearest, fit_edge, normalize_max_edge, output_size  # noqa: F401
from .geometry import (  # noqa: F401
    MPR_PLANES,
    PLANE_SCREEN_AXES,
    AxisRef,
    PlaneGeometry,
    VolumeGeometry,
    assign_axes,
    is_mpr_plane,
    planes_from_affine,
)
from .reslice import reslice_to_gray, sample_axis  # noqa: F401
from .window import compute_volume_window  # noqa: F401
from .dicom import DicomError, DicomSummary, read_dicom_summary, render_dicom  # noqa: F401
from .nifti import (  # noqa: F401
    NiftiError,
    read_nifti_geometry,
    read_nifti_summary,
    render_nifti,
    volume_cache_clear,
)
from .stack import (  # noqa: F401
    DicomVolumeRef,
    ExportedVolume,
    StackError,
    StackGeometry,
    dicom_volume_geometry,
    export_dicom_volume,
    load_dicom_stack,
    render_dicom_volume,
    stack_cache_clear,
)
from .render import (  # noqa: F401
    DICOM,
    DICOM_VOLUME,
    NIFTI,
    RASTER,
    ImageRef,
    RenderedFrame,
    RenderError,
    frame_ref_id,
    render_cache_clear,
    render_cache_stats,
    render_image,
    render_image_cached,
)
