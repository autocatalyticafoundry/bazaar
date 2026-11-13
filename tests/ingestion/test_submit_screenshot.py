import importlib.util
import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("screenshot_runner", Path(__file__).resolve().parents[1] / "scripts" / "submit_screenshot.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class ScreenshotRunnerTests(unittest.TestCase):
    def test_prepare_exact_png_sha_and_dimensions(self):
        import hashlib
        buf = b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\x0dIHDR" + struct.pack(">II", 2048, 1281) + b"\x08\x02\x00\x00\x00" + b"\x00\x00\x00\x00"
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "picture.png"
            p.write_bytes(buf)
            out, sha, w, h = mod.image_info(p)
        self.assertEqual((w, h), (2048, 1281))
        self.assertEqual(out, buf)
        self.assertEqual(sha, hashlib.sha256(buf).hexdigest())

    def test_rejects_non_png(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "picture.png"
            p.write_bytes(b"x" * 40)
            with self.assertRaisesRegex(ValueError, "PNG"):
                mod.image_info(p)

    def test_enqueues_fullcatalog_job(self):
        with patch.object(mod, "call") as c:
            mod.enqueue_start("secret", "accountid", "q123", "perception/inputs/" + "a" * 64 + ".png", "a" * 64)
        args = c.call_args
        self.assertEqual(args.args[:2], ("secret", "POST"))
        payload = json.loads(args.args[3])
        self.assertEqual(payload["content_type"], "json")
        self.assertEqual(payload["body"]["kind"], "fullcatalog_start_v2")

    def test_summary_never_labels_scores_as_probabilities(self):
        locator = {"regions": [{"region_id": "region-01", "bbox": {"x": 10, "y": 20, "width": 140, "height": 280}}]}
        rank = {"top": [{"canonical_entity_id": "bazaar:item:foo", "score": 0.8223}]}
        with patch.object(mod, "load_json", side_effect=[locator, rank]):
            doc = mod.summarize("t", "a", "b", "c" * 64)
        self.assertEqual(doc["status"], "ranked")
        self.assertEqual(doc["regions"][0]["candidates"][0]["canonical_entity_id"], "bazaar:item:foo")
        self.assertFalse(doc["identity_probabilities_calibrated"])


if __name__ == "__main__":
    unittest.main()
