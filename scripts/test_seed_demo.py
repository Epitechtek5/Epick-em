"""Offline checks for account fixtures; never access the API or database."""
import contextlib
import copy
import io
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from seed_demo import NOTIFICATION_CATEGORIES, USERS, configure_accounts


class FakeApi:
    def __init__(self):
        self.settings = {}
        self.profiles = {}

    def request(self, method, path, payload, token, expected):
        assert method == "PATCH"
        assert expected == (200,)
        if path == "/me/settings":
            self.settings[token] = copy.deepcopy(payload)
        elif path == "/me/update":
            self.profiles[token] = {"picture_url": payload["picture_url"] or None}
        else:
            raise AssertionError(path)

    def get(self, path, token):
        if path == "/me/settings":
            return copy.deepcopy(self.settings[token])
        if path == "/me":
            return self.profiles[token].copy()
        raise AssertionError(path)


class AccountFixtureTests(unittest.TestCase):
    def setUp(self):
        self.users = {name: {"token": f"token-{name}"} for name in ["seed_admin", *USERS]}

    def configure(self, api):
        with contextlib.redirect_stdout(io.StringIO()):
            return configure_accounts(api, self.users)

    def test_profiles_cover_languages_themes_channels_and_avatar_fallback(self):
        profiles = self.configure(FakeApi())
        settings = [profile["settings"] for profile in profiles.values()]
        self.assertEqual({item["language"] for item in settings}, {"fr", "en", "es"})
        self.assertEqual({item["theme"] for item in settings}, {"system", "light", "dark"})
        self.assertEqual(
            {(item["notifications"]["teams"]["email"], item["notifications"]["teams"]["push"]) for item in settings},
            {(True, True), (True, False), (False, True), (False, False)},
        )
        for item in settings:
            self.assertEqual(set(item["notifications"]), set(NOTIFICATION_CATEGORIES))
        pictures = [profile["picture_url"] for profile in profiles.values()]
        self.assertIn(None, pictures)
        self.assertTrue(any(pictures))
        self.assertNotIn("token-", str(profiles))

    def test_rejects_settings_that_were_not_persisted(self):
        class StaleApi(FakeApi):
            def get(self, path, token):
                result = super().get(path, token)
                if path == "/me/settings":
                    result["language"] = "es"
                return result

        with self.assertRaisesRegex(RuntimeError, "Settings did not persist"):
            self.configure(StaleApi())

    def test_rejects_picture_that_was_not_persisted(self):
        class StaleApi(FakeApi):
            def get(self, path, token):
                result = super().get(path, token)
                if path == "/me":
                    result["picture_url"] = "https://example.test/stale.png"
                return result

        with self.assertRaisesRegex(RuntimeError, "Profile picture did not persist"):
            self.configure(StaleApi())


if __name__ == "__main__":
    unittest.main()
