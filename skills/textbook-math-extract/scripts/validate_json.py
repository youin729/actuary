#!/usr/bin/env python3
"""Validate extracted math problem metadata against schema.json."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator
from jsonschema.exceptions import ValidationError


SKILL_DIR = Path(__file__).resolve().parents[1]
SCHEMA_PATH = SKILL_DIR / "schema.json"


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def format_error(error: ValidationError) -> str:
    location = "$"
    if error.absolute_path:
        location += "".join(f"[{part!r}]" for part in error.absolute_path)
    return f"{location}: {error.message}"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate textbook math extraction JSON."
    )
    parser.add_argument("json_file", type=Path, help="Metadata JSON file to validate.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    schema = load_json(SCHEMA_PATH)
    metadata = load_json(args.json_file)

    validator = Draft202012Validator(schema)
    errors = sorted(validator.iter_errors(metadata), key=lambda err: list(err.absolute_path))
    if errors:
        print("Invalid JSON metadata")
        for error in errors:
            print(f"- {format_error(error)}")
        raise SystemExit(1)

    print("Valid JSON metadata")


if __name__ == "__main__":
    main()
