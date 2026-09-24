"""Every string the user can be shown when something is unavailable.

They live in one module because §26 fixes three of them exactly - "Unable to load
image.", "Report unavailable", "Unable to load study" - and a requirement like
that is only auditable if the strings are not scattered through the UI.  Nothing
here is decorative: each one is what some specific failure looks like on screen.

Where the web app has its own copy for the same failure, the shape is kept - a
short title plus a sentence saying what to do about it - and only the title is
replaced with the wording §26 asks for.  The bodies are the web app's own,
except that the desktop's rebuild step is named instead of the web's server or
npm.  ``render.MISSING_VOLUME`` was already carried across that way, and this
follows it.

The report strings are re-exported rather than restated so there is exactly one
definition of each; ``core.reports`` owns them because it is what decides when a
report is missing.
"""

from __future__ import annotations

from .imaging.render import MISSING_VOLUME  # noqa: F401  (re-exported)
from .reports import (  # noqa: F401  (re-exported)
    NOT_AVAILABLE,
    REPORT_PANEL_TITLE,
    REPORT_UNAVAILABLE_BODY,
    REPORT_UNAVAILABLE_SHORT,
    REPORT_UNAVAILABLE_TITLE,
)

# --------------------------------------------------------------------- images
#: §26's exact wording.  The web app's own title here is "Unable to display this
#: image" (ImageViewer.tsx:232); the requirement's is used instead.
IMAGE_UNAVAILABLE = "Unable to load image."

#: The decode itself failed.  ImageViewer.tsx:241 with "The server could not
#: render this slice" replaced - there is no server in this build (§19).
IMAGE_DECODE_FAILED = (
    "This slice could not be decoded. If the study index is out of date, rebuild "
    "it; otherwise this source file may be unreadable."
)

#: There is no such frame: the series is shorter than the index said, or the
#: viewer asked for a slice outside it.  ImageViewer.tsx:243, verbatim.
IMAGE_NO_FRAME = "This series has no images available for the current slice."

#: The frame exists in the index but its file is not in the delivered dataset
#: folder.  Named, not swallowed, because §30 requires missing files be
#: identified rather than hidden.
IMAGE_FILE_MISSING = "This file is not in the dataset folder: {path}"

#: Present but unreadable - a permission problem, a disconnected drive, a
#: truncated copy.  The reason the OS gave is appended so a support call has
#: something to go on.
IMAGE_FILE_UNREADABLE = "This file could not be read: {path} ({reason})"

#: The index named a path outside ``dataset/``.  ``app_paths.resolve_data``
#: refuses it (§20), and refusing is worth saying out loud: it means the index
#: was built somewhere else and does not belong to this delivery.
IMAGE_PATH_REJECTED = (
    "This file is recorded outside the dataset folder and was not read: {path}"
)

# -------------------------------------------------------------- studies, index
#: §26's exact wording.  The web app says "Unable to load this study".
STUDY_UNAVAILABLE = "Unable to load study"

#: What is shown when the id is not in the index at all - a stale bookmark, or a
#: study that was in the manifest when the link was made and is not now.
STUDY_NOT_FOUND = "This study is not in the index. It may have been re-indexed under a different id."

#: The study-list equivalent, from the web app's studies page.
STUDY_LIST_UNAVAILABLE = "Unable to load studies"

#: No ``index/studies.db`` beside the application.  The only failure here that a
#: non-technical user can actually fix, so it says where the file should be.
INDEX_MISSING = "No study index was found."
INDEX_MISSING_DETAIL = (
    "The application expects the index at {path}. Run the indexer to build it, "
    "then start the application again."
)

#: The file is there but is not this application's index - a schema from an older
#: build, or something else entirely under that name.
INDEX_UNREADABLE = "The study index could not be opened."
INDEX_UNREADABLE_DETAIL = "{path} is not a readable index for this version ({reason})."

#: A series that names a volume the index does not hold.  The 3-D control is
#: hidden rather than disabled in that case, so this is the fallback for a view
#: that was already open when it happened.
SERIES_NO_VOLUME = MISSING_VOLUME

#: A volume whose descriptor is fine but whose slice files are not all there.
#: The renderer cannot tell these apart - it rejects any unreadable instance and
#: reports one generic reason, as the web renderer does - so the loader looks for
#: itself before repeating a message about inconsistent instances that would send
#: someone after the wrong problem (§30: identify missing files, do not hide
#: them).
VOLUME_SLICES_MISSING = (
    "{missing} of {total} slice files for this series are not in the dataset "
    "folder, starting with {first}"
)

