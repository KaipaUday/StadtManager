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

const state = { files: [], processedCount: 0, messages: [], toastTimer: null, modelsReady: false, modelRequest: 0 };
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

async function uploadFiles(files) {
  if (!files.length) return;
  const allowedExtension = /\.(csv|json|md|pdf|txt)$/i;
  const supportedFiles = files.filter((file) => allowedExtension.test(file.name));
  const skippedCount = files.length - supportedFiles.length;
  let failedCount = 0;

  if (!supportedFiles.length) {
    showToast("No supported files found. Choose CSV, JSON, PDF, Markdown, or text files.");
    fileInput.value = "";
    folderInput.value = "";
    return;
  }

  if (skippedCount) showToast(`Skipping ${skippedCount} unsupported file${skippedCount === 1 ? "" : "s"}.`);
  for (const [index, file] of supportedFiles.entries()) {
    showToast(`Processing file ${index + 1} of ${supportedFiles.length}: ${file.name}`);
    const formData = new FormData();
    formData.append("files", file);
    try {
      const response = await fetch("/api/process-files", { method: "POST", body: formData });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || "Could not process this file.");
      const processedFile = result.files[0];
      if (!processedFile || processedFile.error) failedCount += 1;
      else state.processedCount += 1;
      state.files = [processedFile || { filename: file.name, error: "No result returned." }, ...state.files].slice(0, 12);
      renderFiles();
    } catch (error) {
      failedCount += 1;
      state.files = [{ filename: file.name, error: error.message || "Could not process this file." }, ...state.files].slice(0, 12);
      renderFiles();
    }
  }
  fileInput.value = "";
  folderInput.value = "";
  const totalFailures = failedCount + skippedCount;
  showToast(totalFailures
    ? `Processed ${supportedFiles.length - failedCount} of ${files.length} files; ${totalFailures} skipped or failed.`
    : `All ${supportedFiles.length} files processed successfully.`);
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
    state.modelsReady = true;
    sendButton.disabled = false;
  } catch (error) {
    if (requestId !== state.modelRequest) return;
    keyStatus.classList.add("invalid");
    keyStatus.textContent = error.message || "Could not verify the API key.";
  }
}

fileInput.addEventListener("change", () => uploadFiles([...fileInput.files]));
folderInput.addEventListener("change", () => uploadFiles([...folderInput.files]));
document.querySelector("#browse-files").addEventListener("click", () => fileInput.click());
document.querySelector("#browse-folder").addEventListener("click", () => folderInput.click());
dropzone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropzone.classList.add("drag-over");
});
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("drag-over"));
dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropzone.classList.remove("drag-over");
  uploadFiles([...event.dataTransfer.files]);
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
