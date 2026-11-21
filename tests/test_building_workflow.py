import base64
import json
import os
import shutil
import sqlite3
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pymupdf


_bootstrap_database = tempfile.TemporaryDirectory(prefix="stadtmanager-bootstrap-")
os.environ["STADTMANAGER_DB_PATH"] = str(Path(_bootstrap_database.name) / "bootstrap.sqlite3")

from Site import app as module
from fastapi.testclient import TestClient


class BuildingWorkflowTests(unittest.TestCase):
    def setUp(self) -> None:
        self.original_db_path = module.DB_PATH
        self.database_directory = tempfile.TemporaryDirectory(prefix="stadtmanager-test-")
        module.DB_PATH = Path(self.database_directory.name) / "test.sqlite3"
        module.initialize_database()
        self.client = TestClient(module.app)
        self.previous_keys = {
            name: os.environ.pop(name, None)
            for name in ("ANTHROPIC_API_KEY", "OPENAI_API_KEY")
        }

    def tearDown(self) -> None:
        self.client.close()
        module.DB_PATH = self.original_db_path
        for name, value in self.previous_keys.items():
            if value is not None:
                os.environ[name] = value
        self.database_directory.cleanup()

    def test_extract_review_and_save_persists_file_and_categories(self) -> None:
        os.environ["ANTHROPIC_API_KEY"] = "test-key-not-sent"
        extraction = {
            "object_name": "Coburg Town Hall",
            "address": "Marktplatz 1, Coburg",
            "latitude": 50.258,
            "longitude": 10.964,
            "fields": {"Heating system": "District heating"},
            "other_fields": [{"name": "Roof material", "value": "Slate"}],
            "maintenance_findings": [{
                "title": "Repair damaged roof tiles",
                "action_type": "repair",
                "severity": "high",
                "due_date": "2027-06-01",
                "evidence": "The roof inspection recommends repairing damaged tiles by June 2027.",
            }],
        }
        fake_client = SimpleNamespace(
            messages=SimpleNamespace(
                create=AsyncMock(
                    return_value=SimpleNamespace(
                        content=[SimpleNamespace(type="text", text=json.dumps(extraction))]
                    )
                )
            )
        )
        with patch.object(module, "AsyncAnthropic", return_value=fake_client):
            response = self.client.post(
                "/api/extract",
                data={"provider": "anthropic", "model": "claude-sonnet-5-5"},
                files={"file": ("town-hall.txt", b"Town hall building details", "text/plain")},
            )

        self.assertEqual(response.status_code, 200, response.text)
        extracted = response.json()
        self.assertEqual(extracted["object_name"], "Coburg Town Hall")
        self.assertEqual((extracted["street_name"], extracted["house_number"]), ("Marktplatz", "1"))
        self.assertEqual(extracted["fields"]["Heating system"], "District heating")
        self.assertEqual(extracted["other_fields"], [{"name": "Roof material", "value": "Slate"}])
        self.assertEqual(len(extracted["maintenance_findings"]), 1)

        saved = self.client.post(
            "/api/buildings",
            data={
                "object_name": extracted["object_name"],
                "street_name": extracted["street_name"],
                "house_number": extracted["house_number"],
                "latitude": str(extracted["latitude"]),
                "longitude": str(extracted["longitude"]),
                "fields_json": json.dumps({**extracted["fields"], "Roof material": "Slate"}),
                "maintenance_json": json.dumps(extracted["maintenance_findings"]),
            },
            files={"file": ("town-hall.pdf", b"%PDF test document", "application/pdf")},
        )
        self.assertEqual(saved.status_code, 200, saved.text)
        building_id = saved.json()["id"]

        building = self.client.get("/api/buildings").json()["buildings"][0]
        self.assertEqual(building["object_name"], "Coburg Town Hall")
        self.assertEqual(building["address"], "Marktplatz 1, Coburg")
        self.assertTrue(building["uid"])
        self.assertEqual(building["fields"], {
            "Heating system": "District heating",
            "Roof material": "Slate",
        })
        self.assertEqual((building["latitude"], building["longitude"]), (50.258, 10.964))
        self.assertIn("Roof material", self.client.get("/api/categories").json()["categories"])
        stored_file = self.client.get(f"/api/buildings/{building_id}/file")
        self.assertEqual(stored_file.content, b"%PDF test document")
        pending = self.client.get("/api/maintenance").json()["items"]
        self.assertEqual(len(pending), 1)
        self.assertEqual(pending[0]["status"], "suggested")
        confirmed = self.client.patch(f"/api/maintenance/{pending[0]['id']}", json={"action": "confirm"})
        self.assertEqual(confirmed.json()["status"], "active")
        self.assertEqual(self.client.get("/api/maintenance").json()["items"][0]["status"], "active")
        saved_context = json.loads(module.agent_database_context())
        self.assertEqual(saved_context["buildings"][0]["maintenance"][0]["status"], "active")

        follow_up_client = SimpleNamespace(
            messages=SimpleNamespace(
                create=AsyncMock(
                    return_value=SimpleNamespace(
                        content=[SimpleNamespace(
                            type="text",
                            text=json.dumps({
                                "object_name": "Library",
                                "fields": {"Roof material": "Copper"},
                            }),
                        )]
                    )
                )
            )
        )
        with patch.object(module, "AsyncAnthropic", return_value=follow_up_client):
            follow_up = self.client.post(
                "/api/extract",
                data={"provider": "anthropic", "model": "claude-sonnet-5-5"},
                files={"file": ("library.txt", b"Building: Library", "text/plain")},
            )
        self.assertIn(
            "Roof material",
            follow_up_client.messages.create.call_args.kwargs["messages"][0]["content"],
        )
        self.assertEqual(follow_up.json()["fields"], {"Roof material": "Copper"})

    def test_address_is_required_and_building_name_is_optional(self) -> None:
        response = self.client.post(
            "/api/buildings",
            data={"object_name": "Optional name"},
            files={"file": ("building.pdf", b"%PDF", "application/pdf")},
        )
        self.assertEqual(response.status_code, 422)
        self.assertIn("Street name is required", response.json()["detail"])

        saved = self.client.post(
            "/api/buildings",
            data={"street_name": "Hauptstraße", "house_number": "5a"},
            files={"file": ("building.txt", b"Building details", "text/plain")},
        )
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertEqual(saved.json()["object_name"], "Hauptstraße 5a")
        self.assertTrue(saved.json()["uid"])

    def test_same_address_reuses_uid_and_requires_conflict_review(self) -> None:
        first = self.client.post(
            "/api/buildings",
            data={
                "street_name": "Hauptstraße",
                "house_number": "5a",
                "fields_json": json.dumps({"Heating system": "Gas"}),
            },
            files={"file": ("first.txt", b"first source", "text/plain")},
        )
        self.assertEqual(first.status_code, 200, first.text)
        building_uid = first.json()["uid"]
        second_data = {
            "street_name": "HAUPTSTRASSE",
            "house_number": "5A",
            "fields_json": json.dumps({
                "Heating system": "Heat pump",
                "Roof material": "Slate",
            }),
        }

        conflict = self.client.post(
            "/api/buildings",
            data=second_data,
            files={"file": ("second.txt", b"second source", "text/plain")},
        )
        self.assertEqual(conflict.status_code, 409, conflict.text)
        self.assertEqual(conflict.json()["detail"]["code"], "value-conflicts")
        with module.database() as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM buildings").fetchone()[0], 1)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM building_documents").fetchone()[0], 0)

        second_data["conflict_resolutions_json"] = json.dumps({
            "Heating system": {"action": "replace", "expected_current": "Gas"},
        })
        merged = self.client.post(
            "/api/buildings",
            data=second_data,
            files={"file": ("second.txt", b"second source", "text/plain")},
        )
        self.assertEqual(merged.status_code, 200, merged.text)
        self.assertTrue(merged.json()["merged"])
        self.assertEqual(merged.json()["uid"], building_uid)
        buildings = self.client.get("/api/buildings").json()["buildings"]
        self.assertEqual(len(buildings), 1)
        self.assertEqual(buildings[0]["address"], "Hauptstraße 5a, Coburg")
        self.assertEqual(buildings[0]["fields"], {
            "Heating system": "Heat pump",
            "Roof material": "Slate",
        })
        self.assertEqual(buildings[0]["document_count"], 1)
        documents = self.client.get(f"/api/buildings/{merged.json()['id']}/documents").json()["documents"]
        self.assertEqual(len(documents), 2)
        additional = next(document for document in documents if not document["is_primary"])
        self.assertEqual(
            self.client.get(additional["url"]).content,
            b"second source",
        )
        with module.database() as connection:
            history = connection.execute(
                "SELECT previous_value, replacement_value FROM building_value_history"
            ).fetchone()
        self.assertEqual(tuple(history), ("Gas", "Heat pump"))

    def test_same_street_with_different_house_number_is_a_different_building(self) -> None:
        for house_number in ("4", "6"):
            response = self.client.post(
                "/api/buildings",
                data={"street_name": "Bahnhofstraße", "house_number": house_number},
                files={"file": (f"{house_number}.txt", b"building", "text/plain")},
            )
            self.assertEqual(response.status_code, 200, response.text)
        buildings = self.client.get("/api/buildings").json()["buildings"]
        self.assertEqual(len(buildings), 2)
        self.assertNotEqual(buildings[0]["uid"], buildings[1]["uid"])

    def test_database_migration_assigns_uid_and_parses_legacy_address(self) -> None:
        original_path = module.DB_PATH
        legacy_path = Path(self.database_directory.name) / "legacy.sqlite3"
        with sqlite3.connect(legacy_path) as connection:
            connection.execute(
                """CREATE TABLE buildings (
                   id INTEGER PRIMARY KEY, object_name TEXT NOT NULL, address TEXT NOT NULL DEFAULT '',
                   latitude REAL, longitude REAL, file_name TEXT NOT NULL, mime_type TEXT NOT NULL,
                   file_data BLOB NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"""
            )
            connection.execute(
                """INSERT INTO buildings
                   (object_name, address, file_name, mime_type, file_data)
                   VALUES ('Legacy building', 'Marktplatz 10a, Coburg', 'legacy.txt', 'text/plain', ?)""",
                (b"legacy",),
            )
            connection.execute(
                """CREATE TABLE building_assets (
                   id INTEGER PRIMARY KEY, building_id INTEGER NOT NULL, asset_type TEXT NOT NULL,
                   page_number INTEGER NOT NULL, file_name TEXT NOT NULL, mime_type TEXT NOT NULL,
                   file_data BLOB NOT NULL, UNIQUE (building_id, asset_type, page_number, file_name))"""
            )
            connection.execute(
                """CREATE TABLE building_twins (
                   building_id INTEGER PRIMARY KEY, model_json TEXT NOT NULL,
                   updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"""
            )
        try:
            module.DB_PATH = legacy_path
            module.initialize_database()
            with module.database() as connection:
                building = connection.execute(
                    "SELECT uid, street_name, house_number, address_key FROM buildings"
                ).fetchone()
                asset_columns = {
                    row["name"] for row in connection.execute("PRAGMA table_info(building_assets)")
                }
                twin_columns = {
                    row["name"] for row in connection.execute("PRAGMA table_info(building_twins)")
                }
                pending_status = connection.execute(
                    "SELECT status FROM document_index_state WHERE source_key = 'building:1'"
                ).fetchone()
            self.assertEqual((building["street_name"], building["house_number"]), ("Marktplatz", "10a"))
            self.assertTrue(building["uid"])
            self.assertTrue(building["address_key"])
            self.assertIn("document_id", asset_columns)
            self.assertIn("source_document_id", twin_columns)
            self.assertEqual(pending_status["status"], "pending")
            module.index_pending_documents()
            indexed_text, index_count, _ = module.search_saved_documents("legacy building Marktplatz")
            self.assertEqual(index_count, 1)
            self.assertIn("Legacy building", indexed_text)
        finally:
            module.DB_PATH = original_path

    def test_missing_api_key_returns_manual_review_data(self) -> None:
        response = self.client.post(
            "/api/extract",
            data={"provider": "anthropic"},
            files={"file": ("building.txt", b"Building details", "text/plain")},
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("ANTHROPIC_API_KEY is not set", response.json()["extraction_error"])

    def test_agent_chat_receives_saved_building_data_without_file_blob(self) -> None:
        saved = self.client.post(
            "/api/buildings",
            data={
                "object_name": "Coburg Library",
                "street_name": "Herrngasse",
                "house_number": "7",
                "fields_json": json.dumps({"Heating system": "District heating"}),
            },
            files={"file": ("library.txt", b"original-file-secret-text", "text/plain")},
        )
        self.assertEqual(saved.status_code, 200, saved.text)

        os.environ["ANTHROPIC_API_KEY"] = "test-key-not-sent"
        fake_client = SimpleNamespace(
            messages=SimpleNamespace(
                create=AsyncMock(
                    return_value=SimpleNamespace(
                        content=[SimpleNamespace(type="text", text="The library uses district heating.")]
                    )
                )
            )
        )
        with patch.object(module, "AsyncAnthropic", return_value=fake_client):
            response = self.client.post(
                "/api/agent/chat",
                json={
                    "provider": "anthropic",
                    "messages": [{"role": "user", "content": "What heating does the library use?"}],
                },
            )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["reply"], "The library uses district heating.")
        system_prompt = fake_client.messages.create.call_args.kwargs["system"]
        self.assertIn("Coburg Library", system_prompt)
        self.assertIn("District heating", system_prompt)
        self.assertNotIn("original-file-secret-text", system_prompt)
        self.assertIn("Targeted SQLite search for the latest user question", system_prompt)
        self.assertIn("Automatic full-text document search for the latest user question", system_prompt)

    def test_chat_searches_indexed_documents_and_returns_page_evidence(self) -> None:
        source_text = (
            "The emergency generator inspection must be renewed before the end of 2028. "
            "The service record was signed by the building manager."
        )
        saved = self.client.post(
            "/api/buildings",
            data={"street_name": "Theaterplatz", "house_number": "1"},
            files={"file": ("generator-inspection.txt", source_text.encode(), "text/plain")},
        )
        self.assertEqual(saved.status_code, 200, saved.text)

        documents = self.client.get(f"/api/buildings/{saved.json()['id']}/documents").json()["documents"]
        self.assertEqual(documents[0]["index_status"], "ready")
        serialized, result_count, pending = module.search_saved_documents(
            "When should the generator inspection be renewed?"
        )
        self.assertEqual(result_count, 1)
        self.assertEqual(pending, 0)
        search_result = json.loads(serialized)["matches"][0]
        self.assertEqual(search_result["file"], "generator-inspection.txt")
        self.assertEqual(search_result["page"], 1)
        self.assertIn("before the end of 2028", search_result["evidence"])

        os.environ["ANTHROPIC_API_KEY"] = "test-key-not-sent"
        fake_client = SimpleNamespace(
            messages=SimpleNamespace(
                create=AsyncMock(
                    return_value=SimpleNamespace(
                        content=[SimpleNamespace(type="text", text="The inspection should be renewed by 2028 [generator-inspection.txt, page 1].")]
                    )
                )
            )
        )
        with patch.object(module, "AsyncAnthropic", return_value=fake_client):
            answer = self.client.post(
                "/api/agent/chat",
                json={
                    "provider": "anthropic",
                    "messages": [{"role": "user", "content": "When should the generator inspection be renewed?"}],
                },
            )
        self.assertEqual(answer.status_code, 200, answer.text)
        system_prompt = fake_client.messages.create.call_args.kwargs["system"]
        self.assertIn("generator-inspection.txt", system_prompt)
        self.assertIn("before the end of 2028", system_prompt)
        self.assertIn("page", system_prompt)

    def test_upload_limit_exceeds_previous_five_megabyte_cap(self) -> None:
        self.assertGreater(module.MAX_UPLOAD_BYTES, 5 * 1024 * 1024)
        content = b"x" * (5 * 1024 * 1024 + 1)
        response = self.client.post(
            "/api/process-files",
            files={"files": ("large.txt", content, "text/plain")},
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertNotIn("error", response.json()["files"][0])

    def test_pdf_page_limit_is_reported_for_large_documents(self) -> None:
        document = pymupdf.open()
        for _ in range(module.MAX_PREVIEW_PDF_PAGES + 1):
            document.new_page()
        pages, warnings, page_count = module.extract_pdf_pages(
            document.tobytes(),
            page_limit=module.MAX_PREVIEW_PDF_PAGES,
            ocr_scanned_pages=False,
        )
        self.assertEqual(page_count, module.MAX_PREVIEW_PDF_PAGES + 1)
        self.assertEqual(len(pages), module.MAX_PREVIEW_PDF_PAGES)
        self.assertTrue(any("Only the first" in warning for warning in warnings))

    @unittest.skipUnless(shutil.which("tesseract"), "Tesseract is required for OCR")
    def test_scanned_pdf_uses_ocr_for_searchable_text(self) -> None:
        source = pymupdf.open()
        page = source.new_page(width=800, height=300)
        page.insert_text((35, 120), "OCR generator inspection 2028", fontsize=36)
        image_bytes = page.get_pixmap(dpi=150).tobytes("png")
        scanned = pymupdf.open()
        scanned_page = scanned.new_page(width=800, height=300)
        scanned_page.insert_image(scanned_page.rect, stream=image_bytes)

        pages, warnings, _ = module.extract_pdf_pages(scanned.tobytes())
        self.assertIn("generator", pages[0]["content"].casefold())
        self.assertTrue(pages[0]["used_ocr"])
        self.assertFalse(any("Tesseract OCR" in warning for warning in warnings))

    def test_agent_database_context_marks_records_beyond_limit_as_truncated(self) -> None:
        with module.database() as connection:
            connection.executemany(
                """INSERT INTO buildings
                   (object_name, address, file_name, mime_type, file_data)
                   VALUES (?, '', 'building.txt', 'text/plain', ?)""",
                [(f"Building {index}", b"") for index in range(101)],
            )

        context = json.loads(module.agent_database_context())
        self.assertEqual(context["total_buildings"], 101)
        self.assertEqual(context["included_buildings"], module.MAX_AGENT_DB_BUILDINGS)
        self.assertTrue(context["truncated"])

    def test_agent_database_context_obeys_character_limit(self) -> None:
        with module.database() as connection:
            building_id = connection.execute(
                """INSERT INTO buildings
                   (object_name, address, file_name, mime_type, file_data)
                   VALUES ('Large record', '', 'building.txt', 'text/plain', ?)""",
                (b"",),
            ).lastrowid
            for index in range(8):
                category = f"Property {index}"
                connection.execute("INSERT INTO categories (name) VALUES (?)", (category,))
                category_id = connection.execute(
                    "SELECT id FROM categories WHERE name = ?",
                    (category,),
                ).fetchone()["id"]
                connection.execute(
                    "INSERT INTO building_values (building_id, category_id, value) VALUES (?, ?, ?)",
                    (building_id, category_id, "x" * 2_000),
                )

        serialized_context = module.agent_database_context()
        context = json.loads(serialized_context)
        self.assertLessEqual(len(serialized_context), module.MAX_AGENT_DB_CONTEXT_CHARS)
        self.assertTrue(context["truncated"])

    def test_pdf_images_and_reviewed_twin_are_saved_for_building(self) -> None:
        image_bytes = base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQmcAAAAASUVORK5CYII="
        )
        document = pymupdf.open()
        page = document.new_page()
        page.insert_text((40, 40), "Floor plan")
        page.insert_image(pymupdf.Rect(50, 60, 120, 130), stream=image_bytes)
        pdf_bytes = document.tobytes()

        saved = self.client.post(
            "/api/buildings",
            data={
                "object_name": "Floor Plan Test",
                "street_name": "Marktplatz",
                "house_number": "2",
            },
            files={"file": ("floor-plan.pdf", pdf_bytes, "application/pdf")},
        )
        self.assertEqual(saved.status_code, 200, saved.text)
        building_id = saved.json()["id"]
        self.assertEqual(saved.json()["plan_page_count"], 1)
        self.assertEqual(saved.json()["embedded_image_count"], 1)

        assets = self.client.get(f"/api/buildings/{building_id}/assets").json()["assets"]
        self.assertEqual({asset["asset_type"] for asset in assets}, {"floorplan-page", "embedded-image"})
        extracted_image = next(asset for asset in assets if asset["asset_type"] == "embedded-image")
        image_response = self.client.get(extracted_image["url"])
        self.assertEqual(image_response.status_code, 200)
        self.assertTrue(image_response.headers["content-type"].startswith("image/png"))

        os.environ["ANTHROPIC_API_KEY"] = "test-key-not-sent"
        twin_response = {
            "format": "stadtmanager-twin-v1",
            "units": "relative",
            "scale_note": "Approximate; no scale was shown.",
            "floors": [{
                "level": 0,
                "name": "Ground floor",
                "rooms": [{
                    "name": "Main room",
                    "x": 0,
                    "z": 0,
                    "width": 8,
                    "depth": 6,
                    "height": 2.8,
                    "confidence": "low",
                }],
            }],
        }
        fake_client = SimpleNamespace(
            messages=SimpleNamespace(
                create=AsyncMock(
                    return_value=SimpleNamespace(
                        content=[SimpleNamespace(type="text", text=json.dumps(twin_response))]
                    )
                )
            )
        )
        with patch.object(module, "AsyncAnthropic", return_value=fake_client):
            draft = self.client.post(
                f"/api/buildings/{building_id}/twin/draft",
                json={"provider": "anthropic"},
            )
        self.assertEqual(draft.status_code, 200, draft.text)
        self.assertEqual(draft.json()["twin"]["format"], "stadtmanager-twin-v1")
        sent_content = fake_client.messages.create.call_args.kwargs["messages"][0]["content"]
        self.assertTrue(any(block["type"] == "image" for block in sent_content))
        self.assertIsNone(self.client.get(f"/api/buildings/{building_id}/twin").json()["twin"])

        additional_pdf = self.client.post(
            "/api/buildings",
            data={"street_name": "Marktplatz", "house_number": "2"},
            files={"file": ("floor-plan-update.pdf", pdf_bytes, "application/pdf")},
        )
        self.assertEqual(additional_pdf.status_code, 200, additional_pdf.text)
        self.assertTrue(additional_pdf.json()["merged"])
        added_document = next(
            document
            for document in self.client.get(f"/api/buildings/{building_id}/documents").json()["documents"]
            if not document["is_primary"]
        )
        with patch.object(module, "AsyncAnthropic", return_value=fake_client):
            added_draft = self.client.post(
                f"/api/buildings/{building_id}/twin/draft",
                json={"provider": "anthropic", "document_id": added_document["id"]},
            )
        self.assertEqual(added_draft.status_code, 200, added_draft.text)
        self.assertEqual(added_draft.json()["source_document_id"], added_document["id"])

        os.environ["OPENAI_API_KEY"] = "test-key-not-sent"
        openai_client = SimpleNamespace(
            chat=SimpleNamespace(
                completions=SimpleNamespace(
                    create=AsyncMock(
                        return_value=SimpleNamespace(
                            choices=[SimpleNamespace(
                                message=SimpleNamespace(content=json.dumps(twin_response))
                            )]
                        )
                    )
                )
            )
        )
        with patch.object(module, "AsyncOpenAI", return_value=openai_client):
            openai_draft = self.client.post(
                f"/api/buildings/{building_id}/twin/draft",
                json={"provider": "openai"},
            )
        self.assertEqual(openai_draft.status_code, 200, openai_draft.text)
        openai_content = openai_client.chat.completions.create.call_args.kwargs["messages"][1]["content"]
        self.assertTrue(any(block["type"] == "image_url" for block in openai_content))

        saved_twin = self.client.put(
            f"/api/buildings/{building_id}/twin",
            json={"twin": draft.json()["twin"]},
        )
        self.assertEqual(saved_twin.status_code, 200, saved_twin.text)
        self.assertEqual(
            self.client.get(f"/api/buildings/{building_id}/twin").json()["twin"],
            twin_response,
        )
        self.assertTrue(self.client.get("/api/buildings").json()["buildings"][0]["has_twin"])
        agent_context = json.loads(module.agent_database_context())
        self.assertEqual(
            agent_context["buildings"][0]["digital_twin"]["floors"][0]["rooms"][0]["name"],
            "Main room",
        )

    def test_scanned_floor_plan_pdf_is_available_for_manual_review(self) -> None:
        document = pymupdf.open()
        page = document.new_page()
        page.draw_rect(pymupdf.Rect(30, 30, 300, 240))
        response = self.client.post(
            "/api/extract",
            data={"provider": "anthropic"},
            files={"file": ("scanned-plan.pdf", document.tobytes(), "application/pdf")},
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()["extraction_error"])
        self.assertEqual(response.json()["object_name"], "")


if __name__ == "__main__":
    unittest.main()
