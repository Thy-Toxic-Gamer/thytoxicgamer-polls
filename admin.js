const config = window.TOXIC_POLL_CONFIG;

const pollStyles = Object.freeze({
  versus: { code: "VS", label: "This or That", description: "A direct two-choice showdown.", options: ["Option A", "Option B"], min: 2, max: 2, editable: true },
  yes_no: { code: "Y/N", label: "Yes or No", description: "A fast decision with two fixed answers.", options: ["Yes", "No"], min: 2, max: 2, editable: false },
  yes_no_maybe: { code: "YN?", label: "Yes / No / Maybe", description: "Adds a middle option for undecided viewers.", options: ["Yes", "No", "Maybe"], min: 3, max: 3, editable: false },
  multiple: { code: "3-6", label: "Multiple Choice", description: "Create three to six custom answers.", options: ["Choice 1", "Choice 2", "Choice 3"], min: 3, max: 6, editable: true },
  rating: { code: "1-5", label: "Rating Scale", description: "Let viewers score something from one to five.", options: ["1", "2", "3", "4", "5"], min: 5, max: 5, editable: false },
  agreement: { code: "A-D", label: "Agreement Scale", description: "Measure how strongly viewers agree.", options: ["Strongly disagree", "Disagree", "Neutral", "Agree", "Strongly agree"], min: 5, max: 5, editable: false },
  priority: { code: "P1", label: "Priority Vote", description: "Choose how urgent or important something is.", options: ["Low", "Medium", "High", "Critical"], min: 4, max: 4, editable: false },
  reaction: { code: "RXN", label: "Reaction Vote", description: "Capture the community's overall reaction.", options: ["Love it", "Like it", "Neutral", "Not for me"], min: 4, max: 4, editable: false }
});

const elements = {
  pill: document.querySelector("#admin-pill"), pillText: document.querySelector("#admin-pill-text"),
  authorizing: document.querySelector("#authorizing-view"), denied: document.querySelector("#denied-view"),
  deniedHeading: document.querySelector("#denied-heading"), deniedMessage: document.querySelector("#denied-message"),
  creator: document.querySelector("#creator-view"), demoNotice: document.querySelector("#demo-notice"),
  currentPoll: document.querySelector("#current-poll"), currentPollList: document.querySelector("#current-poll-list"),
  form: document.querySelector("#creator-form"), styleGrid: document.querySelector("#style-grid"),
  question: document.querySelector("#question-input"), questionCount: document.querySelector("#question-count"),
  regularOptionSection: document.querySelector("#regular-option-section"), optionEditor: document.querySelector("#option-editor"),
  optionHelp: document.querySelector("#option-help"), addOption: document.querySelector("#add-option-button"),
  durationOptions: document.querySelector("#duration-options"), previewStyle: document.querySelector("#preview-style"),
  previewDuration: document.querySelector("#preview-duration"), previewQuestion: document.querySelector("#preview-question"),
  previewOptions: document.querySelector("#preview-options"), formStatus: document.querySelector("#form-status"),
  openPoll: document.querySelector("#open-poll-button"), success: document.querySelector("#success-view"),
  successQuestion: document.querySelector("#success-question"), viewPollLink: document.querySelector("#view-poll-link"),
  copyLink: document.querySelector("#copy-link-button"), createAnother: document.querySelector("#create-another-button")
};

const state = {
  style: "multiple", options: [...pollStyles.multiple.options],
  sessionToken: "", adminName: "", currentPolls: [], countdown: null, submitting: false
};

function setPill(status, text) { elements.pill.dataset.state = status; elements.pillText.textContent = text; }
function showDenied(heading, message) { elements.authorizing.hidden = elements.creator.hidden = true; elements.denied.hidden = false; elements.deniedHeading.textContent = heading; elements.deniedMessage.textContent = message; setPill("error", "Access denied"); }
function apiBase() { return String(config.apiBaseUrl || "").replace(/\/$/, ""); }

async function apiRequest(path, options = {}, includeSession = true) {
  if (!apiBase()) throw new Error("The Poll API has not been connected yet.");
  const response = await fetch(`${apiBase()}${path}`, { ...options, headers: { "Content-Type": "application/json", ...(includeSession && state.sessionToken ? { Authorization: `Bearer ${state.sessionToken}` } : {}), ...(options.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(body.message || "The Poll Creator request failed."); error.status = response.status; error.code = body.error; throw error; }
  return body;
}

function removeAccessTokenFromAddress() { const url = new URL(window.location.href); url.searchParams.delete("token"); window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`); }

async function authorize() {
  if (config.demoMode) { state.adminName = "Demo Moderator"; elements.demoNotice.hidden = false; return finishAuthorization(); }
  if (!apiBase()) return showDenied("The protected creator is not connected yet", "The website is ready, but the Poll API must be published before private creator links can work.");
  const params = new URLSearchParams(window.location.search);
  const accessToken = params.get("token");
  removeAccessTokenFromAddress();
  try {
    if (accessToken) {
      const response = await apiRequest("/api/admin/sessions/exchange", { method: "POST", body: JSON.stringify({ accessToken }) }, false);
      state.sessionToken = response.sessionToken; state.adminName = response.adminName; sessionStorage.setItem("toxicPollAdminSession", state.sessionToken);
    } else {
      state.sessionToken = sessionStorage.getItem("toxicPollAdminSession") || "";
      if (!state.sessionToken) throw new Error("No temporary creator session was found.");
      const response = await apiRequest("/api/admin/session"); state.adminName = response.adminName;
    }
    finishAuthorization();
  } catch (error) { sessionStorage.removeItem("toxicPollAdminSession"); showDenied("This creator link is missing, expired, or already used", "Use !pollpanel in Twitch chat to request a fresh private link. Each link can be exchanged only once."); }
}

function finishAuthorization() { elements.authorizing.hidden = elements.denied.hidden = true; elements.creator.hidden = false; setPill("live", state.adminName || "Authorized"); renderStyleGrid(); applyStyle("multiple"); loadCurrentPoll(); }

function renderStyleGrid() {
  elements.styleGrid.replaceChildren();
  Object.entries(pollStyles).forEach(([key, style]) => {
    const button = document.createElement("button");
    button.type = "button"; button.className = "style-option"; button.setAttribute("role", "radio");
    button.setAttribute("aria-checked", String(key === state.style)); button.dataset.style = key;
    button.innerHTML = `<span class="style-code">${style.code}</span><strong>${style.label}</strong><small>${style.description}</small>`;
    button.addEventListener("click", () => applyStyle(key));
    elements.styleGrid.append(button);
  });
}

function applyStyle(styleKey) {
  state.style = styleKey; state.options = [...pollStyles[styleKey].options];
  elements.styleGrid.querySelectorAll(".style-option").forEach((button) => button.setAttribute("aria-checked", String(button.dataset.style === styleKey)));
  renderOptions(); updatePreview();
}

function renderOptions() {
  const style = pollStyles[state.style];
  elements.optionEditor.replaceChildren();
  elements.addOption.hidden = !style.editable || style.max === style.min;
  elements.addOption.disabled = state.options.length >= style.max;
  elements.optionHelp.textContent = style.editable ? `Enter ${style.min}${style.max !== style.min ? ` to ${style.max}` : ""} unique choices.` : "This poll style uses preset answers.";
  state.options.forEach((value, index) => {
    const row = document.createElement("div"); row.className = "option-row";
    const number = document.createElement("span"); number.className = "option-index"; number.textContent = String(index + 1).padStart(2, "0");
    const input = document.createElement("input"); input.type = "text"; input.maxLength = 80; input.value = value; input.readOnly = !style.editable; input.setAttribute("aria-label", `Choice ${index + 1}`);
    input.addEventListener("input", () => { state.options[index] = input.value; updatePreview(); });
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "remove-option"; remove.textContent = "×"; remove.title = `Remove choice ${index + 1}`; remove.disabled = !style.editable || state.options.length <= style.min;
    remove.addEventListener("click", () => { state.options.splice(index, 1); renderOptions(); updatePreview(); });
    row.append(number, input, remove); elements.optionEditor.append(row);
  });
}

function updatePreview() {
  const style = pollStyles[state.style];
  const duration = Number(document.querySelector('input[name="duration"]:checked')?.value || 60);
  const durationLabel = duration < 60 ? `${duration} seconds` : `${duration / 60} ${duration === 60 ? "minute" : "minutes"}`;
  elements.previewStyle.textContent = style.label; elements.previewDuration.textContent = durationLabel;
  elements.previewQuestion.textContent = elements.question.value.trim() || "Your poll question will appear here.";
  elements.previewOptions.replaceChildren();
  state.options.slice(0, 12).forEach((option, index) => {
    const item = document.createElement("div"); item.className = "preview-option"; item.textContent = option.trim() || `Choice ${index + 1}`;
    elements.previewOptions.append(item);
  });
}

function validateForm() {
  const style = pollStyles[state.style];
  const question = elements.question.value.trim().replace(/\s+/g, " ");
  const options = state.options.map((option) => option.trim().replace(/\s+/g, " ")).filter(Boolean);
  if (question.length < 3) return { error: "Enter a poll question with at least 3 characters." };
  if (options.length < style.min || options.length > style.max) return { error: `This poll style requires ${style.min}${style.max !== style.min ? ` to ${style.max}` : ""} choices.` };
  const normalizedLabels = options.map((option) => String(typeof option === "string" ? option : option.label).toLowerCase());
  if (new Set(normalizedLabels).size !== options.length) return { error: "Every answer choice must be different." };
  return { question, options, pollStyle: state.style, durationSeconds: Number(document.querySelector('input[name="duration"]:checked').value), resultsMode: document.querySelector('input[name="resultsMode"]:checked').value };
}

async function openPoll(event) {
  event.preventDefault();
  if (state.submitting) return;
  const data = validateForm();
  if (data.error) return elements.formStatus.textContent = data.error;
  state.submitting = true; elements.formStatus.textContent = ""; elements.openPoll.disabled = true; elements.openPoll.textContent = "Opening poll...";
  try {
    let poll;
    if (config.demoMode) { poll = { id: "creator-demo", ...data, status: "active", closesAt: new Date(Date.now() + data.durationSeconds * 1000).toISOString() }; }
    else { const response = await apiRequest("/api/polls", { method: "POST", body: JSON.stringify({ ...data, createdBy: state.adminName }) }); poll = response.poll; }
    showSuccess(poll);
  } catch (error) { elements.formStatus.textContent = error.message || "The poll could not be opened. Please try again."; }
  finally { state.submitting = false; elements.openPoll.disabled = false; elements.openPoll.textContent = "Open Toxic Poll"; }
}

function showSuccess(poll) {
  elements.form.hidden = true; elements.success.hidden = false; elements.successQuestion.textContent = poll.question;
  elements.viewPollLink.href = config.demoMode ? `${config.siteUrl}?demo=1` : config.siteUrl;
  state.currentPolls = [...state.currentPolls.filter((item) => item.id !== poll.id), poll];
  showCurrentPolls(state.currentPolls); window.scrollTo({ top: elements.success.offsetTop - 18, behavior: "smooth" });
}

function showCurrentPolls(polls) {
  const activePolls = (polls || []).filter((poll) => poll.status === "active" && Date.now() < Date.parse(poll.closesAt));
  state.currentPolls = activePolls;
  if (!activePolls.length) return elements.currentPoll.hidden = true;
  elements.currentPoll.hidden = false; elements.currentPollList.replaceChildren(); clearInterval(state.countdown);
  activePolls.forEach((poll) => {
    const item = document.createElement("article"); item.className = "current-poll-item"; item.dataset.pollId = poll.id;
    item.innerHTML = `<div><span class="current-type">Community Poll</span><strong>${escapeHtml(poll.question)}</strong></div><div class="current-actions"><span class="current-timer" data-close-at="${poll.closesAt}">00:00</span><button class="secondary-button compact-button" data-action="close" type="button">Close now</button><button class="danger-button" data-action="cancel" type="button">Cancel</button></div>`;
    item.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => changeCurrentPoll(poll.id, button.dataset.action)));
    elements.currentPollList.append(item);
  });
  const update = () => {
    elements.currentPollList.querySelectorAll(".current-poll-item").forEach((item) => {
      const timer = item.querySelector(".current-timer"); const remaining = Math.max(0, Date.parse(timer.dataset.closeAt) - Date.now()); const seconds = Math.ceil(remaining / 1000);
      timer.textContent = Math.floor(seconds / 3600) ? `${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}` : `${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
      if (!remaining) item.remove();
    });
    if (!elements.currentPollList.children.length) elements.currentPoll.hidden = true;
  };
  update(); state.countdown = setInterval(update, 250);
}

async function loadCurrentPoll() {
  if (config.demoMode || !apiBase()) return;
  try { const response = await apiRequest("/api/polls/active", {}, false); state.currentPolls = response.polls; showCurrentPolls(response.polls); } catch (error) { if (error.status !== 404) console.warn(error); }
}

async function changeCurrentPoll(pollId, action) {
  if (config.demoMode) { state.currentPolls = state.currentPolls.filter((poll) => poll.id !== pollId); return showCurrentPolls(state.currentPolls); }
  try { await apiRequest(`/api/polls/${encodeURIComponent(pollId)}/${action === "cancel" ? "cancel" : "close"}`, { method: "POST" }); state.currentPolls = state.currentPolls.filter((poll) => poll.id !== pollId); showCurrentPolls(state.currentPolls); } catch (error) { elements.formStatus.textContent = error.message; }
}

function escapeHtml(value) { return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); }

elements.question.addEventListener("input", () => { elements.questionCount.textContent = String(elements.question.value.length); updatePreview(); });
elements.addOption.addEventListener("click", () => { const style = pollStyles[state.style]; if (state.options.length >= style.max) return; state.options.push(`Choice ${state.options.length + 1}`); renderOptions(); updatePreview(); });
document.querySelectorAll('input[name="duration"]').forEach((input) => input.addEventListener("change", updatePreview));
elements.form.addEventListener("submit", openPoll);
elements.copyLink.addEventListener("click", async () => { await navigator.clipboard.writeText(config.demoMode ? `${config.siteUrl}?demo=1` : config.siteUrl); elements.copyLink.textContent = "Copied"; setTimeout(() => (elements.copyLink.textContent = "Copy voting link"), 1500); });
elements.createAnother.addEventListener("click", () => { elements.success.hidden = true; elements.form.hidden = false; elements.question.value = ""; elements.questionCount.textContent = "0"; applyStyle("multiple"); updatePreview(); window.scrollTo({ top: elements.form.offsetTop - 18, behavior: "smooth" }); });

authorize();
