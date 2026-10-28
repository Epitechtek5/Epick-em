#!/usr/bin/env python3
"""Validate changed-component results and write the required-check summary."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any


REQUIRED_COMPONENTS = ("backend", "db", "web", "mobile", "deploy")
BASE_CHECKS = ("changes", "gitleaks")


def validate_required_checks(needs: Any) -> tuple[list[dict[str, str]], list[str]]:
    if not isinstance(needs, dict):
        return [], ["GitHub Actions did not provide a valid needs object."]

    rows: list[dict[str, str]] = []
    errors: list[str] = []

    for job_name in BASE_CHECKS:
        job = needs.get(job_name)
        result = job.get("result") if isinstance(job, dict) else None
        displayed_result = result if isinstance(result, str) else "missing"
        rows.append(
            {"component": job_name, "changed": "required", "result": displayed_result}
        )
        if result != "success":
            errors.append(
                f"{job_name} must succeed; it finished with {displayed_result}."
            )

    change_detection = needs.get("changes")
    outputs = (
        change_detection.get("outputs")
        if isinstance(change_detection, dict)
        else None
    )

    for component in REQUIRED_COMPONENTS:
        job = needs.get(component)
        result = job.get("result") if isinstance(job, dict) else None
        displayed_result = result if isinstance(result, str) else "missing"
        changed = outputs.get(component) if isinstance(outputs, dict) else None

        if changed == "true":
            rows.append(
                {"component": component, "changed": "yes", "result": displayed_result}
            )
            if result != "success":
                errors.append(
                    f"{component} changed and must succeed; it finished with "
                    f"{displayed_result}."
                )
        elif changed == "false":
            rows.append(
                {"component": component, "changed": "no", "result": displayed_result}
            )
            if result != "skipped":
                errors.append(
                    f"{component} is unchanged and must be skipped; it finished "
                    f"with {displayed_result}."
                )
        else:
            rows.append(
                {"component": component, "changed": "invalid", "result": displayed_result}
            )
            errors.append(
                f"{component} has an invalid or missing change-filter result: "
                f"{changed!r}."
            )

    return rows, errors


def format_summary(rows: list[dict[str, str]], errors: list[str]) -> str:
    display_results = {
        "success": "Passed",
        "failure": "Failed",
        "skipped": "Skipped / not applicable",
        "cancelled": "Cancelled",
    }
    lines = [
        "## Required CI checks",
        "",
        "| Component | Changed | Result |",
        "| --- | --- | --- |",
    ]
    lines.extend(
        f"| {row['component']} | {row['changed']} | "
        f"{display_results.get(row['result'], row['result'])} |"
        for row in rows
    )

    outcome = "Failed" if errors else "Passed"
    lines.extend(["", f"**Overall result: {outcome}.**"])
    if errors:
        lines.extend(["", "### Required check failures", ""])
        lines.extend(f"- {error}" for error in errors)
    return "\n".join(lines) + "\n"


def emit_error_annotation(message: str) -> None:
    escaped = (
        message.replace("%", "%25")
        .replace("\r", "%0D")
        .replace("\n", "%0A")
        .replace(":", "%3A")
        .replace(",", "%2C")
    )
    print(f"::error title=Required CI check failed::{escaped}")


def main() -> int:
    try:
        needs = json.loads(os.environ["NEEDS"])
    except (KeyError, json.JSONDecodeError) as error:
        needs = None
        rows, errors = validate_required_checks(needs)
        errors.insert(0, f"Unable to read GitHub Actions job results: {error}.")
    else:
        rows, errors = validate_required_checks(needs)

    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with Path(summary_path).open("a", encoding="utf-8") as summary:
            summary.write(format_summary(rows, errors))

    for error in errors:
        emit_error_annotation(error)

    if errors:
        return 1

    print("All changed components passed; unchanged components were skipped.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
