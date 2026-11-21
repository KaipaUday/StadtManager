"""Text extraction for the many file types StadtManager accepts.

Everything in this module uses only the Python standard library, so no extra
packages are required. PDFs and raster images are handled in ``app.py``
because they need PyMuPDF (rendering and OCR).

Each extractor returns plain text that is used for the review preview, the AI
field extraction and the local full-text search index. Formats that cannot be
read as text (CAD binaries, ArchiCAD projects, videos, ...) are still accepted
and stored; they are reported as "stored without text" so the user can enter
the building details manually.
"""

from __future__ import annotations

import html
import io
import mimetypes
import re
import struct
import zipfile
from html.parser import HTMLParser
from pathlib import Path
from xml.etree import ElementTree

# ---------------------------------------------------------------------------
# Supported formats
# ---------------------------------------------------------------------------

PDF_EXTENSIONS = {".pdf"}
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".tif", ".tiff"}
STRUCTURED_EXTENSIONS = {".csv", ".json"}

# Extension -> label shown in the UI ("kind").
FORMAT_LABELS: dict[str, str] = {
    # Handled in app.py
    ".pdf": "PDF",
    ".csv": "CSV",
    ".json": "JSON",
    ".jpg": "Image (JPG)",
    ".jpeg": "Image (JPG)",
    ".png": "Image (PNG)",
    ".gif": "Image (GIF)",
    ".tif": "Image (TIFF)",
    ".tiff": "Image (TIFF)",
    # Plain text
    ".txt": "Text",
    ".md": "Markdown",
    ".ini": "INI settings",
    ".info": "Info file",
    ".py": "Python script",
    ".sample": "Sample file",
    ".tpl": "Template",
    ".dos": "DOS file",
    # Web / markup
    ".htm": "HTML",
    ".html": "HTML",
    ".xml": "XML",
    ".gan": "GanttProject plan",
    # Office (Open XML)
    ".docx": "Word",
    ".xlsx": "Excel",
    ".xlsm": "Excel (macros)",
    ".pptx": "PowerPoint",
    # Office 97-2003 / Outlook (OLE compound files)
    ".doc": "Word 97-2003",
    ".dot": "Word template 97-2003",
    ".wbk": "Word backup",
    ".xls": "Excel 97-2003",
    ".msg": "Outlook e-mail",
    ".rtf": "Rich Text (RTF)",
    # GAEB tender data (construction)
    ".d81": "GAEB 90 (D81)",
    ".d83": "GAEB 90 (D83)",
    ".d84": "GAEB 90 (D84)",
    ".p81": "GAEB 2000 (P81)",
    ".p83": "GAEB 2000 (P83)",
    ".x81": "GAEB XML (X81)",
    ".x82": "GAEB XML (X82)",
    ".x83": "GAEB XML (X83)",
    ".x84": "GAEB XML (X84)",
    # CAD
    ".dxf": "CAD drawing (DXF)",
    ".dwg": "CAD drawing (DWG)",
    ".shx": "SHX (CAD font / shape index)",
    ".pln": "ArchiCAD project",
    ".pla": "ArchiCAD archive",
    ".bpn": "ArchiCAD backup",
    ".gsm": "ArchiCAD library object",
    ".lwi": "LWI file",
    ".sgc": "SGC file",
    ".cdr": "CorelDRAW graphic",
    # Archives
    ".zip": "ZIP archive",
    ".7z": "7z archive",
    # Other
    ".db": "Database file",
    ".lck": "Lock file",
    ".lnk": "Windows shortcut",
    ".tmp": "Temporary file",
    ".mov": "Video (MOV)",
}

SUPPORTED_EXTENSIONS: frozenset[str] = frozenset(FORMAT_LABELS)

TEXT_EXTENSIONS = {".txt", ".md", ".ini", ".info", ".py", ".sample", ".tpl", ".dos"}
HTML_EXTENSIONS = {".htm", ".html"}
XML_EXTENSIONS = {".xml", ".gan", ".x81", ".x82", ".x83", ".x84"}
GAEB90_EXTENSIONS = {".d81", ".d83", ".d84", ".p81", ".p83"}
OOXML_EXTENSIONS = {".docx", ".xlsx", ".xlsm", ".pptx"}
OLE_EXTENSIONS = {".doc", ".dot", ".wbk", ".xls", ".msg"}

# Explicit MIME types, so the result does not depend on the OS registry.
MIME_TYPES: dict[str, str] = {
    ".pdf": "application/pdf",
    ".csv": "text/csv",
    ".json": "application/json",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".htm": "text/html",
    ".html": "text/html",
    ".xml": "application/xml",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xlsm": "application/vnd.ms-excel.sheet.macroEnabled.12",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".doc": "application/msword",
    ".dot": "application/msword",
    ".xls": "application/vnd.ms-excel",
    ".msg": "application/vnd.ms-outlook",
    ".rtf": "application/rtf",
    ".dxf": "image/vnd.dxf",
    ".dwg": "image/vnd.dwg",
    ".zip": "application/zip",
    ".7z": "application/x-7z-compressed",
    ".mov": "video/quicktime",
}

# Types a browser may display directly without risk of running scripts in the
# app's origin. Everything else is served as a download.
INLINE_SAFE_MIME_TYPES = {
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/gif",
    "text/plain",
    "text/csv",
    "application/json",
}

MAX_TEXT_CHARS = 25_000_000         # upper bound for extracted text per file
ZIP_MAX_MEMBERS = 200               # members inspected inside one ZIP
ZIP_MAX_MEMBER_BYTES = 20 * 1024 * 1024
ZIP_MAX_TOTAL_BYTES = 60 * 1024 * 1024
XLS_MAX_ROWS_PER_SHEET = 5_000

OLE_MAGIC = bytes.fromhex("D0CF11E0A1B11AE1")
ZIP_MAGIC = b"PK\x03\x04"


def format_label(filename: str) -> str:
    extension = Path(filename).suffix.lower()
    return FORMAT_LABELS.get(extension, extension.lstrip(".").upper() or "File")


def mime_type_for(filename: str) -> str:
    extension = Path(filename).suffix.lower()
    return MIME_TYPES.get(extension) or mimetypes.guess_type(filename)[0] or "application/octet-stream"


def supported_extensions_text() -> str:
    return ", ".join(sorted(extension.lstrip(".").upper() for extension in SUPPORTED_EXTENSIONS))


# ---------------------------------------------------------------------------
# Generic helpers
# ---------------------------------------------------------------------------


def decode_text(raw: bytes) -> str:
    """Decode text files that may come from Windows tools (UTF-8, UTF-16 or ANSI)."""
    if raw.startswith((b"\xff\xfe", b"\xfe\xff")):
        return raw.decode("utf-16")
    try:
        return raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        pass
    try:
        return raw.decode("cp1252")
    except UnicodeDecodeError:
        return raw.decode("latin-1")


def looks_like_text(raw: bytes) -> bool:
    sample = raw[:65_536]
    if not sample:
        return False
    if sample.startswith((b"\xff\xfe", b"\xfe\xff")):
        return True
    if b"\x00" in sample:
        return False
    control = sum(1 for byte in sample if byte < 32 and byte not in (9, 10, 12, 13))
    return control / len(sample) < 0.02


def clean_text(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\xa0", " ")
    text = re.sub(r"[\x00-\x08\x0b\x0e-\x1f\x7f]", " ", text)
    text = re.sub(r"[ \t\f\v]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()[:MAX_TEXT_CHARS]


def single_page(text: str) -> list[dict[str, object]]:
    text = clean_text(text)
    return [{"page_number": 1, "content": text}] if text else []


def result(
    kind: str,
    pages: list[dict[str, object]],
    details: str = "",
    warnings: list[str] | None = None,
    note: str = "",
) -> dict[str, object]:
    characters = sum(len(str(page["content"])) for page in pages)
    if not details:
        details = f"{characters:,} characters" if pages else "Stored without readable text"
    return {
        "kind": kind,
        "pages": pages,
        "details": details,
        "warnings": list(dict.fromkeys(warnings or [])),
        "note": note,
    }


def stored_only(kind: str, details: str, note: str = "") -> dict[str, object]:
    return result(
        kind,
        [],
        details=details,
        note=note
        or f"The file ({kind}) is saved as it is, but its content cannot be read as text. "
        "Enter the building details manually.",
    )


# ---------------------------------------------------------------------------
# HTML
# ---------------------------------------------------------------------------


class _HTMLTextParser(HTMLParser):
    BLOCK_TAGS = {
        "address", "article", "br", "div", "dd", "dl", "dt", "footer", "h1", "h2", "h3", "h4",
        "h5", "h6", "header", "hr", "li", "ol", "p", "pre", "section", "table", "tr", "ul", "title",
    }
    SKIP_TAGS = {"script", "style", "head", "noscript", "template", "svg"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.skip_depth = 0
        self.title = ""
        self._in_title = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "title":
            self._in_title = True
        if tag in self.SKIP_TAGS:
            self.skip_depth += 1
        elif tag in self.BLOCK_TAGS:
            self.parts.append("\n")
        elif tag in {"td", "th"}:
            self.parts.append("\t")

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False
        if tag in self.SKIP_TAGS and self.skip_depth:
            self.skip_depth -= 1
        elif tag in self.BLOCK_TAGS:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title += data
        if not self.skip_depth:
            self.parts.append(data)


def html_to_text(markup: str) -> str:
    parser = _HTMLTextParser()
    parser.feed(markup)
    parser.close()
    body = re.sub(r"[ \t]+", " ", "".join(parser.parts))
    body = "\n".join(line.strip() for line in body.splitlines())
    title = parser.title.strip()
    if title and title not in body[:500]:
        body = f"{title}\n\n{body}"
    return clean_text(body)


# ---------------------------------------------------------------------------
# XML (generic XML, GAEB XML, GanttProject)
# ---------------------------------------------------------------------------

_XML_TEXT_ATTRIBUTES = {"name", "title", "description", "label", "text", "subject", "bezeichnung"}


def _strip_markup(text: str) -> str:
    text = re.sub(r"<!DOCTYPE[^\[>]*(\[.*?\])?\s*>", " ", text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r"<!--.*?-->", " ", text, flags=re.DOTALL)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9A-Fa-f]+);)[A-Za-z0-9_.:-]+;", " ", text)
    return clean_text(html.unescape(text))


def xml_to_text(raw: bytes) -> str:
    head = raw[:200_000]
    if b"<!ENTITY" in head:
        # Never expand entities (protection against entity-expansion attacks).
        return _strip_markup(decode_text(raw))
    try:
        root = ElementTree.fromstring(raw)
    except ElementTree.ParseError:
        return _strip_markup(decode_text(raw))
    lines: list[str] = []
    for element in root.iter():
        for key, value in element.attrib.items():
            local_key = key.rsplit("}", 1)[-1].lower()
            if local_key in _XML_TEXT_ATTRIBUTES and value.strip():
                lines.append(value.strip())
        if element.text and element.text.strip():
            lines.append(element.text.strip())
        if element.tail and element.tail.strip():
            lines.append(element.tail.strip())
    return clean_text("\n".join(lines))


# ---------------------------------------------------------------------------
# GAEB 90 / GAEB 2000 (fixed-width 80 character records)
# ---------------------------------------------------------------------------


def gaeb90_to_text(raw: bytes) -> str:
    if raw.lstrip()[:5] == b"<?xml":
        return xml_to_text(raw)
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        text = raw.decode("cp850", errors="replace")
    lines: list[str] = []
    for line in text.splitlines():
        line = line.rstrip()
        # Columns 75-80 hold a running line number.
        if len(line) >= 80 and line[74:80].strip().isdigit():
            line = line[:74].rstrip()
        # Columns 1-2 hold the record type (e.g. 00, 11, 25, 26).
        if len(line) >= 2 and line[:2].isdigit():
            line = line[2:]
        line = line.strip()
        if line:
            lines.append(line)
    return clean_text("\n".join(lines))


# ---------------------------------------------------------------------------
# RTF
# ---------------------------------------------------------------------------

_RTF_TOKEN = re.compile(
    r"\\([a-z]{1,32})(-?\d{1,10})?[ ]?|\\'([0-9a-f]{2})|\\([^a-z])|([{}])|[\r\n]+|(.)",
    re.IGNORECASE | re.DOTALL,
)
_RTF_SKIP_DESTINATIONS = {
    "aftncn", "aftnsep", "aftnsepc", "annotation", "atnauthor", "atndate", "atnicn", "atnid",
    "atnparent", "atnref", "atntime", "atrfend", "atrfstart", "author", "background",
    "bkmkend", "bkmkstart", "blipuid", "buptim", "category", "colorschememapping",
    "colortbl", "comment", "company", "creatim", "datafield", "datastore", "defchp", "defpap",
    "do", "doccomm", "docvar", "dptxbxtext", "ebcend", "ebcstart", "factoidname", "falt",
    "fchars", "ffdeftext", "ffentrymcr", "ffexitmcr", "ffformat", "ffhelptext", "ffl",
    "ffname", "ffstattext", "file", "filetbl", "fldinst", "fldtype", "fname", "fontemb",
    "fontfile", "fonttbl", "formfield", "generator", "gridtable", "hlinkbase", "info",
    "keycode", "keywords", "latentstyles", "levelnumbers", "leveltext", "lfolevel",
    "listoverridetable", "listpicture", "liststylename", "listtable", "listtext",
    "manager", "mmathPr", "nonshppict", "objalias", "objclass", "objdata", "objname",
    "objsect", "objtime", "oldcprops", "oldpprops", "oldsprops", "oldtprops", "operator",
    "panose", "password", "passwordhash", "pgdsctbl", "picprop", "pict", "pn", "pnseclvl",
    "printim", "private", "propname", "protusertbl", "pxe", "result", "revtbl", "revtim",
    "rsidtbl", "sp", "stylesheet", "subject", "tc", "template", "themedata", "title",
    "txe", "ud", "upr", "userprops", "wgrffmtfilter", "windowcaption", "writereservation",
    "writereservhash", "xe", "xform", "xmlattrname", "xmlattrvalue", "xmlclose", "xmlname",
    "xmlnstbl", "xmlopen",
}
_RTF_SPECIAL = {
    "par": "\n", "sect": "\n\n", "page": "\n\n", "line": "\n", "tab": "\t", "cell": "\t",
    "row": "\n", "emdash": "\u2014", "endash": "\u2013", "emspace": "\u2003",
    "enspace": "\u2002", "qmspace": "\u2005", "bullet": "\u2022", "lquote": "\u2018",
    "rquote": "\u2019", "ldblquote": "\u201c", "rdblquote": "\u201d",
}


def rtf_to_text(raw: bytes) -> str:
    text = raw.decode("latin-1")
    codepage = "cp1252"
    stack: list[tuple[int, bool]] = []
    ignorable = False
    unicode_skip = 1
    skip_chars = 0
    out: list[str] = []
    pending_bytes = bytearray()

    def flush_bytes() -> None:
        if pending_bytes:
            out.append(pending_bytes.decode(codepage, errors="replace"))
            pending_bytes.clear()

    for match in _RTF_TOKEN.finditer(text):
        word, argument, hex_code, symbol, brace, char = match.groups()
        if hex_code is None:
            flush_bytes()
        if brace:
            skip_chars = 0
            if brace == "{":
                stack.append((unicode_skip, ignorable))
            elif stack:
                unicode_skip, ignorable = stack.pop()
        elif symbol:
            skip_chars = 0
            if symbol == "~":
                if not ignorable:
                    out.append("\xa0")
            elif symbol in "{}\\":
                if not ignorable:
                    out.append(symbol)
            elif symbol == "*":
                ignorable = True
            elif symbol == "_" and not ignorable:
                out.append("-")
        elif word:
            skip_chars = 0
            word_lower = word.lower()
            if word_lower in _RTF_SKIP_DESTINATIONS:
                ignorable = True
            elif ignorable:
                continue
            elif word_lower == "ansicpg" and argument:
                candidate = f"cp{int(argument)}"
                try:
                    "".encode(candidate)
                    codepage = candidate
                except LookupError:
                    pass
            elif word_lower in _RTF_SPECIAL:
                out.append(_RTF_SPECIAL[word_lower])
            elif word_lower == "uc" and argument:
                unicode_skip = max(0, int(argument))
            elif word_lower == "u" and argument:
                code = int(argument)
                if code < 0:
                    code += 0x10000
                out.append(chr(code))
                skip_chars = unicode_skip
        elif hex_code:
            if skip_chars > 0:
                skip_chars -= 1
            elif not ignorable:
                pending_bytes.append(int(hex_code, 16))
        elif char:
            if skip_chars > 0:
                skip_chars -= 1
            elif not ignorable:
                out.append(char)
    flush_bytes()
    return clean_text("".join(out))


# ---------------------------------------------------------------------------
# Office Open XML (docx, xlsx, xlsm, pptx)
# ---------------------------------------------------------------------------

_W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
_S = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
_A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
_R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
_PKG_REL = "{http://schemas.openxmlformats.org/package/2006/relationships}"


def _read_zip_member(archive: zipfile.ZipFile, name: str, limit: int = ZIP_MAX_MEMBER_BYTES * 3) -> bytes:
    info = archive.getinfo(name)
    if info.file_size > limit:
        raise ValueError(f"{name} inside the file is too large to read.")
    with archive.open(info) as member:
        return member.read(limit + 1)[:limit]


def _parse_xml_member(archive: zipfile.ZipFile, name: str) -> ElementTree.Element | None:
    try:
        data = _read_zip_member(archive, name)
    except KeyError:
        return None
    if b"<!ENTITY" in data[:200_000]:
        raise ValueError("The document contains unsupported XML entity declarations.")
    return ElementTree.fromstring(data)


def _word_paragraphs(root: ElementTree.Element) -> list[str]:
    paragraphs: list[str] = []
    for paragraph in root.iter(f"{_W}p"):
        parts: list[str] = []
        for node in paragraph.iter():
            if node.tag == f"{_W}t" and node.text:
                parts.append(node.text)
            elif node.tag == f"{_W}tab":
                parts.append("\t")
            elif node.tag in (f"{_W}br", f"{_W}cr"):
                parts.append("\n")
        paragraphs.append("".join(parts))
    return paragraphs


def docx_to_text(archive: zipfile.ZipFile) -> str:
    parts: list[str] = []
    names = archive.namelist()
    ordered = ["word/document.xml"]
    ordered += sorted(name for name in names if re.fullmatch(r"word/(header|footer)\d*\.xml", name))
    ordered += [name for name in ("word/footnotes.xml", "word/endnotes.xml", "word/comments.xml") if name in names]
    for name in ordered:
        root = _parse_xml_member(archive, name)
        if root is None:
            continue
        text = "\n".join(_word_paragraphs(root)).strip()
        if text:
            parts.append(text)
    return clean_text("\n\n".join(parts))


def _column_index(reference: str) -> int:
    letters = re.match(r"[A-Z]+", reference.upper())
    if not letters:
        return 0
    index = 0
    for letter in letters.group(0):
        index = index * 26 + (ord(letter) - 64)
    return index - 1


def xlsx_to_pages(archive: zipfile.ZipFile) -> tuple[list[dict[str, object]], str]:
    shared: list[str] = []
    shared_root = _parse_xml_member(archive, "xl/sharedStrings.xml")
    if shared_root is not None:
        for item in shared_root.iter(f"{_S}si"):
            shared.append("".join(node.text or "" for node in item.iter(f"{_S}t")))

    # Sheet names and their files, in workbook order.
    sheets: list[tuple[str, str]] = []
    workbook = _parse_xml_member(archive, "xl/workbook.xml")
    relationships = _parse_xml_member(archive, "xl/_rels/workbook.xml.rels")
    targets: dict[str, str] = {}
    if relationships is not None:
        for relation in relationships.iter(f"{_PKG_REL}Relationship"):
            target = relation.get("Target", "")
            target = target.lstrip("/") if target.startswith("/") else f"xl/{target}"
            targets[relation.get("Id", "")] = target
    if workbook is not None:
        for sheet in workbook.iter(f"{_S}sheet"):
            target = targets.get(sheet.get(f"{_R}id", ""), "")
            if target:
                sheets.append((sheet.get("name", "Sheet"), target))
    if not sheets:
        sheets = [
            (Path(name).stem, name)
            for name in sorted(archive.namelist())
            if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", name)
        ]

    pages: list[dict[str, object]] = []
    total_rows = 0
    for page_number, (sheet_name, target) in enumerate(sheets, start=1):
        root = _parse_xml_member(archive, target)
        if root is None:
            continue
        lines = [f"Sheet: {sheet_name}"]
        row_count = 0
        for row in root.iter(f"{_S}row"):
            values: dict[int, str] = {}
            for cell in row.iter(f"{_S}c"):
                cell_type = cell.get("t", "")
                value = ""
                if cell_type == "inlineStr":
                    value = "".join(node.text or "" for node in cell.iter(f"{_S}t"))
                else:
                    value_node = cell.find(f"{_S}v")
                    raw_value = value_node.text if value_node is not None and value_node.text else ""
                    if cell_type == "s" and raw_value.isdigit():
                        index = int(raw_value)
                        value = shared[index] if index < len(shared) else ""
                    elif cell_type == "b":
                        value = "TRUE" if raw_value == "1" else "FALSE"
                    else:
                        value = raw_value
                if value.strip():
                    values[_column_index(cell.get("r", "")) if cell.get("r") else len(values)] = value.strip()
            if values:
                width = max(values) + 1
                lines.append("\t".join(values.get(index, "") for index in range(width)).rstrip("\t"))
                row_count += 1
        total_rows += row_count
        pages.append({"page_number": page_number, "content": clean_text("\n".join(lines))})
    details = f"{len(pages):,} sheet{'' if len(pages) == 1 else 's'} · {total_rows:,} rows"
    return pages, details


def pptx_to_pages(archive: zipfile.ZipFile) -> list[dict[str, object]]:
    slide_names = sorted(
        (name for name in archive.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", name)),
        key=lambda name: int(re.search(r"(\d+)\.xml$", name).group(1)),
    )
    pages: list[dict[str, object]] = []
    for number, name in enumerate(slide_names, start=1):
        root = _parse_xml_member(archive, name)
        if root is None:
            continue
        paragraphs = [
            "".join(node.text or "" for node in paragraph.iter(f"{_A}t"))
            for paragraph in root.iter(f"{_A}p")
        ]
        slide_number = re.search(r"(\d+)\.xml$", name).group(1)
        notes_name = f"ppt/notesSlides/notesSlide{slide_number}.xml"
        notes_root = _parse_xml_member(archive, notes_name) if notes_name in archive.namelist() else None
        text = "\n".join(paragraph for paragraph in paragraphs if paragraph.strip())
        if notes_root is not None:
            notes = "\n".join(
                "".join(node.text or "" for node in paragraph.iter(f"{_A}t"))
                for paragraph in notes_root.iter(f"{_A}p")
            ).strip()
            if notes:
                text += f"\n\nNotes:\n{notes}"
        pages.append({"page_number": number, "content": clean_text(f"Slide {number}\n{text}")})
    return pages


# ---------------------------------------------------------------------------
# OLE compound files (doc, dot, wbk, xls, msg)
# ---------------------------------------------------------------------------

_FREE_SECTOR = 0xFFFFFFFF
_END_OF_CHAIN = 0xFFFFFFFE
_MAX_REGULAR_SECTOR = 0xFFFFFFFA


class CompoundFile:
    """Minimal read-only parser for Microsoft compound files (OLE2 / CFB)."""

    def __init__(self, raw: bytes) -> None:
        if len(raw) < 512 or raw[:8] != OLE_MAGIC:
            raise ValueError("Not an OLE compound file.")
        self.raw = raw
        sector_shift, mini_shift = struct.unpack_from("<HH", raw, 0x1E)
        if sector_shift not in (9, 12) or mini_shift != 6:
            raise ValueError("Unsupported compound file sector size.")
        self.sector_size = 1 << sector_shift
        self.mini_sector_size = 1 << mini_shift
        (
            fat_sector_count,
            directory_start,
            _transaction,
            self.mini_cutoff,
            mini_fat_start,
            _mini_fat_count,
            difat_start,
            difat_count,
        ) = struct.unpack_from("<IIIIIIII", raw, 0x2C)
        self.max_sectors = max(1, (len(raw) - self.sector_size) // self.sector_size + 1)

        difat = [entry for entry in struct.unpack_from("<109I", raw, 0x4C)]
        next_difat = difat_start
        seen_difat: set[int] = set()
        per_sector = self.sector_size // 4 - 1
        while next_difat < _MAX_REGULAR_SECTOR and len(seen_difat) < difat_count + 1:
            if next_difat in seen_difat:
                break
            seen_difat.add(next_difat)
            values = struct.unpack_from(f"<{per_sector + 1}I", self._sector(next_difat))
            difat.extend(values[:per_sector])
            next_difat = values[per_sector]
        fat_sectors = [sector for sector in difat if sector < _MAX_REGULAR_SECTOR][: max(fat_sector_count, 0) or None]
        fat: list[int] = []
        for sector in fat_sectors:
            fat.extend(struct.unpack_from(f"<{self.sector_size // 4}I", self._sector(sector)))
        self.fat = fat

        directory = self._chain_bytes(directory_start, self.fat, self._sector)
        self.entries: list[dict[str, object]] = []
        for offset in range(0, len(directory) - 127, 128):
            name_length = struct.unpack_from("<H", directory, offset + 0x40)[0]
            name = directory[offset: offset + max(0, min(name_length, 64) - 2)].decode("utf-16-le", errors="replace")
            entry_type = directory[offset + 0x42]
            left, right, child = struct.unpack_from("<III", directory, offset + 0x44)
            start, size_low, size_high = struct.unpack_from("<III", directory, offset + 0x74)
            size = size_low if self.sector_size == 512 else size_low | (size_high << 32)
            self.entries.append({
                "name": name, "type": entry_type, "left": left, "right": right,
                "child": child, "start": start, "size": size,
            })
        if not self.entries or self.entries[0]["type"] != 5:
            raise ValueError("The compound file has no root entry.")
        root = self.entries[0]
        self.mini_stream = self._chain_bytes(int(root["start"]), self.fat, self._sector)[: int(root["size"])]
        mini_fat_raw = self._chain_bytes(mini_fat_start, self.fat, self._sector)
        self.mini_fat = list(struct.unpack_from(f"<{len(mini_fat_raw) // 4}I", mini_fat_raw))
        self.paths = self._build_paths()

    def _sector(self, sector: int) -> bytes:
        offset = (sector + 1) * self.sector_size
        if sector >= _MAX_REGULAR_SECTOR or offset >= len(self.raw):
            raise ValueError("The compound file is truncated or damaged.")
        return self.raw[offset: offset + self.sector_size].ljust(self.sector_size, b"\x00")

    def _mini_sector(self, sector: int) -> bytes:
        offset = sector * self.mini_sector_size
        if offset >= len(self.mini_stream):
            raise ValueError("The compound file mini stream is damaged.")
        return self.mini_stream[offset: offset + self.mini_sector_size]

    def _chain_bytes(self, start: int, table: list[int], reader) -> bytes:
        chunks: list[bytes] = []
        sector = start
        seen: set[int] = set()
        while sector < _MAX_REGULAR_SECTOR:
            if sector in seen or len(seen) > self.max_sectors * 64:
                raise ValueError("The compound file contains a sector loop.")
            seen.add(sector)
            chunks.append(reader(sector))
            if sector >= len(table):
                break
            sector = table[sector]
        return b"".join(chunks)

    def _build_paths(self) -> dict[str, dict[str, object]]:
        paths: dict[str, dict[str, object]] = {}
        stack: list[tuple[int, str]] = [(int(self.entries[0]["child"]), "")]
        visited: set[int] = set()
        while stack:
            index, prefix = stack.pop()
            if index >= len(self.entries) or index in visited:
                continue
            visited.add(index)
            entry = self.entries[index]
            stack.append((int(entry["left"]), prefix))
            stack.append((int(entry["right"]), prefix))
            path = f"{prefix}{entry['name']}"
            if entry["type"] == 1:
                stack.append((int(entry["child"]), f"{path}/"))
            elif entry["type"] == 2:
                paths[path] = entry
        return paths

    def has(self, path: str) -> bool:
        return path in self.paths

    def read(self, path: str) -> bytes:
        entry = self.paths[path]
        size = int(entry["size"])
        if size < self.mini_cutoff:
            data = self._chain_bytes(int(entry["start"]), self.mini_fat, self._mini_sector)
        else:
            data = self._chain_bytes(int(entry["start"]), self.fat, self._sector)
        return data[:size]


def _strings_from_binary(raw: bytes, minimum: int = 5) -> str:
    """Fallback: collect readable text runs (UTF-16LE and ANSI) from binary data."""
    found: list[tuple[int, str]] = []
    letters = "A-Za-z\u00c0-\u00ff0-9"
    utf16 = re.compile(rb"(?:[\x20-\x7e\xa0-\xff]\x00|[\t\r\n]\x00){%d,}" % minimum)
    for match in utf16.finditer(raw):
        value = match.group(0).decode("utf-16-le", errors="ignore")
        found.append((match.start(), value))
    ansi = re.compile(rb"[\t\r\n\x20-\x7e\xa0-\xff]{%d,}" % minimum)
    for match in ansi.finditer(raw):
        value = match.group(0).decode("cp1252", errors="ignore")
        found.append((match.start(), value))
    found.sort()
    lines: list[str] = []
    for _, value in found:
        value = value.strip()
        if len(re.findall(f"[{letters}]", value)) < max(3, len(value) * 0.5):
            continue
        if not re.search(r"[A-Za-z\u00c0-\u00ff]{3}", value):
            continue
        if lines and lines[-1] == value:
            continue
        lines.append(value)
    return clean_text("\n".join(lines))


def _clean_word_text(text: str) -> str:
    # Remove field instructions: \x13 instruction \x14 result \x15 -> result
    output: list[str] = []
    in_instruction: list[bool] = []
    for char in text:
        if char == "\x13":
            in_instruction.append(True)
            continue
        if char == "\x14":
            if in_instruction:
                in_instruction[-1] = False
            continue
        if char == "\x15":
            if in_instruction:
                in_instruction.pop()
            continue
        if any(in_instruction):
            continue
        if char in "\r\x0b\x0c":
            output.append("\n")
        elif char == "\x07":
            output.append("\t")
        elif char in "\x01\x02\x03\x04\x05\x08":
            continue
        else:
            output.append(char)
    return clean_text("".join(output))


def word97_to_text(ole: CompoundFile) -> str:
    word = ole.read("WordDocument")
    if len(word) < 0x1AA or struct.unpack_from("<H", word, 0)[0] != 0xA5EC:
        raise ValueError("Unsupported Word document format.")
    flags = struct.unpack_from("<H", word, 0x0A)[0]
    if flags & 0x0100:
        raise ValueError("The Word document is password protected.")
    table_name = "1Table" if flags & 0x0200 else "0Table"
    if not ole.has(table_name):
        raise ValueError("The Word document has no text table.")
    table = ole.read(table_name)
    fc_clx, lcb_clx = struct.unpack_from("<II", word, 0x01A2)
    clx = table[fc_clx: fc_clx + lcb_clx]
    position = 0
    while position < len(clx) and clx[position] == 0x01:
        position += 3 + struct.unpack_from("<H", clx, position + 1)[0]
    if position >= len(clx) or clx[position] != 0x02:
        raise ValueError("The Word document piece table is missing.")
    plc_length = struct.unpack_from("<I", clx, position + 1)[0]
    plc = clx[position + 5: position + 5 + plc_length]
    piece_count = (len(plc) - 4) // 12
    cps = struct.unpack_from(f"<{piece_count + 1}I", plc, 0)
    parts: list[str] = []
    for index in range(piece_count):
        descriptor = plc[(piece_count + 1) * 4 + index * 8: (piece_count + 1) * 4 + index * 8 + 8]
        fc = struct.unpack_from("<I", descriptor, 2)[0]
        length = max(0, cps[index + 1] - cps[index])
        if fc & 0x40000000:
            start = (fc & ~0x40000000) // 2
            parts.append(word[start: start + length].decode("cp1252", errors="replace"))
        else:
            parts.append(word[fc: fc + length * 2].decode("utf-16-le", errors="replace"))
    return _clean_word_text("".join(parts))


class _BiffStream:
    """Reads BIFF8 records, joining CONTINUE records for the shared string table."""

    def __init__(self, data: bytes) -> None:
        self.records: list[tuple[int, bytes]] = []
        position = 0
        while position + 4 <= len(data):
            record_type, length = struct.unpack_from("<HH", data, position)
            self.records.append((record_type, data[position + 4: position + 4 + length]))
            position += 4 + length


def _xls_number(value: float) -> str:
    if value != value:  # NaN
        return ""
    if value.is_integer() and abs(value) < 1e15:
        return str(int(value))
    return f"{value:.10g}"


def _rk_value(rk: int) -> float:
    if rk & 0x02:
        value = float(rk >> 2 if rk < 0x80000000 else (rk >> 2) - (1 << 30))
    else:
        value = struct.unpack("<d", struct.pack("<Q", (rk & 0xFFFFFFFC) << 32))[0]
    return value / 100 if rk & 0x01 else value


def _read_sst(chunks: list[bytes]) -> list[str]:
    strings: list[str] = []
    chunk_index = 0
    data = chunks[0] if chunks else b""
    position = 8
    if len(data) < 8:
        return strings
    unique_count = struct.unpack_from("<I", data, 4)[0]

    def next_chunk() -> bool:
        nonlocal chunk_index, data, position
        chunk_index += 1
        if chunk_index >= len(chunks):
            return False
        data = chunks[chunk_index]
        position = 0
        return True

    def read_bytes(count: int) -> bytes:
        nonlocal position
        output = bytearray()
        while count > 0:
            if position >= len(data) and not next_chunk():
                raise ValueError("The Excel string table is truncated.")
            take = min(count, len(data) - position)
            output += data[position: position + take]
            position += take
            count -= take
        return bytes(output)

    while len(strings) < unique_count:
        if position >= len(data) and not next_chunk():
            break
        char_count = struct.unpack("<H", read_bytes(2))[0]
        option = read_bytes(1)[0]
        rich_runs = struct.unpack("<H", read_bytes(2))[0] if option & 0x08 else 0
        extended = struct.unpack("<I", read_bytes(4))[0] if option & 0x04 else 0
        wide = bool(option & 0x01)
        characters: list[str] = []
        remaining = char_count
        while remaining > 0:
            if position >= len(data):
                if not next_chunk():
                    break
                wide = bool(data[0] & 0x01)  # each CONTINUE starts with a new option byte
                position = 1
            available = (len(data) - position) // (2 if wide else 1)
            take = min(remaining, available)
            if take <= 0:
                position = len(data)
                continue
            if wide:
                characters.append(data[position: position + take * 2].decode("utf-16-le", errors="replace"))
                position += take * 2
            else:
                characters.append(data[position: position + take].decode("latin-1"))
                position += take
            remaining -= take
        read_bytes(rich_runs * 4 + extended)
        strings.append("".join(characters))
    return strings


def _biff_short_string(data: bytes, offset: int, length_bytes: int = 2) -> str:
    if length_bytes == 1:
        count = data[offset]
    else:
        count = struct.unpack_from("<H", data, offset)[0]
    flags = data[offset + length_bytes]
    start = offset + length_bytes + 1
    if flags & 0x01:
        return data[start: start + count * 2].decode("utf-16-le", errors="replace")
    return data[start: start + count].decode("latin-1")


def xls_to_pages(ole: CompoundFile) -> tuple[list[dict[str, object]], str]:
    stream_name = "Workbook" if ole.has("Workbook") else "Book" if ole.has("Book") else ""
    if not stream_name:
        raise ValueError("The Excel file has no workbook stream.")
    records = _BiffStream(ole.read(stream_name)).records
    if any(record_type == 0x002F for record_type, _ in records[:40]):
        raise ValueError("The Excel file is password protected.")
    sheet_names: list[str] = []
    sst_chunks: list[bytes] = []
    collecting_sst = False
    for record_type, data in records:
        if record_type == 0x0085 and len(data) > 8:
            sheet_names.append(_biff_short_string(data, 6, 1))
        if record_type == 0x00FC:
            sst_chunks = [data]
            collecting_sst = True
        elif record_type == 0x003C and collecting_sst:
            sst_chunks.append(data)
        else:
            collecting_sst = False
    shared = _read_sst(sst_chunks) if sst_chunks else []

    pages: list[dict[str, object]] = []
    sheet_index = -1
    cells: dict[tuple[int, int], str] = {}
    in_worksheet = False
    pending_formula: tuple[int, int] | None = None
    total_rows = 0

    def finish_sheet() -> None:
        nonlocal cells, total_rows
        name = sheet_names[sheet_index] if 0 <= sheet_index < len(sheet_names) else f"Sheet {sheet_index + 1}"
        rows: dict[int, dict[int, str]] = {}
        for (row, column), value in cells.items():
            if value.strip():
                rows.setdefault(row, {})[column] = value.strip()
        lines = [f"Sheet: {name}"]
        for row in sorted(rows)[:XLS_MAX_ROWS_PER_SHEET]:
            values = rows[row]
            lines.append("\t".join(values.get(index, "") for index in range(max(values) + 1)))
        total_rows += min(len(rows), XLS_MAX_ROWS_PER_SHEET)
        pages.append({"page_number": len(pages) + 1, "content": clean_text("\n".join(lines))})
        cells = {}

    for record_type, data in records:
        if record_type == 0x0809 and len(data) >= 4:  # BOF
            substream = struct.unpack_from("<H", data, 2)[0]
            if substream == 0x0010:
                sheet_index += 1
                in_worksheet = True
                cells = {}
            continue
        if record_type == 0x000A:  # EOF
            if in_worksheet:
                finish_sheet()
            in_worksheet = False
            continue
        if not in_worksheet or len(data) < 6:
            if record_type == 0x0207 and pending_formula and in_worksheet:  # STRING (formula result)
                cells[pending_formula] = _biff_short_string(data, 0, 2)
                pending_formula = None
            continue
        row, column = struct.unpack_from("<HH", data, 0)
        if record_type == 0x00FD and len(data) >= 10:  # LABELSST
            index = struct.unpack_from("<I", data, 6)[0]
            cells[(row, column)] = shared[index] if index < len(shared) else ""
        elif record_type == 0x0203 and len(data) >= 14:  # NUMBER
            cells[(row, column)] = _xls_number(struct.unpack_from("<d", data, 6)[0])
        elif record_type == 0x027E and len(data) >= 10:  # RK
            cells[(row, column)] = _xls_number(_rk_value(struct.unpack_from("<I", data, 6)[0]))
        elif record_type == 0x00BD:  # MULRK
            last_column = struct.unpack_from("<H", data, len(data) - 2)[0]
            for offset_index, current in enumerate(range(column, last_column + 1)):
                rk_offset = 4 + offset_index * 6 + 2
                if rk_offset + 4 <= len(data) - 2:
                    cells[(row, current)] = _xls_number(_rk_value(struct.unpack_from("<I", data, rk_offset)[0]))
        elif record_type == 0x0204 and len(data) >= 9:  # LABEL
            cells[(row, column)] = _biff_short_string(data, 6, 2)
        elif record_type == 0x0205 and len(data) >= 8:  # BOOLERR
            if data[7] == 0:
                cells[(row, column)] = "TRUE" if data[6] else "FALSE"
        elif record_type == 0x0006 and len(data) >= 14:  # FORMULA
            result_bytes = data[6:14]
            if result_bytes[6:8] == b"\xff\xff":
                if result_bytes[0] == 0x00:
                    pending_formula = (row, column)
                elif result_bytes[0] == 0x01:
                    cells[(row, column)] = "TRUE" if result_bytes[2] else "FALSE"
            else:
                cells[(row, column)] = _xls_number(struct.unpack("<d", result_bytes)[0])
        elif record_type == 0x0207 and pending_formula:  # STRING
            cells[pending_formula] = _biff_short_string(data, 0, 2)
            pending_formula = None
    details = f"{len(pages):,} sheet{'' if len(pages) == 1 else 's'} · {total_rows:,} rows"
    return pages, details


def _msg_string(ole: CompoundFile, prefix: str, property_id: str) -> str:
    unicode_path = f"{prefix}__substg1.0_{property_id}001F"
    ansi_path = f"{prefix}__substg1.0_{property_id}001E"
    if ole.has(unicode_path):
        return ole.read(unicode_path).decode("utf-16-le", errors="replace").rstrip("\x00").strip()
    if ole.has(ansi_path):
        return ole.read(ansi_path).decode("cp1252", errors="replace").rstrip("\x00").strip()
    return ""


def msg_to_text(ole: CompoundFile) -> str:
    if not any(path.startswith("__substg1.0_") for path in ole.paths):
        raise ValueError("This is not an Outlook message.")
    lines: list[str] = []
    subject = _msg_string(ole, "", "0037")
    sender = _msg_string(ole, "", "0C1A")
    sender_address = _msg_string(ole, "", "0C1F") or _msg_string(ole, "", "5D01")
    to = _msg_string(ole, "", "0E04")
    cc = _msg_string(ole, "", "0E03")
    if subject:
        lines.append(f"Subject: {subject}")
    if sender or sender_address:
        lines.append(f"From: {sender} <{sender_address}>".replace(" <>", ""))
    if to:
        lines.append(f"To: {to}")
    if cc:
        lines.append(f"Cc: {cc}")
    attachments = sorted({
        path.split("/", 1)[0] for path in ole.paths if path.startswith("__attach_version1.0_")
    })
    attachment_names = [
        _msg_string(ole, f"{storage}/", "3707") or _msg_string(ole, f"{storage}/", "3704")
        for storage in attachments
    ]
    attachment_names = [name for name in attachment_names if name]
    if attachment_names:
        lines.append(f"Attachments: {', '.join(attachment_names)}")
    body = _msg_string(ole, "", "1000")
    if not body and ole.has("__substg1.0_10130102"):
        body = html_to_text(decode_text(ole.read("__substg1.0_10130102")))
    if body:
        lines.extend(["", body])
    return clean_text("\n".join(lines))


# ---------------------------------------------------------------------------
# DXF / DWG
# ---------------------------------------------------------------------------

_DXF_TEXT_ENTITIES = {"TEXT", "MTEXT", "ATTRIB", "ATTDEF", "DIMENSION", "MULTILEADER", "MLEADER"}
_DWG_VERSIONS = {
    "AC1009": "AutoCAD R11/R12", "AC1012": "AutoCAD R13", "AC1014": "AutoCAD R14",
    "AC1015": "AutoCAD 2000", "AC1018": "AutoCAD 2004", "AC1021": "AutoCAD 2007",
    "AC1024": "AutoCAD 2010", "AC1027": "AutoCAD 2013", "AC1032": "AutoCAD 2018",
}


def _clean_mtext(value: str) -> str:
    value = re.sub(r"\\U\+([0-9A-Fa-f]{4})", lambda match: chr(int(match.group(1), 16)), value)
    value = value.replace("\\P", "\n").replace("\\~", " ")
    value = re.sub(r"\\S([^;]*)\^([^;]*);", r"\1/\2", value)
    value = re.sub(r"\\[ACcFfHhQqTtWwp][^;\\{}]*;", "", value)
    value = re.sub(r"\\[LlOoKkN]", "", value)
    value = value.replace("\\\\", "\\").replace("{", "").replace("}", "")
    value = re.sub(r"%%[cC]", "\u00d8", value)
    value = re.sub(r"%%[dD]", "\u00b0", value)
    value = re.sub(r"%%[pP]", "\u00b1", value)
    value = re.sub(r"%%[uUoO]", "", value)
    return value.strip()


def dxf_to_text(raw: bytes) -> tuple[str, str]:
    if raw.startswith(b"AutoCAD Binary DXF"):
        raise ValueError("binary-dxf")
    text = decode_text(raw)
    lines = text.splitlines()
    entity = ""
    section = ""
    expect_section_name = False
    layers: list[str] = []
    texts: list[str] = []
    mtext_chunks: list[str] = []
    for index in range(0, len(lines) - 1, 2):
        code = lines[index].strip()
        value = lines[index + 1]
        if code == "0":
            if mtext_chunks:
                texts.append(_clean_mtext("".join(mtext_chunks)))
                mtext_chunks = []
            entity = value.strip().upper()
            expect_section_name = entity == "SECTION"
            continue
        if code == "2" and expect_section_name:
            section = value.strip().upper()
            expect_section_name = False
            continue
        if entity == "LAYER" and code == "2" and section == "TABLES":
            if value.strip() and value.strip() not in layers:
                layers.append(value.strip())
        elif entity in _DXF_TEXT_ENTITIES and code in {"1", "3", "304"}:
            if entity == "DIMENSION" and value.strip() in {"", "<>"}:
                continue
            mtext_chunks.append(value)
    if mtext_chunks:
        texts.append(_clean_mtext("".join(mtext_chunks)))
    texts = [value for value in texts if value]
    unique_texts = list(dict.fromkeys(texts))
    parts: list[str] = []
    if layers:
        parts.append("Layers: " + ", ".join(layers[:300]))
    if unique_texts:
        parts.append("Drawing text:\n" + "\n".join(unique_texts))
    details = f"{len(unique_texts):,} text entries · {len(layers):,} layers"
    return clean_text("\n\n".join(parts)), details


def dwg_details(raw: bytes) -> str:
    version = raw[:6].decode("ascii", errors="replace")
    return _DWG_VERSIONS.get(version, f"DWG version {version}" if version.startswith("AC") else "DWG")


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------


def _extract_zip(filename: str, raw: bytes, depth: int) -> dict[str, object]:
    kind = FORMAT_LABELS[".zip"]
    try:
        archive = zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile as error:
        raise ValueError("The ZIP archive is damaged.") from error
    with archive:
        members = [info for info in archive.infolist() if not info.is_dir()]
        listing = [f"{info.filename} ({info.file_size:,} bytes)" for info in members[:1_000]]
        pages: list[dict[str, object]] = [{
            "page_number": 1,
            "content": clean_text(f"ZIP archive {filename} contains {len(members):,} files:\n" + "\n".join(listing)),
        }]
        warnings: list[str] = []
        if depth > 0:
            warnings.append("Nested archives are listed but not unpacked.")
            return result(kind, pages, f"{len(members):,} files", warnings)
        total_read = 0
        extracted_count = 0
        for info in members[:ZIP_MAX_MEMBERS]:
            extension = Path(info.filename).suffix.lower()
            if (
                extension not in SUPPORTED_EXTENSIONS
                or extension in IMAGE_EXTENSIONS | PDF_EXTENSIONS | {".zip", ".7z"}
                or info.file_size == 0
            ):
                continue
            if info.file_size > ZIP_MAX_MEMBER_BYTES or total_read + info.file_size > ZIP_MAX_TOTAL_BYTES:
                warnings.append("Some large files inside the ZIP archive were listed but not read.")
                continue
            try:
                with archive.open(info) as member:
                    member_raw = member.read(ZIP_MAX_MEMBER_BYTES + 1)
            except (RuntimeError, zipfile.BadZipFile, NotImplementedError, OSError):
                warnings.append(f"Could not read {info.filename} inside the ZIP archive (encrypted or damaged).")
                continue
            total_read += len(member_raw)
            try:
                member_result = extract_document(info.filename, member_raw, depth=depth + 1)
            except (ValueError, UnicodeDecodeError, ElementTree.ParseError, struct.error, IndexError) as error:
                warnings.append(f"Could not read {info.filename} inside the ZIP archive: {error}")
                continue
            member_text = "\n\n".join(str(page["content"]) for page in member_result["pages"])
            if member_text.strip():
                extracted_count += 1
                pages.append({
                    "page_number": len(pages) + 1,
                    "content": clean_text(f"File in archive: {info.filename}\n{member_text}"),
                })
        if len(members) > ZIP_MAX_MEMBERS:
            warnings.append(f"Only the first {ZIP_MAX_MEMBERS} files inside the ZIP archive were inspected.")
        details = f"{len(members):,} files · text read from {extracted_count:,}"
        return result(kind, pages, details, warnings)


def extract_document(filename: str, raw: bytes, depth: int = 0) -> dict[str, object]:
    """Extract text from every non-PDF, non-image, non-CSV/JSON format.

    Returns a dict with ``kind``, ``pages`` (``page_number``/``content``),
    ``details``, ``warnings`` and ``note`` (an explanation when no text could
    be read). Raises ``ValueError`` only for unsupported file extensions:
    damaged, encrypted or unreadable files are still accepted so that they
    can be stored; their result explains why no text is available.
    """
    extension = Path(filename).suffix.lower()
    if extension not in SUPPORTED_EXTENSIONS:
        raise ValueError(f"Unsupported file type {extension or '(none)'}.")
    try:
        return _extract(filename, raw, extension, depth)
    except (
        ValueError, UnicodeDecodeError, ElementTree.ParseError, struct.error,
        IndexError, KeyError, zipfile.BadZipFile, RuntimeError, NotImplementedError, OSError,
        RecursionError, MemoryError,
    ) as error:
        kind = format_label(filename)
        message = str(error) or error.__class__.__name__
        return stored_only(
            kind,
            f"{kind} · text could not be read",
            f"The file can be saved, but its text could not be read ({message}). "
            "Enter the building details manually.",
        )


def _extract(filename: str, raw: bytes, extension: str, depth: int) -> dict[str, object]:
    kind = format_label(filename)
    if not raw:
        return stored_only(kind, "Empty file", "The file is empty. Enter the building details manually.")

    # Content sniffing first: files are often renamed or saved with the "wrong" extension.
    if raw.startswith(ZIP_MAGIC) and extension in OOXML_EXTENSIONS | {".zip", ".doc", ".xls", ".dot"}:
        try:
            archive = zipfile.ZipFile(io.BytesIO(raw))
        except zipfile.BadZipFile as error:
            raise ValueError("The file is damaged (invalid ZIP container).") from error
        with archive:
            names = set(archive.namelist())
            if "word/document.xml" in names:
                return result(kind, single_page(docx_to_text(archive)))
            if "xl/workbook.xml" in names:
                pages, details = xlsx_to_pages(archive)
                return result(kind, [page for page in pages if page["content"]], details)
            if "ppt/presentation.xml" in names:
                pages = pptx_to_pages(archive)
                return result(kind, pages, f"{len(pages):,} slide{'' if len(pages) == 1 else 's'}")
        if extension in OOXML_EXTENSIONS:
            raise ValueError(f"The {kind} file is damaged or encrypted.")
        return _extract_zip(filename, raw, depth)

    if extension == ".zip":
        raise ValueError("The ZIP archive is damaged.")

    if extension == ".db":
        if raw.startswith(b"SQLite format 3\x00"):
            return stored_only("SQLite database", "SQLite database · stored only")
        return stored_only(kind, "Stored only (for example Windows Thumbs.db)")

    if raw.startswith(OLE_MAGIC):
        ole = CompoundFile(raw)
        if ole.has("EncryptedPackage"):
            raise ValueError("the document is password protected")
        if extension in OOXML_EXTENSIONS:
            raise ValueError(f"The {kind} file is password protected and cannot be read.")
        warnings: list[str] = []
        try:
            if ole.has("WordDocument"):
                return result(kind, single_page(word97_to_text(ole)))
            if ole.has("Workbook") or ole.has("Book"):
                pages, details = xls_to_pages(ole)
                return result(kind, [page for page in pages if page["content"]], details)
            if any(path.startswith("__substg1.0_") for path in ole.paths):
                return result(kind, single_page(msg_to_text(ole)))
        except (ValueError, struct.error, IndexError, KeyError) as error:
            warnings.append(f"Exact text extraction failed ({error}); readable text fragments are shown instead.")
        if extension in OLE_EXTENSIONS:
            text = _strings_from_binary(raw)
            return result(kind, single_page(text), warnings=warnings or [
                "Readable text fragments were recovered; layout and numbers may be incomplete."
            ])
        return stored_only(kind, f"{kind} · compound file")

    if extension in OOXML_EXTENSIONS:
        raise ValueError(f"The {kind} file is damaged (expected an Office Open XML document).")
    if extension in OLE_EXTENSIONS:
        if raw.lstrip()[:5] == b"{\\rtf":  # Word often saves RTF with a .doc extension
            return result(kind, single_page(rtf_to_text(raw)))
        if looks_like_text(raw):
            return result(kind, single_page(decode_text(raw)))
        return result(kind, single_page(_strings_from_binary(raw)), warnings=[
            "Unknown internal format; readable text fragments were recovered."
        ])

    if extension == ".rtf":
        return result(kind, single_page(rtf_to_text(raw)))
    if extension in HTML_EXTENSIONS:
        return result(kind, single_page(html_to_text(decode_text(raw))))
    if extension in XML_EXTENSIONS:
        return result(kind, single_page(xml_to_text(raw)))
    if extension in GAEB90_EXTENSIONS:
        return result(kind, single_page(gaeb90_to_text(raw)))
    if extension == ".dxf":
        try:
            text, details = dxf_to_text(raw)
        except ValueError:
            return stored_only(kind, "Binary DXF", "Binary DXF drawings are saved, but their text cannot be read. "
                                                   "Enter the building details manually.")
        return result(kind, single_page(text), details)
    if extension == ".dwg":
        return stored_only(kind, dwg_details(raw), "DWG drawings are saved as they are. Their text cannot be "
                                                   "read without CAD software; export a DXF or PDF for text "
                                                   "search, or enter the building details manually.")
    if extension == ".7z":
        return stored_only(kind, "Archive · contents not unpacked",
                           "7z archives are saved, but not unpacked. Use ZIP to have contents read, "
                           "or enter the building details manually.")
    if extension in TEXT_EXTENSIONS or looks_like_text(raw):
        return result(kind, single_page(decode_text(raw)))
    return stored_only(kind, f"{kind} · stored only")
