const config = window.TOXIC_POLL_CONFIG;

const MIN_CHOICES = 2;
const MAX_CHOICES = 10;

const elements = {
  pill: document.querySelector("#admin-pill"),
  pillText: document.querySelector("#admin-pill-text"),
  authorizing: document.querySelector("#authorizing-view"),
  denied: document.querySelector("#denied-view"),
  deniedHeading: document.querySelector("#denied-heading"),
  deniedMessage: document.querySelector("#denied-message"),
  creator: document.querySelector("#creator-view"),
  demoNotice: document.querySelector("#demo-notice"),
  currentPoll: document.querySelector("#current-poll"),
  currentPollList: document.querySelector("#current-poll-list"),
  form: document.querySelector("#creator-form"),
  question: document.querySelector("#question-input"),
  questionCount: document.querySelector("#question-count"),
  optionEditor: document.querySelector("#option-editor"),
  optionHelp: document.querySelector("#option-help"),
  addOption: document.querySelector("#add-option-button"),
  previewDuration: document.querySelector("#preview-duration"),
  previewQuestion: document.querySelector("#preview-question"),
  previewOptions: document.querySelector("#preview-options"),
  formStatus: document.querySelector("#form-status"),
  openPoll: document.querySelector("#open-poll-button"),
  success: document.querySelector("#success-view"),
  successQuestion: document.querySelector("#success-question"),
  viewPollLink: document.querySelector("#view-poll-link"),
  copyLink: document.querySelector("#copy-link-button"),
  createAnother: document.querySelector("#create-another-button"),
};

const state = {
  options: ["Choice 1", "Choice 2"],
  sessionToken: "",
  adminName: "",
  currentPolls: [],
  countdown: null,
  submitting: false,
};

function setPill(status, text) {
  elements.pill.dataset.state = status;
  elements.pillText.textContent = text;
}

function showDenied(heading, message) {
  elements.authorizing.hidden = true;
  elements.creator.hidden = true;
  elements.denied.hidden = false;
  elements.deniedHeading.textContent = heading;
  elements.deniedMessage.textContent = message;
  setPill("error", "Access denied");
}

function apiBase() {
  return String(config.apiBaseUrl || "").replace(/\/$/, "");
}

async function apiRequest(path, options = {}, includeSession = true) {
  if (!apiBase()) throw new Error("The Poll API has not been connected yet.");
  const response = await fetch(`${apiBase()}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(includeSession && state.sessionToken ? { Authorization: `Bearer ${state.sessionToken}` } : {}),
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.message || "The Poll Creator request failed.");
    error.status = response.status;
    error.code = body.error;
    throw error;
  }
  return body;
}

function removeAccessTokenFromAddress() {
  const url = new URL(window.location.href);
  url.searchParams.delete("token");
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
}

async function authorize() {
  if (config.demoMode) {
    state.adminName = "Demo Moderator";
    elements.demoNotice.hidden = false;
    finishAuthorization();
    return;
  }

  if (!apiBase()) {
    showDenied(
      "The protected creator is not connected yet",
      "The website is ready, but the Poll API must be published before private creator links can work."
    );
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const accessToken = params.get("token");
  removeAccessTokenFromAddress();

  try {
    if (accessToken) {
      const response = await apiRequest(
        "/api/admin/sessions/exchange",
        { method: "POST", body: JSON.stringify({ accessToken }) },
        false
      );
      state.sessionToken = response.sessionToken;
      state.adminName = response.adminName;
      sessionStorage.setItem("toxicPollAdminSession", state.sessionToken);
    } else {
      state.sessionToken = sessionStorage.getItem("toxicPollAdminSession") || "";
      if (!state.sessionToken) throw new Error("No temporary creator session was found.");
      const response = await apiRequest("/api/admin/session");
      state.adminName = response.adminName;
    }

    finishAuthorization();
  } catch (error) {
    sessionStorage.removeItem("toxicPollAdminSession");
    showDenied(
      "This creator link is missing, expired, or already used",
      "Use !pollpanel in Twitch chat to request a fresh private link. Each link can be exchanged only once."
    );
  }
}

function finishAuthorization() {
  elements.authorizing.hidden = true;
  elements.denied.hidden = true;
  elements.creator.hidden = false;
  setPill("live", state.adminName || "Authorized");
  renderOptions();
  updatePreview();
  loadCurrentPoll();
}

function renderOptions() {
  elements.optionEditor.replaceChildren();
  elements.addOption.disabled = state.options.length >= MAX_CHOICES;
  elements.optionHelp.textContent = `Enter ${MIN_CHOICES} to ${MAX_CHOICES} unique answers.`;

  state.options.forEach((value, index) => {
    const row = document.createElement("div");
    row.className = "option-row";

    const number = document.createElement("span");
    number.className = "option-index";
    number.textContent = String(index + 1).padStart(2, "0");

    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = 80;
    input.value = value;
    input.setAttribute("aria-label", `Answer ${index + 1}`);
    input.addEventListener("input", () => {
      state.options[index] = input.value;
      updatePreview();
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-option";
    remove.textContent = "×";
    remove.title = `Remove answer ${index + 1}`;
    remove.disabled = state.options.length <= MIN_CHOICES;
    remove.addEventListener("click", () => {
      state.options.splice(index, 1);
      renderOptions();
      updatePreview();
    });

    row.append(number, input, remove);
    elements.optionEditor.append(row);
  });
}

function updatePreview() {
  const duration = Number(document.querySelector('input[name="duration"]:checked')?.value || 60);
  const durationLabel = duration < 60
    ? `${duration} seconds`
    : `${duration / 60} ${duration === 60 ? "minute" : "minutes"}`;

  elements.previewDuration.textContent = durationLabel;
  elements.previewQuestion.textContent = elements.question.value.trim() || "Your poll question will appear here.";
  elements.previewOptions.replaceChildren();

  state.options.forEach((option, index) => {
    const item = document.createElement("div");
    item.className = "preview-option";
    item.textContent = option.trim() || `Answer ${index + 1}`;
    elements.previewOptions.append(item);
  });
}

function validateForm() {
  const question = elements.question.value.trim().replace(/\s+/g, " ");
  const options = state.options.map((option) => option.trim().replace(/\s+/g, " ")).filter(Boolean);

  if (question.length < 3) return { error: "Enter a poll question with at least 3 characters." };
  if (options.length < MIN_CHOICES || options.length > MAX_CHOICES) {
    return { error: `Enter between ${MIN_CHOICES} and ${MAX_CHOICES} answers.` };
  }

  const normalizedLabels = options.map((option) => option.toLowerCase());
  if (new Set(normalizedLabels).size !== options.length) {
    return { error: "Every answer must be different." };
  }

  return {
    question,
    options,
    pollStyle: "multiple",
    durationSeconds: Number(document.querySelector('input[name="duration"]:checked').value),
    resultsMode: document.querySelector('input[name="resultsMode"]:checked').value,
  };
}

async function openPoll(event) {
  event.preventDefault();
  if (state.submitting) return;

  if (state.currentPolls.length >= 3) {
    elements.formStatus.textContent = "Three polls are already active. Close or cancel one before opening another.";
    return;
  }

  const data = validateForm();
  if (data.error) {
    elements.formStatus.textContent = data.error;
    return;
  }

  state.submitting = true;
  elements.formStatus.textContent = "";
  elements.openPoll.disabled = true;
  elements.openPoll.textContent = "Opening poll...";

  try {
    let poll;
    if (config.demoMode) {
      poll = {
        id: `creator-demo-${Date.now()}`,
        ...data,
        status: "active",
        closesAt: new Date(Date.now() + data.durationSeconds * 1000).toISOString(),
      };
    } else {
      const response = await apiRequest("/api/polls", {
        method: "POST",
        body: JSON.stringify({ ...data, createdBy: state.adminName }),
      });
      poll = response.poll;
    }

    showSuccess(poll);
  } catch (error) {
    elements.formStatus.textContent = error.message || "The poll could not be opened. Please try again.";
  } finally {
    state.submitting = false;
    elements.openPoll.disabled = false;
    elements.openPoll.textContent = "Open Toxic Poll";
  }
}

function showSuccess(poll) {
  elements.form.hidden = true;
  elements.success.hidden = false;
  elements.successQuestion.textContent = poll.question;
  const publicUrl = config.demoMode ? `${config.siteUrl}?demo=1` : config.siteUrl;
  elements.viewPollLink.href = publicUrl;
  state.currentPolls = [...state.currentPolls.filter((item) => item.id !== poll.id), poll];
  showCurrentPolls(state.currentPolls);
  window.scrollTo({ top: elements.success.offsetTop - 18, behavior: "smooth" });
}

function showCurrentPolls(polls) {
  const activePolls = (polls || []).filter(
    (poll) => poll.status === "active" && Date.now() < Date.parse(poll.closesAt)
  );
  state.currentPolls = activePolls;

  if (!activePolls.length) {
    elements.currentPoll.hidden = true;
    return;
  }

  elements.currentPoll.hidden = false;
  elements.currentPollList.replaceChildren();
  clearInterval(state.countdown);

  activePolls.forEach((poll, index) => {
    const item = document.createElement("article");
    item.className = "current-poll-item";
    item.dataset.pollId = poll.id;
    item.innerHTML = `
      <div>
        <span class="current-type">Poll ${index + 1}</span>
        <strong>${escapeHtml(poll.question)}</strong>
      </div>
      <div class="current-actions">
        <span class="current-timer" data-close-at="${poll.closesAt}">00:00</span>
        <button class="secondary-button compact-button" data-action="close" type="button">Close now</button>
        <button class="danger-button" data-action="cancel" type="button">Cancel</button>
      </div>
    `;

    item.querySelectorAll("[data-action]").forEach((button) => {
      button.addEventListener("click", () => changeCurrentPoll(poll.id, button.dataset.action));
    });
    elements.currentPollList.append(item);
  });

  const update = () => {
    elements.currentPollList.querySelectorAll(".current-poll-item").forEach((item) => {
      const timer = item.querySelector(".current-timer");
      const remaining = Math.max(0, Date.parse(timer.dataset.closeAt) - Date.now());
      const seconds = Math.ceil(remaining / 1000);
      const minutes = Math.floor(seconds / 60);
      const remainingSeconds = seconds % 60;
      timer.textContent = `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
      if (!remaining) item.remove();
    });
    if (!elements.currentPollList.children.length) elements.currentPoll.hidden = true;
  };

  update();
  state.countdown = setInterval(update, 250);
}

async function loadCurrentPoll() {
  if (config.demoMode || !apiBase()) return;
  try {
    const response = await apiRequest("/api/polls/active", {}, false);
    state.currentPolls = response.polls;
    showCurrentPolls(response.polls);
  } catch (error) {
    if (error.status !== 404) console.warn(error);
  }
}

async function changeCurrentPoll(pollId, action) {
  const verb = action === "cancel" ? "cancel" : "close";
  if (config.demoMode) {
    state.currentPolls = state.currentPolls.filter((poll) => poll.id !== pollId);
    showCurrentPolls(state.currentPolls);
    return;
  }

  try {
    await apiRequest(`/api/polls/${encodeURIComponent(pollId)}/${verb}`, { method: "POST" });
    state.currentPolls = state.currentPolls.filter((poll) => poll.id !== pollId);
    showCurrentPolls(state.currentPolls);
  } catch (error) {
    elements.formStatus.textContent = error.message;
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function resetForm() {
  elements.question.value = "";
  elements.questionCount.textContent = "0";
  state.options = ["Choice 1", "Choice 2"];
  const defaultDuration = document.querySelector('input[name="duration"][value="60"]');
  if (defaultDuration) defaultDuration.checked = true;
  renderOptions();
  updatePreview();
}

elements.question.addEventListener("input", () => {
  elements.questionCount.textContent = String(elements.question.value.length);
  updatePreview();
});

elements.addOption.addEventListener("click", () => {
  if (state.options.length >= MAX_CHOICES) return;
  state.options.push(`Choice ${state.options.length + 1}`);
  renderOptions();
  updatePreview();
});

document.querySelectorAll('input[name="duration"]').forEach((input) => input.addEventListener("change", updatePreview));
elements.form.addEventListener("submit", openPoll);
elements.copyLink.addEventListener("click", async () => {
  const publicUrl = config.demoMode ? `${config.siteUrl}?demo=1` : config.siteUrl;
  await navigator.clipboard.writeText(publicUrl);
  elements.copyLink.textContent = "Copied";
  setTimeout(() => (elements.copyLink.textContent = "Copy voting link"), 1500);
});
elements.createAnother.addEventListener("click", () => {
  elements.success.hidden = true;
  elements.form.hidden = false;
  resetForm();
  window.scrollTo({ top: elements.form.offsetTop - 18, behavior: "smooth" });
});

authorize();
