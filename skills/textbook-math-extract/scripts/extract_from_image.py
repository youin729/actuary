#!/usr/bin/env python3
"""Extract mobile-app math problem metadata from an image with OpenAI."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import sys
from datetime import datetime
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

from jsonschema import Draft202012Validator
from openai import OpenAI

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None


SKILL_DIR = Path(__file__).resolve().parents[1]
SCHEMA_PATH = SKILL_DIR / "schema.json"

if load_dotenv is not None:
    load_dotenv()
    load_dotenv(SKILL_DIR / ".env")

DEFAULT_MODEL = os.getenv("OPENAI_MODEL", "gpt-5-nano")
SUPPORTED_MIME_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
}
API_SCHEMA_UNSUPPORTED_KEYS = {
    "$schema",
    "$id",
    "title",
    "description",
    "minLength",
    "maxLength",
    "minimum",
    "maximum",
    "minItems",
    "pattern",
}


@dataclass(frozen=True)
class ExtractionOptions:
    model: str
    api_key: Optional[str]
    page: Optional[int]
    problem_number: Optional[str]
    subject: Optional[str]
    unit: Optional[str]
    answer_image: Optional[Path] = None
    problem_id: Optional[str] = None


def log_progress(message: str) -> None:
    timestamp = datetime.now().strftime("%H:%M:%S")
    print(f"[{timestamp}] {message}", file=sys.stderr, flush=True)


def load_schema() -> dict[str, Any]:
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


def schema_for_openai(schema: dict[str, Any]) -> dict[str, Any]:
    """Keep local schema strict while using the JSON Schema subset accepted by the API."""
    if isinstance(schema, dict):
        return {
            key: schema_for_openai(value)
            for key, value in schema.items()
            if key not in API_SCHEMA_UNSUPPORTED_KEYS
        }
    if isinstance(schema, list):
        return [schema_for_openai(item) for item in schema]
    return schema


def response_schema_for_openai(problem_schema: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["problems"],
        "properties": {
            "problems": {
                "type": "array",
                "items": schema_for_openai(problem_schema),
            }
        },
    }


def image_to_data_url(image_path: Path) -> str:
    suffix = image_path.suffix.lower()
    mime_type = SUPPORTED_MIME_TYPES.get(suffix)
    if mime_type is None:
        supported = ", ".join(sorted(SUPPORTED_MIME_TYPES))
        raise ValueError(f"Unsupported image type '{suffix}'. Supported: {supported}")

    encoded = base64.b64encode(image_path.read_bytes()).decode("ascii")
    return f"data:{mime_type};base64,{encoded}"


def stable_problem_id(image_path: Path) -> str:
    digest = hashlib.sha256(image_path.read_bytes()).hexdigest()[:16]
    return f"math_{digest}"


def stable_problem_id_prefix(image_path: Path) -> str:
    digest = hashlib.sha256(image_path.read_bytes()).hexdigest()[:16]
    return f"math_{digest}"


def placeholder_reason(api_key: str) -> Optional[str]:
    stripped_api_key = api_key.strip()
    placeholder_values = {
        "sk-your-api-key",
        "sk-your-openai-api-key",
        "sk-your-real-api-key",
        "your-api-key",
        "your_openai_api_key",
    }
    if stripped_api_key in placeholder_values:
        return "matches a known placeholder value"
    if "your" in stripped_api_key.lower():
        return "contains 'your'"
    return None


def looks_like_placeholder(api_key: str) -> bool:
    return placeholder_reason(api_key) is not None


def masked_api_key(api_key: Optional[str]) -> str:
    if not api_key:
        return "<empty>"

    stripped_api_key = api_key.strip()
    if len(stripped_api_key) <= 8:
        return f"{stripped_api_key[:2]}...{stripped_api_key[-2:]}"
    return f"{stripped_api_key[:7]}...{stripped_api_key[-4:]}"


def debug_api_key_candidate(label: str, api_key: Optional[str]) -> None:
    reason = placeholder_reason(api_key) if api_key else None
    print(
        (
            f"[api-key-debug] {label}: "
            f"present={bool(api_key)}, "
            f"length={len(api_key.strip()) if api_key else 0}, "
            f"masked={masked_api_key(api_key)}, "
            f"placeholder={bool(reason)}, "
            f"reason={reason or 'none'}"
        ),
        file=sys.stderr,
    )


def resolve_api_key(cli_api_key: Optional[str]) -> Optional[str]:
    env_api_key = os.getenv("OPENAI_API_KEY")
    api_key = cli_api_key or env_api_key
    legacy_api_key = os.getenv("OPEN_API_KEY")
    api_key_source = "--api-key" if cli_api_key else "OPENAI_API_KEY"
    debug_enabled = os.getenv("OPENAI_API_KEY_DEBUG") == "1"

    def debug_resolution() -> None:
        debug_api_key_candidate("--api-key", cli_api_key)
        debug_api_key_candidate("OPENAI_API_KEY", env_api_key)
        debug_api_key_candidate("OPEN_API_KEY", legacy_api_key)
        debug_api_key_candidate(f"selected ({api_key_source})", api_key)

    if legacy_api_key and (not api_key or looks_like_placeholder(api_key)):
        print(
            "Warning: OPEN_API_KEY is deprecated. Rename it to OPENAI_API_KEY.",
            file=sys.stderr,
        )
        api_key = legacy_api_key
        api_key_source = "OPEN_API_KEY"

    if debug_enabled:
        debug_resolution()

    if not api_key:
        if not debug_enabled:
            debug_resolution()
        raise SystemExit(
            "OpenAI API key is not set. Set OPENAI_API_KEY in .env or pass --api-key."
        )

    reason = placeholder_reason(api_key)
    if reason:
        if not debug_enabled:
            debug_resolution()
        raise SystemExit(
            "OpenAI API key still looks like a placeholder "
            f"({reason}). Replace it with a real key in .env."
        )

    return api_key


def build_prompt(
    image_path: Path,
    options: ExtractionOptions,
    problem_id_prefix: str,
    source_image_file: str,
) -> str:
    context = {
        "id_prefix": problem_id_prefix,
        "source_image_file": source_image_file,
        "source_page": options.page,
        "source_problem_number": options.problem_number,
        "subject_hint": options.subject,
        "unit_hint": options.unit,
        "answer_image_file": str(options.answer_image) if options.answer_image else None,
    }
    return f"""
You are converting a math textbook problem image into JSON metadata for a mobile learning app.

Return JSON only. The JSON must strictly match the provided JSON Schema.
The top-level JSON object must contain a "problems" array.

Context:
{json.dumps(context, ensure_ascii=False, indent=2)}

Extraction policy:
- Detect every independent problem or subproblem visible in the problem image.
- Return one object per problem/subproblem in reading order.
- If the image contains subproblems numbered 1 through 5, return 5 problem objects.
- Give each problem a unique id by appending the subproblem number to id_prefix, for example "<id_prefix>_1".
- Put the detected subproblem number in source.problem_number. If a parent problem number is supplied, combine them, for example "3-1".
- Preserve mathematical expressions in LaTeX.
- Keep original_text minimal for copyright protection. Use a compact excerpt or summary, not unnecessary full transcription.
- Fill source.image_file and source.page from the context above.
- If a field is unknown and the schema allows null, use null. For required strings that cannot be inferred, use "unknown".
- Split steps into small mobile interactions, ideally one learner action per step.
- Choose answer_format.type from the schema enum.
- Add ui_components suitable for a phone learning UI.
- If an answer image is provided, use it only as a reference for final_answer, steps, and confidence. Do not copy unnecessary explanation text into original_text.
- If neither image contains an answer, infer final_answer only when mathematically reasonable and lower confidence, usually 0.75 or less.
- If final_answer cannot be inferred reliably, set final_answer to null and lower confidence.
- Ensure final_answer, steps, and givens do not contradict each other.
""".strip()


def response_text(response: Any) -> str:
    output_text = getattr(response, "output_text", None)
    if output_text:
        return output_text

    chunks: list[str] = []
    for item in getattr(response, "output", []) or []:
        for content in getattr(item, "content", []) or []:
            text = getattr(content, "text", None)
            if text:
                chunks.append(text)
    if chunks:
        return "".join(chunks)

    raise RuntimeError("OpenAI response did not contain text output.")


def extract_metadata(
    image_path: Path,
    options: ExtractionOptions,
    source_image_file: Optional[str] = None,
) -> list[dict[str, Any]]:
    log_progress(f"Starting extraction: {image_path}")
    if not image_path.exists():
        raise FileNotFoundError(image_path)
    if options.answer_image and not options.answer_image.exists():
        raise FileNotFoundError(options.answer_image)

    if options.answer_image:
        log_progress(f"Using answer image: {options.answer_image}")
    else:
        log_progress("No answer image found for this input.")

    log_progress("Loading JSON schema and building prompt.")
    schema = load_schema()
    problem_id_prefix = options.problem_id or stable_problem_id_prefix(image_path)
    prompt = build_prompt(
        image_path,
        options,
        problem_id_prefix,
        source_image_file or image_path.name,
    )
    log_progress("Encoding problem image.")
    content = [
        {"type": "input_text", "text": prompt},
        {"type": "input_image", "image_url": image_to_data_url(image_path)},
    ]
    if options.answer_image:
        log_progress("Encoding answer image.")
        content.extend(
            [
                {
                    "type": "input_text",
                    "text": "Reference answer image for the same source image:",
                },
                {"type": "input_image", "image_url": image_to_data_url(options.answer_image)},
            ]
        )

    log_progress(f"Sending request to OpenAI model: {options.model}")
    client = OpenAI(api_key=options.api_key)
    response = client.responses.create(
        model=options.model,
        input=[
            {
                "role": "user",
                "content": content,
            }
        ],
        text={
            "format": {
                "type": "json_schema",
                "name": "textbook_math_problem_metadata_batch",
                "schema": response_schema_for_openai(schema),
                "strict": True,
            }
        },
    )

    log_progress("Received OpenAI response. Parsing JSON.")
    response_metadata = json.loads(response_text(response))
    problems = response_metadata["problems"]
    log_progress(f"Validating {len(problems)} problem JSON object(s).")
    validator = Draft202012Validator(schema)
    for metadata in problems:
        validator.validate(metadata)
    log_progress(f"Extraction complete: {image_path} -> {len(problems)} problem(s)")
    return problems


def iter_image_paths(input_path: Path, recursive: bool) -> list[Path]:
    if input_path.is_file():
        image_paths = [input_path]
    elif input_path.is_dir():
        pattern = "**/*" if recursive else "*"
        image_paths = [
            path
            for path in input_path.glob(pattern)
            if path.is_file() and path.suffix.lower() in SUPPORTED_MIME_TYPES
        ]
    else:
        raise FileNotFoundError(input_path)

    return sorted(image_paths)


def answer_image_for(image_path: Path, input_path: Path, answer_dir: Optional[Path]) -> Optional[Path]:
    if answer_dir is None:
        return None

    candidates: list[Path] = []
    if input_path.is_dir():
        relative = image_path.relative_to(input_path)
        candidates.extend(answer_dir / relative.with_suffix(suffix).name for suffix in SUPPORTED_MIME_TYPES)
        candidates.extend(answer_dir / relative.with_suffix(suffix) for suffix in SUPPORTED_MIME_TYPES)
    else:
        candidates.extend(answer_dir / image_path.with_suffix(suffix).name for suffix in SUPPORTED_MIME_TYPES)

    for candidate in candidates:
        if candidate.exists() and candidate.is_file():
            return candidate
    return None


def output_path_for(image_path: Path, input_path: Path, output_path: Path) -> Path:
    if input_path.is_file():
        if output_path.exists() and output_path.is_dir():
            return output_path / image_path.with_suffix(".json").name
        if output_path.suffix == "":
            return output_path / image_path.with_suffix(".json").name
        return output_path

    relative = image_path.relative_to(input_path)
    return output_path / relative.with_suffix(".json")


def output_path_for_problem(base_output_path: Path, metadata: dict[str, Any], problem_count: int) -> Path:
    if problem_count == 1:
        return base_output_path

    problem_number = metadata.get("source", {}).get("problem_number")
    suffix = str(problem_number or metadata.get("id") or "problem")
    safe_suffix = "".join(
        char if char.isalnum() or char in ("-", "_") else "_"
        for char in suffix
    ).strip("_")
    if not safe_suffix:
        safe_suffix = "problem"

    return base_output_path.with_name(f"{base_output_path.stem}_{safe_suffix}{base_output_path.suffix}")


def write_metadata(metadata: dict[str, Any], output_path: Path) -> None:
    schema = load_schema()
    Draft202012Validator(schema).validate(metadata)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extract JSON metadata from a math problem image."
    )
    parser.add_argument("input", type=Path, help="Input image file or directory.")
    parser.add_argument("output", type=Path, help="Output JSON file or directory.")
    parser.add_argument("--model", default=DEFAULT_MODEL, help="OpenAI model name.")
    parser.add_argument("--api-key", default=None, help="OpenAI API key. Defaults to OPENAI_API_KEY.")
    parser.add_argument(
        "--problem-id",
        default=None,
        help="Override generated metadata id. Valid only for single-image input.",
    )
    parser.add_argument("--page", type=int, default=None, help="Source page number.")
    parser.add_argument("--problem-number", default=None, help="Source problem number.")
    parser.add_argument("--subject", default=None, help="Subject hint, e.g. 数学I.")
    parser.add_argument("--unit", default=None, help="Unit hint, e.g. 二次方程式.")
    parser.add_argument(
        "--answer-image",
        type=Path,
        default=None,
        help="Optional answer image for a single input image.",
    )
    parser.add_argument(
        "--answer-dir",
        type=Path,
        default=None,
        help="Optional directory containing answer images that match input image stems.",
    )
    parser.add_argument(
        "--recursive",
        action="store_true",
        help="Process images in input directories recursively.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    log_progress(f"Scanning input: {args.input}")
    image_paths = iter_image_paths(args.input, args.recursive)
    if args.input.is_dir() and args.answer_dir:
        resolved_answer_dir = args.answer_dir.resolve()
        image_paths = [
            path
            for path in image_paths
            if resolved_answer_dir not in path.resolve().parents
        ]
    if not image_paths:
        raise SystemExit(f"No supported images found in {args.input}")
    log_progress(f"Found {len(image_paths)} image(s) to process.")
    if args.input.is_dir() and args.problem_id:
        raise SystemExit("--problem-id can only be used when input is a single image file.")
    if args.input.is_dir() and args.answer_image:
        raise SystemExit("--answer-image can only be used when input is a single image file.")

    api_key = resolve_api_key(args.api_key)

    for index, image_path in enumerate(image_paths, start=1):
        log_progress(f"Processing image {index}/{len(image_paths)}: {image_path}")
        source_image_file = (
            str(image_path.relative_to(args.input))
            if args.input.is_dir()
            else image_path.name
        )
        answer_image = (
            answer_image_for(image_path, args.input, args.answer_dir)
            if args.answer_dir
            else args.answer_image
        )
        if args.answer_dir:
            if answer_image:
                log_progress(f"Matched answer image: {answer_image}")
            else:
                log_progress(f"No matching answer image found in {args.answer_dir}")
        options = ExtractionOptions(
            model=args.model,
            api_key=api_key,
            page=args.page,
            problem_number=args.problem_number,
            subject=args.subject,
            unit=args.unit,
            answer_image=answer_image,
            problem_id=args.problem_id,
        )
        metadata_items = extract_metadata(image_path, options, source_image_file)
        base_destination = output_path_for(image_path, args.input, args.output)
        for metadata in metadata_items:
            destination = output_path_for_problem(
                base_destination,
                metadata,
                len(metadata_items),
            )
            write_metadata(metadata, destination)
            log_progress(f"Wrote JSON: {destination}")
            print(f"Saved: {destination}")
    log_progress("All images processed.")


if __name__ == "__main__":
    main()
