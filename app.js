const config = window.TOXIC_POLL_CONFIG;
const requestedPollId = new URLSearchParams(window.location.search).get("poll");

const elements = {
  connectionPill: document.querySelector("#connection-pill"),
  connectionText: document.querySelector("#connection-text"),
  timer: document.querySelector("#timer"),
  timerValue: document.querySelector("#timer-value"),
  switcher: document.querySelector("#poll-switcher"),
  switcherLabel: document.querySelector("#poll-switcher-label"),
  pollTabs: document.querySelector("#poll-tabs"),
  loadingView: document.querySelector("#loading-view"),
  waitingView: document.querySelector("#waiting-view"),
  activeView: document.querySelector("#active-view"),
  errorView: document.querySelector("#error-view"),
  errorMessage: document.querySelector("#error-message"),
  retryButton: document.querySelector("#retry-button"),
  pollStatus: document.querySelector("#poll-status"),
  pollQuestion: document.querySelector("#poll-question"),
  pollInstruction: document.querySelector("#poll-instruction"),
  voteConfirmation: document.querySelector("#vote-confirmation"),
  voteConfirmationChoice: document.querySelector("#vote-confirmation-choice"),
  voteDialog: document.querySelector("#vote-dialog"),
  voteDialogChoice: document.querySelector("#vote-dialog-choice"),
  voteDialogCancel: document.querySelector("#vote-dialog-cancel"),
  voteDialogConfirm: document.querySelector("#vote-dialog-confirm"),
  choices: document.querySelector("#choices"),
  choiceTemplate: document.querySelector("#choice-template"),
  voteTotal: document.querySelector("#vote-total"),
  voteNotice: document.querySelector("#vote-notice"),
  resultCallout: document.querySelector("#result-callout"),
};

const state = {
  polls: [],
  poll: null,
  selectedPollId: requestedPollId || "",
  refreshTimer: null,
  countdownTimer: null,
  submitting: false,
  pendingOptionId: "",
  demoCloseAt: new Date(Date.now() + 120000).toISOString(),
  demoGameCloseAt: new Date(Date.now() + 9000000).toISOString(),
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

function withDemoVote(pollId, options) {
  const storedChoice = getStoredVote(pollId);
  return options.map((option) => ({
    ...option,
    votes: option.votes + (option.id === storedChoice ? 1 : 0),
  }));
}

function getDemoPolls() {
  const communityOptions = withDemoVote("demo-toxic-poll", [
    { id: "ffxiv", label: "Final Fantasy XIV", votes: 7 },
    { id: "doom", label: "DOOM", votes: 5 },
    { id: "enshrouded", label: "Enshrouded", votes: 3 },
  ]);
  const gameOptions = withDemoVote("demo-game-poll", [
    { id: "hades", label: "Hades II", tileCode: "HII", tileVariant: 1, votes: 4 },
    { id: "poe2", label: "Path of Exile 2", tileCode: "POE", tileVariant: 2, votes: 3 },
    { id: "valheim", label: "Valheim", tileCode: "V", tileVariant: 3, votes: 2 },
    { id: "warframe", label: "Warframe", tileCode: "W", tileVariant: 4, votes: 2 },
    { id: "palworld", label: "Palworld", tileCode: "P", tileVariant: 5, votes: 1 },
    { id: "witcher", label: "The Witcher 3: Wild Hunt", tileCode: "TW3", tileVariant: 6, votes: 1 },
    { id: "darktide", label: "Warhammer 40,000: Darktide", tileCode: "W40", tileVariant: 7, votes: 1 },
    { id: "ark", label: "ARK: Survival Ascended", tileCode: "ASA", tileVariant: 8, votes: 1 },
  ]);

  return [
    normalizePoll({
      id: "demo-toxic-poll",
      question: "Which game should contaminate the stream next?",
      pollStyle: "multiple",
      resultsMode: "after_vote",
      status: Date.now() >= Date.parse(state.demoCloseAt) ? "closed" : "active",
      closesAt: state.demoCloseAt,
      options: communityOptions,
    }),
    normalizePoll({
      id: "demo-game-poll",
      question: "What should ThyToxicGamer play during the next community stream?",
      pollStyle: "game_library",
      resultsMode: "after_vote",
      status: Date.now() >= Date.parse(state.demoGameCloseAt) ? "closed" : "active",
      closesAt: state.demoGameCloseAt,
      options: gameOptions,
    }),
  ];
}

function normalizePoll(poll) {
  const options = (poll.options || []).map((option, index) => ({
    id: String(option.id),
    label: String(option.label),
    votes: Number(option.votes || 0),
    tileCode: String(option.tileCode || ""),
    tileVariant: Number(option.tileVariant || ((index % 8) + 1)),
  }));
  const totalVotes = options.reduce((sum, option) => sum + option.votes, 0);

  return {
    id: String(poll.id),
    question: String(poll.question),
    pollStyle: String(poll.pollStyle || "multiple"),
    resultsMode: String(poll.resultsMode || "after_vote"),
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
  elements.switcher.hidden = true;
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

function renderSwitcher() {
  elements.pollTabs.replaceChildren();
  elements.switcher.hidden = state.polls.length < 2;
  elements.switcherLabel.textContent = `${state.polls.length} polls available`;
  state.polls.forEach((poll, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "poll-tab";
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(poll.id === state.selectedPollId));
    const prefix = poll.pollStyle === "game_library" ? "Game vote" : `Poll ${index + 1}`;
    const shortQuestion = poll.question.length > 44 ? `${poll.question.slice(0, 41)}...` : poll.question;
    button.textContent = `${prefix}: ${shortQuestion}`;
    button.addEventListener("click", () => selectPoll(poll.id));
    elements.pollTabs.append(button);
  });
}

function selectPoll(pollId) {
  const poll = state.polls.find((item) => item.id === pollId);
  if (!poll) return;
  state.selectedPollId = poll.id;
  state.poll = poll;
  renderSwitcher();
  renderPoll(poll);
  if (!config.demoMode) {
    const url = new URL(window.location.href);
    url.searchParams.set("poll", poll.id);
    window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
  }
}

function openVoteDialog(optionId) {
  if (state.submitting || !state.poll || getStoredVote(state.poll.id)) return;
  const option = state.poll.options.find((item) => item.id === optionId);
  if (!option) return;

  state.pendingOptionId = option.id;
  elements.voteDialogChoice.textContent = option.label;
  elements.voteDialog.showModal();
}

function closeVoteDialog() {
  state.pendingOptionId = "";
  if (elements.voteDialog.open) elements.voteDialog.close();
}

function returnToStreamAfterVote() {
  if (config.demoMode) return;

  window.setTimeout(() => {
    // This succeeds when Twitch opened the Poll Center in a closable tab.
    window.close();

    // Browsers may block window.close(). If the tab remains open,
    // return the viewer directly to the Twitch stream instead.
    window.setTimeout(() => {
      window.location.replace(config.streamUrl || "https://www.twitch.tv/thytoxicgamer");
    }, 500);
  }, 1500);
}

function renderPoll(poll) {
  state.poll = normalizePoll(poll);
  const isOpen = state.poll.status === "active" && Date.now() < Date.parse(state.poll.closesAt);
  const storedVote = getStoredVote(state.poll.id);
  const showResults =
    !isOpen ||
    state.poll.resultsMode === "live" ||
    (state.poll.resultsMode === "after_vote" && Boolean(storedVote));
  const isGamePoll = state.poll.pollStyle === "game_library";
  const selectedOption = storedVote
    ? state.poll.options.find((option) => option.id === storedVote)
    : null;
  const voteComplete = isOpen && Boolean(storedVote);

  showOnly(elements.activeView);
  elements.pollQuestion.textContent = state.poll.question;
  elements.voteTotal.textContent = String(state.poll.totalVotes);
  elements.pollStatus.textContent = isOpen ? "Poll open" : state.poll.status === "cancelled" ? "Poll cancelled" : "Poll closed";
  elements.pollStatus.dataset.status = isOpen ? "active" : state.poll.status;
  elements.pollInstruction.textContent = isOpen
    ? isGamePoll
      ? "Choose one game. Your vote is final."
      : "Choose one option. Your vote is final."
    : "Voting has ended. Final results are below.";
  elements.pollInstruction.hidden = voteComplete;

  elements.voteConfirmation.hidden = !voteComplete;
  elements.voteConfirmationChoice.textContent = selectedOption
    ? selectedOption.label
    : "Your selected answer";

  elements.choices.replaceChildren();
  elements.choices.classList.toggle("game-choices", isGamePoll);
  elements.choices.hidden = voteComplete;

  if (!voteComplete) {
    state.poll.options.forEach((option) => {
      const choice = elements.choiceTemplate.content.firstElementChild.cloneNode(true);
      const selected = storedVote === option.id;
      choice.dataset.optionId = option.id;
      choice.classList.toggle("selected", selected);
      choice.classList.toggle("results-visible", showResults);
      choice.disabled = !isOpen || Boolean(storedVote) || state.submitting;
      choice.setAttribute("aria-checked", String(selected));
      choice.querySelector(".choice-label").textContent = option.label;
      choice.querySelector(".choice-percent").textContent = showResults
        ? `${option.percentage}%`
        : "Select";
      choice.querySelector(".choice-fill").style.width = showResults ? `${option.percentage}%` : "0%";
      choice.querySelector(".choice-votes").textContent = showResults
        ? `${option.votes} ${option.votes === 1 ? "vote" : "votes"}`
        : "";

      if (isGamePoll) {
        const art = choice.querySelector(".choice-game-art");
        art.hidden = false;
        art.classList.add(`variant-${option.tileVariant}`);
        art.querySelector(".choice-game-code").textContent = option.tileCode || option.label.slice(0, 3).toUpperCase();
      }

      choice.addEventListener("click", () => openVoteDialog(option.id));
      elements.choices.append(choice);
    });
  }

  elements.resultCallout.hidden = isOpen;
  elements.resultCallout.textContent = isOpen ? "" : resultSummary(state.poll);
  elements.voteNotice.textContent = state.submitting ? "Submitting your vote..." : "";
  elements.timer.hidden = false;
  setConnection(isOpen ? "live" : "closed", isOpen ? "Poll live" : "Poll closed");
  startCountdown();
}

function formatRemaining(milliseconds) {
  const seconds = Math.ceil(Math.max(0, milliseconds) / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secondsPart = seconds % 60;
  return hours
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secondsPart).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(secondsPart).padStart(2, "0")}`;
}

function startCountdown() {
  clearInterval(state.countdownTimer);
  const update = async () => {
    if (!state.poll?.closesAt) return;
    const remaining = Math.max(0, Date.parse(state.poll.closesAt) - Date.now());
    elements.timerValue.textContent = formatRemaining(remaining);
    if (!remaining && state.poll.status === "active") {
      clearInterval(state.countdownTimer);
      if (config.demoMode) {
        state.poll.status = "closed";
        renderPoll(state.poll);
        return;
      }
      try {
        const response = await apiRequest(`/api/polls/${encodeURIComponent(state.poll.id)}/results`);
        const closedPoll = normalizePoll(response.poll);
        state.polls = state.polls.map((poll) => (poll.id === closedPoll.id ? closedPoll : poll));
        renderPoll(closedPoll);
      } catch {
        refreshPolls();
      }
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
      const demoPoll = getDemoPolls().find((poll) => poll.id === state.poll.id);
      state.polls = state.polls.map((poll) => (poll.id === demoPoll.id ? demoPoll : poll));
      renderPoll(demoPoll);
      return;
    }

    const response = await apiRequest(`/api/polls/${encodeURIComponent(state.poll.id)}/votes`, {
      method: "POST",
      body: JSON.stringify({ optionId, voterId: getViewerId() }),
    });
    setStoredVote(state.poll.id, optionId);
    const updatedPoll = normalizePoll(response.poll);
    state.polls = state.polls.map((poll) => (poll.id === updatedPoll.id ? updatedPoll : poll));
    renderPoll(updatedPoll);
    returnToStreamAfterVote();
  } catch (error) {
    voteError = error.status === 409
      ? "This browser has already voted in this poll."
      : error.message || "Your vote could not be submitted. Please try again.";
  } finally {
    state.submitting = false;
    if (state.poll) renderPoll(state.poll);
    if (voteError) elements.voteNotice.textContent = voteError;
  }
}

async function refreshPolls() {
  try {
    let polls;
    if (config.demoMode) {
      polls = getDemoPolls();
    } else {
      if (!config.apiBaseUrl) {
        showWaiting();
        return;
      }
      const response = await apiRequest("/api/polls/active");
      polls = (response.polls || []).map(normalizePoll);

      const desiredId = state.selectedPollId || requestedPollId;
      if (desiredId && !polls.some((poll) => poll.id === desiredId)) {
        try {
          const result = await apiRequest(`/api/polls/${encodeURIComponent(desiredId)}/results`);
          if (result.poll) polls.push(normalizePoll(result.poll));
        } catch {
          // The requested poll may no longer exist; fall back to a live poll.
        }
      }
    }

    if (!polls.length) {
      showWaiting();
      return;
    }

    state.polls = polls;
    const selected = polls.find((poll) => poll.id === state.selectedPollId)
      || polls.find((poll) => poll.id === requestedPollId)
      || polls[0];
    state.selectedPollId = selected.id;
    renderSwitcher();
    renderPoll(selected);
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
  refreshPolls();
  state.refreshTimer = setInterval(refreshPolls, config.refreshMs);
}

elements.retryButton.addEventListener("click", () => {
  showOnly(elements.loadingView);
  setConnection("waiting", "Checking polls");
  refreshPolls();
});

elements.voteDialogCancel.addEventListener("click", closeVoteDialog);

elements.voteDialogConfirm.addEventListener("click", () => {
  const optionId = state.pendingOptionId;
  if (!optionId || state.submitting) return;
  closeVoteDialog();
  submitVote(optionId);
});

elements.voteDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeVoteDialog();
});

elements.voteDialog.addEventListener("click", (event) => {
  if (event.target === elements.voteDialog) closeVoteDialog();
});

beginPolling();
