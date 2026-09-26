"""PyInstaller entry point: runs the Meridian desktop app as a frozen exe/app."""
import multiprocessing
import sys

if __name__ == "__main__":
    multiprocessing.freeze_support()
    from meridian_desktop.app import main
    sys.exit(main())