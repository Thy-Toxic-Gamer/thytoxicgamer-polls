const config = window.TOXIC_POLL_CONFIG;
const MIN_CHOICES = 2;
const MAX_CHOICES = 10;
const RESULT_MODES = [
  ["live", "Live", "Everyone sees totals immediately."],
  ["after_vote", "After voting", "Results unlock after a viewer votes."],
  ["after_close", "After closing", "Percentages remain hidden until the poll closes."],
];

const elements = {
  pill: document.querySelector("#admin-pill"), pillText: document.querySelector("#admin-pill-text"),
  authorizing: document.querySelector("#authorizing-view"), denied: document.querySelector("#denied-view"),
  deniedHeading: document.querySelector("#denied-heading"), deniedMessage: document.querySelector("#denied-message"),
  ownerSignIn: document.querySelector("#owner-sign-in"), creator: document.querySelector("#creator-view"),
  demoNotice: document.querySelector("#demo-notice"), sessionRole: document.querySelector("#session-role"),
  sessionName: document.querySelector("#session-name"), sessionExpiry: document.querySelector("#session-expiry"),
  signOut: document.querySelector("#sign-out-button"), currentPoll: document.querySelector("#current-poll"),
  twitchConnectionCard: document.querySelector("#twitch-connection-card"),
  twitchConnectionMessage: document.querySelector("#twitch-connection-message"),
  twitchConnectionBadge: document.querySelector("#twitch-connection-badge"),
  connectTwitch: document.querySelector("#connect-twitch-button"),
  currentPollList: document.querySelector("#current-poll-list"), pollHistory: document.querySelector("#poll-history"),
  historyList: document.querySelector("#history-list"), form: document.querySelector("#creator-form"),
  question: document.querySelector("#question-input"), questionCount: document.querySelector("#question-count"),
  optionEditor: document.querySelector("#option-editor"), addOption: document.querySelector("#add-option-button"),
  previewDuration: document.querySelector("#preview-duration"), previewQuestion: document.querySelector("#preview-question"),
  previewOptions: document.querySelector("#preview-options"), formStatus: document.querySelector("#form-status"),
  testPoll: document.querySelector("#test-poll-button"), openPoll: document.querySelector("#open-poll-button"),
  success: document.querySelector("#success-view"), successQuestion: document.querySelector("#success-question"),
  announcementResult: document.querySelector("#announcement-result"),
  viewPollLink: document.querySelector("#view-poll-link"), copyLink: document.querySelector("#copy-link-button"),
  createAnother: document.querySelector("#create-another-button"), confirmDialog: document.querySelector("#confirm-dialog"),
  confirmTitle: document.querySelector("#confirm-title"), confirmMessage: document.querySelector("#confirm-message"),
  confirmAction: document.querySelector("#confirm-action-button"), editDialog: document.querySelector("#edit-dialog"),
  editForm: document.querySelector("#edit-form"), editQuestion: document.querySelector("#edit-question"),
  editOptionEditor: document.querySelector("#edit-option-editor"), editAddOption: document.querySelector("#edit-add-option"),
  editResultsModes: document.querySelector("#edit-results-modes"), editResetTimer: document.querySelector("#edit-reset-timer"),
  editDuration: document.querySelector("#edit-duration"), editStatus: document.querySelector("#edit-status"),
  savePoll: document.querySelector("#save-poll-button"), testDialog: document.querySelector("#test-dialog"),
  testQuestion: document.querySelector("#test-question"), testOptions: document.querySelector("#test-options"),
  testTotal: document.querySelector("#test-total"), testTimer: document.querySelector("#test-timer"),
  resetTest: document.querySelector("#reset-test-button"),
};

const state = {
  options: ["Choice 1", "Choice 2"], session: null, adminName: "", role: "",
  currentPolls: [], recentPolls: [], countdown: null, submitting: false,
  editingPoll: null, editOptions: [], testData: null, testSelected: "",
  testEndsAt: 0, testCountdown: null, twitchStatus: null,
};

const supabaseClient = !config.demoMode && window.supabase?.createClient
  ? window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {
      auth: { persistSession: true, detectSessionInUrl: true, autoRefreshToken: true },
    })
  : null;

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
  setPill("error", "Owner sign-in required");
}

function apiBase() {
  return String(config.apiBaseUrl || "").replace(/\/$/, "");
}

async function apiRequest(path, options = {}, includeSession = true) {
  if (!apiBase()) throw new Error("The Poll API has not been connected yet.");
  const token = includeSession ? state.session?.access_token : "";
  const response = await fetch(`${apiBase()}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      apikey: config.supabasePublishableKey,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.message || "The Poll Center request failed.");
    error.status = response.status;
    error.code = body.error;
    throw error;
  }
  return body;
}

async function authorize() {
  if (config.demoMode) {
    state.adminName = "Demo Owner";
    state.role = "owner";
    elements.demoNotice.hidden = false;
    finishAuthorization();
    return;
  }
  if (!supabaseClient || !apiBase()) {
    showDenied("Poll Center is not connected", "The Supabase connection is incomplete.");
    return;
  }
  const params = new URLSearchParams(window.location.search);
  const oauthError = params.get("error_description") || params.get("error");
  if (oauthError) {
    window.history.replaceState({}, document.title, window.location.pathname);
    showDenied("Twitch sign-in did not complete", oauthError.replace(/\+/g, " "));
    return;
  }
  try {
    const { data, error } = await supabaseClient.auth.getSession();
    if (error) throw error;
    state.session = data.session;
    if (!state.session) {
      showDenied("Owner or moderator access required", "Sign in with the Twitch account authorized for Poll Center controls.");
      return;
    }
    const response = await apiRequest("/api/admin/session");
    state.adminName = response.adminName;
    state.role = response.role;
    finishAuthorization();
    const twitchChatResult = params.get("twitch_chat");
    if (twitchChatResult) {
      const message = params.get("twitch_message");
      elements.formStatus.textContent = twitchChatResult === "connected"
        ? "ThyToxicBot is connected. Supabase can now announce active polls directly in Twitch chat."
        : message || "ThyToxicBot could not be connected.";
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  } catch (error) {
    if (error.status === 403) {
      showDenied("This Twitch account is not authorized", "Sign out and use the ThyToxicGamer Owner account, or ask the Owner to add this account as Poll Center staff.");
      return;
    }
    showDenied("Your Twitch session needs to be refreshed", "Sign in again to open Poll Center controls.");
  }
}

async function signInWithTwitch(event) {
  event.preventDefault();
  if (!supabaseClient) return;
  const redirectTo = `${window.location.origin}${window.location.pathname}`;
  const { error } = await supabaseClient.auth.signInWithOAuth({ provider: "twitch", options: { redirectTo } });
  if (error) showDenied("Twitch sign-in could not start", error.message);
}

async function signOut() {
  if (supabaseClient) await supabaseClient.auth.signOut();
  state.session = null;
  window.location.replace(window.location.pathname);
}

function finishAuthorization() {
  elements.authorizing.hidden = true;
  elements.denied.hidden = true;
  elements.creator.hidden = false;
  elements.sessionRole.textContent = state.role === "owner" ? "Twitch-verified Owner" : "Authorized moderator";
  elements.sessionName.textContent = state.adminName || "Poll Center Staff";
  elements.sessionExpiry.textContent = config.demoMode ? "Browser-only demo session" : "Secure Supabase session · remains active until you sign out";
  setPill("live", state.role === "owner" ? "Owner online" : "Staff online");
  renderOptions();
  updatePreview();
  loadTwitchStatus();
  loadAdminPolls();
}

async function loadTwitchStatus() {
  if (config.demoMode) {
    elements.twitchConnectionBadge.dataset.state = "connected";
    elements.twitchConnectionBadge.textContent = "Demo ready";
    elements.twitchConnectionMessage.textContent = "Demo mode never contacts Twitch.";
    return;
  }
  try {
    const status = await apiRequest("/api/admin/twitch/status");
    state.twitchStatus = status;
    elements.connectTwitch.hidden = state.role !== "owner";
    if (status.connected) {
      elements.twitchConnectionBadge.dataset.state = status.lastError ? "error" : "connected";
      elements.twitchConnectionBadge.textContent = status.lastError ? "Needs attention" : "Connected";
      elements.twitchConnectionMessage.textContent = status.lastError
        ? `@${status.senderLogin} is connected, but the last announcement failed: ${status.lastError}`
        : `Supabase will post poll links as @${status.senderLogin} in @${status.broadcasterLogin}'s chat.`;
      elements.connectTwitch.textContent = "Reconnect ThyToxicBot";
    } else {
      elements.twitchConnectionBadge.dataset.state = "error";
      elements.twitchConnectionBadge.textContent = "Not connected";
      elements.twitchConnectionMessage.textContent = status.configured
        ? "Connect @ThyToxicBot once so Supabase can announce polls directly in Twitch chat."
        : "The Twitch application credentials must be added to Supabase before connecting the bot.";
      elements.connectTwitch.textContent = "Connect ThyToxicBot";
    }
  } catch (error) {
    elements.twitchConnectionBadge.dataset.state = "error";
    elements.twitchConnectionBadge.textContent = "Setup required";
    elements.twitchConnectionMessage.textContent = error.message || "The Twitch connection status could not be loaded.";
    elements.connectTwitch.hidden = state.role !== "owner";
  }
}

async function connectTwitchBot() {
  if (state.role !== "owner" || config.demoMode) return;
  elements.connectTwitch.disabled = true;
  elements.connectTwitch.textContent = "Opening Twitch...";
  try {
    const response = await apiRequest("/api/admin/twitch/connect", { method: "POST" });
    window.location.assign(response.authorizationUrl);
  } catch (error) {
    elements.twitchConnectionBadge.dataset.state = "error";
    elements.twitchConnectionBadge.textContent = "Setup required";
    elements.twitchConnectionMessage.textContent = error.message;
    elements.connectTwitch.disabled = false;
    elements.connectTwitch.textContent = "Connect ThyToxicBot";
  }
}

async function announcePoll(poll, button) {
  if (button) {
    button.disabled = true;
    button.textContent = "Sending...";
  }
  try {
    const response = await apiRequest(`/api/polls/${encodeURIComponent(poll.id)}/announce`, { method: "POST" });
    const message = response.announcement?.message || "The voting link was sent to Twitch chat.";
    elements.formStatus.textContent = message;
    await Promise.all([loadAdminPolls(), loadTwitchStatus()]);
  } catch (error) {
    elements.formStatus.textContent = error.message || "The voting link could not be sent to Twitch chat.";
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Resend to Twitch";
    }
  }
}

function renderOptions() {
  elements.optionEditor.replaceChildren();
  elements.addOption.disabled = state.options.length >= MAX_CHOICES;
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
    input.addEventListener("input", () => { state.options[index] = input.value; updatePreview(); });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-option";
    remove.textContent = "×";
    remove.title = `Remove answer ${index + 1}`;
    remove.disabled = state.options.length <= MIN_CHOICES;
    remove.addEventListener("click", () => { state.options.splice(index, 1); renderOptions(); updatePreview(); });
    row.append(number, input, remove);
    elements.optionEditor.append(row);
  });
}

function selectedDuration() {
  return Number(document.querySelector('input[name="duration"]:checked')?.value || 60);
}

function durationLabel(duration) {
  return duration < 60 ? `${duration} seconds` : `${duration / 60} ${duration === 60 ? "minute" : "minutes"}`;
}

function updatePreview() {
  elements.previewDuration.textContent = durationLabel(selectedDuration());
  elements.previewQuestion.textContent = elements.question.value.trim() || "Your poll question will appear here.";
  elements.previewOptions.replaceChildren();
  state.options.forEach((option, index) => {
    const item = document.createElement("div");
    item.className = "preview-option";
    item.textContent = option.trim() || `Answer ${index + 1}`;
    elements.previewOptions.append(item);
  });
}

function validateValues(questionValue = elements.question.value, optionValues = state.options) {
  const question = questionValue.trim().replace(/\s+/g, " ");
  const options = optionValues.map((option) => String(option).trim().replace(/\s+/g, " ")).filter(Boolean);
  if (question.length < 3) return { error: "Enter a poll question with at least 3 characters." };
  if (options.length < MIN_CHOICES || options.length > MAX_CHOICES) return { error: `Enter between ${MIN_CHOICES} and ${MAX_CHOICES} answers.` };
  if (new Set(options.map((option) => option.toLowerCase())).size !== options.length) return { error: "Every answer must be different." };
  return { question, options };
}

function validateForm() {
  const values = validateValues();
  if (values.error) return values;
  return {
    ...values, pollStyle: "multiple", durationSeconds: selectedDuration(),
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
  if (data.error) { elements.formStatus.textContent = data.error; return; }
  state.submitting = true;
  elements.formStatus.textContent = "";
  elements.openPoll.disabled = true;
  elements.openPoll.textContent = "Opening poll...";
  try {
    const response = config.demoMode
      ? {
          poll: { id: `demo-${Date.now()}`, ...data, status: "active", closesAt: new Date(Date.now() + data.durationSeconds * 1000).toISOString(), options: data.options.map((label, index) => ({ id: `demo-${index}`, label, votes: 0 })) },
          announcement: { status: "demo", message: "Browser-only test; nothing was sent to Twitch." },
        }
      : await apiRequest("/api/polls", { method: "POST", body: JSON.stringify(data) });
    showSuccess(response.poll, response.announcement);
    await loadAdminPolls();
  } catch (error) {
    elements.formStatus.textContent = error.message || "The poll could not be opened.";
  } finally {
    state.submitting = false;
    elements.openPoll.disabled = false;
    elements.openPoll.textContent = "Open 𝐓☣︎𝐱𝐢c Poll";
  }
}

function showSuccess(poll, announcement) {
  elements.form.hidden = true;
  elements.success.hidden = false;
  elements.successQuestion.textContent = poll.question;
  const publicUrl = new URL(config.siteUrl);
  if (config.demoMode) publicUrl.searchParams.set("demo", "1");
  else publicUrl.searchParams.set("poll", poll.id);
  elements.viewPollLink.href = publicUrl.toString();
  elements.copyLink.dataset.url = publicUrl.toString();
  const announcementStatus = announcement?.status || "failed";
  elements.announcementResult.dataset.state = announcementStatus;
  elements.announcementResult.textContent = announcementStatus === "sent"
    ? "✓ ThyToxicBot posted the voting link in Twitch chat."
    : announcement?.message || "The poll is live, but its Twitch announcement needs to be resent.";
  window.scrollTo({ top: elements.success.offsetTop - 18, behavior: "smooth" });
}

function showCurrentPolls(polls) {
  const activePolls = (polls || []).filter((poll) => poll.status === "active" && Date.now() < Date.parse(poll.closesAt));
  state.currentPolls = activePolls;
  elements.currentPoll.hidden = !activePolls.length;
  elements.currentPollList.replaceChildren();
  clearInterval(state.countdown);
  activePolls.forEach((poll, index) => {
    const item = document.createElement("article");
    item.className = "current-poll-item";
    const announcementState = poll.announcement?.status || "pending";
    const announcementLabel = announcementState === "sent" ? "Twitch sent" : announcementState === "failed" ? "Twitch failed" : "Twitch pending";
    item.innerHTML = `<div><span class="current-type">Poll ${index + 1} · ${poll.totalVotes} votes · ${announcementLabel}</span><strong>${escapeHtml(poll.question)}</strong></div><div class="current-actions"><span class="current-timer" data-close-at="${poll.closesAt}">00:00</span><button class="secondary-button compact-button" data-action="announce" type="button">${announcementState === "sent" ? "Resend to Twitch" : "Send to Twitch"}</button><button class="secondary-button compact-button" data-action="edit" type="button">Edit</button><button class="secondary-button compact-button" data-action="close" type="button">Close now</button><button class="danger-button" data-action="cancel" type="button">Cancel</button></div>`;
    item.querySelector('[data-action="announce"]').addEventListener("click", (event) => announcePoll(poll, event.currentTarget));
    item.querySelector('[data-action="edit"]').addEventListener("click", () => openEditDialog(poll));
    item.querySelector('[data-action="close"]').addEventListener("click", () => confirmStatusChange(poll, "close"));
    item.querySelector('[data-action="cancel"]').addEventListener("click", () => confirmStatusChange(poll, "cancel"));
    elements.currentPollList.append(item);
  });
  const update = () => {
    elements.currentPollList.querySelectorAll(".current-timer").forEach((timer) => {
      const seconds = Math.max(0, Math.ceil((Date.parse(timer.dataset.closeAt) - Date.now()) / 1000));
      timer.textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
    });
  };
  update();
  if (activePolls.length) state.countdown = setInterval(update, 250);
}

function showHistory(polls) {
  state.recentPolls = polls || [];
  elements.pollHistory.hidden = !state.recentPolls.length;
  elements.historyList.replaceChildren();
  state.recentPolls.forEach((poll) => {
    const item = document.createElement("article");
    item.className = "history-item";
    const date = new Date(poll.createdAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
    item.innerHTML = `<div><span class="history-status" data-status="${poll.status}">${escapeHtml(poll.status)}</span><strong>${escapeHtml(poll.question)}</strong></div><span>${poll.totalVotes} votes · ${escapeHtml(date)}</span>`;
    elements.historyList.append(item);
  });
}

async function loadAdminPolls() {
  if (config.demoMode) return;
  try {
    const response = await apiRequest("/api/admin/polls");
    showCurrentPolls(response.active);
    showHistory(response.recent);
  } catch (error) { elements.formStatus.textContent = error.message; }
}

function askConfirmation(title, message, buttonText) {
  elements.confirmTitle.textContent = title;
  elements.confirmMessage.textContent = message;
  elements.confirmAction.textContent = buttonText;
  elements.confirmDialog.returnValue = "";
  elements.confirmDialog.showModal();
  return new Promise((resolve) => {
    elements.confirmDialog.addEventListener("close", () => resolve(elements.confirmDialog.returnValue === "confirm"), { once: true });
  });
}

async function confirmStatusChange(poll, action) {
  const cancelling = action === "cancel";
  const confirmed = await askConfirmation(
    cancelling ? "Cancel this poll?" : "Close this poll now?",
    cancelling ? `“${poll.question}” will be cancelled without publishing a winner.` : `“${poll.question}” will close immediately and its final result will be recorded.`,
    cancelling ? "Cancel poll" : "Close poll"
  );
  if (!confirmed) return;
  try {
    await apiRequest(`/api/polls/${encodeURIComponent(poll.id)}/${action}`, { method: "POST" });
    await loadAdminPolls();
  } catch (error) { elements.formStatus.textContent = error.message; }
}

function openEditDialog(poll) {
  state.editingPoll = poll;
  state.editOptions = poll.options.map((option) => ({ id: option.id, label: option.label, votes: Number(option.votes || 0) }));
  elements.editQuestion.value = poll.question;
  elements.editResetTimer.checked = false;
  elements.editStatus.textContent = "";
  elements.editResultsModes.replaceChildren();
  RESULT_MODES.forEach(([value, label, help]) => {
    const wrapper = document.createElement("label");
    wrapper.innerHTML = `<input type="radio" name="editResultsMode" value="${value}" ${poll.resultsMode === value ? "checked" : ""}><span><strong>${label}</strong><small>${help}</small></span>`;
    elements.editResultsModes.append(wrapper);
  });
  renderEditOptions();
  elements.editDialog.showModal();
}

function renderEditOptions() {
  elements.editOptionEditor.replaceChildren();
  elements.editAddOption.disabled = state.editOptions.length >= MAX_CHOICES;
  state.editOptions.forEach((option, index) => {
    const row = document.createElement("div");
    row.className = "option-row edit-option-row";
    const number = document.createElement("span");
    number.className = "option-index";
    number.textContent = String(index + 1).padStart(2, "0");
    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = 80;
    input.value = option.label;
    input.addEventListener("input", () => { state.editOptions[index].label = input.value; });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-option";
    remove.textContent = "×";
    remove.disabled = state.editOptions.length <= MIN_CHOICES || option.votes > 0;
    remove.title = option.votes > 0 ? "This answer already has votes and can only be renamed." : "Remove answer";
    remove.addEventListener("click", () => { state.editOptions.splice(index, 1); renderEditOptions(); });
    row.append(number, input, remove);
    if (option.votes > 0) {
      const lock = document.createElement("small");
      lock.className = "vote-lock";
      lock.textContent = `${option.votes} vote${option.votes === 1 ? "" : "s"} · locked from removal`;
      row.append(lock);
    }
    elements.editOptionEditor.append(row);
  });
}

async function savePollChanges(event) {
  event.preventDefault();
  const values = validateValues(elements.editQuestion.value, state.editOptions.map((option) => option.label));
  if (values.error) { elements.editStatus.textContent = values.error; return; }
  elements.savePoll.disabled = true;
  elements.savePoll.textContent = "Saving...";
  try {
    await apiRequest(`/api/polls/${encodeURIComponent(state.editingPoll.id)}/update`, {
      method: "POST",
      body: JSON.stringify({
        question: values.question,
        options: state.editOptions.map((option) => ({ id: option.id || null, label: option.label.trim() })),
        resultsMode: document.querySelector('input[name="editResultsMode"]:checked').value,
        resetTimer: elements.editResetTimer.checked,
        durationSeconds: Number(elements.editDuration.value),
      }),
    });
    elements.editDialog.close();
    await loadAdminPolls();
  } catch (error) { elements.editStatus.textContent = error.message; }
  finally { elements.savePoll.disabled = false; elements.savePoll.textContent = "Save changes"; }
}

function openTestPoll() {
  const data = validateForm();
  if (data.error) { elements.formStatus.textContent = data.error; return; }
  elements.formStatus.textContent = "";
  state.testData = { ...data, options: data.options.map((label, index) => ({ id: `test-${index}`, label, votes: 0 })) };
  state.testSelected = "";
  state.testEndsAt = Date.now() + data.durationSeconds * 1000;
  renderTestPoll();
  clearInterval(state.testCountdown);
  state.testCountdown = setInterval(updateTestTimer, 250);
  elements.testDialog.showModal();
}

function renderTestPoll() {
  elements.testQuestion.textContent = state.testData.question;
  elements.testOptions.replaceChildren();
  state.testData.options.forEach((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "test-option";
    button.disabled = Boolean(state.testSelected);
    button.innerHTML = `<span>${escapeHtml(option.label)}</span><strong>${option.votes}</strong>`;
    if (state.testSelected === option.id) button.dataset.selected = "true";
    button.addEventListener("click", () => {
      if (state.testSelected || Date.now() >= state.testEndsAt) return;
      state.testSelected = option.id;
      option.votes += 1;
      renderTestPoll();
    });
    elements.testOptions.append(button);
  });
  const total = state.testData.options.reduce((sum, option) => sum + option.votes, 0);
  elements.testTotal.textContent = `${total} test vote${total === 1 ? "" : "s"}`;
  updateTestTimer();
}

function updateTestTimer() {
  if (!state.testData) return;
  const seconds = Math.max(0, Math.ceil((state.testEndsAt - Date.now()) / 1000));
  elements.testTimer.textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  if (!seconds) {
    clearInterval(state.testCountdown);
    elements.testOptions.querySelectorAll("button").forEach((button) => { button.disabled = true; });
  }
}

function resetTestPoll() {
  if (!state.testData) return;
  state.testData.options.forEach((option) => { option.votes = 0; });
  state.testSelected = "";
  state.testEndsAt = Date.now() + state.testData.durationSeconds * 1000;
  clearInterval(state.testCountdown);
  state.testCountdown = setInterval(updateTestTimer, 250);
  renderTestPoll();
}

function resetForm() {
  elements.question.value = "";
  elements.questionCount.textContent = "0";
  state.options = ["Choice 1", "Choice 2"];
  document.querySelector('input[name="duration"][value="60"]').checked = true;
  document.querySelector('input[name="resultsMode"][value="after_vote"]').checked = true;
  renderOptions();
  updatePreview();
}

function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

elements.ownerSignIn.addEventListener("click", signInWithTwitch);
elements.signOut.addEventListener("click", signOut);
elements.connectTwitch.addEventListener("click", connectTwitchBot);
elements.question.addEventListener("input", () => { elements.questionCount.textContent = String(elements.question.value.length); updatePreview(); });
elements.addOption.addEventListener("click", () => { if (state.options.length < MAX_CHOICES) { state.options.push(`Choice ${state.options.length + 1}`); renderOptions(); updatePreview(); } });
document.querySelectorAll('input[name="duration"]').forEach((input) => input.addEventListener("change", updatePreview));
elements.form.addEventListener("submit", openPoll);
elements.testPoll.addEventListener("click", openTestPoll);
elements.editAddOption.addEventListener("click", () => { if (state.editOptions.length < MAX_CHOICES) { state.editOptions.push({ id: null, label: `Choice ${state.editOptions.length + 1}`, votes: 0 }); renderEditOptions(); } });
elements.editForm.addEventListener("submit", savePollChanges);
elements.resetTest.addEventListener("click", resetTestPoll);
elements.testDialog.addEventListener("close", () => clearInterval(state.testCountdown));
elements.copyLink.addEventListener("click", async () => {
  await navigator.clipboard.writeText(elements.copyLink.dataset.url || config.siteUrl);
  elements.copyLink.textContent = "Copied";
  setTimeout(() => { elements.copyLink.textContent = "Copy voting link"; }, 1500);
});
elements.createAnother.addEventListener("click", () => { elements.success.hidden = true; elements.form.hidden = false; resetForm(); window.scrollTo({ top: elements.form.offsetTop - 18, behavior: "smooth" }); });

authorize();
