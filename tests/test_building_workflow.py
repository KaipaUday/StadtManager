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

from sample_files import minimal_xlsx


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
            "building_code": "CTH",
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
        self.assertEqual(extracted["building_code"], "CTH")
        self.assertEqual((extracted["street_name"], extracted["house_number"]), ("Marktplatz", "1"))
        self.assertEqual(extracted["fields"]["Heating system"], "District heating")
        self.assertEqual(extracted["other_fields"], [{"name": "Roof material", "value": "Slate"}])
        self.assertEqual(len(extracted["maintenance_findings"]), 1)

        saved = self.client.post(
            "/api/buildings",
            data={
                "object_name": extracted["object_name"],
                "building_code": extracted["building_code"],
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
        self.assertEqual(building["building_code"], "CTH")
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

    def test_address_validation_returns_exact_coburg_coordinates(self) -> None:
        response_data = json.dumps([{
            "lat": "50.2580",
            "lon": "10.9640",
            "display_name": "Marktplatz 1, Coburg",
            "address": {"road": "Marktplatz", "house_number": "1"},
        }]).encode("utf-8")

        class Response:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def read(self):
                return response_data

        with patch.object(module, "urlopen", return_value=Response()):
            response = self.client.post(
                "/api/address/validate",
                data={"street_name": "Marktplatz", "house_number": "1"},
            )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["latitude"], 50.258)
        self.assertEqual(response.json()["longitude"], 10.964)

    def test_saving_verified_address_keeps_manually_selected_map_coordinates(self) -> None:
        verified_location = {"latitude": 50.258, "longitude": 10.964}
        selected_location = (50.263, 10.971)
        with patch.object(module, "geocode_coburg_address", return_value=verified_location):
            response = self.client.post(
                "/api/buildings",
                data={
                    "street_name": "Marktplatz",
                    "house_number": "1",
                    "latitude": str(selected_location[0]),
                    "longitude": str(selected_location[1]),
                    "address_verified": "true",
                    "location_manually_selected": "true",
                },
                files={"file": ("town-hall.txt", b"Town hall details", "text/plain")},
            )

        self.assertEqual(response.status_code, 200, response.text)
        building = self.client.get("/api/buildings").json()["buildings"][0]
        self.assertEqual((building["latitude"], building["longitude"]), selected_location)

        outside_coburg = self.client.post(
            "/api/buildings",
            data={
                "street_name": "Marktplatz",
                "house_number": "2",
                "latitude": "0",
                "longitude": "0",
                "location_manually_selected": "true",
            },
            files={"file": ("town-hall-2.txt", b"Town hall details", "text/plain")},
        )
        self.assertEqual(outside_coburg.status_code, 422)

    def test_existing_coburg_street_is_accepted_without_house_number_result(self) -> None:
        response_data = json.dumps([{
            "lat": "50.2563712",
            "lon": "10.9557614",
            "display_name": "Plattenäcker, Dörfles bei Scheuerfeld, Coburg, Bayern, 96450, Deutschland",
            "address": {
                "road": "Plattenäcker",
                "town": "Coburg",
                "postcode": "96450",
            },
        }]).encode("utf-8")

        class Response:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def read(self):
                return response_data

        with patch.object(module, "urlopen", return_value=Response()):
            response = self.client.post(
                "/api/address/validate",
                data={
                    "street_name": "Plattenäcker",
                    "house_number": "30",
                    "full_address": "Plattenäcker 30, 96450 Coburg",
                },
            )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["address_match"], "street-and-coburg-area")
        self.assertFalse(response.json()["house_number_verified"])
        self.assertEqual(response.json()["location_precision"], "street")

    def test_exact_osm_building_footprint_improves_street_fallback(self) -> None:
        street_response = json.dumps([{
            "lat": "50.2563712",
            "lon": "10.9557614",
            "display_name": "Plattenäcker, Coburg, 96450",
            "address": {"road": "Plattenäcker", "town": "Coburg", "postcode": "96450"},
        }]).encode("utf-8")
        building_response = json.dumps({
            "elements": [{
                "type": "way",
                "center": {"lat": 50.257, "lon": 10.956},
                "tags": {
                    "addr:street": "Plattenäcker",
                    "addr:housenumber": "30",
                    "building": "yes",
                },
            }],
        }).encode("utf-8")

        class Response:
            def __init__(self, data: bytes):
                self.data = data

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def read(self):
                return self.data

        with patch.object(
            module,
            "urlopen",
            side_effect=[Response(street_response), Response(building_response)],
        ):
            response = self.client.post(
                "/api/address/validate",
                data={"street_name": "Plattenäcker", "house_number": "30"},
            )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["address_match"], "exact-building")
        self.assertEqual(response.json()["location_precision"], "building")
        self.assertTrue(response.json()["house_number_verified"])
        self.assertEqual((response.json()["latitude"], response.json()["longitude"]), (50.257, 10.956))

    def test_full_address_is_used_for_geocoding(self) -> None:
        response_data = json.dumps([{
            "lat": "50.2581",
            "lon": "10.9641",
            "display_name": "Plattenäcker 30, 96450 Coburg",
            "address": {
                "road": "Plattenäcker",
                "house_number": "30",
                "city": "Coburg",
                "postcode": "96450",
            },
        }]).encode("utf-8")

        class Response:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def read(self):
                return response_data

        with patch.object(module, "urlopen", return_value=Response()) as urlopen_mock:
            response = self.client.post(
                "/api/address/validate",
                data={
                    "street_name": "Plattenäcker",
                    "house_number": "30",
                    "full_address": "Plattenäcker 30, 96450 Coburg",
                },
            )

        self.assertEqual(response.status_code, 200, response.text)
        request = urlopen_mock.call_args.args[0]
        self.assertIn("Platten", request.full_url)

    def test_german_month_year_maintenance_dates_are_normalized(self) -> None:
        findings = module.normalized_maintenance_findings([
            {
                "title": "Zwischenprüfung des Aufzugs",
                "action_type": "inspect",
                "severity": "low",
                "due_date": "03/2028",
                "evidence": "Zwischenprüfung: 03/2028",
            },
            {
                "title": "Hauptprüfung des Aufzugs",
                "action_type": "inspect",
                "severity": "low",
                "due_date": "März 2027",
                "evidence": "Hauptprüfung: 03/2027",
            },
        ])
        self.assertEqual([finding["due_date"] for finding in findings], ["2028-03-31", "2027-03-31"])

    def test_clear_application_data_removes_buildings_and_related_records(self) -> None:
        saved = self.client.post(
            "/api/buildings",
            data={"street_name": "Marktplatz", "house_number": "1"},
            files={"file": ("building.txt", b"Building details", "text/plain")},
        )
        self.assertEqual(saved.status_code, 200, saved.text)

        reset = self.client.delete("/api/data")
        self.assertEqual(reset.status_code, 200, reset.text)
        self.assertEqual(reset.json()["deleted_buildings"], 1)
        self.assertEqual(self.client.get("/api/buildings").json()["buildings"], [])
        self.assertEqual(self.client.get("/api/maintenance").json()["items"], [])

    def test_health_is_unavailable_when_configured_database_file_is_missing(self) -> None:
        configured_path = module.DB_PATH
        module.DB_PATH = Path(self.database_directory.name) / "missing.sqlite3"
        try:
            response = self.client.get("/api/health")
        finally:
            module.DB_PATH = configured_path

        self.assertEqual(response.status_code, 503)
        self.assertIn("database file is missing", response.json()["detail"])

    def test_health_reports_database_available(self) -> None:
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {"status": "ok", "database": "ok"})

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

    def test_building_code_is_unique_and_reused_for_existing_address(self) -> None:
        first = self.client.post(
            "/api/buildings",
            data={
                "street_name": "Marktplatz",
                "house_number": "1",
                "building_code": "SBS",
            },
            files={"file": ("town-hall.txt", b"Town hall", "text/plain")},
        )
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(first.json()["building_code"], "SBS")
        first_uid = first.json()["uid"]

        second = self.client.post(
            "/api/buildings",
            data={"street_name": "Marktplatz", "house_number": "1"},
            files={"file": ("town-hall-update.txt", b"Updated details", "text/plain")},
        )
        self.assertEqual(second.status_code, 200, second.text)
        self.assertTrue(second.json()["merged"])
        self.assertEqual(second.json()["building_code"], "SBS")

        os.environ["ANTHROPIC_API_KEY"] = "test-key-not-sent"
        extraction_client = SimpleNamespace(
            messages=SimpleNamespace(
                create=AsyncMock(
                    return_value=SimpleNamespace(
                        content=[SimpleNamespace(
                            type="text",
                            text=json.dumps({
                                "object_name": "Town Hall",
                                "building_code": "DIFF",
                                "street_name": "Marktplatz",
                                "house_number": "1",
                                "matched_building_uid": first_uid,
                            }),
                        )]
                    )
                )
            )
        )
        with patch.object(module, "AsyncAnthropic", return_value=extraction_client):
            extracted = self.client.post(
                "/api/extract",
                data={"provider": "anthropic"},
                files={"file": ("town-hall.txt", b"Town hall data", "text/plain")},
            )
        self.assertEqual(extracted.status_code, 200, extracted.text)
        self.assertEqual(extracted.json()["building_code"], "SBS")
        self.assertTrue(extracted.json()["building_code_existing"])
        self.assertEqual(extracted.json()["matched_building_uid"], first_uid)
        self.assertTrue(extracted.json()["building_match"]["exact_address_match"])
        extraction_prompt = extraction_client.messages.create.call_args.kwargs["messages"][0]["content"]
        self.assertIn(first_uid, extraction_prompt)

        with patch.object(
            module,
            "geocode_coburg_address",
            return_value={"latitude": 50.258, "longitude": 10.964},
        ):
            address = self.client.post(
                "/api/address/validate",
                data={"street_name": "Marktplatz", "house_number": "1"},
            )
        self.assertEqual(address.status_code, 200, address.text)
        self.assertEqual(address.json()["building_code"], "SBS")
        self.assertTrue(address.json()["building_code_existing"])
        self.assertEqual(address.json()["matched_building_uid"], first_uid)

        duplicate = self.client.post(
            "/api/buildings",
            data={
                "street_name": "Bahnhofstraße",
                "house_number": "3",
                "building_code": "SBS",
            },
            files={"file": ("station.txt", b"Station", "text/plain")},
        )
        self.assertEqual(duplicate.status_code, 409)
        self.assertEqual(duplicate.json()["detail"]["code"], "duplicate-building-code")

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
        connection.close()  # "with" only commits; Windows keeps the file locked until it is closed
        try:
            module.DB_PATH = legacy_path
            module.initialize_database()
            with module.database() as connection:
                building = connection.execute(
                    "SELECT uid, building_code, street_name, house_number, address_key FROM buildings"
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
            self.assertRegex(building["building_code"], r"^[A-Z]{3,8}$")
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

    def test_building_attachments_index_excel_and_expose_saved_content(self) -> None:
        saved = self.client.post(
            "/api/buildings",
            data={"street_name": "Marktplatz", "house_number": "5"},
            files={"file": ("inspection.txt", b"Original inspection text", "text/plain")},
        )
        self.assertEqual(saved.status_code, 200, saved.text)
        building_id = saved.json()["id"]

        with module.database() as connection:
            connection.execute(
                """INSERT INTO ai_generated_records
                   (uid, record_type, provider, model, source_file_name, building_id, payload_json, search_text)
                   VALUES (?, 'extraction', 'anthropic', 'test-model', ?, ?, ?, ?)""",
                (
                    "test-extraction-record",
                    "inspection.txt",
                    building_id,
                    json.dumps({"fields": {"Heating": "District heating"}}),
                    "Heating District heating",
                ),
            )

        pdf = pymupdf.open()
        page = pdf.new_page()
        page.insert_text((72, 72), "Ground floor plan")
        pdf_bytes = pdf.tobytes()
        pdf.close()
        added = self.client.post(
            f"/api/buildings/{building_id}/documents",
            files=[
                ("files", ("building-register.xlsx", minimal_xlsx([["Street", "No"], ["Ketschengasse", "7"]]), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")),
                ("files", ("ground-floor.pdf", pdf_bytes, "application/pdf")),
            ],
        )
        self.assertEqual(added.status_code, 201, added.text)
        self.assertEqual(len(added.json()["documents"]), 2)

        documents = self.client.get(f"/api/buildings/{building_id}/documents").json()["documents"]
        spreadsheet = next(document for document in documents if document["file_name"] == "building-register.xlsx")
        self.assertEqual(spreadsheet["index_status"], "ready")
        spreadsheet_text = self.client.get(
            f"/api/buildings/{building_id}/document-text?document_id={spreadsheet['id']}"
        ).json()
        self.assertIn("Sheet: Gebäude", spreadsheet_text["parsed_text"])
        self.assertIn("Ketschengasse\t7", spreadsheet_text["parsed_text"])

        original_text = self.client.get(f"/api/buildings/{building_id}/document-text").json()
        self.assertIn("Original inspection text", original_text["parsed_text"])
        self.assertEqual(
            original_text["ai_extraction"]["data"]["fields"]["Heating"],
            "District heating",
        )
        self.assertTrue(any(
            document["file_name"] == "ground-floor.pdf" and document["mime_type"] == "application/pdf"
            for document in documents
        ))

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

    def test_pdf_is_sent_directly_to_selected_ai_provider(self) -> None:
        source = pymupdf.open()
        source_page = source.new_page(width=800, height=1_000)
        source_page.insert_text((35, 100), "Building report: next inspection March 2027", fontsize=28)
        image_bytes = source_page.get_pixmap(dpi=100).tobytes("png")
        scanned = pymupdf.open()
        page = scanned.new_page(width=800, height=1_000)
        page.insert_image(page.rect, stream=image_bytes)
        page.insert_text((20, 25), "bad embedded text layer " * 3, color=(1, 1, 1))
        pdf_bytes = scanned.tobytes()
        extraction = {
            "object_name": "Building report",
            "fields": {"Inspection": "March 2027"},
            "maintenance_findings": [],
        }

        os.environ["ANTHROPIC_API_KEY"] = "test-key-not-sent"
        anthropic_client = SimpleNamespace(
            messages=SimpleNamespace(
                create=AsyncMock(
                    return_value=SimpleNamespace(
                        content=[SimpleNamespace(type="text", text=json.dumps(extraction))]
                    )
                )
            )
        )
        with patch.object(module, "AsyncAnthropic", return_value=anthropic_client):
            response = self.client.post(
                "/api/extract",
                data={"provider": "anthropic", "model": "claude-sonnet-5-5"},
                files={"file": ("scanned-report.pdf", pdf_bytes, "application/pdf")},
            )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["extraction_method"], "pdf")
        anthropic_blocks = anthropic_client.messages.create.call_args.kwargs["messages"][0]["content"]
        document_block = next(block for block in anthropic_blocks if block["type"] == "document")
        anthropic_pdf = base64.b64decode(document_block["source"]["data"])
        with pymupdf.open(stream=anthropic_pdf, filetype="pdf") as sent_document:
            self.assertEqual(sent_document.page_count, 1)
        anthropic_prompt = next(block["text"] for block in anthropic_blocks if block["type"] == "text")
        self.assertIn("Read the attached PDF directly", anthropic_prompt)

        os.environ["OPENAI_API_KEY"] = "test-key-not-sent"
        openai_client = SimpleNamespace(
            responses=SimpleNamespace(
                create=AsyncMock(
                    return_value=SimpleNamespace(output_text=json.dumps(extraction))
                )
            )
        )
        with patch.object(module, "AsyncOpenAI", return_value=openai_client):
            response = self.client.post(
                "/api/extract",
                data={"provider": "openai", "model": "gpt-4.1-mini"},
                files={"file": ("scanned-report.pdf", pdf_bytes, "application/pdf")},
            )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["extraction_method"], "pdf")
        openai_blocks = openai_client.responses.create.call_args.kwargs["input"][1]["content"]
        pdf_input = next(block for block in openai_blocks if block["type"] == "input_file")
        openai_pdf = base64.b64decode(pdf_input["file_data"].split(",", 1)[1])
        with pymupdf.open(stream=openai_pdf, filetype="pdf") as sent_document:
            self.assertEqual(sent_document.page_count, 1)
        openai_prompt = openai_blocks[0]["text"]
        self.assertIn("Read the attached PDF directly", openai_prompt)

    def test_pdf_sent_to_ai_contains_at_most_the_first_eight_pages(self) -> None:
        pdf = pymupdf.open()
        for page_number in range(9):
            page = pdf.new_page()
            page.insert_text((40, 60), f"Page {page_number + 1}")
        limited_pdf, original_page_count = module.pdf_prefix_for_ai(pdf.tobytes())
        self.assertEqual(original_page_count, 9)
        with pymupdf.open(stream=limited_pdf, filetype="pdf") as sent_document:
            self.assertEqual(sent_document.page_count, 8)
            self.assertIn("Page 1", sent_document[0].get_text())
            self.assertIn("Page 8", sent_document[7].get_text())

    def test_pdf_analysis_uses_pypdf_text_fallback_and_persists_skipped_results(self) -> None:
        pdf = pymupdf.open()
        page = pdf.new_page()
        page.insert_text((40, 60), "Building name: Coburg Library\nAddress: Marktplatz 1")
        pdf_bytes = pdf.tobytes()
        empty_result = {
            "fields": {},
            "other_fields": [],
            "maintenance_findings": [],
        }
        successful_result = {
            "object_name": "Coburg Library",
            "street_name": "Marktplatz",
            "house_number": "1",
            "fields": {"Heating system": "District heating"},
            "other_fields": [],
            "maintenance_findings": [],
        }
        fake_client = SimpleNamespace(
            messages=SimpleNamespace(
                create=AsyncMock(side_effect=[
                    SimpleNamespace(content=[SimpleNamespace(type="text", text=json.dumps(empty_result))]),
                    SimpleNamespace(content=[SimpleNamespace(type="text", text=json.dumps(successful_result))]),
                ])
            )
        )
        os.environ["ANTHROPIC_API_KEY"] = "test-key-not-sent"
        with patch.object(module, "AsyncAnthropic", return_value=fake_client):
            response = self.client.post(
                "/api/extract",
                data={"provider": "anthropic"},
                files={"file": ("fallback.pdf", pdf_bytes, "application/pdf")},
            )

        self.assertEqual(response.status_code, 200, response.text)
        extracted = response.json()
        self.assertEqual(extracted["extraction_method"], "pypdf-fallback")
        self.assertEqual(extracted["object_name"], "Coburg Library")
        self.assertEqual(fake_client.messages.create.await_count, 2)
        fallback_prompt = fake_client.messages.create.call_args_list[1].kwargs["messages"][0]["content"]
        self.assertIn("Building name: Coburg Library", fallback_prompt)
        self.assertTrue(extracted["ai_record_uid"])
        with module.database() as connection:
            record = connection.execute(
                "SELECT record_type, building_id, payload_json FROM ai_generated_records WHERE uid = ?",
                (extracted["ai_record_uid"],),
            ).fetchone()
        self.assertEqual(record["record_type"], "extraction")
        self.assertIsNone(record["building_id"])
        self.assertEqual(json.loads(record["payload_json"])["fields"]["Heating system"], "District heating")

        saved = self.client.post(
            "/api/buildings",
            data={
                "object_name": extracted["object_name"],
                "building_code": extracted["building_code"],
                "street_name": extracted["street_name"],
                "house_number": extracted["house_number"],
                "fields_json": json.dumps(extracted["fields"]),
                "ai_record_uid": extracted["ai_record_uid"],
            },
            files={"file": ("fallback.pdf", pdf_bytes, "application/pdf")},
        )
        self.assertEqual(saved.status_code, 200, saved.text)
        with module.database() as connection:
            linked_record = connection.execute(
                "SELECT building_id FROM ai_generated_records WHERE uid = ?",
                (extracted["ai_record_uid"],),
            ).fetchone()
        self.assertEqual(linked_record["building_id"], saved.json()["id"])

    def test_chat_answers_are_saved_searchable_and_removed_by_clear_data(self) -> None:
        os.environ["ANTHROPIC_API_KEY"] = "test-key-not-sent"
        fake_client = SimpleNamespace(
            messages=SimpleNamespace(
                create=AsyncMock(
                    return_value=SimpleNamespace(
                        content=[SimpleNamespace(type="text", text="The boiler inspection is due in June 2027.")]
                    )
                )
            )
        )
        with patch.object(module, "AsyncAnthropic", return_value=fake_client):
            response = self.client.post(
                "/api/agent/chat",
                json={
                    "provider": "anthropic",
                    "messages": [{"role": "user", "content": "When is the boiler inspection due?"}],
                },
            )
        self.assertEqual(response.status_code, 200, response.text)
        saved_context, matched_count = module.search_saved_ai_records("boiler inspection")
        self.assertEqual(matched_count, 1)
        self.assertIn("June 2027", saved_context)

        cleared = self.client.delete("/api/data")
        self.assertEqual(cleared.status_code, 200, cleared.text)
        self.assertEqual(cleared.json()["deleted_ai_records"], 1)
        self.assertEqual(module.search_saved_ai_records("boiler inspection")[1], 0)

    def test_initialize_database_replaces_legacy_ai_record_fts_triggers(self) -> None:
        record_uid = module.save_ai_generated_record(
            "chat",
            "anthropic",
            "test-model",
            "",
            {"reply": "Distinctive boiler inspection finding"},
        )
        with module.database() as connection:
            connection.executescript(
                """
                DROP TRIGGER ai_generated_records_ad;
                DROP TRIGGER ai_generated_records_au;
                CREATE TRIGGER ai_generated_records_ad
                    AFTER DELETE ON ai_generated_records BEGIN
                    INSERT INTO ai_generated_records_fts
                        (ai_generated_records_fts, rowid, search_text, source_file_name, record_type)
                    VALUES ('delete', old.id, old.search_text, old.source_file_name, old.record_type);
                END;
                CREATE TRIGGER ai_generated_records_au
                    AFTER UPDATE ON ai_generated_records BEGIN
                    INSERT INTO ai_generated_records_fts
                        (ai_generated_records_fts, rowid, search_text, source_file_name, record_type)
                    VALUES ('delete', old.id, old.search_text, old.source_file_name, old.record_type);
                    INSERT INTO ai_generated_records_fts
                        (rowid, search_text, source_file_name, record_type)
                    VALUES (new.id, new.search_text, new.source_file_name, new.record_type);
                END;
                """
            )

        module.initialize_database()
        with module.database() as connection:
            connection.execute(
                "UPDATE ai_generated_records SET building_id = NULL WHERE uid = ?",
                (record_uid,),
            )
        context, matched_count = module.search_saved_ai_records("Distinctive boiler inspection")
        self.assertEqual(matched_count, 1)
        self.assertIn("Distinctive boiler inspection finding", context)

        with module.database() as connection:
            connection.execute("DELETE FROM ai_generated_records WHERE uid = ?", (record_uid,))
        self.assertEqual(module.search_saved_ai_records("Distinctive boiler inspection")[1], 0)

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
        photo_pixmap = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 240, 180), False)
        photo_pixmap.clear_with(120)
        photo_bytes = photo_pixmap.tobytes("png")
        page_image_pixmap = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 400, 600), False)
        page_image_pixmap.clear_with(180)
        page_image_bytes = page_image_pixmap.tobytes("png")
        document = pymupdf.open()
        page = document.new_page()
        page.insert_text((40, 40), "Floor plan")
        page.insert_image(pymupdf.Rect(50, 60, 250, 230), stream=photo_bytes)
        page.insert_image(page.rect, stream=page_image_bytes)
        page.insert_image(pymupdf.Rect(500, 60, 501, 61), stream=image_bytes)
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

        with module.database() as connection:
            connection.execute(
                "UPDATE document_index_state SET asset_version = 0 WHERE source_key = ?",
                (f"building:{building_id}",),
            )
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
