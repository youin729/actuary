#!/usr/bin/env python3
"""Compatibility wrapper for the textbook-math-extract skill script."""

from __future__ import annotations

import runpy
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "textbook-math-extract" / "scripts" / "extract_from_image.py"


if __name__ == "__main__":
    runpy.run_path(str(SCRIPT), run_name="__main__")
