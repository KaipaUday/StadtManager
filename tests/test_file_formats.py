"""Tests for the file types accepted by StadtManager.

These tests only need the Python standard library, so they also run where
FastAPI and PyMuPDF are not installed:

    python -m unittest tests.test_file_formats
"""

import io
import re
import sys
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
for path in (ROOT, ROOT / "tests"):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from Site import file_formats as ff  # noqa: E402
import sample_files as sf  # noqa: E402

FIXTURES = Path(__file__).resolve().parent / "fixtures"

# File types found in the city's document collection (requested 2026-11-21).
REQUESTED_EXTENSIONS = {
    ".7z", ".bpn", ".cdr", ".d81", ".d83", ".d84", ".db", ".doc", ".docx", ".dos", ".dot", ".dwg",
    ".dxf", ".gan", ".gif", ".gsm", ".htm", ".html", ".info", ".ini", ".jpg", ".lck", ".lnk", ".lwi",
    ".md", ".mov", ".msg", ".p81", ".p83", ".pdf", ".pla", ".pln", ".png", ".pptx", ".py", ".rtf",
    ".sample", ".sgc", ".shx", ".tif", ".tmp", ".tpl", ".txt", ".wbk", ".x81", ".x82", ".x83",
    ".x84", ".xls", ".xlsm", ".xlsx", ".xml", ".zip",
}


def text_of(result: dict) -> str:
    return "\n".join(str(page["content"]) for page in result["pages"])


class SupportedTypesTests(unittest.TestCase):
    def test_every_requested_type_is_accepted(self) -> None:
        self.assertEqual(len(REQUESTED_EXTENSIONS), 53)
        self.assertEqual(REQUESTED_EXTENSIONS - ff.SUPPORTED_EXTENSIONS, set())
        # Previously supported types stay supported.
        self.assertLessEqual({".csv", ".json", ".md", ".pdf", ".txt"}, ff.SUPPORTED_EXTENSIONS)

    def test_frontend_lists_match_backend(self) -> None:
        public = ROOT / "Site" / "Public"
        script = (public / "app.js").read_text(encoding="utf-8")
        match = re.search(r"const SUPPORTED_EXTENSIONS = \[(.*?)\];", script, re.DOTALL)
        self.assertIsNotNone(match, "SUPPORTED_EXTENSIONS missing in app.js")
        script_extensions = {f".{value}" for value in re.findall(r'"([a-z0-9]+)"', match.group(1))}
        self.assertEqual(script_extensions, set(ff.SUPPORTED_EXTENSIONS))

        page = (public / "index.html").read_text(encoding="utf-8")
        accept_lists = re.findall(
            r'<input id="(?:file-input|folder-input)"[^>]*accept="([^"]+)"',
            page,
        )
        self.assertEqual(len(accept_lists), 2)
        drawing_accept = re.search(
            r'<input id="building-drawing-input"[^>]*accept="([^"]+)"',
            page,
        )
        self.assertIsNotNone(drawing_accept, "PDF drawing input is missing")
        self.assertEqual(drawing_accept.group(1), ".pdf,application/pdf")
        for accept in accept_lists:
            self.assertEqual(set(accept.split(",")), set(ff.SUPPORTED_EXTENSIONS))

    def test_unsupported_extension_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            ff.extract_document("setup.exe", b"MZ")

    def test_dangerous_types_are_downloaded_instead_of_rendered(self) -> None:
        for name in ("page.html", "page.htm", "data.xml", "mail.msg", "plan.dwg"):
            self.assertNotIn(ff.mime_type_for(name), ff.INLINE_SAFE_MIME_TYPES, name)
        for name in ("plan.pdf", "photo.jpg", "notes.txt"):
            self.assertIn(ff.mime_type_for(name), ff.INLINE_SAFE_MIME_TYPES, name)


class OfficeFormatTests(unittest.TestCase):
    def test_docx(self) -> None:
        result = ff.extract_document("bericht.docx", sf.minimal_docx("Rathaus Coburg", "Heizung: Fernwärme"))
        self.assertEqual(result["kind"], "Word")
        self.assertIn("Heizung: Fernwärme", text_of(result))

    def test_xlsx_and_xlsm(self) -> None:
        raw = sf.minimal_xlsx([["Straße", "Nr"], ["Ketschengasse", "7"]])
        for name in ("liste.xlsx", "makro.xlsm"):
            result = ff.extract_document(name, raw)
            self.assertIn("Sheet: Gebäude", text_of(result))
            self.assertIn("Ketschengasse\t7", text_of(result))
            self.assertIn("2 rows", result["details"])

    def test_pptx_slides_become_pages(self) -> None:
        result = ff.extract_document("folien.pptx", sf.minimal_pptx("Sanierung Zeughaus", "Kosten 2027"))
        self.assertEqual([page["page_number"] for page in result["pages"]], [1, 2])
        self.assertIn("Kosten 2027", result["pages"][1]["content"])

    def test_word_97_document(self) -> None:
        raw = (FIXTURES / "sample-word97.doc").read_bytes()
        for name in ("bericht.doc", "vorlage.dot", "sicherung.wbk"):
            result = ff.extract_document(name, raw)
            text = text_of(result)
            self.assertIn("Kosten: 1.200 € – Gebäude „Zeughaus“", text, name)
            self.assertIn("Seite 1", text)
            self.assertNotIn("PAGE", text)  # field instructions are removed
            self.assertEqual(result["warnings"], [])

    def test_excel_97_workbook(self) -> None:
        result = ff.extract_document("kosten.xls", (FIXTURES / "sample-excel97.xls").read_bytes())
        text = text_of(result)
        self.assertIn("Sheet: Kosten €", text)
        self.assertIn("Posten – Ω\tBetrag €", text)
        self.assertIn("Dach\t1200", text)
        self.assertIn("TRUE\t-3", text)
        self.assertIn("xxxxxxxxxx\t0.1", text)

    def test_excel_97_strings_split_across_continue_records(self) -> None:
        result = ff.extract_document("lang.xls", (FIXTURES / "sample-excel97-long.xls").read_bytes())
        lines = text_of(result).splitlines()[1:]
        self.assertEqual(len(lines), 600)
        for number, line in enumerate(lines):
            self.assertEqual(line, f"Zeile {number} – Ω € „Text“\t{number}")

    def test_outlook_message(self) -> None:
        raw = sf.outlook_message(
            "Heizungsausfall Marktplatz 1", "Hausmeister Müller", "Hochbauamt",
            "Die Heizung ist ausgefallen.", "foto.jpg",
        )
        text = text_of(ff.extract_document("mail.msg", raw))
        self.assertIn("Subject: Heizungsausfall Marktplatz 1", text)
        self.assertIn("From: Hausmeister Müller", text)
        self.assertIn("Attachments: foto.jpg", text)
        self.assertIn("Die Heizung ist ausgefallen.", text)

    def test_rtf_and_rtf_saved_as_doc(self) -> None:
        raw = b"{\\rtf1\\ansi\\ansicpg1252{\\fonttbl{\\f0 Arial;}} Rathaus \\'fcberpr\\'fcfen\\par \\u8364? 500}"
        for name in ("brief.rtf", "brief.doc"):
            self.assertEqual(text_of(ff.extract_document(name, raw)), "Rathaus überprüfen\n€ 500")


class MarkupAndConstructionFormatTests(unittest.TestCase):
    def test_html_ignores_scripts(self) -> None:
        raw = b"<html><head><title>Zeughaus</title><script>alert(1)</script></head><body><p>Herrngasse&nbsp;4</p></body></html>"
        text = text_of(ff.extract_document("seite.html", raw))
        self.assertIn("Herrngasse 4", text)
        self.assertNotIn("alert", text)

    def test_xml_encoding_and_attributes(self) -> None:
        raw = b"<?xml version='1.0' encoding='ISO-8859-1'?><r><g name='Rathaus'><p>Pr\xfcfung f\xe4llig</p></g></r>"
        text = text_of(ff.extract_document("daten.xml", raw))
        self.assertIn("Rathaus", text)
        self.assertIn("Prüfung fällig", text)

    def test_xml_entities_are_never_expanded(self) -> None:
        raw = b"<?xml version='1.0'?><!DOCTYPE r [<!ENTITY a 'aaaaaaaaaa'><!ENTITY b '&a;&a;&a;'>]><r>&b; Text</r>"
        self.assertEqual(text_of(ff.extract_document("bombe.xml", raw)), "Text")

    def test_ganttproject_task_names(self) -> None:
        raw = b"<project name='Sanierung'><tasks><task id='0' name='Dach decken'/></tasks></project>"
        self.assertIn("Dach decken", text_of(ff.extract_document("plan.gan", raw)))

    def test_gaeb_xml(self) -> None:
        raw = (
            "<GAEB xmlns='http://www.gaeb.de/GAEB_DA_XML/DA83/3.2'><Award><BoQ><Item>"
            "<Description><p><span>Mauerwerk ausbessern</span></p></Description><QU>m2</QU>"
            "</Item></BoQ></Award></GAEB>"
        ).encode()
        for name in ("lv.x81", "lv.x82", "lv.x83", "lv.x84"):
            self.assertIn("Mauerwerk ausbessern", text_of(ff.extract_document(name, raw)))

    def test_gaeb_90(self) -> None:
        for name in ("lv.d81", "lv.d83", "lv.d84", "lv.p81", "lv.p83"):
            text = text_of(ff.extract_document(name, sf.SAMPLE_GAEB90))
            self.assertIn("Unterspannbahn prüfen", text, name)
            self.assertNotIn("000003", text)

    def test_dxf_text_and_layers(self) -> None:
        result = ff.extract_document("grundriss.dxf", sf.SAMPLE_DXF.encode("utf-8"))
        text = text_of(result)
        self.assertIn("Layers: Waende, Beschriftung", text)
        self.assertIn("Erdgeschoss Rathaus", text)
        self.assertIn("Raum 1.01\nFläche 24,5 m²", text)

    def test_dwg_is_stored_with_version(self) -> None:
        result = ff.extract_document("plan.dwg", b"AC1032" + bytes(200))
        self.assertEqual(result["pages"], [])
        self.assertEqual(result["details"], "AutoCAD 2018")
        self.assertIn("DWG", result["note"])


class TextAndArchiveTests(unittest.TestCase):
    def test_windows_text_encodings(self) -> None:
        self.assertEqual(text_of(ff.extract_document("a.txt", "Grüße – Coburg".encode("cp1252"))), "Grüße – Coburg")
        self.assertEqual(text_of(ff.extract_document("b.txt", "Grüße".encode("utf-16"))), "Grüße")
        self.assertIn("Pläne", text_of(ff.extract_document("desktop.ini", b"[x]\r\nName=Pl\xe4ne\r\n")))
        for name in ("readme.md", "notes.info", "script.py", "config.sample", "brief.tpl", "alt.dos"):
            self.assertEqual(text_of(ff.extract_document(name, b"Inhalt")), "Inhalt", name)

    def test_zip_lists_and_reads_members(self) -> None:
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr("ordner/bericht.docx", sf.minimal_docx("Dachschaden Zeughaus"))
            archive.writestr("notiz.txt", "Schlüssel beim Hausmeister".encode())
            archive.writestr("foto.jpg", b"\xff\xd8\xff")
        result = ff.extract_document("paket.zip", buffer.getvalue())
        text = text_of(result)
        self.assertIn("ordner/bericht.docx", text)
        self.assertIn("Dachschaden Zeughaus", text)
        self.assertIn("Schlüssel beim Hausmeister", text)
        self.assertIn("text read from 2", result["details"])

    def test_binary_formats_are_stored_without_text(self) -> None:
        binary = bytes(range(256)) * 4
        for name in (
            "a.7z", "a.bpn", "a.cdr", "a.db", "a.gsm", "a.lck", "a.lnk", "a.lwi", "a.mov",
            "a.pla", "a.pln", "a.sgc", "a.shx", "a.tmp",
        ):
            result = ff.extract_document(name, binary)
            self.assertEqual(result["pages"], [], name)
            self.assertTrue(result["note"], name)

    def test_damaged_and_protected_files_can_still_be_stored(self) -> None:
        encrypted = sf.compound_file({"EncryptionInfo": b"\x04" * 600, "EncryptedPackage": b"\x01" * 700})
        cases = {
            "kaputt.docx": b"PK\x03\x04broken",
            "kaputt.xlsx": b"not a zip",
            "kaputt.msg": ff.OLE_MAGIC + bytes(100),
            "geschuetzt.docx": encrypted,
            "kaputt.zip": b"PK\x03\x04broken",
            "leer.pdf.txt": b"",
        }
        for name, raw in cases.items():
            result = ff.extract_document(name, raw)
            self.assertEqual(result["pages"], [], name)
            self.assertTrue(result["note"], name)
        self.assertIn("password protected", ff.extract_document("geschuetzt.docx", encrypted)["note"])


if __name__ == "__main__":
    unittest.main()
