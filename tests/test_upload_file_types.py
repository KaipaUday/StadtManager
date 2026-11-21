"""End-to-end checks for uploading, storing, indexing and serving the new file types."""

import asyncio
import io
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
<<<<<<< HEAD
from types import SimpleNamespace
=======
>>>>>>> origin/master

ROOT = Path(__file__).resolve().parents[1]
for path in (ROOT, ROOT / "tests"):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

_bootstrap_database = tempfile.TemporaryDirectory(prefix="stadtmanager-types-bootstrap-")
os.environ.setdefault("STADTMANAGER_DB_PATH", str(Path(_bootstrap_database.name) / "bootstrap.sqlite3"))

import pymupdf  # noqa: E402
from fastapi import BackgroundTasks, HTTPException, UploadFile  # noqa: E402

from Site import app as module  # noqa: E402
import sample_files as sf  # noqa: E402

FIXTURES = Path(__file__).resolve().parent / "fixtures"
HAS_PYMUPDF = hasattr(pymupdf, "Pixmap")


def upload(filename: str, raw: bytes) -> UploadFile:
    return UploadFile(file=io.BytesIO(raw), filename=filename)


class UploadFileTypeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.original_db_path = module.DB_PATH
        self.database_directory = tempfile.TemporaryDirectory(prefix="stadtmanager-types-")
        module.DB_PATH = Path(self.database_directory.name) / "test.sqlite3"
        module.initialize_database()
<<<<<<< HEAD
        self.request = SimpleNamespace(state=SimpleNamespace(user={"role": module.ROLE_CITY_ADMIN}))
=======
>>>>>>> origin/master
        self.previous_keys = {
            name: os.environ.pop(name, None) for name in ("ANTHROPIC_API_KEY", "OPENAI_API_KEY")
        }
        self.house_number = 0

    def tearDown(self) -> None:
        module.DB_PATH = self.original_db_path
        for name, value in self.previous_keys.items():
            if value is not None:
                os.environ[name] = value
        self.database_directory.cleanup()

    def save(self, filename: str, raw: bytes) -> dict:
        self.house_number += 1
        tasks = BackgroundTasks()
        result = asyncio.run(module.save_building(
<<<<<<< HEAD
            self.request,
=======
>>>>>>> origin/master
            tasks,
            upload(filename, raw),
            object_name=f"Test {filename}",
            street_name="Ketschengasse",
            house_number=str(self.house_number),
            address="",
            latitude="",
            longitude="",
            address_verified="false",
            fields_json=json.dumps({"Source": filename}),
            maintenance_json="[]",
            merge_target_uid="",
            conflict_resolutions_json="{}",
        ))
        for task in tasks.tasks:  # run the background indexing synchronously
            task.func(*task.args, **task.kwargs)
        return result

    def index_state(self, building_id: int) -> tuple[str, int]:
        with module.database() as connection:
            state = connection.execute(
                "SELECT status FROM document_index_state WHERE building_id = ?", (building_id,)
            ).fetchone()
            chunks = connection.execute(
                "SELECT count(*) FROM document_text WHERE building_id = ?", (building_id,)
            ).fetchone()[0]
        return state["status"], chunks

    def test_office_mail_and_construction_files_are_saved_and_searchable(self) -> None:
        files = {
            "bericht.doc": ((FIXTURES / "sample-word97.doc").read_bytes(), "Zeughaus"),
            "kosten.xls": ((FIXTURES / "sample-excel97.xls").read_bytes(), "Dach"),
            "meldung.msg": (sf.outlook_message("Heizung", "Hausmeister", "Amt", "Waermepumpe defekt"), "Waermepumpe"),
            "lv.d83": (sf.SAMPLE_GAEB90, "Unterspannbahn"),
            "grundriss.dxf": (sf.SAMPLE_DXF.encode(), "Erdgeschoss"),
            "folien.pptx": (sf.minimal_pptx("Fassadensanierung"), "Fassadensanierung"),
        }
        for filename, (raw, search_word) in files.items():
            with self.subTest(filename=filename):
                parsed = module.process_upload(filename, raw)
                self.assertTrue(parsed["content"], filename)
                saved = self.save(filename, raw)
                status, chunks = self.index_state(saved["id"])
                self.assertEqual(status, "ready", filename)
                self.assertGreater(chunks, 0)
                context, *_ = module.search_saved_documents(search_word)
                self.assertIn(filename, context)

    def test_binary_cad_files_are_stored_for_manual_review(self) -> None:
        raw = b"AC1032" + bytes(512)
<<<<<<< HEAD
        extracted = asyncio.run(module.extract_document(
            self.request, upload("plan.dwg", raw), provider="anthropic", model=""
        ))
=======
        extracted = asyncio.run(module.extract_document(upload("plan.dwg", raw), provider="anthropic", model=""))
>>>>>>> origin/master
        self.assertEqual(extracted["kind"], "CAD drawing (DWG)")
        self.assertIn("DWG drawings are saved", extracted["extraction_error"])
        saved = self.save("plan.dwg", raw)
        with module.database() as connection:
            stored = connection.execute("SELECT file_data FROM buildings WHERE id = ?", (saved["id"],)).fetchone()
        self.assertEqual(bytes(stored["file_data"]), raw)
        self.assertEqual(self.index_state(saved["id"]), ("partial", 0))

    def test_unsupported_type_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            module.process_upload("setup.exe", b"MZ")
        with self.assertRaises(HTTPException) as raised:
            self.save("setup.exe", b"MZ")
        self.assertEqual(raised.exception.status_code, 415)

    def test_uploaded_html_is_downloaded_not_rendered(self) -> None:
        saved = self.save("seite.html", b"<script>alert(document.cookie)</script><p>Rathaus</p>")
<<<<<<< HEAD
        response = asyncio.run(module.get_building_file(saved["id"], self.request))
=======
        response = asyncio.run(module.get_building_file(saved["id"]))
>>>>>>> origin/master
        self.assertEqual(response.media_type, "application/octet-stream")
        self.assertTrue(response.headers["content-disposition"].startswith("attachment"))
        self.assertEqual(response.headers["x-content-type-options"], "nosniff")

    def test_semicolon_csv_from_german_excel(self) -> None:
        parsed = module.process_upload("liste.csv", "Straße;Nr\nMarktplatz;1\n".encode("cp1252"))
        self.assertEqual(parsed["preview"], [{"Straße": "Marktplatz", "Nr": "1"}])

    @unittest.skipUnless(HAS_PYMUPDF, "PyMuPDF is required for images")
    def test_images_get_preview_pages_and_can_be_saved(self) -> None:
        document = pymupdf.open()
        page = document.new_page(width=600, height=200)
        page.insert_text((30, 100), "Grundriss Erdgeschoss", fontsize=30)
        png = page.get_pixmap(dpi=100).tobytes("png")
        jpg = page.get_pixmap(dpi=100).tobytes("jpeg")

        for filename, raw, kind in (("plan.png", png, "Image (PNG)"), ("foto.JPG", jpg, "Image (JPG)")):
            with self.subTest(filename=filename):
                parsed = module.process_upload(filename, raw)
                self.assertEqual(parsed["kind"], kind)
                self.assertIn("image page", parsed["details"])
                self.assertTrue(module.image_to_pdf(raw, Path(filename).suffix).startswith(b"%PDF"))

        saved = self.save("plan.png", png)
<<<<<<< HEAD
        assets = asyncio.run(module.get_building_assets(saved["id"], self.request))["assets"]
        self.assertEqual([asset["asset_type"] for asset in assets], ["floorplan-page"])
        response = asyncio.run(module.get_building_file(saved["id"], self.request))
=======
        assets = asyncio.run(module.get_building_assets(saved["id"]))["assets"]
        self.assertEqual([asset["asset_type"] for asset in assets], ["floorplan-page"])
        response = asyncio.run(module.get_building_file(saved["id"]))
>>>>>>> origin/master
        self.assertEqual(response.media_type, "image/png")

    @unittest.skipUnless(HAS_PYMUPDF, "PyMuPDF is required for images")
    def test_damaged_image_is_still_saved(self) -> None:
        parsed = module.process_upload("kaputt.jpg", b"not an image")
        self.assertEqual(parsed["content"], "")
        saved = self.save("kaputt.jpg", b"not an image")
        self.assertEqual(saved["asset_warnings"], ["The image was saved, but no preview could be created."])

    @unittest.skipUnless(HAS_PYMUPDF and shutil.which("tesseract"), "PyMuPDF and Tesseract are required for OCR")
    def test_scanned_image_text_is_recognized(self) -> None:
        document = pymupdf.open()
        page = document.new_page(width=800, height=300)
        page.insert_text((35, 120), "OCR heating inspection 2028", fontsize=36)
        png = page.get_pixmap(dpi=150).tobytes("png")
        parsed = module.process_upload("scan.png", png)
        self.assertIn("heating", parsed["content"].casefold())
        self.assertIn("OCR on 1 page", parsed["details"])


if __name__ == "__main__":
    unittest.main()
