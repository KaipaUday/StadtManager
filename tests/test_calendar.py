import os
import tempfile
import unittest
from pathlib import Path


_bootstrap_database = tempfile.TemporaryDirectory(prefix="stadtmanager-calendar-bootstrap-")
os.environ.setdefault("STADTMANAGER_DB_PATH", str(Path(_bootstrap_database.name) / "bootstrap.sqlite3"))

from Site import app as module
from fastapi.testclient import TestClient


class CalendarEventTests(unittest.TestCase):
    def setUp(self) -> None:
        self.original_db_path = module.DB_PATH
        self.database_directory = tempfile.TemporaryDirectory(prefix="stadtmanager-calendar-test-")
        module.DB_PATH = Path(self.database_directory.name) / "test.sqlite3"
        module.initialize_database()
        self.client = TestClient(module.app)

    def tearDown(self) -> None:
        self.client.close()
        module.DB_PATH = self.original_db_path
        self.database_directory.cleanup()

    def test_create_list_and_delete_event(self) -> None:
        created = self.client.post("/api/calendar/events", json={
            "title": "  Begehung Dach  ",
            "event_date": "2029-01-15",
            "event_time": "09:30",
            "note": "Mit Hausmeister",
        })
        self.assertEqual(created.status_code, 201, created.text)
        event = created.json()
        self.assertEqual(event["title"], "Begehung Dach")
        self.assertEqual(event["event_date"], "2029-01-15")
        self.assertEqual(event["event_time"], "09:30")

        listed = self.client.get("/api/calendar/events").json()["events"]
        self.assertEqual([item["id"] for item in listed], [event["id"]])

        deleted = self.client.delete(f"/api/calendar/events/{event['id']}")
        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(self.client.get("/api/calendar/events").json()["events"], [])
        self.assertEqual(self.client.delete(f"/api/calendar/events/{event['id']}").status_code, 404)

    def test_events_are_sorted_by_date_and_time(self) -> None:
        for title, day, time in [
            ("Ohne Uhrzeit", "2027-03-02", None),
            ("Spät", "2027-03-02", "15:00"),
            ("Früh", "2027-03-02", "08:00"),
            ("Vorher", "2027-03-01", None),
        ]:
            response = self.client.post("/api/calendar/events", json={
                "title": title, "event_date": day, "event_time": time,
            })
            self.assertEqual(response.status_code, 201, response.text)
        titles = [item["title"] for item in self.client.get("/api/calendar/events").json()["events"]]
        self.assertEqual(titles, ["Vorher", "Früh", "Spät", "Ohne Uhrzeit"])

    def test_invalid_input_is_rejected(self) -> None:
        for payload in [
            {"title": "", "event_date": "2027-01-01"},
            {"title": "   ", "event_date": "2027-01-01"},
            {"title": "X", "event_date": "2027-02-30"},
            {"title": "X", "event_date": "2027-01-01", "event_time": "25:00"},
        ]:
            response = self.client.post("/api/calendar/events", json=payload)
            self.assertEqual(response.status_code, 422, payload)


if __name__ == "__main__":
    unittest.main()
