const config = window.TOXIC_POLL_CONFIG;

const elements = {
  connectionPill: document.querySelector("#connection-pill"),
  connectionText: document.querySelector("#connection-text"),
  timer: document.querySelector("#timer"),
  timerValue: document.querySelector("#timer-value"),
  loadingView: document.querySelector("#loading-view"),
  waitingView: document.querySelector("#waiting-view"),
  activeView: document.querySelector("#active-view"),
  errorView: document.querySelector("#error-view"),
  errorMessage: document.querySelector("#error-message"),
  retryButton: document.querySelector("#retry-button"),
  pollStatus: document.querySelector("#poll-status"),
  pollQuestion: document.querySelector("#poll-question"),
  pollInstruction: document.querySelector("#poll-instruction"),
  choices: document.querySelector("#choices"),
  choiceTemplate: document.querySelector("#choice-template"),
  voteTotal: document.querySelector("#vote-total"),
  voteNotice: document.querySelector("#vote-notice"),
  resultCallout: document.querySelector("#result-callout"),
};

const state = {
  poll: null,
  refreshTimer: null,
  countdownTimer: null,
  submitting: false,
  demoCloseAt: new Date(Date.now() + 120000).toISOString(),
};

function getViewerId() {
  const storageKey = "toxicPollViewerId";
  let viewerId = localStorage.getItem(storageKey);

  if (!viewerId) {
    viewerId = window.crypto?.randomUUID?.() || `viewer-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(storageKey, viewerId);
  }

  return viewerId;
}

function voteKey(pollId) {
  return `toxicPollVote:${pollId}`;
}

function getStoredVote(pollId) {
  return localStorage.getItem(voteKey(pollId));
}

function setStoredVote(pollId, optionId) {
  localStorage.setItem(voteKey(pollId), optionId);
}

function getDemoPoll() {
  const storedChoice = getStoredVote("demo-toxic-poll");
  const options = [
    { id: "ffxiv", label: "Final Fantasy XIV", votes: 7 },
    { id: "doom", label: "DOOM", votes: 5 },
    { id: "enshrouded", label: "Enshrouded", votes: 3 },
  ];

  if (storedChoice) {
    const selected = options.find((option) => option.id === storedChoice);
    if (selected) selected.votes += 1;
  }

  return normalizePoll({
    id: "demo-toxic-poll",
    question: "Which game should contaminate the stream next?",
    status: Date.now() >= Date.parse(state.demoCloseAt) ? "closed" : "active",
    closesAt: state.demoCloseAt,
    options,
  });
}

function normalizePoll(poll) {
  const options = (poll.options || []).map((option) => ({
    id: String(option.id),
    label: String(option.label),
    votes: Number(option.votes || 0),
  }));
  const totalVotes = options.reduce((sum, option) => sum + option.votes, 0);

  return {
    id: String(poll.id),
    question: String(poll.question),
    status: String(poll.status || "active").toLowerCase(),
    closesAt: poll.closesAt,
    totalVotes,
    options: options.map((option) => ({
      ...option,
      percentage: totalVotes ? Math.round((option.votes / totalVotes) * 1000) / 10 : 0,
    })),
  };
}

async function apiRequest(path, options = {}) {
  const baseUrl = config.apiBaseUrl.replace(/\/$/, "");
  if (!baseUrl) return null;

  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
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

function showOnly(view) {
  [elements.loadingView, elements.waitingView, elements.activeView, elements.errorView].forEach((element) => {
    element.hidden = element !== view;
  });
}

function setConnection(stateName, text) {
  elements.connectionPill.dataset.state = stateName;
  elements.connectionText.textContent = text;
}

function showWaiting() {
  state.poll = null;
  showOnly(elements.waitingView);
  elements.timer.hidden = true;
  setConnection("waiting", "Awaiting poll");
  clearInterval(state.countdownTimer);
}

function showError(message) {
  showOnly(elements.errorView);
  elements.timer.hidden = true;
  elements.errorMessage.textContent = message || "Refresh the page in a moment and try again.";
  setConnection("error", "Connection interrupted");
}

function resultSummary(poll) {
  if (!poll.totalVotes) return "The poll closed without any votes.";

  const topVotes = Math.max(...poll.options.map((option) => option.votes));
  const winners = poll.options.filter((option) => option.votes === topVotes);

  if (winners.length > 1) {
    return `${winners.map((option) => option.label).join(" and ")} finished in a tie with ${winners[0].percentage}%.`;
  }

  return `${winners[0].label} wins with ${winners[0].percentage}% of the vote!`;
}

function renderPoll(poll) {
  state.poll = normalizePoll(poll);
  const isOpen = state.poll.status === "active" && Date.now() < Date.parse(state.poll.closesAt);
  const storedVote = getStoredVote(state.poll.id);
  const showResults = Boolean(storedVote) || !isOpen;

  showOnly(elements.activeView);
  elements.pollQuestion.textContent = state.poll.question;
  elements.voteTotal.textContent = String(state.poll.totalVotes);
  elements.pollStatus.textContent = isOpen ? "Poll open" : state.poll.status === "cancelled" ? "Poll cancelled" : "Poll closed";
  elements.pollStatus.dataset.status = isOpen ? "active" : state.poll.status;
  elements.pollInstruction.textContent = isOpen
    ? storedVote
      ? "Your vote is locked in. Results will update automatically."
      : "Choose one option. Your vote is final."
    : "Voting has ended. Final results are below.";

  elements.choices.replaceChildren();
  state.poll.options.forEach((option) => {
    const choice = elements.choiceTemplate.content.firstElementChild.cloneNode(true);
    const selected = storedVote === option.id;
    choice.dataset.optionId = option.id;
    choice.classList.toggle("selected", selected);
    choice.classList.toggle("results-visible", showResults);
    choice.disabled = !isOpen || Boolean(storedVote) || state.submitting;
    choice.setAttribute("aria-pressed", String(selected));
    choice.querySelector(".choice-label").textContent = option.label;
    choice.querySelector(".choice-percent").textContent = showResults ? `${option.percentage}%` : "Select";
    choice.querySelector(".choice-fill").style.width = showResults ? `${option.percentage}%` : "0%";
    choice.querySelector(".choice-votes").textContent = showResults ? `${option.votes} ${option.votes === 1 ? "vote" : "votes"}` : "";
    choice.addEventListener("click", () => submitVote(option.id));
    elements.choices.append(choice);
  });

  elements.resultCallout.hidden = isOpen;
  elements.resultCallout.textContent = isOpen ? "" : resultSummary(state.poll);
  elements.voteNotice.textContent = storedVote && isOpen ? "☣ Vote accepted. Stay on this page to watch the results." : "";
  elements.timer.hidden = false;
  setConnection(isOpen ? "live" : "closed", isOpen ? "Poll live" : "Poll closed");
  startCountdown();
}

function startCountdown() {
  clearInterval(state.countdownTimer);

  const update = () => {
    if (!state.poll?.closesAt) return;
    const remaining = Math.max(0, Date.parse(state.poll.closesAt) - Date.now());
    const seconds = Math.ceil(remaining / 1000);
    const minutesPart = String(Math.floor(seconds / 60)).padStart(2, "0");
    const secondsPart = String(seconds % 60).padStart(2, "0");
    elements.timerValue.textContent = `${minutesPart}:${secondsPart}`;

    if (!remaining && state.poll.status === "active") {
      state.poll.status = "closed";
      renderPoll(state.poll);
      refreshPoll();
    }
  };

  update();
  state.countdownTimer = setInterval(update, 250);
}

async function submitVote(optionId) {
  if (state.submitting || !state.poll || getStoredVote(state.poll.id)) return;
  state.submitting = true;
  let voteError = "";
  elements.voteNotice.textContent = "Submitting your vote...";
  renderPoll(state.poll);

  try {
    if (config.demoMode) {
      setStoredVote(state.poll.id, optionId);
      renderPoll(getDemoPoll());
      return;
    }

    const response = await apiRequest(`/api/polls/${encodeURIComponent(state.poll.id)}/votes`, {
      method: "POST",
      body: JSON.stringify({ optionId, voterId: getViewerId() }),
    });
    setStoredVote(state.poll.id, optionId);
    renderPoll(response.poll);
  } catch (error) {
    if (error.status === 409) {
      voteError = "This browser has already voted in this poll.";
    } else {
      voteError = error.message || "Your vote could not be submitted. Please try again.";
    }
  } finally {
    state.submitting = false;
    if (state.poll) renderPoll(state.poll);
    if (voteError) elements.voteNotice.textContent = voteError;
  }
}

async function refreshPoll() {
  try {
    if (config.demoMode) {
      renderPoll(getDemoPoll());
      return;
    }

    if (!config.apiBaseUrl) {
      showWaiting();
      return;
    }

    const response = await apiRequest("/api/polls/current");
    renderPoll(response.poll);
  } catch (error) {
    if (error.status === 404 || error.code === "no_poll") {
      showWaiting();
    } else if (!state.poll) {
      showError(error.message);
    }
  }
}

function beginPolling() {
  clearInterval(state.refreshTimer);
  refreshPoll();
  state.refreshTimer = setInterval(refreshPoll, config.refreshMs);
}

elements.retryButton.addEventListener("click", () => {
  showOnly(elements.loadingView);
  setConnection("waiting", "Checking poll");
  refreshPoll();
});

beginPolling();
