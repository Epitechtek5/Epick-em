"""Regression tests for required GitHub Actions result aggregation."""

from __future__ import annotations

import unittest

from validate_required_checks import format_summary, validate_required_checks


def make_needs() -> dict[str, object]:
    outputs = {
        "backend": "true",
        "db": "false",
        "web": "true",
        "mobile": "false",
        "deploy": "false",
    }
    return {
        "changes": {"result": "success", "outputs": outputs},
        "gitleaks": {"result": "success"},
        "backend": {"result": "success"},
        "db": {"result": "skipped"},
        "web": {"result": "success"},
        "mobile": {"result": "skipped"},
        "deploy": {"result": "skipped"},
    }


class RequiredCheckValidationTests(unittest.TestCase):
    def test_accepts_successful_changed_and_skipped_unchanged_components(self) -> None:
        rows, errors = validate_required_checks(make_needs())

        self.assertEqual(errors, [])
        self.assertIn(
            {"component": "db", "changed": "no", "result": "skipped"}, rows
        )
        self.assertIn(
            {"component": "backend", "changed": "yes", "result": "success"},
            rows,
        )
        self.assertIn("Overall result: Passed", format_summary(rows, errors))
        self.assertIn("Skipped / not applicable", format_summary(rows, errors))

    def test_summary_distinguishes_failed_cancelled_and_unknown_results(self) -> None:
        summary = format_summary(
            [
                {"component": "mobile", "changed": "yes", "result": "failure"},
                {"component": "web", "changed": "yes", "result": "cancelled"},
                {"component": "db", "changed": "no", "result": "unexpected"},
            ],
            ["mobile failed"],
        )

        self.assertIn("| mobile | yes | Failed |", summary)
        self.assertIn("| web | yes | Cancelled |", summary)
        self.assertIn("| db | no | unexpected |", summary)

    def test_fails_when_a_changed_component_fails(self) -> None:
        needs = make_needs()
        needs["mobile"] = {"result": "failure"}
        needs["changes"]["outputs"]["mobile"] = "true"

        _, errors = validate_required_checks(needs)

        self.assertTrue(any("mobile changed and must succeed" in error for error in errors))

    def test_fails_when_an_unchanged_component_did_not_skip(self) -> None:
        needs = make_needs()
        needs["deploy"] = {"result": "success"}

        _, errors = validate_required_checks(needs)

        self.assertTrue(any("deploy is unchanged and must be skipped" in error for error in errors))

    def test_fails_for_missing_or_invalid_change_filter_values(self) -> None:
        needs = make_needs()
        needs["changes"]["outputs"].pop("db")
        needs["changes"]["outputs"]["deploy"] = "unknown"

        _, errors = validate_required_checks(needs)

        self.assertTrue(any("db has an invalid or missing" in error for error in errors))
        self.assertTrue(any("deploy has an invalid or missing" in error for error in errors))

    def test_requires_change_detection_and_gitleaks_to_succeed(self) -> None:
        needs = make_needs()
        needs["changes"]["result"] = "failure"
        needs["gitleaks"]["result"] = "cancelled"

        _, errors = validate_required_checks(needs)

        self.assertTrue(any("changes must succeed" in error for error in errors))
        self.assertTrue(any("gitleaks must succeed" in error for error in errors))

    def test_fails_for_missing_job_results(self) -> None:
        needs = make_needs()
        del needs["web"]

        _, errors = validate_required_checks(needs)

        self.assertTrue(any("web changed and must succeed" in error for error in errors))

    def test_rejects_a_malformed_needs_object(self) -> None:
        rows, errors = validate_required_checks(None)

        self.assertEqual(rows, [])
        self.assertEqual(len(errors), 1)


if __name__ == "__main__":
    unittest.main()
