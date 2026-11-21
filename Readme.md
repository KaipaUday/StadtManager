# StadtManager

## Run locally

```bash
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python -m uvicorn app:app --app-dir Site --reload
```

Open <http://127.0.0.1:8000>. Press `Ctrl+C` to stop the server. The site
supports individual files or whole folders with 57 file types (see
[Supported file types](#supported-file-types)) up to 100 MB each by default.
Supported files are processed one at a time. Review extracted building details,
add categories such as heating system, and accept each record before it is saved.

## Supported file types

Every listed type can be uploaded. Accepted originals are stored unchanged in
SQLite. Where the format contains text, it is extracted for the preview and
local full-text search. PDF field extraction sends up to the first eight pages
directly to the selected AI provider; other formats use extracted text. No
extra Python packages are needed beyond `requirements.txt`; the readers live in
`Site/file_formats.py`.

| Group | Extensions | What is read |
| --- | --- | --- |
| PDF | `.pdf` | Text per page, local OCR, direct AI PDF reading (first eight pages), page previews, embedded images |
| Images | `.jpg` `.jpeg` `.png` `.gif` `.tif` `.tiff` | OCR text (Tesseract), page preview, 3D draft from scanned plans |
| Word | `.docx` `.doc` `.dot` `.wbk` `.rtf` | Body text, tables, headers and footers |
| Excel | `.xlsx` `.xlsm` `.xls` `.csv` | All sheets, cell values (CSV with `,` or `;`) |
| PowerPoint | `.pptx` | Text of each slide and its notes |
| E-mail | `.msg` | Subject, sender, recipients, attachment names, body |
| Web / data | `.html` `.htm` `.xml` `.json` `.gan` | Visible text, XML text and name attributes, GanttProject tasks |
| GAEB | `.x81`–`.x84`, `.d81` `.d83` `.d84` `.p81` `.p83` | Tender texts (GAEB XML and GAEB 90/2000) |
| CAD | `.dxf` | Layer names and drawing text (TEXT, MTEXT, attributes) |
| Text | `.txt` `.md` `.ini` `.info` `.py` `.sample` `.tpl` `.dos` | Text (UTF-8, UTF-16 or Windows-1252) |
| Archives | `.zip` | File list plus text of the supported files inside |
| Stored only | `.dwg` `.pln` `.pla` `.bpn` `.gsm` `.shx` `.lwi` `.sgc` `.cdr` `.7z` `.mov` `.db` `.lnk` `.lck` `.tmp` | Saved as they are; enter building details manually |

Damaged, password-protected, or unreadable files are still accepted and saved;
the review panel explains why no text was found. Older binary Office files
(`.doc`, `.xls`, `.msg`) are read directly from their compound-file structure.
Uploaded HTML, XML, e-mails, and other non-viewable files are always served as
downloads, so they can't run scripts inside the app.

Run the tests with:

```bash
python -m unittest discover -s tests
```

`tests/test_file_formats.py` needs only the Python standard library.

Accepted building records and their original files are stored locally in
`data/stadtmanager.sqlite3` (the files are stored as database BLOBs). Original
files from skipped uploads aren't saved, but their structured AI analysis is.
Street name and house number remain the unique
address match, while each building also gets a unique, human-readable 3–8 letter
code. The AI recommends a code for new buildings; review or edit it before
saving. Uploads for an existing address reuse its saved code. A UUID and integer
database key remain internal identifiers. Each source file remains available
from the building details. If an upload conflicts with a saved property value,
choose whether to keep or replace it before the merge is saved; replaced values
are retained in the database history.

The city map is centered on Coburg and uses OpenFreeMap/OpenStreetMap map tiles,
so an internet connection is required.
Search the saved-object list by name, address, or property; opening a pin or
list result shows the attached files, stored PDF images, maintenance findings,
and any saved 3D model.

For saved PDFs, the app renders up to eight page previews and extracts
compatible embedded images for the building detail view. Selecting **Generate
3D draft** sends up to five rendered pages to the selected AI provider. Review
the approximate room layout before saving it. The model is stored as
`stadtmanager-twin-v1` JSON in SQLite (`building_twins.model_json`): floors,
rooms, positions, dimensions, units, and confidence. If the PDF has no usable
scale, dimensions are relative rather than meters. This is a simplified visual
model, not an IFC/BIM model or an engineering-accurate representation.

The top bar has a German/English language toggle. It defaults to German when
the browser language starts with `de`, otherwise English, and remembers the
chosen language locally. **Clear data** asks for confirmation before deleting
all saved buildings, source files, maintenance findings, document indexes, and
saved 3D models.

Address lookup runs automatically as the street and house number are entered,
and again before saving. It uses the public OpenStreetMap service to find a
Coburg address, fill coordinates, and reuse the code for an existing building.
If the address search only finds the street, it also checks OpenStreetMap for a
building explicitly tagged with that street and house number; when found, the
pin uses the building center. Otherwise the app labels the street-level
approximation and lets you pick a point on the map rather than claiming an exact
building location.
If the address cannot be verified or is outside the Coburg area, the file will
not be saved. Coordinates can also be selected directly on the map, but the
street and house number are still checked before acceptance. An optional
full-address field can be entered or extracted from a document for address
searches.

To use the AI assistant, set either `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`
in the server's environment. Select the matching provider in the website.
Optional `ANTHROPIC_MODEL` and `OPENAI_MODEL` variables override the default
model names. The UI checks the key and loads available chat models before
showing the model selector. Keys are never sent to or displayed by the browser.
Each chat request includes saved building details and any reviewed digital-twin
geometry from SQLite (up to the newest 100 buildings and a 16,000-character
limit), along with any text from files currently uploaded in the workspace.
Original stored file bytes are not sent as part of the database context. This
information is sent to the selected AI provider; the assistant is told when the
database context has been truncated. When creating a 3D draft, rendered plan
pages are also sent to that provider.
During document extraction, the selected provider also receives up to the
newest 100 saved buildings' UIDs, codes, names, and addresses so it can suggest
a possible match. The suggestion is checked against saved records and shown for
review; it does not merge or link a building automatically. The uploaded
PDF is sent directly to the provider as a PDF (up to the first eight pages).
For other file types, extracted text is sent. If direct PDF analysis returns no
structured fields, pypdf extracts local PDF text and the provider retries using
that text.

Structured extraction results, maintenance suggestions, chat questions and
answers, and AI 3D drafts are saved locally for future searches and predictions.
Extraction results are retained even when an upload is skipped. The original
file is saved only after acceptance. The app stores structured outputs, not raw
extraction responses or private model reasoning. **Clear data** removes these
AI records along with saved buildings and files.

## Large documents, OCR, and AI search

The upload limit defaults to 100 MB per file and can be changed with
`STADTMANAGER_MAX_UPLOAD_MB` (1–1024). PDF processing defaults to 500 pages per
document; change `STADTMANAGER_MAX_PDF_PAGES` to a value from 1 to 10000.
Building-field extraction previews the first 30 pages, while the saved-document
index processes pages up to the configured document limit.

PDF pages with little or no selectable text are OCR-processed using PyMuPDF and
the locally installed Tesseract engine. Install Tesseract and the German and
English language data for your OS. For macOS, for example:

```bash
brew install tesseract
```

Set `OCR_LANGUAGES` to the languages available on your machine (default
`deu+eng`). Set `TESSDATA_PREFIX` if Tesseract's language data is not in its
standard location. OCR and indexing run locally; a document's full extracted
text is stored in SQLite's local full-text index. Documents over the page limit,
missing OCR languages, and indexing failures are reported in the building's
file list.

During upload, the selected AI provider receives the PDF itself, limited to its
first eight pages. The provider can read selectable text and visual content
such as tables and scanned pages. If it returns no structured building fields,
the app uses pypdf to extract text locally and retries the structured
extraction. Local OCR and text extraction remain in use for preview and
saved-file search.

Every AI chat request automatically searches both the SQLite building records
and the indexed contents of saved files. The assistant receives the bounded
building overview plus matching building records and up to eight relevant
document passages, labeled with filename, page, and building. Pending or
partially indexed documents are identified so the assistant can disclose
incomplete coverage. Existing saved files are queued for indexing as chat
requests arrive. Matching document passages and database information are sent
to the selected AI provider with the chat request; original file bytes are not
sent as part of this retrieval context. Relevant saved AI extraction results
and previous chat answers are also included as unverified context.

When a document contains explicit repair, replacement, inspection, or scheduled
maintenance information, the AI may extract an evidence-backed suggestion.
These findings appear on the dashboard as **Needs review** and do not become
active alerts until a user confirms them. Findings without a supporting excerpt
are not saved. Confirmed alerts can be dismissed or marked repaired.
Image-backed PDFs use AI visual analysis during upload; other PDFs rely on
selectable text or local OCR for maintenance extraction. If neither provides
readable content, the file needs manual review. Existing databases receive a
migration that assigns
stable UIDs and parses unambiguous street/number addresses; ambiguous legacy
addresses are preserved for review rather than automatically merged.

With the server running, check a provider key and list models without printing
the key itself:

```bash
curl --fail-with-body --silent --show-error --get http://127.0.0.1:8000/api/models \
  --data-urlencode provider=anthropic
```

Use `provider=openai` to check the OpenAI key instead. A successful response
includes the available model IDs; an invalid or missing key returns an error.

## Environment variables

Replace placeholders with your own credentials. Never commit real secrets to
the repository or paste them into source code.

### For the current terminal only

```bash
export OPENAI_API_KEY="your-openai-api-key"
export ANTHROPIC_API_KEY="your-anthropic-api-key"
export STADTMANAGER_MAX_UPLOAD_MB="100"
export STADTMANAGER_MAX_PDF_PAGES="500"
export OCR_LANGUAGES="deu+eng"

# Optional database settings for future database-backed features
export DB_HOST="localhost"
export DB_PORT="5432"
export DB_NAME="your-database-name"
export DB_USER="your-database-user"
export DB_PASSWORD="your-database-password"
```

### Persist on macOS (zsh)

Add the same `export` lines to `~/.zshrc` using a text editor:

```bash
nano ~/.zshrc
```

Save and close the editor, then load the settings into the current terminal:

```bash
source ~/.zshrc
```

New terminal windows will load these settings automatically. The current app
uses local SQLite, so the `DB_*` examples aren't used. Set
`STADTMANAGER_DB_PATH` if you want to store the SQLite database at a different
local path.
