const fileInput = document.querySelector("#file-input");
const folderInput = document.querySelector("#folder-input");
const dropzone = document.querySelector("#dropzone");
const fileList = document.querySelector("#file-list");
const chatForm = document.querySelector("#chat-form");
const chatInput = document.querySelector("#chat-input");
const chatArea = document.querySelector("#chat-area");
const providerSelect = document.querySelector("#provider");
const modelSelect = document.querySelector("#model-select");
const keyStatus = document.querySelector("#key-status");
const sendButton = document.querySelector("#send-button");
const toast = document.querySelector("#toast");

const state = {
  files: [],
  processedCount: 0,
  messages: [],
  toastTimer: null,
  modelsReady: false,
  modelRequest: 0,
  categories: ["Heating system"],
  importQueue: [],
  importTotal: 0,
  importCompleted: 0,
  currentImport: null,
  currentExtraction: null,
  pendingMerge: null,
  suggestedBuildingUid: "",
  previewUrl: null,
  buildings: [],
  maintenance: [],
  map: null,
  mapLoaded: false,
  mapMarkers: [],
  pickingLocation: false,
  activeBuildingId: null,
  twinDraft: null,
  twinDraftSourceDocumentId: null,
  threePromise: null,
  twinViewer: null,
  addressVerified: false,
  addressRequestId: 0,
  addressLookupTimer: null,
  buildingCodeManuallyEdited: false,
  buildingCodeSource: "",
  locationPickedManually: false,
  pickedLocationMarker: null,
  language: "en",
  user: null,
  adminUsers: [],
  authMode: "login",
  profile: null,
  pendingProfileImage: null,
  profileImageRemoved: false,
};
sendButton.disabled = true;

// Keep in sync with Site/file_formats.py (checked by tests/test_file_formats.py).
const SUPPORTED_EXTENSIONS = [
  "7z", "bpn", "cdr", "csv", "d81", "d83", "d84", "db", "doc", "docx", "dos", "dot", "dwg", "dxf",
  "gan", "gif", "gsm", "htm", "html", "info", "ini", "jpeg", "jpg", "json", "lck", "lnk", "lwi",
  "md", "mov", "msg", "p81", "p83", "pdf", "pla", "pln", "png", "pptx", "py", "rtf", "sample",
  "sgc", "shx", "tif", "tiff", "tmp", "tpl", "txt", "wbk", "x81", "x82", "x83", "x84", "xls",
  "xlsm", "xlsx", "xml", "zip",
];
const BROWSER_IMAGE_EXTENSIONS = ["gif", "jpeg", "jpg", "png"];
const RENDERABLE_EXTENSIONS = ["gif", "jpeg", "jpg", "pdf", "png", "tif", "tiff"];

function fileExtension(name) {
  const match = /\.([^./\\]+)$/.exec(name || "");
  return match ? match[1].toLowerCase() : "";
}

function isSupportedFile(name) {
  return SUPPORTED_EXTENSIONS.includes(fileExtension(name));
}

const translations = {
  en: {
    workspace: "Workspace",
    overview: "Overview",
    files: "File workspace",
    map: "City map",
    assistant: "AI assistant",
    checking: "Checking backend",
    connected: "Backend connected",
    offline: "Backend offline",
    clear: "Clear data",
    profileTitle: "Executive management",
    profileSubtitle: "City administration",
    buildingHealth: "BUILDING HEALTH",
    saved: "SAVED BUILDINGS",
    savedFoot: "Accepted records in database",
    maintenance: "Maintenance & alerts",
    maintenanceCopy: "AI findings stay suggestions until you confirm them. Track upcoming repairs here.",
    fileWorkspace: "File workspace",
    fileCopy: "Drop in a file to preview and prepare it for analysis.",
    drop: "Drop your files here",
    browseFiles: "Browse files",
    browseFolder: "Choose folder",
    fileLimits: "PDF, Office, images, CAD, GAEB, e-mail, ZIP and more",
    fileSize: "Up to 100 MB each",
    formatsFoot: "PDF, Office, images, CAD, GAEB, e-mail, archives",
    aiPartner: "YOUR AI PARTNER",
    ask: "Ask StadtManager",
    mapTitle: "Coburg in 3D",
    mapCopy: "Click a pin to open its PDF images and 3D model. Search saved buildings by name, address, or property.",
    cityTwin: "CITY TWIN",
    database: "DATABASE",
    mapAria: "Interactive 3D map of Coburg",
    savedBuildings: "Saved buildings",
    mapAttribution: "Map data © OpenStreetMap contributors · Tiles by OpenFreeMap",
    emptyMaintenance: "No repair suggestions yet. Upload a building report to look for repairs.",
    yourData: "YOUR DATA",
    dropSubtitle: "Choose individual files or import a folder",
    or: "or",
    recentFiles: "RECENT FILES",
    workspaceReady: "Your workspace is ready",
    uploadedFilesAppear: "Uploaded files will appear here.",
    aiProvider: "AI provider",
    availableModel: "Available model",
    assistantWelcome: "Hi there! Upload a file and ask me to summarize it, find patterns, or help you make sense of the data.",
    tryAsking: "TRY ASKING",
    suggestionAnalysis: "What can you help me analyze?",
    suggestionSummary: "Summarize my files",
    chatPlaceholder: "Ask a question about your data...",
    chatAria: "Message the AI assistant",
    privacyHint: "Key stays here; saved building data and uploaded text go to the selected AI provider",
    send: "Send",
    verifyBeforeSaving: "VERIFY BEFORE SAVING",
    reviewBuilding: "Review building data",
    reviewCopy: "Extracted details are suggestions. Confirm or edit them before saving.",
    skipFile: "Skip this file",
    buildingName: "Building name",
    buildingCode: "Building code",
    buildingCodeHint: "AI suggestion; review or edit before saving.",
    buildingCodePlaceholder: "e.g. SBS",
    systemUid: "System UID",
    optional: "Optional",
    optionalLabel: "Optional label",
    streetName: "Street name",
    required: "Required",
    houseNumber: "House number",
    fullAddress: "Full address",
    mapCoordinates: "Map coordinates",
    pickMap: "Pick on map",
    latitude: "Latitude",
    longitude: "Longitude",
    buildingDetails: "Building details",
    editableFields: "AI-extracted fields can be edited.",
    addField: "+ Add field",
    acceptSave: "Accept & save building",
    sourceDocument: "Source document",
    uploadImagePreview: "Uploaded image preview",
    savedBuildings: "Saved buildings",
    database: "DATABASE",
    searchBuildings: "Search buildings and properties",
    noBuildings: "Accepted building records will appear here.",
    buildingTwin: "BUILDING DIGITAL TWIN",
    building: "Building",
    close: "Close",
    buildingFiles: "Building files",
    reviewRequired: "Review required",
    pdfImages: "Images from the PDF",
    simplifiedModel: "Simplified 3D model",
    aiEstimate: "AI estimate",
    generateFromPlan: "Generate a draft from a saved PDF floor plan.",
    twinProviderNote: "Generating a draft sends up to five rendered PDF pages to the selected AI provider.",
    twinScaleNote: "The generated geometry is approximate and should be checked against the source plan.",
    editableRooms: "Editable rooms in the 3D model",
    twinSource: "PDF source document",
    generateTwin: "Generate 3D draft",
    saveTwin: "Save reviewed model",
    footerTagline: "A clearer view of your city",
    footerBuilt: "Built for thoughtful decisions.",
  },
  de: {
    workspace: "Arbeitsbereich",
    overview: "Übersicht",
    files: "Datei-Arbeitsbereich",
    map: "Stadtkarte",
    assistant: "KI-Assistent",
    checking: "Backend wird geprüft",
    connected: "Backend verbunden",
    offline: "Backend nicht erreichbar",
    clear: "Daten löschen",
    profileTitle: "Geschäftsführung",
    profileSubtitle: "Stadtverwaltung",
    buildingHealth: "GEBÄUDEZUSTAND",
    saved: "GESPEICHERTE GEBÄUDE",
    savedFoot: "Bestätigte Datensätze in der Datenbank",
    maintenance: "Wartung & Meldungen",
    maintenanceCopy: "KI-Ergebnisse bleiben Vorschläge, bis Sie diese bestätigen. Verfolgen Sie bevorstehende Reparaturen.",
    fileWorkspace: "Datei-Arbeitsbereich",
    fileCopy: "Legen Sie eine Datei ab, um sie anzusehen und für die Analyse vorzubereiten.",
    drop: "Legen Sie Ihre Dateien hier ab",
    browseFiles: "Dateien auswählen",
    browseFolder: "Ordner auswählen",
    fileLimits: "PDF, Office, Bilder, CAD, GAEB, E-Mail, ZIP und mehr",
    fileSize: "Bis zu 100 MB pro Datei",
    formatsFoot: "PDF, Office, Bilder, CAD, GAEB, E-Mail, Archive",
    aiPartner: "IHR KI-PARTNER",
    ask: "StadtManager fragen",
    mapTitle: "Coburg in 3D",
    mapCopy: "Klicken Sie auf eine Stecknadel, um PDF-Bilder und 3D-Modell zu öffnen. Suchen Sie Gebäude nach Name, Adresse oder Eigenschaft.",
    cityTwin: "DIGITALES STADTMODELL",
    database: "DATENBANK",
    mapAria: "Interaktive 3D-Karte von Coburg",
    savedBuildings: "Gespeicherte Gebäude",
    mapAttribution: "Kartendaten © OpenStreetMap-Mitwirkende · Kartenkacheln von OpenFreeMap",
    emptyMaintenance: "Noch keine Reparaturvorschläge. Laden Sie einen Gebäudereport hoch, um Reparaturbedarf zu erkennen.",
    yourData: "IHRE DATEN",
    dropSubtitle: "Einzelne Dateien auswählen oder einen Ordner importieren",
    or: "oder",
    recentFiles: "LETZTE DATEIEN",
    workspaceReady: "Ihr Arbeitsbereich ist bereit",
    uploadedFilesAppear: "Hochgeladene Dateien werden hier angezeigt.",
    aiProvider: "KI-Anbieter",
    availableModel: "Verfügbares Modell",
    assistantWelcome: "Hallo! Laden Sie eine Datei hoch und bitten Sie mich, sie zusammenzufassen, Muster zu finden oder die Daten zu erklären.",
    tryAsking: "FRAGEN SIE ZUM BEISPIEL",
    suggestionAnalysis: "Welche Analysen können Sie durchführen?",
    suggestionSummary: "Fassen Sie meine Dateien zusammen",
    chatPlaceholder: "Stellen Sie eine Frage zu Ihren Daten …",
    chatAria: "Nachricht an den KI-Assistenten",
    privacyHint: "Der Schlüssel bleibt hier; gespeicherte Gebäudedaten und Dateitexte werden an den ausgewählten KI-Anbieter gesendet",
    send: "Senden",
    verifyBeforeSaving: "VOR DEM SPEICHERN PRÜFEN",
    reviewBuilding: "Gebäudedaten prüfen",
    reviewCopy: "Extrahierte Angaben sind Vorschläge. Prüfen oder bearbeiten Sie sie vor dem Speichern.",
    skipFile: "Datei überspringen",
    buildingName: "Gebäudename",
    buildingCode: "Gebäudekürzel",
    buildingCodeHint: "KI-Vorschlag; vor dem Speichern prüfen oder bearbeiten.",
    buildingCodePlaceholder: "z. B. SBS",
    systemUid: "System-UID",
    optional: "Optional",
    optionalLabel: "Optionale Bezeichnung",
    streetName: "Straße",
    required: "Erforderlich",
    houseNumber: "Hausnummer",
    fullAddress: "Vollständige Adresse",
    mapCoordinates: "Kartenkoordinaten",
    pickMap: "Auf Karte auswählen",
    latitude: "Breitengrad",
    longitude: "Längengrad",
    buildingDetails: "Gebäudedetails",
    editableFields: "KI-extrahierte Angaben können bearbeitet werden.",
    addField: "+ Feld hinzufügen",
    acceptSave: "Gebäude bestätigen und speichern",
    sourceDocument: "Quelldokument",
    uploadImagePreview: "Vorschau des hochgeladenen Bildes",
    savedBuildings: "Gespeicherte Gebäude",
    database: "DATENBANK",
    searchBuildings: "Gebäude und Eigenschaften suchen",
    noBuildings: "Bestätigte Gebäude werden hier angezeigt.",
    buildingTwin: "DIGITALER GEBÄUDEZWILLING",
    building: "Gebäude",
    close: "Schließen",
    buildingFiles: "Gebäudedateien",
    reviewRequired: "Prüfung erforderlich",
    pdfImages: "Bilder aus dem PDF",
    simplifiedModel: "Vereinfachtes 3D-Modell",
    aiEstimate: "KI-Schätzung",
    generateFromPlan: "Erstellen Sie einen Entwurf aus einem gespeicherten PDF-Grundriss.",
    twinProviderNote: "Für einen Entwurf werden bis zu fünf gerenderte PDF-Seiten an den ausgewählten KI-Anbieter gesendet.",
    twinScaleNote: "Die Geometrie ist ungefähr und sollte anhand des Quelldokuments geprüft werden.",
    editableRooms: "Bearbeitbare Räume im 3D-Modell",
    twinSource: "PDF-Quelldokument",
    generateTwin: "3D-Entwurf erstellen",
    saveTwin: "Geprüftes Modell speichern",
    footerTagline: "Ihre Stadt im klaren Überblick",
    footerBuilt: "Für fundierte Entscheidungen entwickelt.",
  },
};

function applyLanguage(language) {
  state.language = language;
  document.documentElement.lang = language;
  localStorage.setItem("stadtmanager-language", language);
  document.querySelector("#language-en").classList.toggle("active", language === "en");
  document.querySelector("#language-de").classList.toggle("active", language === "de");
  const t = translations[language];
  for (const element of document.querySelectorAll("[data-i18n]")) {
    const value = t[element.dataset.i18n];
    if (typeof value === "string") element.textContent = value;
  }
  for (const element of document.querySelectorAll("[data-i18n-placeholder]")) {
    const value = t[element.dataset.i18nPlaceholder];
    if (typeof value === "string") element.setAttribute("placeholder", value);
  }
  for (const element of document.querySelectorAll("[data-i18n-aria-label]")) {
    const value = t[element.dataset.i18nAriaLabel];
    if (typeof value === "string") element.setAttribute("aria-label", value);
  }
  for (const element of document.querySelectorAll("[data-i18n-alt]")) {
    const value = t[element.dataset.i18nAlt];
    if (typeof value === "string") element.setAttribute("alt", value);
  }
  document.querySelector("#language-toggle").setAttribute(
    "aria-label",
    language === "en" ? "Zur deutschen Oberfläche wechseln" : "Switch to English interface",
  );
  if (state.user) {
    document.querySelector("#profile-name").textContent = state.user.display_name;
    document.querySelector("#profile-role").textContent = roleLabel(state.user.role);
  }
  if (state.currentImport) {
    document.querySelector("#preview-kind").textContent = previewKindLabel(
      state.currentExtraction?.kind || fileExtension(state.currentImport.name).toUpperCase(),
      state.currentExtraction?.extraction_method,
    );
  }
  renderMaintenanceOverview();
}

function roleLabel(role) {
  const labels = {
    en: {
      city_administrator: "City Administration",
      building_administrator: "Building Administrator",
      employee: "Employee",
    },
    de: {
      city_administrator: "Stadtverwaltung",
      building_administrator: "Gebäudeverwaltung",
      employee: "Mitarbeiter",
    },
  };
  return labels[state.language][role] || role;
}

function profileInitials(name) {
  return String(name || "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] || "")
    .join("")
    .toUpperCase() || "U";
}

function renderProfileImage(imageData, name, profileOnly = false) {
  const initials = profileInitials(name);
  const targets = profileOnly
    ? [["#profile-image-preview", "#profile-image-initials"]]
    : [
      ["#profile-avatar-image", "#profile-avatar-initials"],
      ["#profile-image-preview", "#profile-image-initials"],
    ];
  for (const [imageSelector, initialsSelector] of targets) {
    const image = document.querySelector(imageSelector);
    const fallback = document.querySelector(initialsSelector);
    image.hidden = !imageData;
    fallback.hidden = Boolean(imageData);
    fallback.textContent = initials;
    if (imageData) image.src = imageData;
    else image.removeAttribute("src");
  }
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove("show"), 4200);
}

function formatFileCount(count) {
  return `${count} ${count === 1 ? "file" : "files"}`;
}

function renderFiles() {
  document.querySelector("#processed-count").textContent = state.processedCount;
  document.querySelector("#file-count").textContent = state.processedCount;
  document.querySelector("#list-count").textContent = formatFileCount(state.files.length);

  if (!state.files.length) {
    fileList.innerHTML = `<div class="empty-files">
      <span class="empty-file-icon"><svg viewBox="0 0 24 24"><path d="M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10z"/><path d="M13 3v7h7"/></svg></span>
      <span>Your workspace is ready</span><small>Uploaded files will appear here.</small>
    </div>`;
    return;
  }

  fileList.replaceChildren(...state.files.map((file) => {
    const row = document.createElement("div");
    row.className = `file-row${file.error ? " error" : ""}`;
    const type = document.createElement("span");
    type.className = "file-type";
    type.textContent = file.kind || file.filename.split(".").pop() || "FILE";
    const meta = document.createElement("span");
    meta.className = "file-meta";
    const name = document.createElement("span");
    name.className = "file-name";
    name.textContent = file.filename;
    const details = document.createElement("span");
    details.className = "file-details";
    details.textContent = file.error || file.details;
    meta.append(name, details);
    const status = document.createElement("span");
    status.className = "file-state";
    status.textContent = file.error ? "Failed" : "Ready";
    row.append(type, meta, status);
    return row;
  }));
}

function queueFiles(files) {
  if (!files.length) return;
  const supportedFiles = files.filter((file) => isSupportedFile(file.name));
  const skippedFiles = files.filter((file) => !isSupportedFile(file.name));
  const skippedTypes = [...new Set(skippedFiles.map((file) => fileExtension(file.name) || "no extension"))]
    .slice(0, 6)
    .map((extension) => (extension === "no extension" ? extension : `.${extension}`))
    .join(", ");
  if (!supportedFiles.length) {
    showToast(
      `No supported files found${skippedTypes ? ` (${skippedTypes})` : ""}. `
      + `${SUPPORTED_EXTENSIONS.length} formats are supported, including PDF, Office, images, CAD, GAEB, e-mail and ZIP.`,
    );
    fileInput.value = "";
    folderInput.value = "";
    return;
  }
  if (skippedFiles.length) {
    showToast(`Skipping ${skippedFiles.length} unsupported file${skippedFiles.length === 1 ? "" : "s"} (${skippedTypes}).`);
  }
  state.importQueue.push(...supportedFiles);
  state.importTotal += supportedFiles.length;
  fileInput.value = "";
  folderInput.value = "";
  processNextImport();
}

function createFieldRow(categoryName = "", value = "") {
  const row = document.createElement("div");
  row.className = "review-field-row";
  const categorySelect = document.createElement("select");
  categorySelect.className = "category-select";
  categorySelect.setAttribute("aria-label", "Field category");
  const emptyOption = document.createElement("option");
  emptyOption.value = "";
  emptyOption.textContent = "Choose field";
  categorySelect.append(emptyOption);
  for (const category of state.categories) {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    categorySelect.append(option);
  }
  const otherOption = document.createElement("option");
  otherOption.value = "__other__";
  otherOption.textContent = "Other…";
  categorySelect.append(otherOption);

  const otherWrap = document.createElement("div");
  otherWrap.className = "form-field other-category";
  otherWrap.hidden = true;
  const otherInput = document.createElement("input");
  otherInput.maxLength = 100;
  otherInput.placeholder = "New category";
  otherInput.setAttribute("aria-label", "New category name");
  otherWrap.append(otherInput);

  const valueWrap = document.createElement("div");
  valueWrap.className = "form-field";
  const valueInput = document.createElement("input");
  valueInput.maxLength = 2_000;
  valueInput.placeholder = "Value";
  valueInput.setAttribute("aria-label", "Field value");
  valueInput.value = value;
  valueWrap.append(valueInput);

  const removeButton = document.createElement("button");
  removeButton.className = "remove-field";
  removeButton.type = "button";
  removeButton.textContent = "×";
  removeButton.setAttribute("aria-label", "Remove field");
  removeButton.addEventListener("click", () => row.remove());

  const match = state.categories.find((category) => category.toLocaleLowerCase() === categoryName.toLocaleLowerCase());
  if (match) {
    categorySelect.value = match;
  } else if (categoryName) {
    categorySelect.value = "__other__";
    otherInput.value = categoryName;
    otherWrap.hidden = false;
    row.classList.add("has-other");
  }
  categorySelect.addEventListener("change", () => {
    const isOther = categorySelect.value === "__other__";
    otherWrap.hidden = !isOther;
    otherInput.required = isOther;
    row.classList.toggle("has-other", isOther);
  });
  row.append(categorySelect, otherWrap, valueWrap, removeButton);
  return row;
}

function displayPreview(file, result = null) {
  const pdfPreview = document.querySelector("#pdf-preview");
  const imagePreview = document.querySelector("#image-preview");
  const textPreview = document.querySelector("#text-preview");
  const extension = fileExtension(file.name);
  document.querySelector("#preview-filename").textContent = file.name;
  document.querySelector("#preview-kind").textContent = previewKindLabel(
    result?.kind || extension.toUpperCase(),
    result?.extraction_method,
  );
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.previewUrl = null;
  if (extension === "pdf") {
    state.previewUrl = URL.createObjectURL(file);
    pdfPreview.src = state.previewUrl;
    pdfPreview.hidden = false;
    imagePreview.removeAttribute("src");
    imagePreview.hidden = true;
    textPreview.hidden = true;
  } else if (BROWSER_IMAGE_EXTENSIONS.includes(extension)) {
    state.previewUrl = URL.createObjectURL(file);
    imagePreview.src = state.previewUrl;
    imagePreview.alt = `Preview of ${file.name}`;
    imagePreview.hidden = false;
    pdfPreview.removeAttribute("src");
    pdfPreview.hidden = true;
    textPreview.hidden = true;
  } else {
    pdfPreview.removeAttribute("src");
    pdfPreview.hidden = true;
    imagePreview.removeAttribute("src");
    imagePreview.hidden = true;
    const preview = result?.preview;
    textPreview.textContent = typeof preview === "string" ? preview : JSON.stringify(preview ?? "Extracting document…", null, 2);
    textPreview.hidden = false;
  }
}
function previewKindLabel(kind, extractionMethod) {
  if (extractionMethod !== "vision") return kind;
  return state.language === "de" ? `${kind} · KI-Bildanalyse` : `${kind} · AI visual read`;
}

function setReviewEditingEnabled(enabled) {
  for (const control of document.querySelectorAll(".review-form input, .review-form select, .review-form button")) {
    control.disabled = !enabled;
  }
}

function showExtraction(result) {
  state.currentExtraction = result;
  state.addressVerified = false;
  state.suggestedBuildingUid = result.building_match?.exact_address_match ? result.building_match.uid : "";
  renderBuildingMatch(result.building_match);
  document.querySelector("#object-name").value = result.object_name || "";
  document.querySelector("#building-code").value = result.building_code || "";
  state.buildingCodeManuallyEdited = false;
  state.buildingCodeSource = result.building_code_source || (result.building_code_existing ? "existing" : "");
  document.querySelector("#street-name").value = result.street_name || "";
  document.querySelector("#house-number").value = result.house_number || "";
  document.querySelector("#full-address").value = result.address || "";
  document.querySelector("#building-latitude").value = result.latitude ?? "";
  document.querySelector("#building-longitude").value = result.longitude ?? "";
  document.querySelector("#preview-kind").textContent = previewKindLabel(
    result.kind || "",
    result.extraction_method,
  );
  const notice = document.querySelector("#extraction-notice");
  notice.textContent = result.extraction_error || "";
  notice.hidden = !result.extraction_error;
  const fieldList = document.querySelector("#review-fields");
  fieldList.replaceChildren();
  const knownFields = Object.entries(result.fields || {}).map(([name, value]) => ({ name, value }));
  const additionalFields = (result.other_fields || []).filter((field) => field?.name);
  for (const field of [...knownFields, ...additionalFields]) {
    fieldList.append(createFieldRow(field.name, field.value || ""));
  }
  if (!fieldList.children.length) fieldList.append(createFieldRow());
  renderExtractedMaintenance(result.maintenance_findings || []);
  scheduleAddressValidation();
}

function renderBuildingMatch(match) {
  const panel = document.querySelector("#building-match");
  panel.replaceChildren();
  if (!match) {
    panel.hidden = true;
    return;
  }
  const exactAddressMatch = Boolean(match.exact_address_match);
  const identity = [
    match.object_name || "",
    match.building_code || "",
    match.address || "",
    match.uid ? `UID ${match.uid}` : "",
  ].filter(Boolean).join(" · ");
  const message = state.language === "de"
    ? exactAddressMatch
      ? `Gespeichertes Gebäude mit übereinstimmender Adresse: ${identity}. Bitte vor dem Speichern prüfen.`
      : `Möglicher Treffer der KI – bitte manuell prüfen: ${identity}. Es wird nichts automatisch zusammengeführt.`
    : exactAddressMatch
      ? `Saved building with matching address: ${identity}. Review before saving.`
      : `Possible AI match — please review: ${identity}. Nothing will be merged automatically.`;
  panel.textContent = message;
  panel.hidden = false;
}

function renderExtractedMaintenance(findings) {
  const container = document.querySelector("#extraction-maintenance");
  container.replaceChildren();
  if (!findings.length) {
    container.hidden = true;
    return;
  }
  const heading = document.createElement("strong");
  heading.textContent = "AI maintenance suggestions · not active alerts";
  const note = document.createElement("p");
  note.textContent = "These evidence-backed findings will remain pending until you confirm them on the dashboard.";
  container.append(heading, note);
  for (const finding of findings) {
    const item = document.createElement("div");
    item.className = "extraction-finding";
    const title = document.createElement("strong");
    title.textContent = finding.title;
    const details = document.createElement("span");
    details.textContent = `${finding.action_type} · ${finding.severity}${finding.due_date ? ` · Due ${finding.due_date}` : ""}`;
    const evidence = document.createElement("p");
    evidence.textContent = `“${finding.evidence}”`;
    item.append(title, details, evidence);
    container.append(item);
  }
  container.hidden = false;
}

function renderMergeReview(detail) {
  const panel = document.querySelector("#merge-review");
  const previous = state.pendingMerge;
  const candidates = detail.candidates || previous?.candidates || [];
  const proposedTargetUid = previous?.targetUid || state.suggestedBuildingUid;
  state.pendingMerge = {
    targetUid: candidates.some((candidate) => candidate.uid === proposedTargetUid) ? proposedTargetUid : "",
    resolutions: previous?.resolutions || {},
    candidates,
    conflicts: detail.conflicts || [],
    buildingUid: detail.building_uid || previous?.buildingUid || "",
  };
  panel.replaceChildren();
  const heading = document.createElement("strong");
  heading.textContent = "Review merge with existing address";
  const note = document.createElement("p");
  note.textContent = detail.message || "Choose which existing values to keep before saving this file.";
  panel.append(heading, note);

  if (state.pendingMerge.candidates.length) {
    const label = document.createElement("label");
    label.className = "merge-target-label";
    label.textContent = "Select the existing building for this address";
    const select = document.createElement("select");
    select.className = "merge-target-select";
    select.setAttribute("aria-label", "Existing building");
    const prompt = document.createElement("option");
    prompt.value = "";
    prompt.textContent = "Choose a building UID";
    select.append(prompt);
    for (const candidate of state.pendingMerge.candidates) {
      const option = document.createElement("option");
      option.value = candidate.uid;
      option.textContent = `${candidate.object_name} · ${candidate.building_code} · ${candidate.address}`;
      select.append(option);
    }
    select.value = state.pendingMerge.targetUid;
    select.addEventListener("change", () => {
      state.pendingMerge.targetUid = select.value;
      const selected = state.pendingMerge.candidates.find((candidate) => candidate.uid === select.value);
      if (selected?.building_code) {
        document.querySelector("#building-code").value = selected.building_code;
        state.buildingCodeSource = "existing";
        state.buildingCodeManuallyEdited = false;
      }
    });
    label.append(select);
    panel.append(label);
  }

  for (const conflict of state.pendingMerge.conflicts) {
    const item = document.createElement("div");
    item.className = "merge-conflict";
    const title = document.createElement("strong");
    title.textContent = conflict.category;
    const current = document.createElement("p");
    current.textContent = `Current: ${conflict.existing_value}`;
    const incoming = document.createElement("p");
    incoming.textContent = `From this file: ${conflict.incoming_value}`;
    const select = document.createElement("select");
    select.className = "merge-resolution";
    select.dataset.category = conflict.category;
    select.setAttribute("aria-label", `Choose value for ${conflict.category}`);
    const prompt = document.createElement("option");
    prompt.value = "";
    prompt.textContent = "Choose whether to keep or replace";
    select.append(prompt);
    for (const [value, text] of [["keep", "Keep current"], ["replace", "Replace with new value"]]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = text;
      select.append(option);
    }
    select.value = state.pendingMerge.resolutions[conflict.category]?.action || "";
    select.addEventListener("change", () => {
      state.pendingMerge.resolutions[conflict.category] = {
        action: select.value,
        expected_current: conflict.existing_value,
      };
    });
    item.append(title, current, incoming, select);
    panel.append(item);
  }
  panel.hidden = false;
  document.querySelector("#accept-building").textContent = "Confirm merge";
}

async function processNextImport() {
  if (state.currentImport) return;
  const file = state.importQueue.shift();
  if (!file) {
    document.querySelector("#review-panel").hidden = true;
    state.importTotal = 0;
    state.importCompleted = 0;
    return;
  }

  state.currentImport = file;
  const panel = document.querySelector("#review-panel");
  panel.hidden = false;
  document.querySelector("#review-progress").textContent =
    `File ${state.importCompleted + 1} of ${state.importTotal}: ${file.name}. Verify the extracted details before saving.`;
  document.querySelector("#review-status").textContent = "Extracting document fields…";
  setReviewEditingEnabled(false);
  document.querySelector("#object-name").value = "";
  document.querySelector("#building-code").value = "";
  state.buildingCodeManuallyEdited = false;
  state.buildingCodeSource = "";
  document.querySelector("#street-name").value = "";
  document.querySelector("#house-number").value = "";
  document.querySelector("#full-address").value = "";
  document.querySelector("#building-latitude").value = "";
  document.querySelector("#building-longitude").value = "";
  state.locationPickedManually = false;
  state.currentExtraction = null;
  state.suggestedBuildingUid = "";
  state.pickedLocationMarker?.remove();
  state.pickedLocationMarker = null;
  document.querySelector("#extraction-maintenance").hidden = true;
  renderBuildingMatch(null);
  document.querySelector("#merge-review").hidden = true;
  document.querySelector("#accept-building").textContent = "Accept & save building";
  state.pendingMerge = null;
  document.querySelector("#extraction-notice").hidden = true;
  document.querySelector("#review-fields").replaceChildren(createFieldRow());
  state.addressVerified = false;
  displayPreview(file);
  panel.scrollIntoView({ behavior: "smooth", block: "start" });

  const formData = new FormData();
  formData.append("file", file);
  formData.append("provider", providerSelect.value);
  formData.append("model", state.modelsReady ? modelSelect.value : "");
  try {
    const response = await fetch("/api/extract", { method: "POST", body: formData });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || "Could not extract this document.");
    if (state.currentImport !== file) return;
    showExtraction(result);
    displayPreview(file, result);
    document.querySelector("#review-status").textContent = "Review and correct the extracted values.";
  } catch (error) {
    if (state.currentImport !== file) return;
    const notice = document.querySelector("#extraction-notice");
    notice.textContent = `${error.message || "Extraction failed."} You can still enter the details manually.`;
    notice.hidden = false;
    displayPreview(file);
    document.querySelector("#review-status").textContent = "Street name and house number are required.";
  } finally {
    if (state.currentImport === file) setReviewEditingEnabled(true);
  }
}

function finishCurrentImport() {
  state.addressRequestId += 1;
  clearTimeout(state.addressLookupTimer);
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.previewUrl = null;
  state.currentImport = null;
  state.currentExtraction = null;
  state.pendingMerge = null;
  state.suggestedBuildingUid = "";
  state.importCompleted += 1;
  processNextImport();
}

async function validateAddress() {
  const streetName = document.querySelector("#street-name").value.trim();
  const houseNumber = document.querySelector("#house-number").value.trim();
  const fullAddress = document.querySelector("#full-address").value.trim();
  if (!streetName || !houseNumber) {
    throw new Error("Enter a street name and house number before saving.");
  }
  const requestId = ++state.addressRequestId;
  document.querySelector("#review-status").textContent = state.language === "de"
    ? "Adresse wird mit der Karte abgeglichen…"
    : "Verifying this Coburg address against the map…";
  const formData = new FormData();
  formData.append("street_name", streetName);
  formData.append("house_number", houseNumber);
  formData.append("full_address", fullAddress);
  const response = await fetch("/api/address/validate", { method: "POST", body: formData });
  const result = await response.json();
  if (
    requestId !== state.addressRequestId
    || streetName !== document.querySelector("#street-name").value.trim()
    || houseNumber !== document.querySelector("#house-number").value.trim()
    || fullAddress !== document.querySelector("#full-address").value.trim()
  ) return null;
  if (!response.ok) {
    const detail = result.detail;
    const message = typeof detail === "object" ? detail.message : detail;
    throw new Error(message || "This address could not be verified.");
  }
  const buildingCodeInput = document.querySelector("#building-code");
  if (!state.buildingCodeManuallyEdited && (result.building_code_existing || state.buildingCodeSource !== "ai")) {
    buildingCodeInput.value = result.building_code || "";
    state.buildingCodeSource = result.building_code_source || "";
  }
  if (!state.locationPickedManually) {
    document.querySelector("#building-latitude").value = Number(result.latitude).toFixed(6);
    document.querySelector("#building-longitude").value = Number(result.longitude).toFixed(6);
  }
  state.addressVerified = true;
  const streetLevelMatch = result.address_match === "street-and-coburg-area";
  const buildingFootprint = result.location_precision === "building";
  const possibleAiMatch = state.currentExtraction?.building_match;
  renderBuildingMatch(
    result.building_match || (possibleAiMatch && !possibleAiMatch.exact_address_match ? possibleAiMatch : null),
  );
  state.suggestedBuildingUid = result.matched_building_uid || "";
  document.querySelector("#review-status").textContent = state.language === "de"
    ? buildingFootprint
      ? state.locationPickedManually
        ? `Gebäudeumriss gefunden; Ihre manuelle Kartenposition wurde beibehalten.`
        : `Gebäudeumriss gefunden; die Kartenposition zeigt die Gebäudemitte: ${result.display_name}.`
      : streetLevelMatch
        ? state.locationPickedManually
          ? `Straße gefunden; keine genaue Hausnummernposition in der Karte. Ihre Kartenposition wurde beibehalten.`
          : `Straße gefunden; keine genaue Hausnummernposition in der Karte. Straßenposition verwendet: ${result.display_name}.`
        : state.locationPickedManually
          ? `Adresse gefunden: ${result.display_name}. Kartenposition wurde beibehalten.`
          : `Adresse gefunden: ${result.display_name}.`
    : buildingFootprint
      ? state.locationPickedManually
        ? "A building footprint was found; your manually selected map point was kept."
        : `A building footprint was found; the pin is at the building center: ${result.display_name}.`
      : streetLevelMatch
        ? state.locationPickedManually
          ? "Street found, but the map has no exact house-number location. Your selected map point was kept."
          : `Street found, but the map has no exact house-number location. Using street location: ${result.display_name}.`
        : state.locationPickedManually
          ? `Address found: ${result.display_name}. Your selected map point was kept.`
          : `Address found: ${result.display_name}.`;
  return result;
}

function scheduleAddressValidation() {
  clearTimeout(state.addressLookupTimer);
  const streetName = document.querySelector("#street-name").value.trim();
  const houseNumber = document.querySelector("#house-number").value.trim();
  if (!streetName || !houseNumber) return;
  state.addressLookupTimer = setTimeout(async () => {
    try {
      await validateAddress();
    } catch (error) {
      if (state.language === "de") {
        document.querySelector("#review-status").textContent =
          `Adresse konnte nicht gefunden werden: ${error.message || "Prüfung fehlgeschlagen."}`;
      } else {
        document.querySelector("#review-status").textContent =
          `Could not find address: ${error.message || "Verification failed."}`;
      }
    }
  }, 800);
}

async function acceptBuilding() {
  const file = state.currentImport;
  if (!file) return;
  const objectName = document.querySelector("#object-name").value.trim();
  const streetName = document.querySelector("#street-name").value.trim();
  const houseNumber = document.querySelector("#house-number").value.trim();
  if (!streetName) {
    document.querySelector("#street-name").focus();
    document.querySelector("#review-status").textContent = "Street name is required.";
    return;
  }
  if (!houseNumber) {
    document.querySelector("#house-number").focus();
    document.querySelector("#review-status").textContent = "House number is required.";
    return;
  }
  if (!state.addressVerified) {
    try {
      await validateAddress();
    } catch (error) {
      document.querySelector("#review-status").textContent = error.message || "Address verification failed.";
      return;
    }
  }
  const buildingCode = document.querySelector("#building-code").value.trim().toUpperCase();
  if (!/^[A-Z]{3,8}$/.test(buildingCode)) {
    document.querySelector("#building-code").focus();
    document.querySelector("#review-status").textContent = state.language === "de"
      ? "Geben Sie ein Gebäudekürzel aus 3 bis 8 Buchstaben ein."
      : "Enter a building code containing 3 to 8 letters.";
    return;
  }

  if (state.pendingMerge?.candidates.length && !state.pendingMerge.targetUid) {
    document.querySelector(".merge-target-select")?.focus();
    document.querySelector("#review-status").textContent = "Select the existing building UID to merge into.";
    return;
  }
  if (state.pendingMerge?.conflicts.some((conflict) => !state.pendingMerge.resolutions[conflict.category]?.action)) {
    document.querySelector(".merge-resolution")?.focus();
    document.querySelector("#review-status").textContent = "Choose whether to keep or replace every differing value.";
    return;
  }

  const fields = {};
  for (const row of document.querySelectorAll(".review-field-row")) {
    const select = row.querySelector(".category-select");
    const category = select.value === "__other__"
      ? row.querySelector(".other-category input").value.trim()
      : select.value;
    const value = row.querySelector('[aria-label="Field value"]').value.trim();
    if (value && !category) {
      document.querySelector("#review-status").textContent = "Choose a category for every field with a value.";
      select.focus();
      return;
    }
    if (category && value) fields[category] = value;
  }

  const formData = new FormData();
  formData.append("file", file);
  formData.append("object_name", objectName);
  formData.append("building_code", buildingCode);
  formData.append("street_name", streetName);
  formData.append("house_number", houseNumber);
  formData.append("address", document.querySelector("#full-address").value.trim());
  formData.append("latitude", document.querySelector("#building-latitude").value.trim());
  formData.append("longitude", document.querySelector("#building-longitude").value.trim());
  formData.append("address_verified", state.addressVerified ? "true" : "false");
  formData.append("location_manually_selected", state.locationPickedManually ? "true" : "false");
  formData.append("fields_json", JSON.stringify(fields));
  formData.append("maintenance_json", JSON.stringify(state.currentExtraction?.maintenance_findings || []));
  formData.append("merge_target_uid", state.pendingMerge?.targetUid || "");
  const resolutions = Object.fromEntries(
    (state.pendingMerge?.conflicts || []).map((conflict) => [
      conflict.category,
      state.pendingMerge.resolutions[conflict.category],
    ]),
  );
  formData.append("conflict_resolutions_json", JSON.stringify(resolutions));
  const acceptButton = document.querySelector("#accept-building");
  acceptButton.disabled = true;
  document.querySelector("#review-status").textContent = state.pendingMerge
    ? "Saving file to the selected building…"
    : "Saving file and building data…";
  try {
    const response = await fetch("/api/buildings", { method: "POST", body: formData });
    const result = await response.json();
    if (!response.ok) {
      const detail = result.detail;
      if (response.status === 409 && detail && typeof detail === "object"
        && ["duplicate-address", "value-conflicts"].includes(detail.code)) {
        renderMergeReview(detail);
        document.querySelector("#review-status").textContent = detail.message;
        return;
      }
      throw new Error(typeof detail === "string" ? detail : detail?.message || "Could not save this building.");
    }
    if (!result.merged) state.processedCount += 1;
    state.files = [{
      filename: result.file_name,
      kind: state.currentExtraction?.kind || fileExtension(file.name).toUpperCase(),
      details: result.merged ? "Added to existing building" : "Saved in database",
      content: state.currentExtraction?.preview || "",
    }, ...state.files].slice(0, 12);
    renderFiles();
    await Promise.all([loadBuildings(), loadCategories(), loadMaintenance()]);
    const assetWarning = result.asset_warnings?.length ? ` ${result.asset_warnings.join(" ")}` : "";
    const imageCount = result.embedded_image_count ? ` ${result.embedded_image_count} PDF image${result.embedded_image_count === 1 ? "" : "s"} extracted.` : "";
    const maintenanceNote = result.maintenance_suggestion_count
      ? ` ${result.maintenance_suggestion_count} maintenance suggestion${result.maintenance_suggestion_count === 1 ? "" : "s"} need review.`
      : "";
    showToast(
      `${result.object_name} ${result.merged ? "updated with the new file" : "saved to the city database"} as ${result.building_code}.${imageCount}${maintenanceNote}${assetWarning}`,
    );
    finishCurrentImport();
  } catch (error) {
    document.querySelector("#review-status").textContent = error.message || "Save failed.";
  } finally {
    if (state.currentImport === file) acceptButton.disabled = false;
  }
}

function skipCurrentImport() {
  if (!state.currentImport) return;
  showToast(`${state.currentImport.name} skipped.`);
  finishCurrentImport();
}

async function loadCategories() {
  try {
    const response = await fetch("/api/categories");
    if (!response.ok) throw new Error("Could not load building categories.");
    const result = await response.json();
    state.categories = result.categories;
  } catch (error) {
    showToast(error.message || "Could not load building categories.");
  }
}

function renderBuildings() {
  const list = document.querySelector("#building-list");
  const search = document.querySelector("#building-search").value.trim().toLocaleLowerCase();
  document.querySelector("#building-count").textContent =
    `${state.buildings.length} saved ${state.buildings.length === 1 ? "building" : "buildings"}`;
  if (!state.buildings.length) {
    list.innerHTML = '<div class="map-empty">Accepted building records will appear here.</div>';
  } else {
    const matches = state.buildings.filter((building) => {
      const searchable = [
        building.object_name,
        building.building_code,
        building.address,
        building.uid,
        building.street_name,
        building.house_number,
        ...Object.entries(building.fields || {}).flat(),
      ].join(" ").toLocaleLowerCase();
      return searchable.includes(search);
    });
    if (!matches.length) {
      list.innerHTML = '<div class="map-empty">No saved buildings match your search.</div>';
    } else list.replaceChildren(...matches.map((building) => {
      const card = document.createElement("div");
      card.className = "building-record-card";
      const button = document.createElement("button");
      button.className = "building-record";
      button.type = "button";
      const name = document.createElement("strong");
      name.textContent = building.object_name;
      if (building.has_twin) {
        const twinBadge = document.createElement("span");
        twinBadge.className = "building-twin-badge";
        twinBadge.textContent = "3D";
        name.append(twinBadge);
      }
      const details = document.createElement("span");
      const heating = building.fields["Heating system"];
      details.textContent = [
        building.address || "No address",
        building.building_code && `${translations[state.language].buildingCode}: ${building.building_code}`,
        heating && `Heating: ${heating}`,
        building.latitude === null && "No map location",
      ].filter(Boolean).join(" · ");
      button.append(name, details);
      button.addEventListener("click", () => openBuildingDetails(building.id));
      const actions = document.createElement("div");
      actions.className = "building-record-actions";
      const detailsAction = document.createElement("button");
      detailsAction.className = "building-record-action";
      detailsAction.type = "button";
      detailsAction.textContent = "Open details";
      detailsAction.addEventListener("click", () => openBuildingDetails(building.id));
      actions.append(detailsAction);
      if (building.latitude !== null && building.longitude !== null) {
        const mapAction = document.createElement("button");
        mapAction.className = "building-record-action";
        mapAction.type = "button";
        mapAction.textContent = "Show on map";
        mapAction.addEventListener("click", () => {
          if (state.map) {
            state.map.flyTo({ center: [building.longitude, building.latitude], zoom: 17, pitch: 60 });
          }
        });
        actions.append(mapAction);
      }
      const fileLink = document.createElement("a");
      fileLink.className = "building-file-link";
      fileLink.href = `/api/buildings/${building.id}/file`;
      fileLink.target = "_blank";
      fileLink.rel = "noreferrer";
      fileLink.textContent = `Open ${building.file_name}${building.document_count ? ` · ${building.document_count} additional file${building.document_count === 1 ? "" : "s"}` : ""}`;
      card.append(button, actions, fileLink);
      return card;
    }));
  }

  for (const marker of state.mapMarkers) marker.remove();
  state.mapMarkers = [];
  if (!state.mapLoaded || !window.maplibregl) return;
  for (const building of state.buildings) {
    if (building.latitude === null || building.longitude === null) continue;
    const element = document.createElement("button");
    element.className = "city-marker";
    element.type = "button";
    element.title = `${building.building_code} · ${building.object_name}`;
    element.addEventListener("click", (event) => {
      event.stopPropagation();
      if (state.pickingLocation) {
        selectMapLocation(building.longitude, building.latitude, building.object_name);
        return;
      }
      openBuildingDetails(building.id);
    });
    const marker = new maplibregl.Marker({ element })
      .setLngLat([building.longitude, building.latitude])
      .addTo(state.map);
    element.setAttribute("aria-label", `Open digital twin for ${building.object_name}`);
    state.mapMarkers.push(marker);
  }
}

function selectMapLocation(longitude, latitude, label = "") {
  document.querySelector("#building-latitude").value = Number(latitude).toFixed(6);
  document.querySelector("#building-longitude").value = Number(longitude).toFixed(6);
  state.locationPickedManually = true;
  state.addressVerified = false;
  state.addressRequestId += 1;
  clearTimeout(state.addressLookupTimer);
  state.pickedLocationMarker?.remove();
  state.pickedLocationMarker = new maplibregl.Marker({ color: "#bd604b" })
    .setLngLat([longitude, latitude])
    .addTo(state.map);
  document.querySelector("#review-status").textContent = state.language === "de"
    ? `Kartenposition ausgewählt${label ? `: ${label}` : ""}. Sie wird beim Speichern beibehalten.`
    : `Map location selected${label ? `: ${label}` : ""}. It will be kept when saved.`;
  state.pickingLocation = false;
  state.map.getCanvas().style.cursor = "";
  document.querySelector("#review-panel").scrollIntoView({ behavior: "smooth", block: "start" });
}

function clearTwinViewer() {
  const viewer = state.twinViewer;
  if (!viewer) return;
  viewer.resizeObserver?.disconnect();
  viewer.controls.dispose();
  viewer.scene.traverse((object) => {
    object.geometry?.dispose();
    if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
    else object.material?.dispose();
  });
  viewer.renderer.dispose();
  viewer.renderer.domElement.remove();
  state.twinViewer = null;
}

async function renderTwin(twin, buildingId = state.activeBuildingId) {
  clearTwinViewer();
  state.twinDraft = twin;
  const viewerElement = document.querySelector("#twin-viewer");
  const roomList = document.querySelector("#twin-room-list");
  const units = twin.units === "m" ? "m" : "relative units";
  roomList.replaceChildren(...twin.floors.flatMap((floor, floorIndex) =>
    floor.rooms.map((room, roomIndex) => {
      const card = document.createElement("div");
      card.className = "twin-room-card";
      card.setAttribute("role", "listitem");
      const heading = document.createElement("div");
      heading.className = "twin-room-heading";
      const name = document.createElement("strong");
      name.textContent = `${floor.name} · ${room.name}`;
      const confidence = document.createElement("small");
      confidence.textContent = `${room.confidence} confidence`;
      heading.append(name, confidence);
      const fields = document.createElement("div");
      fields.className = "twin-room-fields";
      const definitions = [
        ["name", "Room name", "text"],
        ["x", "X position", "number"],
        ["z", "Z position", "number"],
        ["width", `Width (${units})`, "number"],
        ["depth", `Depth (${units})`, "number"],
        ["height", `Height (${units})`, "number"],
      ];
      for (const [field, labelText, type] of definitions) {
        const label = document.createElement("label");
        label.textContent = labelText;
        const input = document.createElement("input");
        input.type = type;
        input.value = room[field];
        input.disabled = state.user?.role === "employee";
        input.dataset.twinFloor = floorIndex;
        input.dataset.twinRoom = roomIndex;
        input.dataset.twinField = field;
        if (field === "name") input.maxLength = 100;
        else {
          input.step = "0.1";
          input.min = field === "x" || field === "z" ? "-500" : field === "height" ? "1.5" : "0.2";
          input.max = field === "x" || field === "z" ? "500" : field === "height" ? "10" : "500";
        }
        label.append(input);
        fields.append(label);
      }
      card.append(heading, fields);
      return card;
    }),
  ));
  document.querySelector("#twin-scale-note").textContent =
    `${twin.scale_note || "Approximate geometry."} Verify room sizes and layout against the PDF before relying on this model.`;
  viewerElement.textContent = "Loading 3D viewer…";

  try {
    state.threePromise ||= Promise.all([
      import("three"),
      import("three/addons/controls/OrbitControls.js"),
    ]);
    const [THREE, { OrbitControls }] = await state.threePromise;
    if (!document.querySelector("#building-detail-dialog").open || state.activeBuildingId !== buildingId) return;
    viewerElement.replaceChildren();
    const width = Math.max(viewerElement.clientWidth, 1);
    const height = Math.max(viewerElement.clientHeight, 1);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    viewerElement.append(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#edf1ed");
    scene.add(new THREE.HemisphereLight(0xffffff, 0x889789, 2));
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.4);
    keyLight.position.set(12, 20, 10);
    scene.add(keyLight);

    const entries = twin.floors.flatMap((floor) => floor.rooms.map((room) => ({
      floor,
      room,
      y: floor.level * 3.2,
    })));
    const minX = Math.min(...entries.map(({ room }) => room.x));
    const maxX = Math.max(...entries.map(({ room }) => room.x + room.width));
    const minZ = Math.min(...entries.map(({ room }) => room.z));
    const maxZ = Math.max(...entries.map(({ room }) => room.z + room.depth));
    const minY = Math.min(...entries.map(({ y }) => y));
    const maxY = Math.max(...entries.map(({ y, room }) => y + room.height));
    const center = new THREE.Vector3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
    const span = Math.max(maxX - minX, maxZ - minZ, maxY - minY, 4);
    const palette = [0x83b893, 0x8eadd0, 0xd5a36d, 0xa697ce, 0x66b7b1, 0xd08b8b];

    entries.forEach(({ room, y }, index) => {
      const color = palette[index % palette.length];
      const floorGeometry = new THREE.BoxGeometry(room.width, 0.08, room.depth);
      const floorMesh = new THREE.Mesh(
        floorGeometry,
        new THREE.MeshStandardMaterial({ color, roughness: 0.85, transparent: true, opacity: 0.78 }),
      );
      floorMesh.position.set(room.x + room.width / 2, y, room.z + room.depth / 2);
      scene.add(floorMesh);

      const wallMaterial = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.9,
        transparent: true,
        opacity: 0.52,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const thickness = Math.max(span * 0.006, 0.06);
      const wallHeight = room.height;
      const walls = [
        [room.width, wallHeight, thickness, room.x + room.width / 2, y + wallHeight / 2, room.z],
        [room.width, wallHeight, thickness, room.x + room.width / 2, y + wallHeight / 2, room.z + room.depth],
        [thickness, wallHeight, room.depth, room.x, y + wallHeight / 2, room.z + room.depth / 2],
        [thickness, wallHeight, room.depth, room.x + room.width, y + wallHeight / 2, room.z + room.depth / 2],
      ];
      for (const [wallWidth, wallHeightValue, wallDepth, x, wallY, z] of walls) {
        const wall = new THREE.Mesh(new THREE.BoxGeometry(wallWidth, wallHeightValue, wallDepth), wallMaterial);
        wall.position.set(x, wallY, z);
        scene.add(wall);
      }
    });

    const grid = new THREE.GridHelper(span * 1.6, Math.max(12, Math.ceil(span * 2)), 0x9ca99e, 0xd5ddd6);
    grid.position.set(center.x, minY - 0.08, center.z);
    scene.add(grid);
    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, span * 40);
    camera.position.set(center.x + span * 1.15, center.y + span * 1.05, center.z + span * 1.3);
    camera.lookAt(center);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(center);
    controls.enableDamping = false;
    controls.addEventListener("change", () => renderer.render(scene, camera));
    const resizeObserver = new ResizeObserver(() => {
      const nextWidth = Math.max(viewerElement.clientWidth, 1);
      const nextHeight = Math.max(viewerElement.clientHeight, 1);
      camera.aspect = nextWidth / nextHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(nextWidth, nextHeight);
      renderer.render(scene, camera);
    });
    resizeObserver.observe(viewerElement);
    state.twinViewer = { scene, renderer, controls, resizeObserver };
    renderer.render(scene, camera);
  } catch (error) {
    if (state.activeBuildingId === buildingId && document.querySelector("#building-detail-dialog").open) {
      viewerElement.textContent = "The 3D viewer could not load. Check your internet connection and try again.";
      document.querySelector("#twin-status").textContent = error.message || "3D viewer unavailable.";
    }
  }
}

function renderMaintenanceCards(container, items, emptyMessage) {
  container.replaceChildren();
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "maintenance-empty";
    empty.textContent = emptyMessage;
    container.append(empty);
    return;
  }
  for (const item of items) {
    const card = document.createElement("article");
    card.className = "maintenance-card";
    const top = document.createElement("div");
    top.className = "maintenance-card-top";
    const severity = document.createElement("span");
    severity.className = `maintenance-severity ${item.severity}`;
    severity.textContent = item.severity;
    const status = document.createElement("span");
    status.className = `maintenance-status ${item.status}`;
    status.textContent = item.status === "suggested" ? "Needs review" : "Confirmed alert";
    top.append(severity, status);
    const title = document.createElement("strong");
    title.className = "maintenance-card-title";
    title.textContent = item.title;
    const buildingButton = document.createElement("button");
    buildingButton.type = "button";
    buildingButton.className = "maintenance-building-link";
    buildingButton.textContent = `${item.object_name} · ${item.address}`;
    buildingButton.addEventListener("click", () => openBuildingDetails(item.building_id));
    const evidence = document.createElement("p");
    evidence.className = "maintenance-evidence";
    evidence.textContent = `Evidence: “${item.evidence}”`;
    const meta = document.createElement("p");
    meta.className = "maintenance-meta";
    meta.textContent = `${item.action_type}${item.due_date ? ` · Due ${item.due_date}` : " · No due date stated"}${item.source_file_name ? ` · ${item.source_file_name}` : ""}`;
    card.append(top, title, buildingButton, evidence, meta);

    const actions = document.createElement("div");
    actions.className = "maintenance-actions";
    const addAction = (action, label, style = "") => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `maintenance-action ${style}`.trim();
      button.textContent = label;
      button.addEventListener("click", () => updateMaintenanceItem(item.id, action));
      actions.append(button);
    };
    if (item.status === "suggested") {
      addAction("confirm", "Confirm alert", "confirm");
      addAction("dismiss", "Dismiss");
    } else {
      addAction("resolve", "Mark repaired", "confirm");
      addAction("dismiss", "Dismiss");
    }
    card.append(actions);
    if (state.user?.role === "employee") actions.hidden = true;
    container.append(card);
  }
}

function renderMaintenanceOverview() {
  const suggested = state.maintenance.filter((item) => item.status === "suggested").length;
  const active = state.maintenance.filter((item) => item.status === "active").length;
  const summary = document.querySelector("#maintenance-summary");
  summary.textContent = state.maintenance.length
    ? `${suggested} need review · ${active} active`
    : "No open items";
  renderMaintenanceCards(
    document.querySelector("#maintenance-list"),
    state.maintenance,
    translations[state.language].emptyMaintenance,
  );
}

async function loadMaintenance() {
  try {
    const response = await fetch("/api/maintenance");
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || "Could not load maintenance alerts.");
    state.maintenance = result.items || [];
    renderMaintenanceOverview();
  } catch (error) {
    showToast(error.message || "Could not load maintenance alerts.");
  }
}

async function loadBuildingMaintenance(buildingId) {
  const response = await fetch(`/api/maintenance?building_id=${encodeURIComponent(buildingId)}`);
  const result = await response.json();
  if (!response.ok) throw new Error(result.detail || "Could not load building maintenance items.");
  return result.items || [];
}

async function updateMaintenanceItem(itemId, action) {
  try {
    const response = await fetch(`/api/maintenance/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || "Could not update this maintenance item.");
    await loadMaintenance();
    if (state.activeBuildingId) {
      const items = await loadBuildingMaintenance(state.activeBuildingId);
      renderMaintenanceCards(
        document.querySelector("#building-maintenance-list"),
        items,
        "No open maintenance items for this building.",
      );
    }
    showToast(action === "confirm" ? "Maintenance alert confirmed." : action === "resolve" ? "Repair marked as completed." : "Maintenance suggestion dismissed.");
  } catch (error) {
    showToast(error.message || "Could not update this maintenance item.");
  }
}

function addBuildingEditField(name = "", value = "") {
  const row = document.createElement("div");
  row.className = "building-edit-row";
  const category = document.createElement("input");
  category.maxLength = 100;
  category.placeholder = "Property name";
  category.setAttribute("aria-label", "Property name");
  category.value = name;
  const propertyValue = document.createElement("input");
  propertyValue.maxLength = 2_000;
  propertyValue.placeholder = "Value";
  propertyValue.setAttribute("aria-label", "Property value");
  propertyValue.value = value;
  const remove = document.createElement("button");
  remove.className = "remove-field";
  remove.type = "button";
  remove.textContent = "×";
  remove.setAttribute("aria-label", "Remove property");
  remove.addEventListener("click", () => row.remove());
  row.append(category, propertyValue, remove);
  document.querySelector("#building-edit-fields").append(row);
}

async function openBuildingDetails(buildingId) {
  const building = state.buildings.find((record) => record.id === buildingId);
  if (!building) return;
  state.activeBuildingId = buildingId;
  state.twinDraft = null;
  state.twinDraftSourceDocumentId = null;
  const dialog = document.querySelector("#building-detail-dialog");
  document.querySelector("#building-detail-title").textContent = building.object_name;
  document.querySelector("#building-detail-address").textContent = building.address || "No address recorded";
  document.querySelector("#building-detail-uid").textContent =
    `${translations[state.language].buildingCode}: ${building.building_code} · ${translations[state.language].systemUid}: ${building.uid}`;
  const propertyList = document.querySelector("#building-property-list");
  const properties = Object.entries(building.fields || {});
  const editable = state.user?.role !== "employee";
  const editForm = document.querySelector("#building-edit-form");
  editForm.hidden = !editable;
  propertyList.hidden = editable;
  document.querySelector("#building-edit-name").value = building.object_name;
  document.querySelector("#building-edit-fields").replaceChildren();
  for (const [name, value] of properties) addBuildingEditField(name, value);
  if (!properties.length && editable) addBuildingEditField();
  if (!properties.length) {
    propertyList.textContent = "No building details have been recorded.";
  } else if (!editable) {
    propertyList.replaceChildren(...properties.map(([name, value]) => {
      const item = document.createElement("div");
      item.className = "building-property";
      const label = document.createElement("strong");
      label.textContent = name;
      const content = document.createElement("span");
      content.textContent = value;
      item.append(label, content);
      return item;
    }));
  }
  document.querySelector("#building-detail-warning").hidden = true;
  document.querySelector("#building-image-gallery").textContent = "Loading PDF images…";
  document.querySelector("#building-image-count").textContent = "";
  document.querySelector("#building-document-list").textContent = "Loading building files…";
  document.querySelector("#building-maintenance-list").textContent = "Loading maintenance items…";
  document.querySelector("#twin-viewer").textContent = "Loading saved model…";
  document.querySelector("#twin-room-list").replaceChildren();
  document.querySelector("#twin-scale-note").textContent =
    "The generated geometry is approximate and should be checked against the source plan.";
  document.querySelector("#twin-status").textContent = "";
  document.querySelector("#save-twin").hidden = true;
  const generateButton = document.querySelector("#generate-twin");
  generateButton.disabled = true;
  generateButton.hidden = state.user?.role === "employee";
  document.querySelector("#save-twin").hidden = true;
  generateButton.textContent = "Loading PDF files…";
  if (!dialog.open) dialog.showModal();
  clearTwinViewer();

  try {
    const [assetsResponse, documentsResponse, twinResponse, maintenanceItems] = await Promise.all([
      fetch(`/api/buildings/${buildingId}/assets`),
      fetch(`/api/buildings/${buildingId}/documents`),
      fetch(`/api/buildings/${buildingId}/twin`),
      loadBuildingMaintenance(buildingId),
    ]);
    const [assetsResult, documentsResult, twinResult] = await Promise.all([
      assetsResponse.json(),
      documentsResponse.json(),
      twinResponse.json(),
    ]);
    if (!assetsResponse.ok) throw new Error(assetsResult.detail || "Could not load building images.");
    if (!documentsResponse.ok) throw new Error(documentsResult.detail || "Could not load building files.");
    if (!twinResponse.ok) throw new Error(twinResult.detail || "Could not load the saved 3D model.");
    if (state.activeBuildingId !== buildingId) return;
    const documents = documentsResult.documents || [];
    const documentList = document.querySelector("#building-document-list");
    if (!documents.length) {
      documentList.textContent = "No files are attached to this building.";
    } else {
      documentList.replaceChildren(...documents.map((source) => {
        const row = document.createElement("div");
        row.className = "building-document-row";
        const fileName = document.createElement("span");
        fileName.textContent = source.file_name;
        const status = document.createElement("small");
        const statusLabels = {
          pending: "Waiting for text indexing",
          processing: "Extracting and indexing text…",
          ready: `Searchable · ${source.indexed_pages} page${source.indexed_pages === 1 ? "" : "s"}`,
          partial: `Partially indexed · ${source.index_error}`,
          failed: `Indexing failed · ${source.index_error}`,
        };
        status.textContent = statusLabels[source.index_status] || "Index status unavailable";
        const link = document.createElement("a");
        link.href = source.url;
        link.target = "_blank";
        link.rel = "noreferrer";
        link.textContent = source.is_primary ? "Original file" : "Open file";
        row.append(fileName, status, link);
        return row;
      }));
      document.querySelector("#building-document-count").textContent =
        `${documents.length} file${documents.length === 1 ? "" : "s"}`;
    }

    const pdfDocuments = documents.filter((source) =>
      source.mime_type === "application/pdf"
      || /^image\/(jpeg|png|gif|tiff)$/.test(source.mime_type || "")
      || RENDERABLE_EXTENSIONS.includes(fileExtension(source.file_name)),
    );
    const sourceSelect = document.querySelector("#twin-source-document");
    sourceSelect.replaceChildren();
    for (const source of pdfDocuments) {
      const option = document.createElement("option");
      option.value = source.id === null ? "" : String(source.id);
      option.textContent = `${source.is_primary ? "Original" : "Added"} · ${source.file_name}`;
      sourceSelect.append(option);
    }
    const savedSourceId = twinResult.source_document_id;
    const hasSavedSource = pdfDocuments.some((source) =>
      (source.id === null ? null : source.id) === savedSourceId,
    );
    if (hasSavedSource) sourceSelect.value = savedSourceId === null ? "" : String(savedSourceId);
    else if (pdfDocuments.length) {
      const preferred = pdfDocuments.find((source) => !source.is_primary) || pdfDocuments[0];
      sourceSelect.value = preferred.id === null ? "" : String(preferred.id);
    }
    const hasPdf = pdfDocuments.length > 0;
    sourceSelect.disabled = !hasPdf;
    generateButton.disabled = !hasPdf;
    generateButton.textContent = !hasPdf
      ? "PDF floor plan required"
      : building.has_twin ? "Create a new draft" : "Generate 3D draft";

    renderMaintenanceCards(
      document.querySelector("#building-maintenance-list"),
      maintenanceItems,
      "No open maintenance items for this building.",
    );
    const gallery = document.querySelector("#building-image-gallery");
    const assets = assetsResult.assets || [];
    if (!assets.length) {
      gallery.innerHTML = '<div class="map-empty">No PDF images were saved for this object.</div>';
    } else {
      gallery.replaceChildren(...assets.map((asset) => {
        const card = document.createElement("figure");
        card.className = "building-image-card";
        const image = document.createElement("img");
        image.src = asset.url;
        image.alt = asset.asset_type === "floorplan-page"
          ? `PDF floor plan page ${asset.page_number}`
          : `Image extracted from PDF page ${asset.page_number}`;
        image.loading = "lazy";
        const caption = document.createElement("figcaption");
        caption.textContent = asset.asset_type === "floorplan-page"
          ? `Floor-plan page ${asset.page_number}`
          : `Embedded image · page ${asset.page_number}`;
        if (asset.source_file_name) caption.textContent += ` · ${asset.source_file_name}`;
        card.append(image, caption);
        return card;
      }));
      document.querySelector("#building-image-count").textContent = `${assets.length} images`;
    }
    if (assetsResult.warnings?.length) {
      const warning = document.querySelector("#building-detail-warning");
      warning.textContent = assetsResult.warnings.join(" ");
      warning.hidden = false;
    }

    if (twinResult.twin) await renderTwin(twinResult.twin, buildingId);
    else {
      document.querySelector("#twin-viewer").textContent = "No 3D model saved yet. Generate a draft from this PDF floor plan.";
      document.querySelector("#twin-room-list").replaceChildren();
    }
  } catch (error) {
    showToast(error.message || "Could not load building details.");
    document.querySelector("#building-image-gallery").textContent = error.message || "Could not load building images.";
  }
}

async function generateTwinDraft() {
  if (!state.activeBuildingId) return;
  const buildingId = state.activeBuildingId;
  const button = document.querySelector("#generate-twin");
  button.disabled = true;
  document.querySelector("#save-twin").hidden = true;
  document.querySelector("#twin-status").textContent = "Analyzing PDF floor-plan images…";
  try {
    const response = await fetch(`/api/buildings/${buildingId}/twin/draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: providerSelect.value,
        model: state.modelsReady ? modelSelect.value : undefined,
        document_id: document.querySelector("#twin-source-document").value
          ? Number(document.querySelector("#twin-source-document").value)
          : undefined,
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || "Could not generate a 3D draft.");
    if (state.activeBuildingId !== buildingId) return;
    state.twinDraftSourceDocumentId = result.source_document_id ?? null;
    if (result.warnings?.length) {
      const warning = document.querySelector("#building-detail-warning");
      warning.textContent = result.warnings.join(" ");
      warning.hidden = false;
    }
    await renderTwin(result.twin, buildingId);
    document.querySelector("#save-twin").hidden = false;
    document.querySelector("#save-twin").textContent = "Save reviewed model";
    document.querySelector("#twin-status").textContent =
      `Draft uses ${result.analyzed_pages} PDF page${result.analyzed_pages === 1 ? "" : "s"}. Check it against the source before saving.`;
  } catch (error) {
    if (state.activeBuildingId === buildingId) {
      document.querySelector("#twin-status").textContent = error.message || "Could not generate a 3D draft.";
    }
  } finally {
    if (state.activeBuildingId === buildingId) button.disabled = false;
  }
}

async function saveTwinDraft() {
  if (!state.activeBuildingId || !state.twinDraft) return;
  const buildingId = state.activeBuildingId;
  const twinDraft = state.twinDraft;
  const button = document.querySelector("#save-twin");
  button.disabled = true;
  document.querySelector("#twin-status").textContent = "Saving reviewed 3D model…";
  try {
    const response = await fetch(`/api/buildings/${buildingId}/twin`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        twin: twinDraft,
        source_document_id: state.twinDraftSourceDocumentId,
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || "Could not save this 3D model.");
    const building = state.buildings.find((record) => record.id === buildingId);
    if (building) building.has_twin = true;
    if (state.activeBuildingId === buildingId) {
      document.querySelector("#twin-status").textContent = "Reviewed 3D model saved.";
      document.querySelector("#save-twin").hidden = true;
    }
    await loadBuildings();
  } catch (error) {
    if (state.activeBuildingId === buildingId) {
      document.querySelector("#twin-status").textContent = error.message || "Could not save the 3D model.";
    }
  } finally {
    if (state.activeBuildingId === buildingId) button.disabled = false;
  }
}

async function loadBuildings() {
  try {
    const response = await fetch("/api/buildings");
    if (!response.ok) throw new Error("Could not load saved buildings.");
    const result = await response.json();
    state.buildings = result.buildings;
    state.processedCount = state.buildings.length;
    renderFiles();
    renderBuildings();
    if (state.user?.role === "city_administrator" && state.adminUsers.length) renderAdminUsers();
  } catch (error) {
    showToast(error.message || "Could not load saved buildings.");
  }
}

function initializeCityMap() {
  const mapElement = document.querySelector("#city-map-canvas");
  if (!window.maplibregl) {
    mapElement.textContent = "The 3D map library could not be loaded. Check your internet connection and reload.";
    mapElement.classList.add("map-unavailable");
    return;
  }
  state.map = new maplibregl.Map({
    container: mapElement,
    style: "https://tiles.openfreemap.org/styles/liberty",
    center: [10.9644, 50.2643],
    zoom: 15.5,
    pitch: 58,
    bearing: -18,
    maxPitch: 85,
  });
  state.map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
  state.map.on("load", () => {
    const labelLayer = state.map.getStyle().layers.find((layer) =>
      layer.type === "symbol" && layer.layout && layer.layout["text-field"]);
    if (state.map.getSource("openmaptiles")) {
      state.map.addLayer({
        id: "city-buildings-3d",
        source: "openmaptiles",
        "source-layer": "building",
        type: "fill-extrusion",
        minzoom: 14,
        paint: {
          "fill-extrusion-color": "#d9d4c7",
          "fill-extrusion-height": ["coalesce", ["get", "render_height"], 8],
          "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
          "fill-extrusion-opacity": 0.9,
        },
      }, labelLayer?.id);
    }
    state.mapLoaded = true;
    renderBuildings();
  });
  state.map.on("click", (event) => {
    if (!state.pickingLocation) return;
    selectMapLocation(event.lngLat.lng, event.lngLat.lat);
  });
}

function addMessage(role, content) {
  const wrapper = document.createElement("div");
  wrapper.className = role === "user" ? "user-message" : "assistant-message";
  if (role === "assistant") {
    const avatar = document.createElement("span");
    avatar.className = "chat-avatar";
    avatar.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 3 14.2 9.8 21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2L12 3z"/></svg>';
    wrapper.append(avatar);
  }
  const contentWrap = document.createElement("div");
  contentWrap.className = "message-content";
  if (role === "assistant") {
    const label = document.createElement("span");
    label.className = "message-name";
    label.textContent = "StadtManager";
    contentWrap.append(label);
  }
  const bubble = document.createElement("div");
  bubble.className = "message-bubble";
  bubble.textContent = content;
  contentWrap.append(bubble);
  wrapper.append(contentWrap);
  chatArea.append(wrapper);
  chatArea.scrollTop = chatArea.scrollHeight;
}

async function sendMessage(message) {
  const cleanMessage = message.trim();
  if (!cleanMessage || sendButton.disabled) return;
  state.messages.push({ role: "user", content: cleanMessage });
  addMessage("user", cleanMessage);
  chatInput.value = "";
  sendButton.disabled = true;
  sendButton.querySelector("span").textContent = "Thinking";
  try {
    const context = state.files
      .filter((file) => !file.error && file.content)
      .map((file) => file.content)
      .join("\n\n---\n\n")
      .slice(0, 18_000);
    const response = await fetch("/api/agent/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: providerSelect.value,
        model: modelSelect.value,
        messages: state.messages.slice(-12),
        context,
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || "The assistant could not respond.");
    state.messages.push({ role: "assistant", content: result.reply });
    addMessage("assistant", result.reply);
  } catch (error) {
    state.messages.pop();
    addMessage("assistant", error.message || "Could not reach the assistant.");
  } finally {
    sendButton.disabled = !state.modelsReady;
    sendButton.querySelector("span").textContent = "Send";
    chatInput.focus();
  }
}

async function loadModels() {
  const requestId = ++state.modelRequest;
  state.modelsReady = false;
  sendButton.disabled = true;
  modelSelect.hidden = true;
  modelSelect.disabled = true;
  document.querySelector("#agent-state").textContent = "Checking";
  document.querySelector("#agent-foot").textContent = "Verifying provider access";
  keyStatus.className = "key-status";
  keyStatus.textContent = `Checking ${providerSelect.value} API key…`;
  try {
    const response = await fetch(`/api/models?provider=${encodeURIComponent(providerSelect.value)}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || "Could not verify the API key.");
    if (requestId !== state.modelRequest) return;
    modelSelect.replaceChildren(...result.models.map((model) => {
      const option = document.createElement("option");
      option.value = model;
      option.textContent = model;
      return option;
    }));
    modelSelect.value = result.default_model;
    modelSelect.hidden = false;
    modelSelect.disabled = false;
    keyStatus.classList.add("verified");
    keyStatus.textContent = `Key verified · ${result.models.length} models`;
    document.querySelector("#agent-state").textContent = "Ready";
    document.querySelector("#agent-foot").textContent = `${result.models.length} chat models available`;
    state.modelsReady = true;
    sendButton.disabled = false;
  } catch (error) {
    if (requestId !== state.modelRequest) return;
    keyStatus.classList.add("invalid");
    keyStatus.textContent = error.message || "Could not verify the API key.";
    document.querySelector("#agent-state").textContent = "Not connected";
    document.querySelector("#agent-foot").textContent = "Check the selected provider key";
  }
}

function populateBuildingSelect(select, selectedIds = []) {
  const selected = new Set(selectedIds.map(Number));
  select.replaceChildren(...state.buildings.map((building) => {
    const option = document.createElement("option");
    option.value = building.id;
    option.textContent = `${building.object_name} · ${building.address}`;
    option.selected = selected.has(Number(building.id));
    return option;
  }));
}

function renderAdminUsers() {
  if (state.user?.role !== "city_administrator") return;
  populateBuildingSelect(
    document.querySelector("#new-user-buildings"),
    [...document.querySelector("#new-user-buildings").selectedOptions].map((option) => option.value),
  );
  const container = document.querySelector("#admin-user-list");
  if (!state.adminUsers.length) {
    container.textContent = "No accounts found.";
    return;
  }
  container.replaceChildren(...state.adminUsers.map((user) => {
    const row = document.createElement("form");
    row.className = "admin-user-row";
    if (user.role === "city_administrator") {
      const identity = document.createElement("div");
      identity.className = "admin-user-identity";
      identity.textContent = user.display_name;
      const username = document.createElement("small");
      username.textContent = `${user.username} · City Administrator`;
      identity.append(username);
      row.append(identity);
      return row;
    }

    const identity = document.createElement("div");
    identity.className = "admin-user-identity";
    identity.textContent = user.display_name;
    const username = document.createElement("small");
    username.textContent = user.username;
    identity.append(username);

    const roleLabelElement = document.createElement("label");
    roleLabelElement.className = "auth-field";
    roleLabelElement.textContent = "Role";
    const role = document.createElement("select");
    role.innerHTML = '<option value="employee">Employee (read-only)</option><option value="building_administrator">Building Administrator</option>';
    role.value = user.role;
    roleLabelElement.append(role);

    const buildingLabel = document.createElement("label");
    buildingLabel.className = "auth-field";
    buildingLabel.textContent = "Assigned buildings";
    const buildings = document.createElement("select");
    buildings.multiple = true;
    buildings.size = 3;
    populateBuildingSelect(buildings, user.buildings.map((building) => building.id));
    buildingLabel.append(buildings);

    const passwordLabel = document.createElement("label");
    passwordLabel.className = "auth-field";
    passwordLabel.textContent = "Reset password (optional)";
    const password = document.createElement("input");
    password.type = "password";
    password.minLength = 12;
    password.maxLength = 128;
    password.autocomplete = "new-password";
    passwordLabel.append(password);

    const save = document.createElement("button");
    save.className = "secondary-button";
    save.type = "submit";
    save.textContent = "Save access";
    row.append(identity, roleLabelElement, buildingLabel, passwordLabel, save);
    row.addEventListener("submit", async (event) => {
      event.preventDefault();
      save.disabled = true;
      try {
        const response = await fetch(`/api/admin/users/${user.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            display_name: user.display_name,
            role: role.value,
            building_ids: [...buildings.selectedOptions].map((option) => Number(option.value)),
            password: password.value || null,
          }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.detail || "Could not update account.");
        password.value = "";
        showToast("User access updated.");
        await loadAdminUsers();
      } catch (error) {
        showToast(error.message || "Could not update account.");
      } finally {
        save.disabled = false;
      }
    });
    return row;
  }));
}

async function loadAdminUsers() {
  if (state.user?.role !== "city_administrator") return;
  try {
    const response = await fetch("/api/admin/users");
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || "Could not load user accounts.");
    state.adminUsers = result.users || [];
    renderAdminUsers();
  } catch (error) {
    showToast(error.message || "Could not load user accounts.");
  }
}

async function openWorkspacePage(page, activeLink = null) {
  if (page === "users" && state.user?.role !== "city_administrator") page = "overview";
  document.querySelector("#overview").hidden = page !== "overview";
  document.querySelector("#users-page").hidden = page !== "users";
  document.querySelector("#profile-settings-page").hidden = page !== "profile";
  document.querySelector("#profile-menu").hidden = true;
  document.querySelector("#profile-trigger").setAttribute("aria-expanded", "false");

  const pageTitles = {
    overview: "Overview",
    users: "Users and building access",
    profile: "Profile settings",
  };
  document.querySelector("#page-title").textContent = pageTitles[page];
  const selectedLink = page === "users"
    ? document.querySelector("#users-nav")
    : page === "profile"
      ? null
      : activeLink || document.querySelector('.nav-item[href="#overview"]');
  document.querySelectorAll(".nav-item").forEach((link) => {
    const active = link === selectedLink;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });

  if (page === "users") await loadAdminUsers();
  if (page === "profile") await loadProfile();
}

function renderCurrentProfile(profile) {
  state.profile = profile;
  state.user.display_name = profile.display_name;
  document.querySelector("#profile-name").textContent = profile.display_name;
  document.querySelector("#profile-role").textContent = roleLabel(profile.role);
  renderProfileImage(profile.profile_image, profile.display_name);
}

async function loadProfile() {
  const status = document.querySelector("#profile-save-status");
  status.textContent = "";
  try {
    const response = await fetch("/api/auth/profile");
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || "Could not load profile settings.");
    const profile = result.profile;
    renderCurrentProfile(profile);
    document.querySelector("#profile-display-name").value = profile.display_name;
    document.querySelector("#profile-email").value = profile.email;
    document.querySelector("#profile-phone").value = profile.phone;
    document.querySelector("#profile-job-title").value = profile.job_title;
    document.querySelector("#profile-department").value = profile.department;
    document.querySelector("#profile-username").value = profile.username;
    document.querySelector("#profile-role-value").value = roleLabel(profile.role);
    document.querySelector("#profile-current-password").value = "";
    document.querySelector("#profile-new-password").value = "";
    document.querySelector("#profile-confirm-password").value = "";
    document.querySelector("#profile-image-file").value = "";
    document.querySelector("#profile-image-status").textContent = "";
    state.pendingProfileImage = null;
    state.profileImageRemoved = false;
  } catch (error) {
    status.textContent = error.message || "Could not load profile settings.";
  }
}

async function startAuthenticatedApp(user) {
  state.user = user;
  document.querySelector("#auth-screen").hidden = true;
  document.querySelector("#app-shell").hidden = false;
  document.querySelector("#profile-name").textContent = user.display_name;
  document.querySelector("#profile-role").textContent = roleLabel(user.role);
  renderProfileImage(user.profile_image || "", user.display_name);
  const isCityAdmin = user.role === "city_administrator";
  const isWriter = user.role !== "employee";
  document.querySelector("#users-nav").hidden = !isCityAdmin;
  document.querySelector("#clear-data").hidden = !isCityAdmin;
  document.querySelector("#dropzone").hidden = !isWriter;
  document.querySelector("#review-panel").hidden = true;
  document.querySelector(".files-panel").hidden = !isWriter;
  document.querySelector(".assistant-panel").classList.toggle("assistant-only", !isWriter);
  await openWorkspacePage("overview");
  await loadProfile();
  await loadBuildings();
  await loadMaintenance();
  if (isWriter) await loadCategories();
  loadModels();
  initializeCityMap();
}

function showAuthScreen(mode, message = "") {
  state.authMode = mode;
  document.querySelector("#app-shell").hidden = true;
  document.querySelector("#auth-screen").hidden = false;
  const setup = mode === "setup";
  document.querySelector("#auth-title").textContent = setup
    ? "Create City Administrator"
    : "Sign in";
  document.querySelector("#auth-copy").textContent = setup
    ? "Create the first administrator account to secure this StadtManager database."
    : "Sign in to view your assigned buildings.";
  document.querySelector("#auth-submit").textContent = setup ? "Create administrator" : "Sign in";
  document.querySelector("#auth-display-wrap").hidden = !setup;
  document.querySelector("#auth-display-name").required = setup;
  document.querySelector("#auth-password").autocomplete = setup ? "new-password" : "current-password";
  document.querySelector("#auth-password").minLength = setup ? 12 : 1;
  document.querySelector("#auth-message").textContent = message;
  document.querySelector("#auth-form").reset();
}

async function initializeAuthentication() {
  try {
    const response = await fetch("/api/auth/status");
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || "Could not check login status.");
    if (result.user) {
      await startAuthenticatedApp(result.user);
    } else {
      showAuthScreen(result.setup_required ? "setup" : "login");
    }
  } catch (error) {
    showAuthScreen("login", error.message || "Could not connect to StadtManager.");
  }
}

fileInput.addEventListener("change", () => queueFiles([...fileInput.files]));
folderInput.addEventListener("change", () => queueFiles([...folderInput.files]));
document.querySelector("#browse-files").addEventListener("click", () => fileInput.click());
document.querySelector("#browse-folder").addEventListener("click", () => folderInput.click());
document.querySelector("#accept-building").addEventListener("click", acceptBuilding);
document.querySelector("#skip-file").addEventListener("click", skipCurrentImport);
document.querySelector("#building-search").addEventListener("input", renderBuildings);
document.querySelector("#building-detail-close").addEventListener("click", () => {
  document.querySelector("#building-detail-dialog").close();
});
document.querySelector("#building-detail-dialog").addEventListener("close", () => {
  state.activeBuildingId = null;
  state.twinDraft = null;
  state.twinDraftSourceDocumentId = null;
  clearTwinViewer();
});
document.querySelector("#twin-source-document").addEventListener("change", () => {
  state.twinDraft = null;
  state.twinDraftSourceDocumentId = null;
  document.querySelector("#save-twin").hidden = true;
  document.querySelector("#twin-status").textContent = "";
});
document.querySelector("#generate-twin").addEventListener("click", generateTwinDraft);
document.querySelector("#save-twin").addEventListener("click", saveTwinDraft);
document.querySelector("#twin-room-list").addEventListener("change", (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || !input.dataset.twinField || !state.twinDraft) return;
  const floor = state.twinDraft.floors[Number(input.dataset.twinFloor)];
  const room = floor?.rooms[Number(input.dataset.twinRoom)];
  if (!room) return;
  const field = input.dataset.twinField;
  const value = field === "name" ? input.value.trim() : Number(input.value);
  const bounds = { x: [-500, 500], z: [-500, 500], width: [0.2, 500], depth: [0.2, 500], height: [1.5, 10] };
  if (
    (field === "name" && !value)
    || (field !== "name" && (
      !input.value.trim()
      || !Number.isFinite(value)
      || value < bounds[field][0]
      || value > bounds[field][1]
    ))
  ) {
    input.value = room[field];
    document.querySelector("#twin-status").textContent = "Enter a valid room name or dimension.";
    return;
  }
  room[field] = value;
  const building = state.buildings.find((record) => record.id === state.activeBuildingId);
  const saveButton = document.querySelector("#save-twin");
  saveButton.hidden = false;
  saveButton.textContent = building?.has_twin ? "Save model changes" : "Save reviewed model";
  document.querySelector("#twin-status").textContent = "Draft edited. Review the updated 3D model before saving.";
  renderTwin(state.twinDraft, state.activeBuildingId);
});
for (const id of ["street-name", "house-number", "full-address"]) {
  const field = document.querySelector(`#${id}`);
  field.addEventListener("input", () => {
    state.addressVerified = false;
    state.locationPickedManually = false;
    state.suggestedBuildingUid = "";
    if (state.currentExtraction) state.currentExtraction.building_match = null;
    renderBuildingMatch(null);
    if (!state.buildingCodeManuallyEdited && state.buildingCodeSource !== "ai") {
      document.querySelector("#building-code").value = "";
      state.buildingCodeSource = "";
    }
    state.addressRequestId += 1;
    clearTimeout(state.addressLookupTimer);
    state.pickedLocationMarker?.remove();
    state.pickedLocationMarker = null;
    document.querySelector("#building-latitude").value = "";
    document.querySelector("#building-longitude").value = "";
  });
  field.addEventListener("change", scheduleAddressValidation);
  field.addEventListener("blur", scheduleAddressValidation);
}
document.querySelector("#building-code").addEventListener("input", () => {
  state.buildingCodeManuallyEdited = true;
  state.buildingCodeSource = "manual";
});
document.querySelector("#building-latitude").addEventListener("input", () => {
  state.addressVerified = false;
  state.locationPickedManually = true;
});
document.querySelector("#building-longitude").addEventListener("input", () => {
  state.addressVerified = false;
  state.locationPickedManually = true;
});
document.querySelector("#add-field").addEventListener("click", () => {
  const row = createFieldRow();
  document.querySelector("#review-fields").append(row);
  row.querySelector(".category-select").focus();
});
document.querySelector("#pick-location").addEventListener("click", () => {
  if (!state.currentImport) return;
  if (!state.mapLoaded || !state.map) {
    document.querySelector("#review-status").textContent = state.language === "de"
      ? "Die Karte wird noch geladen. Bitte versuchen Sie es gleich erneut."
      : "The map is still loading. Please try again in a moment.";
    return;
  }
  state.pickingLocation = true;
  document.querySelector("#review-status").textContent = state.language === "de"
    ? "Klicken Sie auf die Karte, um den Gebäudestandort festzulegen."
    : "Click the map to set this building's location.";
  state.map.getCanvas().style.cursor = "crosshair";
  document.querySelector("#city-map").scrollIntoView({ behavior: "smooth", block: "start" });
});
dropzone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropzone.classList.add("drag-over");
});
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("drag-over"));
dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropzone.classList.remove("drag-over");
  queueFiles([...event.dataTransfer.files]);
});
chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  sendMessage(chatInput.value);
});
chatInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});
providerSelect.addEventListener("change", loadModels);
document.querySelectorAll(".suggestion").forEach((button) => {
  button.addEventListener("click", () => sendMessage(button.dataset.prompt));
});
document.querySelector("#theme-toggle").addEventListener("click", () => {
  document.body.classList.toggle("dark");
  localStorage.setItem("stadtmanager-theme", document.body.classList.contains("dark") ? "dark" : "light");
});
if (localStorage.getItem("stadtmanager-theme") === "dark") document.body.classList.add("dark");

document.querySelector("#language-toggle").addEventListener("click", () => {
  applyLanguage(state.language === "en" ? "de" : "en");
});
document.querySelectorAll(".nav-item").forEach((link) => {
  link.addEventListener("click", (event) => {
    const page = link.dataset.workspacePage;
    if (page) event.preventDefault();
    void openWorkspacePage(page || "overview", link);
  });
});
document.querySelector("#profile-trigger").addEventListener("click", () => {
  const menu = document.querySelector("#profile-menu");
  menu.hidden = !menu.hidden;
  document.querySelector("#profile-trigger").setAttribute("aria-expanded", String(!menu.hidden));
});
document.querySelector("#profile-settings-button").addEventListener("click", () => {
  void openWorkspacePage("profile");
});
document.addEventListener("click", (event) => {
  if (event.target.closest(".sidebar-bottom")) return;
  document.querySelector("#profile-menu").hidden = true;
  document.querySelector("#profile-trigger").setAttribute("aria-expanded", "false");
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  document.querySelector("#profile-menu").hidden = true;
  document.querySelector("#profile-trigger").setAttribute("aria-expanded", "false");
});
document.querySelector("#profile-back").addEventListener("click", () => {
  void openWorkspacePage("overview");
});
document.querySelector("#choose-profile-image").addEventListener("click", () => {
  document.querySelector("#profile-image-file").click();
});
async function prepareProfileImage(file) {
  const image = await createImageBitmap(file);
  try {
    if (image.width * image.height > 60_000_000) {
      throw new Error("This photo is too large to process. Choose an image with fewer pixels.");
    }
    const scale = Math.min(1, 512 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not prepare the selected photo.");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const result = canvas.toDataURL("image/jpeg", 0.85);
    if (!result.startsWith("data:image/jpeg;base64,") || result.length > 1_500_000) {
      throw new Error("Could not optimize this photo. Try a different image.");
    }
    return result;
  } finally {
    image.close();
  }
}
document.querySelector("#profile-image-file").addEventListener("change", async (event) => {
  const file = event.currentTarget.files[0];
  if (!file) return;
  const status = document.querySelector("#profile-image-status");
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 12 * 1024 * 1024) {
    status.textContent = "Choose a PNG, JPEG, or WebP image up to 12 MB.";
    event.currentTarget.value = "";
    return;
  }
  try {
    status.textContent = "Optimizing photo…";
    state.pendingProfileImage = await prepareProfileImage(file);
    state.profileImageRemoved = false;
    renderProfileImage(state.pendingProfileImage, document.querySelector("#profile-display-name").value, true);
    status.textContent = `Ready to save: ${file.name}`;
  } catch (error) {
    status.textContent = error.message || "Could not read the selected image.";
  }
});
document.querySelector("#remove-profile-image").addEventListener("click", () => {
  state.pendingProfileImage = null;
  state.profileImageRemoved = true;
  document.querySelector("#profile-image-file").value = "";
  document.querySelector("#profile-image-status").textContent = "Photo will be removed when you save.";
  renderProfileImage("", document.querySelector("#profile-display-name").value, true);
});
document.querySelector("#profile-display-name").addEventListener("input", (event) => {
  if (state.pendingProfileImage || state.profile?.profile_image) return;
  renderProfileImage("", event.currentTarget.value, true);
});
document.querySelector("#profile-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = document.querySelector("#profile-save-status");
  const button = document.querySelector("#profile-save");
  const currentPassword = document.querySelector("#profile-current-password").value;
  const newPassword = document.querySelector("#profile-new-password").value;
  if (newPassword && newPassword !== document.querySelector("#profile-confirm-password").value) {
    status.textContent = "The new passwords do not match.";
    document.querySelector("#profile-confirm-password").focus();
    return;
  }
  if (Boolean(currentPassword) !== Boolean(newPassword)) {
    status.textContent = "Enter both your current password and a new password to change it.";
    return;
  }
  button.disabled = true;
  status.textContent = "Saving profile…";
  const payload = {
    display_name: document.querySelector("#profile-display-name").value.trim(),
    email: document.querySelector("#profile-email").value.trim(),
    phone: document.querySelector("#profile-phone").value.trim(),
    job_title: document.querySelector("#profile-job-title").value.trim(),
    department: document.querySelector("#profile-department").value.trim(),
    profile_image: state.pendingProfileImage || (state.profileImageRemoved ? "" : null),
    current_password: currentPassword || null,
    new_password: newPassword || null,
  };
  try {
    const response = await fetch("/api/auth/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || "Could not save profile settings.");
    renderCurrentProfile(result.profile);
    state.pendingProfileImage = null;
    state.profileImageRemoved = false;
    document.querySelector("#profile-image-file").value = "";
    document.querySelector("#profile-image-status").textContent = "";
    document.querySelector("#profile-current-password").value = "";
    document.querySelector("#profile-new-password").value = "";
    document.querySelector("#profile-confirm-password").value = "";
    status.textContent = "Profile saved.";
  } catch (error) {
    status.textContent = error.message || "Could not save profile settings.";
  } finally {
    button.disabled = false;
  }
});
document.querySelector("#clear-data").addEventListener("click", async () => {
  const message = state.language === "de"
    ? "Alle gespeicherten Gebäude, Dateien, Wartungsmeldungen und 3D-Modelle unwiderruflich löschen?"
    : "Permanently delete all saved buildings, files, maintenance alerts, and 3D models?";
  if (!window.confirm(message)) return;
  try {
    const response = await fetch("/api/data", { method: "DELETE" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || "Could not clear saved data.");
    state.files = [];
    state.processedCount = 0;
    state.buildings = [];
    state.maintenance = [];
    renderFiles();
    renderBuildings();
    renderMaintenanceOverview();
    showToast(state.language === "de"
      ? `${result.deleted_buildings} Gebäude und alle zugehörigen Daten gelöscht.`
      : `${result.deleted_buildings} buildings and all related data deleted.`);
  } catch (error) {
    showToast(error.message || "Could not clear saved data.");
  }
});
document.querySelector("#sign-out").addEventListener("click", async () => {
  try {
    const response = await fetch("/api/auth/logout", { method: "POST" });
    if (!response.ok) throw new Error("Could not sign out.");
    window.location.reload();
  } catch (error) {
    showToast(error.message || "Could not sign out.");
  }
});
document.querySelector("#building-add-property").addEventListener("click", () => addBuildingEditField());
document.querySelector("#building-edit-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const buildingId = state.activeBuildingId;
  if (!buildingId || state.user?.role === "employee") return;
  const status = document.querySelector("#building-edit-status");
  const button = event.currentTarget.querySelector('button[type="submit"]');
  const fields = {};
  for (const row of document.querySelectorAll("#building-edit-fields .building-edit-row")) {
    const category = row.querySelector('[aria-label="Property name"]').value.trim();
    const value = row.querySelector('[aria-label="Property value"]').value.trim();
    if (value && !category) {
      status.textContent = "Enter a property name for every value.";
      row.querySelector('[aria-label="Property name"]').focus();
      return;
    }
    if (category && value) fields[category] = value;
  }
  button.disabled = true;
  status.textContent = "Saving building data…";
  try {
    const response = await fetch(`/api/buildings/${buildingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        object_name: document.querySelector("#building-edit-name").value.trim(),
        fields,
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || "Could not save building data.");
    await loadBuildings();
    status.textContent = "Building data saved.";
    await openBuildingDetails(buildingId);
  } catch (error) {
    status.textContent = error.message || "Could not save building data.";
  } finally {
    button.disabled = false;
  }
});
document.querySelector("#auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = document.querySelector("#auth-submit");
  const isSetup = state.authMode === "setup";
  const payload = {
    username: document.querySelector("#auth-username").value.trim(),
    password: document.querySelector("#auth-password").value,
  };
  if (isSetup) payload.display_name = document.querySelector("#auth-display-name").value.trim();
  submit.disabled = true;
  document.querySelector("#auth-message").textContent = "";
  try {
    const response = await fetch(isSetup ? "/api/auth/setup" : "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || "Authentication failed.");
    await startAuthenticatedApp(result.user);
  } catch (error) {
    document.querySelector("#auth-message").textContent = error.message || "Authentication failed.";
  } finally {
    submit.disabled = false;
  }
});
document.querySelector("#admin-user-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        display_name: document.querySelector("#new-user-name").value.trim(),
        username: document.querySelector("#new-user-username").value.trim(),
        password: document.querySelector("#new-user-password").value,
        role: document.querySelector("#new-user-role").value,
        building_ids: [...document.querySelector("#new-user-buildings").selectedOptions]
          .map((option) => Number(option.value)),
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || "Could not create user account.");
    event.currentTarget.reset();
    await loadAdminUsers();
    showToast(`Account created for ${result.display_name}.`);
  } catch (error) {
    showToast(error.message || "Could not create user account.");
  } finally {
    button.disabled = false;
  }
});

const savedLanguage = localStorage.getItem("stadtmanager-language");
const browserLanguage = (navigator.language || "en").toLowerCase().startsWith("de") ? "de" : "en";
applyLanguage(savedLanguage === "de" || savedLanguage === "en" ? savedLanguage : browserLanguage);

fetch("/api/health")
  .then((response) => {
    if (!response.ok) throw new Error("Backend unavailable");
    return response.json();
  })
  .then(() => { document.querySelector("#backend-label").dataset.i18n = "connected"; applyLanguage(state.language); })
  .catch(() => {
    document.querySelector("#backend-label").dataset.i18n = "offline";
    applyLanguage(state.language);
    document.querySelector(".status-dot").classList.add("offline");
  });

initializeAuthentication();
