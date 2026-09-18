"""End-to-end checks using explicitly fictional, locally generated documents."""

import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from PIL import Image, ImageDraw, ImageFont
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "convert_pdf.py"


class PdfConversionTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        base = ROOT / ".research" / "tests"
        base.mkdir(parents=True, exist_ok=True)
        cls.fixture_dir = Path(tempfile.mkdtemp(prefix="docling-", dir=base))
        cls.pdf = cls.fixture_dir / "fictional-archive.pdf"
        document = canvas.Canvas(str(cls.pdf))
        document.setFont("Helvetica", 18)
        document.drawString(60, 750, "Fictional Harbor Archive")
        document.setFont("Helvetica", 12)
        document.drawString(60, 720, "Example Trading Company was founded in 1842.")
        document.showPage()
        scan = Image.new("RGB", (1400, 600), "white")
        draw = ImageDraw.Draw(scan)
        font = ImageFont.load_default(size=44)
        draw.text((70, 80), "FICTIONAL SCANNED RECORD", font=font, fill="black")
        draw.text((70, 180), "EXAMPLE MILL OPENED IN 1882", font=font, fill="black")
        document.drawImage(ImageReader(scan), 40, 450, width=520, height=223)
        document.save()

    def invoke(self, *args):
        return subprocess.run(
            [sys.executable, str(SCRIPT), *map(str, args)],
            cwd=ROOT, capture_output=True, text=True, timeout=600,
        )

    def test_mixed_pdf_preserves_original_and_extracts_scan_with_locations(self):
        result = self.invoke(self.pdf, "--device", "cpu")
        self.assertEqual(result.returncode, 0, result.stderr)
        manifest = json.loads(result.stdout)
        directory = Path(manifest["directory"])
        self.assertTrue(directory.is_relative_to(ROOT / ".research"))
        original = (directory / "original.pdf").read_bytes()
        self.assertEqual(original, self.pdf.read_bytes())
        self.assertEqual(hashlib.sha256(original).hexdigest(), manifest["sha256"])
        self.assertEqual(manifest["processedPages"], [1, 2])
        self.assertEqual(manifest["totalPages"], 2)
        self.assertFalse(manifest["requestedSubset"])
        markdown = (directory / "document.md").read_text()
        self.assertIn("Example Trading Company", markdown)
        self.assertIn("1842", markdown)
        self.assertIn("EXAMPLE MILL OPENED IN 1882", markdown)
        structured = json.loads((directory / "document.json").read_text())
        scanned = [item for item in structured["texts"] if "1882" in item["text"]]
        self.assertTrue(scanned)
        self.assertEqual(scanned[0]["prov"][0]["page_no"], 2)
        self.assertIn("bbox", scanned[0]["prov"][0])
        saved = json.loads((directory / "manifest.json").read_text())
        self.assertEqual(saved["status"], "done")
        self.assertTrue(saved["processor"]["version"])

    def test_explicit_page_range_records_coverage(self):
        result = self.invoke(self.pdf, "--pages", 1, 1, "--device", "cpu", "--ocr", "off")
        self.assertEqual(result.returncode, 0, result.stderr)
        manifest = json.loads(result.stdout)
        self.assertTrue(manifest["requestedSubset"])
        self.assertEqual(manifest["processedPages"], [1])
        self.assertEqual(manifest["totalPages"], 2)
        self.assertIsNone(manifest["settings"]["ocrEngine"])

    def test_rejects_non_pdf_and_invalid_page_range(self):
        fake = self.fixture_dir / "not-a-pdf.pdf"
        fake.write_text("<html>Access denied</html>")
        result = self.invoke(fake)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("PDF header", result.stderr)
        result = self.invoke(self.pdf, "--pages", 2, 1)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("positive and ordered", result.stderr)

    def test_portable_ocr_backend_extracts_scanned_page(self):
        result = self.invoke(self.pdf, "--pages", 2, 2, "--device", "cpu", "--ocr-engine", "rapidocr")
        self.assertEqual(result.returncode, 0, result.stderr)
        manifest = json.loads(result.stdout)
        self.assertEqual(manifest["settings"]["ocrEngine"], "rapidocr")
        markdown = (Path(manifest["directory"]) / "document.md").read_text()
        self.assertIn("EXAMPLE MILL OPENED IN 1882", markdown)


if __name__ == "__main__":
    unittest.main()
