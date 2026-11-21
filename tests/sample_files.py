"""Small generators for test files in formats that need no extra packages."""

from __future__ import annotations

import io
import struct
import zipfile


def compound_file(streams: dict[str, bytes]) -> bytes:
    """Build a minimal OLE compound file (512-byte sectors, no mini stream).

    ``streams`` maps paths such as ``"__substg1.0_0037001F"`` or
    ``"__attach_version1.0_#00000000/__substg1.0_3707001F"`` to their bytes.
    Only one level of storages is supported, which is enough for test messages.
    """
    sector = 512
    end_of_chain, fat_marker, free = 0xFFFFFFFE, 0xFFFFFFFD, 0xFFFFFFFF

    # Directory entries: root, storages and streams.
    entries: list[dict[str, object]] = [{"name": "Root Entry", "type": 5, "children": []}]
    storages: dict[str, int] = {}
    for path, data in streams.items():
        parent = 0
        if "/" in path:
            storage_name, path = path.split("/", 1)
            if storage_name not in storages:
                entries.append({"name": storage_name, "type": 1, "children": []})
                storages[storage_name] = len(entries) - 1
                entries[0]["children"].append(storages[storage_name])
            parent = storages[storage_name]
        entries.append({"name": path, "type": 2, "data": data, "children": []})
        entries[parent]["children"].append(len(entries) - 1)

    # Sector layout: [FAT sectors][directory sectors][stream data ...]
    directory_sectors = -(-len(entries) * 128 // sector)
    data_sectors = sum(-(-len(entry.get("data", b"")) // sector) for entry in entries if entry["type"] == 2)
    fat_sectors = 1
    while fat_sectors * (sector // 4) < fat_sectors + directory_sectors + data_sectors:
        fat_sectors += 1
    fat = [fat_marker] * fat_sectors
    directory_start = len(fat)
    for index in range(directory_sectors):
        fat.append(directory_start + index + 1 if index < directory_sectors - 1 else end_of_chain)
    data_blob = bytearray()
    for entry in entries:
        data = entry.get("data", b"")
        if entry["type"] != 2 or not data:
            entry["start"], entry["size"] = (end_of_chain, 0) if entry["type"] != 5 else (end_of_chain, 0)
            continue
        count = -(-len(data) // sector)
        start = len(fat)
        for index in range(count):
            fat.append(start + index + 1 if index < count - 1 else end_of_chain)
        entry["start"], entry["size"] = start, len(data)
        data_blob += data.ljust(count * sector, b"\x00")
    fat += [free] * (fat_sectors * (sector // 4) - len(fat))

    # Children are linked as a right-leaning sibling chain.
    for entry in entries:
        entry.setdefault("left", free)
        entry.setdefault("right", free)
        entry["child"] = free
    for entry in entries:
        children = entry["children"]
        if children:
            entry["child"] = children[0]
            for current, following in zip(children, children[1:]):
                entries[current]["right"] = following

    directory = bytearray()
    for entry in entries:
        name = str(entry["name"]).encode("utf-16-le") + b"\x00\x00"
        record = bytearray(128)
        record[0:len(name)] = name
        struct.pack_into("<H", record, 0x40, len(name))
        record[0x42] = int(entry["type"])
        record[0x43] = 1
        struct.pack_into("<III", record, 0x44, entry["left"], entry["right"], entry["child"])
        struct.pack_into("<III", record, 0x74, entry["start"], entry["size"], 0)
        directory += record
    directory = directory.ljust(directory_sectors * sector, b"\x00")

    header = bytearray(512)
    header[0:8] = bytes.fromhex("D0CF11E0A1B11AE1")
    struct.pack_into("<HHHH", header, 0x18, 0x3E, 3, 0xFFFE, 9)
    struct.pack_into("<H", header, 0x20, 6)
    struct.pack_into(
        "<IIIIIIII", header, 0x2C,
        fat_sectors, directory_start, 0, 0, end_of_chain, 0, end_of_chain, 0,
    )
    difat = list(range(fat_sectors)) + [free] * (109 - fat_sectors)
    struct.pack_into("<109I", header, 0x4C, *difat)
    fat_bytes = struct.pack(f"<{len(fat)}I", *fat)
    return bytes(header) + fat_bytes + bytes(directory) + bytes(data_blob)


def outlook_message(subject: str, sender: str, to: str, body: str, attachment: str = "") -> bytes:
    def text(value: str) -> bytes:
        return value.encode("utf-16-le")

    streams = {
        "__substg1.0_0037001F": text(subject),
        "__substg1.0_0C1A001F": text(sender),
        "__substg1.0_0E04001F": text(to),
        "__substg1.0_1000001F": text(body),
        "__properties_version1.0": b"\x00" * 32,
    }
    if attachment:
        streams["__attach_version1.0_#00000000/__substg1.0_3707001F"] = text(attachment)
    return compound_file(streams)


def office_zip(files: dict[str, str]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, content in files.items():
            archive.writestr(name, content)
    return buffer.getvalue()


def minimal_docx(*paragraphs: str) -> bytes:
    namespace = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
    body = "".join(f"<w:p><w:r><w:t>{paragraph}</w:t></w:r></w:p>" for paragraph in paragraphs)
    return office_zip({
        "[Content_Types].xml": "<Types xmlns='http://schemas.openxmlformats.org/package/2006/content-types'/>",
        "word/document.xml": f"<w:document xmlns:w='{namespace}'><w:body>{body}</w:body></w:document>",
    })


def minimal_xlsx(rows: list[list[str]], sheet_name: str = "Gebäude") -> bytes:
    main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    relationship = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
    shared: list[str] = []
    xml_rows = []
    for row_index, row in enumerate(rows, start=1):
        cells = []
        for column_index, value in enumerate(row):
            reference = f"{chr(65 + column_index)}{row_index}"
            if value.replace(".", "", 1).isdigit():
                cells.append(f"<c r='{reference}'><v>{value}</v></c>")
            else:
                shared.append(value)
                cells.append(f"<c r='{reference}' t='s'><v>{len(shared) - 1}</v></c>")
        xml_rows.append(f"<row r='{row_index}'>{''.join(cells)}</row>")
    strings = "".join(f"<si><t>{value}</t></si>" for value in shared)
    return office_zip({
        "[Content_Types].xml": "<Types xmlns='http://schemas.openxmlformats.org/package/2006/content-types'/>",
        "xl/workbook.xml": (
            f"<workbook xmlns='{main}' xmlns:r='{relationship}'><sheets>"
            f"<sheet name='{sheet_name}' sheetId='1' r:id='rId1'/></sheets></workbook>"
        ),
        "xl/_rels/workbook.xml.rels": (
            "<Relationships xmlns='http://schemas.openxmlformats.org/package/2006/relationships'>"
            "<Relationship Id='rId1' Target='worksheets/sheet1.xml' "
            "Type='http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet'/>"
            "</Relationships>"
        ),
        "xl/sharedStrings.xml": f"<sst xmlns='{main}'>{strings}</sst>",
        "xl/worksheets/sheet1.xml": f"<worksheet xmlns='{main}'><sheetData>{''.join(xml_rows)}</sheetData></worksheet>",
    })


def minimal_pptx(*slides: str) -> bytes:
    drawing = "http://schemas.openxmlformats.org/drawingml/2006/main"
    files = {
        "[Content_Types].xml": "<Types xmlns='http://schemas.openxmlformats.org/package/2006/content-types'/>",
        "ppt/presentation.xml": "<p:presentation xmlns:p='http://schemas.openxmlformats.org/presentationml/2006/main'/>",
    }
    for number, text in enumerate(slides, start=1):
        files[f"ppt/slides/slide{number}.xml"] = (
            f"<p:sld xmlns:p='http://schemas.openxmlformats.org/presentationml/2006/main' "
            f"xmlns:a='{drawing}'><a:p><a:r><a:t>{text}</a:t></a:r></a:p></p:sld>"
        )
    return office_zip(files)


SAMPLE_DXF = "\n".join([
    "0", "SECTION", "2", "TABLES",
    "0", "TABLE", "2", "LAYER",
    "0", "LAYER", "2", "Waende", "70", "0",
    "0", "LAYER", "2", "Beschriftung", "70", "0",
    "0", "ENDTAB",
    "0", "ENDSEC",
    "0", "SECTION", "2", "ENTITIES",
    "0", "TEXT", "8", "Beschriftung", "1", "Erdgeschoss Rathaus",
    "0", "MTEXT", "8", "Beschriftung", "3", "{\\fArial|b1;Raum 1.01}\\PFläche 24,5 m",
    "1", "\\U+00B2",
    "0", "LINE", "8", "Waende", "10", "0", "20", "0", "11", "5", "21", "0",
    "0", "ENDSEC",
    "0", "EOF",
]) + "\n"

def gaeb90(*records: str) -> bytes:
    """GAEB 90 lines: 74 characters of content plus a 6-digit line number, DOS code page 850."""
    lines = [f"{record:<74.74}{number:06d}" for number, record in enumerate(records, start=1)]
    return ("\r\n".join(lines) + "\r\n").encode("cp850")


SAMPLE_GAEB90 = gaeb90(
    "00        83   GAEB 90 Testdatei",
    "25Dachsanierung Rathaus Coburg",
    "26Ziegel erneuern, Unterspannbahn prüfen",
)
