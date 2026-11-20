import json
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch


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
        self.assertEqual(extracted["fields"]["Heating system"], "District heating")
        self.assertEqual(extracted["other_fields"], [{"name": "Roof material", "value": "Slate"}])

        saved = self.client.post(
            "/api/buildings",
            data={
                "object_name": extracted["object_name"],
                "address": extracted["address"],
                "latitude": str(extracted["latitude"]),
                "longitude": str(extracted["longitude"]),
                "fields_json": json.dumps({**extracted["fields"], "Roof material": "Slate"}),
            },
            files={"file": ("town-hall.pdf", b"%PDF test document", "application/pdf")},
        )
        self.assertEqual(saved.status_code, 200, saved.text)
        building_id = saved.json()["id"]

        building = self.client.get("/api/buildings").json()["buildings"][0]
        self.assertEqual(building["object_name"], "Coburg Town Hall")
        self.assertEqual(building["fields"], {
            "Heating system": "District heating",
            "Roof material": "Slate",
        })
        self.assertEqual((building["latitude"], building["longitude"]), (50.258, 10.964))
        self.assertIn("Roof material", self.client.get("/api/categories").json()["categories"])
        stored_file = self.client.get(f"/api/buildings/{building_id}/file")
        self.assertEqual(stored_file.content, b"%PDF test document")

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

    def test_building_name_is_required(self) -> None:
        response = self.client.post(
            "/api/buildings",
            data={"object_name": "  "},
            files={"file": ("building.pdf", b"%PDF", "application/pdf")},
        )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["detail"], "Building name is required.")

    def test_missing_api_key_returns_manual_review_data(self) -> None:
        response = self.client.post(
            "/api/extract",
            data={"provider": "anthropic"},
            files={"file": ("building.txt", b"Building details", "text/plain")},
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("ANTHROPIC_API_KEY is not set", response.json()["extraction_error"])


if __name__ == "__main__":
    unittest.main()
