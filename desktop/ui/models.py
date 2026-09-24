"""Qt models over the SQLite index.

The study table is the screen that has to survive the full corpus: 31,447 studies
at the delivered scope, and §8 asks for pagination or virtualization rather than a
list widget with 31,447 rows in it.  Both happen here, and they are different
things.  *Virtualization* is Qt's: a ``QTableView`` only ever asks the model for
the cells it is about to paint, so the 40 visible rows are the only ones that
become text.  *Pagination* is this model's: it holds one page of ``StudyRow``
objects at a time and asks the index for the next page when the view scrolls into
it, so memory stays flat and the first page appears without the other 31,000 rows
being read at all.

Filtering and sorting are not done here.  They are pushed into ``StudyQuery`` and
answered by SQLite, which is what §10 requires - "search/filter must hit the
index, not the UI" - and is also the only way it stays fast: the alternative is
loading every row to filter it in Python, which is the thing the index exists to
avoid.
"""

from __future__ import annotations

from PySide6.QtCore import QAbstractTableModel, QModelIndex, Qt, Signal

from ..core.db import Index, StudyQuery, StudyRow
from ..core.log import log
from . import format as fmt
from . import theme

#: One page.  Large enough that a full screen of rows and a page-down are one
#: query, small enough that the first paint is not waiting on the rest.
PAGE_SIZE = 200

#: ``(key, header, sort_key, alignment)``.  ``sort_key`` is a key of
#: ``core.db.SORT_COLUMNS``; ``None`` means the column is not sortable, which is
#: how the web app treats the same columns.
COLUMNS: tuple[tuple[str, str, str | None, str], ...] = (
    ("study", "Study", "study", "left"),
    ("patient", "Patient", "patient", "left"),
    ("modality", "Modality", "modality", "left"),
    ("region", "Region", None, "left"),
    ("date", "Date", "date", "left"),
    ("status", "Status", "report", "left"),
    ("series", "Series", "series", "right"),
    ("images", "Images", "frames", "right"),
    ("size", "Size", "size", "right"),
)

COL_STUDY, COL_PATIENT, COL_MODALITY, COL_REGION = 0, 1, 2, 3
COL_DATE, COL_STATUS, COL_SERIES, COL_IMAGES, COL_SIZE = 4, 5, 6, 7, 8

#: Extra roles the badge delegate reads.  ``UserRole`` itself carries the study
#: id, so a selection can be turned into a viewer request without the view
#: knowing anything about the row's shape.
ROLE_STUDY_ID = int(Qt.ItemDataRole.UserRole)
ROLE_BADGE = int(Qt.ItemDataRole.UserRole) + 1
ROLE_SUBTEXT = int(Qt.ItemDataRole.UserRole) + 2


class StudyTableModel(QAbstractTableModel):
    """One page of the study list at a time, filtered and sorted by SQLite."""

    #: Emitted whenever the filter changes and the new total is known, so the
    #: page can say "31,447 studies" without counting rows itself.
    countChanged = Signal(int)
    #: Emitted when a query fails.  The view shows ``STUDY_LIST_UNAVAILABLE``
    #: rather than an empty table, because "no studies" and "the index could not
    #: be read" are different things and §26 says so.
    failed = Signal(str)

    def __init__(self, index: Index, query: StudyQuery | None = None,
                 parent=None) -> None:
        super().__init__(parent)
        self._index = index
        self._query = query or StudyQuery()
        self._rows: list[StudyRow] = []
        self._total = 0
        self._theme = "light"
        self.refresh()

    # ------------------------------------------------------------------- shape

    def rowCount(self, parent=QModelIndex()) -> int:
        if parent.isValid():
            return 0
        return len(self._rows)

    def columnCount(self, parent=QModelIndex()) -> int:
        if parent.isValid():
            return 0
        return len(COLUMNS)

    def headerData(self, section: int, orientation, role=Qt.ItemDataRole.DisplayRole):
        if role != Qt.ItemDataRole.DisplayRole:
            return None
        if orientation == Qt.Orientation.Horizontal and 0 <= section < len(COLUMNS):
            return COLUMNS[section][1]
        return None

    # -------------------------------------------------------------------- data

    def study_at(self, row: int) -> StudyRow | None:
        if 0 <= row < len(self._rows):
            return self._rows[row]
        return None

    @property
    def total(self) -> int:
        """Every study the filter matches, not just the ones loaded."""
        return self._total

    @property
    def loaded(self) -> int:
        return len(self._rows)

    @property
    def query(self) -> StudyQuery:
        return self._query

    def data(self, index: QModelIndex, role=Qt.ItemDataRole.DisplayRole):
        if not index.isValid():
            return None
        study = self.study_at(index.row())
        if study is None:
            return None
        column = index.column()
        if role == ROLE_STUDY_ID:
            return study.id
        if role == Qt.ItemDataRole.TextAlignmentRole:
            align = COLUMNS[column][3]
            if align == "right":
                return int(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
            return int(Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)
        if role == ROLE_SUBTEXT and column == COL_PATIENT:
            return fmt.format_age_sex(study.age, study.sex)
        if role == ROLE_BADGE:
            return self._badge(study, column)
        if role == Qt.ItemDataRole.ToolTipRole:
            return self._tooltip(study, column)
        if role == Qt.ItemDataRole.DisplayRole:
            return self._display(study, column)
        return None

    def _display(self, study: StudyRow, column: int) -> str:
        if column == COL_STUDY:
            return study.study_code or study.id
        if column == COL_PATIENT:
            return study.patient_alias or fmt.NOT_AVAILABLE
        if column == COL_MODALITY:
            return theme.MODALITY_LABELS.get(study.modality, study.modality or "-")
        if column == COL_REGION:
            return study.body_region or fmt.NOT_AVAILABLE
        if column == COL_DATE:
            return fmt.format_date(study.date)
        if column == COL_STATUS:
            return theme.STATUS_LABELS.get(study.status, (study.status, "neutral"))[0]
        if column == COL_SERIES:
            return fmt.format_int(study.series_count)
        if column == COL_IMAGES:
            return fmt.format_int(study.frame_count)
        if column == COL_SIZE:
            return fmt.format_bytes(study.bytes)
        return ""

    def _badge(self, study: StudyRow, column: int):
        """``(text, tone)`` for the two columns drawn as badges, else None."""
        if column == COL_MODALITY:
            label = theme.MODALITY_LABELS.get(study.modality, study.modality or "-")
            return (label, theme.MODALITY_TONES.get(study.modality, "clinical"))
        if column == COL_STATUS:
            return theme.STATUS_LABELS.get(study.status, (study.status, "neutral"))
        return None

    def _tooltip(self, study: StudyRow, column: int) -> str | None:
        if column == COL_STUDY:
            source = study.source_study_id or study.id
            return f"{study.study_code or study.id}\nIndex id: {study.id}\nSource id: {source}"
        if column == COL_MODALITY and study.dataset:
            return f"Dataset source: {study.dataset}"
        if column == COL_STATUS:
            return ("This study has a source report."
                    if study.has_report else "No source report was matched to this study.")
        return None

    # ---------------------------------------------------------------- paging

    def canFetchMore(self, parent=QModelIndex()) -> bool:
        if parent.isValid():
            return False
        return len(self._rows) < self._total

    def fetchMore(self, parent=QModelIndex()) -> None:
        """Load the next page.

        Called by the view as it scrolls, which is what keeps this from being a
        31,447-row load: the reader who stays on the first screen never pays for
        the second page.
        """
        if parent.isValid() or not self.canFetchMore():
            return
        offset = len(self._rows)
        try:
            page = self._index.list_studies(self._query, limit=PAGE_SIZE, offset=offset)
        except Exception as exc:  # noqa: BLE001
            log.exception("studies: page at offset %d failed", offset)
            self.failed.emit(str(exc))
            return
        if not page:
            # The index shrank under us (a re-index while the app is open).  Stop
            # asking rather than looping on an offset that will never fill.
            self._total = len(self._rows)
            return
        first, last = offset, offset + len(page) - 1
        self.beginInsertRows(QModelIndex(), first, last)
        self._rows.extend(page)
        self.endInsertRows()

    # ---------------------------------------------------------------- querying

    def set_query(self, query: StudyQuery) -> None:
        """Replace the filter and reload from the first page."""
        self._query = query
        self.refresh()

    def set_sort_key(self, key: str, descending: bool) -> None:
        from dataclasses import replace
        self.set_query(replace(self._query, sort=key, descending=descending))

    def sort(self, column: int, order=Qt.SortOrder.AscendingOrder) -> None:
        """Header-click sorting, answered by the index rather than by the view.

        A ``QSortFilterProxyModel`` would sort the loaded page only, which on a
        paged model means the reader sorts the 200 rows they happen to have -
        wrong, and quietly so.  This re-queries instead.
        """
        if not 0 <= column < len(COLUMNS):
            return
        key = COLUMNS[column][2]
        if key is None:
            return
        self.set_sort_key(key, order == Qt.SortOrder.DescendingOrder)

    def refresh(self) -> None:
        """Re-count and re-read the first page.  Everything else follows."""
        self.beginResetModel()
        self._rows = []
        self._total = 0
        try:
            self._total = self._index.count_studies(self._query)
            self._rows = self._index.list_studies(
                self._query, limit=PAGE_SIZE, offset=0)
        except Exception as exc:  # noqa: BLE001
            log.exception("studies: query failed")
            self._rows = []
            self._total = 0
            self.endResetModel()
            self.failed.emit(str(exc))
            self.countChanged.emit(0)
            return
        self.endResetModel()
        self.countChanged.emit(self._total)

    def ids(self) -> list[str]:
        """Every matching id in display order, for the viewer's study stepping."""
        try:
            return self._index.study_ids(self._query)
        except Exception:  # noqa: BLE001
            log.exception("studies: id list failed")
            return [row.id for row in self._rows]




