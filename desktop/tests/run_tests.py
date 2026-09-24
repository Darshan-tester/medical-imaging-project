"""Zero-dependency test runner: executes the test modules without pytest.

The project targets pytest (``python -m pytest desktop/tests``) wherever the
environment can install it.  This shim implements just enough of the API
(``pytest.approx``, ``pytest.raises``, ``@pytest.mark.parametrize``, ``tmp_path``,
``pytest.fail``) to run the same files headless, so the suite can be verified
on a machine with nothing but numpy available.
"""

from __future__ import annotations

import contextlib
import itertools
import shutil
import sys
import tempfile
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


# --------------------------------------------------------------- pytest shim

class _Approx:
    def __init__(self, expected, tol=1e-6):
        self.expected = expected
        self.tol = tol

    def __eq__(self, other):
        if isinstance(other, (tuple, list)):
            return len(other) == len(self.expected) and all(
                _Approx(e, self.tol) == o for e, o in zip(self.expected, other))
        return abs(float(other) - float(self.expected)) <= self.tol

    def __req__(self, other):
        return self.__eq__(other)


class _Raises:
    def __init__(self, exc_type):
        self.exc_type = exc_type
        self.value = None

    def __enter__(self):
        return self

    def __exit__(self, etype, exc, tb):
        if etype is None:
            raise AssertionError(f"expected {self.exc_type.__name__} to be raised")
        if not issubclass(etype, self.exc_type):
            raise AssertionError(f"wrong exception: {etype}")
        self.value = exc
        return True


def _parametrize(argnames, argvalues):
    names = [n.strip() for n in argnames.split(",")]

    def deco(fn):
        cases = []
        for values in argvalues:
            if not isinstance(values, (tuple, list)):
                values = (values,)
            cases.append(dict(zip(names, values)))
        existing = getattr(fn, "_parametrize", [])
        fn._parametrize = existing + [cases]
        return fn
    return deco


class _Mark:
    def parametrize(self, argnames, argvalues):
        return _parametrize(argnames, argvalues)


def _install_shim():
    import types
    shim = types.ModuleType("pytest")
    shim.approx = _Approx
    shim.raises = _Raises
    shim.mark = _Mark()
    sys.modules["pytest"] = shim


class _TmpPath:
    def __truediv__(self, name):
        p = Path(tempfile.mkdtemp()) / name
        p.parent.mkdir(parents=True, exist_ok=True)
        return p


def main() -> int:
    _install_shim()
    here = Path(__file__).resolve().parent
    failures = 0
    ran = 0
    for module_path in sorted(here.glob("test_*.py")):
        module_name = module_path.stem
        module = __import__(module_name)
        for name in sorted(dir(module)):
            if not name.startswith("test_"):
                continue
            fn = getattr(module, name)
            if not callable(fn):
                continue
            param_sets = getattr(fn, "_parametrize", [[]])
            for combo in itertools.product(*param_sets):
                kwargs = {}
                for d in combo:
                    kwargs.update(d)
                ran += 1
                try:
                    fn(**kwargs, tmp_path=_TmpPath())
                except TypeError:
                    fn(**kwargs)
                except Exception:  # noqa: BLE001
                    failures += 1
                    print(f"FAIL {module_name}.{name} {kwargs}")
                    traceback.print_exc()
    print(f"{ran} cases, {failures} failures")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())