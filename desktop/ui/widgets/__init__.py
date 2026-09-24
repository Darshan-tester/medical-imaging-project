"""Widgets: the parts of the screen that draw pixels or take clicks.

Nothing in here reaches into the index or the loader directly.  Pages own the
data and hand these widgets values, which keeps every widget testable by
constructing it with a value rather than with a dataset.
"""
