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
  previewUrl: null,
  buildings: [],
  map: null,
  mapLoaded: false,
  mapMarkers: [],
  pickingLocation: false,
};
sendButton.disabled = true;

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
  const allowedExtension = /\.(csv|json|md|pdf|txt)$/i;
  const supportedFiles = files.filter((file) => allowedExtension.test(file.name));
  const skippedCount = files.length - supportedFiles.length;
  if (!supportedFiles.length) {
    showToast("No supported files found. Choose CSV, JSON, PDF, Markdown, or text files.");
    fileInput.value = "";
    folderInput.value = "";
    return;
  }
  if (skippedCount) showToast(`Skipping ${skippedCount} unsupported file${skippedCount === 1 ? "" : "s"}.`);
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
  const textPreview = document.querySelector("#text-preview");
  document.querySelector("#preview-filename").textContent = file.name;
  document.querySelector("#preview-kind").textContent = result?.kind || file.name.split(".").pop().toUpperCase();
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  if (file.name.toLowerCase().endsWith(".pdf")) {
    state.previewUrl = URL.createObjectURL(file);
    pdfPreview.src = state.previewUrl;
    pdfPreview.hidden = false;
    textPreview.hidden = true;
  } else {
    pdfPreview.removeAttribute("src");
    pdfPreview.hidden = true;
    const preview = result?.preview;
    textPreview.textContent = typeof preview === "string" ? preview : JSON.stringify(preview ?? "Extracting document…", null, 2);
    textPreview.hidden = false;
  }
}

function setReviewEditingEnabled(enabled) {
  for (const control of document.querySelectorAll(".review-form input, .review-form select, .review-form button")) {
    control.disabled = !enabled;
  }
}

function showExtraction(result) {
  state.currentExtraction = result;
  document.querySelector("#object-name").value = result.object_name || "";
  document.querySelector("#building-address").value = result.address || "";
  document.querySelector("#building-latitude").value = result.latitude ?? "";
  document.querySelector("#building-longitude").value = result.longitude ?? "";
  document.querySelector("#preview-kind").textContent = result.kind || "";
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
  document.querySelector("#building-address").value = "";
  document.querySelector("#building-latitude").value = "";
  document.querySelector("#building-longitude").value = "";
  document.querySelector("#extraction-notice").hidden = true;
  document.querySelector("#review-fields").replaceChildren(createFieldRow());
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
    document.querySelector("#review-status").textContent = "Enter the required building name to continue.";
  } finally {
    if (state.currentImport === file) setReviewEditingEnabled(true);
  }
}

function finishCurrentImport() {
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.previewUrl = null;
  state.currentImport = null;
  state.currentExtraction = null;
  state.importCompleted += 1;
  processNextImport();
}

async function acceptBuilding() {
  const file = state.currentImport;
  if (!file) return;
  const objectName = document.querySelector("#object-name").value.trim();
  if (!objectName) {
    document.querySelector("#object-name").focus();
    document.querySelector("#review-status").textContent = "Building name is required.";
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
  formData.append("address", document.querySelector("#building-address").value.trim());
  formData.append("latitude", document.querySelector("#building-latitude").value.trim());
  formData.append("longitude", document.querySelector("#building-longitude").value.trim());
  formData.append("fields_json", JSON.stringify(fields));
  const acceptButton = document.querySelector("#accept-building");
  acceptButton.disabled = true;
  document.querySelector("#review-status").textContent = "Saving file and building data…";
  try {
    const response = await fetch("/api/buildings", { method: "POST", body: formData });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || "Could not save this building.");
    state.processedCount += 1;
    state.files = [{
      filename: result.file_name,
      kind: state.currentExtraction?.kind || file.name.split(".").pop().toUpperCase(),
      details: "Saved in database",
      content: state.currentExtraction?.preview || "",
    }, ...state.files].slice(0, 12);
    renderFiles();
    await Promise.all([loadBuildings(), loadCategories()]);
    showToast(`${objectName} saved to the city database.`);
    finishCurrentImport();
  } catch (error) {
    document.querySelector("#review-status").textContent = error.message || "Save failed.";
    acceptButton.disabled = false;
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
  document.querySelector("#building-count").textContent =
    `${state.buildings.length} saved ${state.buildings.length === 1 ? "building" : "buildings"}`;
  if (!state.buildings.length) {
    list.innerHTML = '<div class="map-empty">Accepted building records will appear here.</div>';
  } else {
    list.replaceChildren(...state.buildings.map((building) => {
      const card = document.createElement("div");
      card.className = "building-record-card";
      const button = document.createElement("button");
      button.className = "building-record";
      button.type = "button";
      const name = document.createElement("strong");
      name.textContent = building.object_name;
      const details = document.createElement("span");
      const heating = building.fields["Heating system"];
      details.textContent = [
        building.address || "No address",
        heating && `Heating: ${heating}`,
        building.latitude === null && "No map location",
      ].filter(Boolean).join(" · ");
      button.append(name, details);
      button.addEventListener("click", () => {
        if (state.map && building.latitude !== null && building.longitude !== null) {
          state.map.flyTo({ center: [building.longitude, building.latitude], zoom: 17, pitch: 60 });
        }
      });
      const fileLink = document.createElement("a");
      fileLink.className = "building-file-link";
      fileLink.href = `/api/buildings/${building.id}/file`;
      fileLink.target = "_blank";
      fileLink.rel = "noreferrer";
      fileLink.textContent = `Open ${building.file_name}`;
      card.append(button, fileLink);
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
    element.title = building.object_name;
    const popupContent = document.createElement("div");
    popupContent.className = "map-popup";
    const popupName = document.createElement("strong");
    popupName.textContent = building.object_name;
    const popupAddress = document.createElement("span");
    popupAddress.textContent = building.address || "Building";
    popupContent.append(popupName, popupAddress);
    const marker = new maplibregl.Marker({ element })
      .setLngLat([building.longitude, building.latitude])
      .setPopup(new maplibregl.Popup({ offset: 12 }).setDOMContent(popupContent))
      .addTo(state.map);
    state.mapMarkers.push(marker);
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
    document.querySelector("#building-latitude").value = event.lngLat.lat.toFixed(6);
    document.querySelector("#building-longitude").value = event.lngLat.lng.toFixed(6);
    document.querySelector("#review-status").textContent = "Map location selected.";
    state.pickingLocation = false;
    state.map.getCanvas().style.cursor = "";
    document.querySelector("#review-panel").scrollIntoView({ behavior: "smooth", block: "start" });
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

fileInput.addEventListener("change", () => queueFiles([...fileInput.files]));
folderInput.addEventListener("change", () => queueFiles([...folderInput.files]));
document.querySelector("#browse-files").addEventListener("click", () => fileInput.click());
document.querySelector("#browse-folder").addEventListener("click", () => folderInput.click());
document.querySelector("#accept-building").addEventListener("click", acceptBuilding);
document.querySelector("#skip-file").addEventListener("click", skipCurrentImport);
document.querySelector("#add-field").addEventListener("click", () => {
  const row = createFieldRow();
  document.querySelector("#review-fields").append(row);
  row.querySelector(".category-select").focus();
});
document.querySelector("#pick-location").addEventListener("click", () => {
  if (!state.currentImport) return;
  state.pickingLocation = true;
  document.querySelector("#review-status").textContent = "Click the map to set this building's location.";
  if (state.map) {
    state.map.getCanvas().style.cursor = "crosshair";
    document.querySelector("#city-map").scrollIntoView({ behavior: "smooth", block: "start" });
  }
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

const now = new Date();
document.querySelector("#current-date").textContent = new Intl.DateTimeFormat(undefined, {
  weekday: "short", month: "short", day: "numeric", year: "numeric",
}).format(now);

fetch("/api/health")
  .then((response) => {
    if (!response.ok) throw new Error("Backend unavailable");
    return response.json();
  })
  .then(() => { document.querySelector("#backend-label").textContent = "Backend connected"; })
  .catch(() => {
    document.querySelector("#backend-label").textContent = "Backend offline";
    document.querySelector(".status-dot").classList.add("offline");
  });

loadModels();
loadCategories();
loadBuildings();
initializeCityMap();
