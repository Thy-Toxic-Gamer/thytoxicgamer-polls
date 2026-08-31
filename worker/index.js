const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };
const POLL_STYLES = new Set(["multiple"]);
const RESULT_MODES = new Set(["live", "after_vote", "after_close"]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(request, env),
      });
    }

    try {
      if (request.method === "GET" && url.pathname === "/api/health") {
        return json(
          {
            ok: true,
            service: "⁅𝐓𝐡𝐲𝐓☣︎𝐱𝐢𝐜𝐆𝐚𝐦𝐞𝐫⁆ Poll API",
            version: 2,
          },
          200,
          request,
          env
        );
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/admin/sessions"
      ) {
        requireAdminKey(request, env);
        return createAdminSession(request, env);
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/admin/sessions/exchange"
      ) {
        return exchangeAdminSession(request, env);
      }

      if (
        request.method === "GET" &&
        url.pathname === "/api/admin/session"
      ) {
        const admin = await requireAdmin(request, env);

        return json(
          {
            ok: true,
            adminName: admin.adminName,
            expiresAt: admin.expiresAt,
          },
          200,
          request,
          env
        );
      }

      if (
        request.method === "GET" &&
        url.pathname === "/api/polls/current"
      ) {
        return getCurrentPoll(request, env);
      }

      if (
        request.method === "GET" &&
        url.pathname === "/api/polls/active"
      ) {
        return getActivePolls(request, env);
      }

      if (request.method === "POST" && url.pathname === "/api/polls") {
        const admin = await requireAdmin(request, env);
        return createPoll(request, env, admin);
      }

      if (
        request.method === "GET" &&
        url.pathname === "/api/events/pending"
      ) {
        requireAdminKey(request, env);
        return getPendingEvents(request, env);
      }

      const eventAckMatch = url.pathname.match(
        /^\/api\/events\/([^/]+)\/ack$/
      );

      if (eventAckMatch && request.method === "POST") {
        requireAdminKey(request, env);

        return acknowledgeEvent(
          request,
          env,
          decodeURIComponent(eventAckMatch[1])
        );
      }

      const voteMatch = url.pathname.match(
        /^\/api\/polls\/([^/]+)\/votes$/
      );

      if (voteMatch && request.method === "POST") {
        return submitVote(
          request,
          env,
          decodeURIComponent(voteMatch[1])
        );
      }

      const resultsMatch = url.pathname.match(
        /^\/api\/polls\/([^/]+)\/results$/
      );

      if (resultsMatch && request.method === "GET") {
        return getPollResults(
          request,
          env,
          decodeURIComponent(resultsMatch[1])
        );
      }

      const closeMatch = url.pathname.match(
        /^\/api\/polls\/([^/]+)\/(close|cancel)$/
      );

      if (closeMatch && request.method === "POST") {
        await requireAdmin(request, env);

        return changePollStatus(
          request,
          env,
          decodeURIComponent(closeMatch[1]),
          closeMatch[2]
        );
      }

      return json(
        {
          error: "not_found",
          message: "Route not found.",
        },
        404,
        request,
        env
      );
    } catch (error) {
      const typedError =
        /** @type {Error & { status?: number, code?: string }} */ (error);

      const status = Number(typedError.status || 500);
      const message =
        status >= 500
          ? "The poll service encountered an error."
          : typedError.message;

      if (status >= 500) {
        console.error(typedError);
      }

      return json(
        {
          error: typedError.code || "request_failed",
          message,
        },
        status,
        request,
        env
      );
    }
  },
};

async function createAdminSession(request, env) {
  const body = await readJson(request);
  const adminName = cleanText(
    body.adminName || body.createdBy || "Authorized moderator",
    80
  );

  const accessToken = randomToken(32);
  const accessTokenHash = await hashToken(accessToken);
  const now = Date.now();
  const expiresAt = now + 5 * 60 * 1000;

  await env.DB.prepare(
    `INSERT INTO admin_sessions
      (id, access_token_hash, admin_name, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(
      crypto.randomUUID(),
      accessTokenHash,
      adminName,
      now,
      expiresAt
    )
    .run();

  const adminPage = String(
    env.POLL_ADMIN_URL ||
      "https://thy-toxic-gamer.github.io/thytoxicgamer-polls/admin.html"
  );

  const adminUrl = new URL(adminPage);
  adminUrl.searchParams.set("token", accessToken);

  return json(
    {
      adminUrl: adminUrl.toString(),
      expiresAt: new Date(expiresAt).toISOString(),
      expiresInSeconds: 300,
    },
    201,
    request,
    env
  );
}

async function exchangeAdminSession(request, env) {
  const body = await readJson(request);
  const accessToken = cleanText(body.accessToken, 220);

  if (!accessToken) {
    throw clientError(
      "invalid_creator_link",
      "A creator access token is required.",
      401
    );
  }

  const accessTokenHash = await hashToken(accessToken);
  const now = Date.now();

  const row = await env.DB.prepare(
    `SELECT id, admin_name, expires_at, exchanged_at
     FROM admin_sessions
     WHERE access_token_hash = ?`
  )
    .bind(accessTokenHash)
    .first();

  if (
    !row ||
    row.exchanged_at ||
    Number(row.expires_at) <= now
  ) {
    throw clientError(
      "creator_link_expired",
      "This creator link is expired or has already been used.",
      401
    );
  }

  const sessionToken = randomToken(48);
  const sessionTokenHash = await hashToken(sessionToken);
  const sessionExpiresAt = now + 30 * 60 * 1000;

  const result = await env.DB.prepare(
    `UPDATE admin_sessions
     SET exchanged_at = ?, session_token_hash = ?, session_expires_at = ?
     WHERE id = ? AND exchanged_at IS NULL AND expires_at > ?`
  )
    .bind(
      now,
      sessionTokenHash,
      sessionExpiresAt,
      row.id,
      now
    )
    .run();

  if (!result.meta.changes) {
    throw clientError(
      "creator_link_expired",
      "This creator link is expired or has already been used.",
      401
    );
  }

  return json(
    {
      sessionToken,
      adminName: row.admin_name,
      expiresAt: new Date(sessionExpiresAt).toISOString(),
    },
    200,
    request,
    env
  );
}

async function getCurrentPoll(request, env) {
  const poll = await env.DB.prepare(
    "SELECT * FROM polls ORDER BY created_at DESC LIMIT 1"
  ).first();

  if (!poll) {
    return json(
      {
        error: "no_poll",
        message: "There is no poll yet.",
      },
      404,
      request,
      env
    );
  }

  await closePollIfExpired(env, poll);

  return json(
    {
      poll: await serializePoll(env, poll.id),
    },
    200,
    request,
    env
  );
}

async function getActivePolls(request, env) {
  await closeAllExpiredPolls(env);

  const result = await env.DB.prepare(
    "SELECT id FROM polls WHERE status = 'active' ORDER BY created_at ASC LIMIT ?"
  )
    .bind(maxActivePolls(env))
    .all();

  if (!result.results.length) {
    return json(
      {
        error: "no_poll",
        message: "There are no active polls.",
      },
      404,
      request,
      env
    );
  }

  const polls = [];

  for (const row of result.results) {
    polls.push(await serializePoll(env, row.id));
  }

  return json(
    {
      polls,
      maxActivePolls: maxActivePolls(env),
    },
    200,
    request,
    env
  );
}

async function createPoll(request, env, admin) {
  const body = await readJson(request);
  const question = cleanText(body.question, 180);
  const createdBy = cleanText(
    body.createdBy || admin.adminName || "⁅𝐓𝐡𝐲𝐓☣︎𝐱𝐢𝐜𝐆𝐚𝐦𝐞𝐫⁆",
    80
  );

  const durationSeconds = Number(body.durationSeconds);
  const pollStyle = cleanText(
    body.pollStyle || "multiple",
    40
  ).toLowerCase();

  const resultsMode = cleanText(
    body.resultsMode || "after_vote",
    40
  ).toLowerCase();

  const optionRows = Array.isArray(body.options)
    ? body.options
        .map((option, index) => {
          const value =
            typeof option === "string"
              ? { label: option }
              : option || {};

          const requestedVariant = Number(
            value.tileVariant || (index % 8) + 1
          );

          return {
            label: cleanText(value.label, 80),
            tileCode: cleanText(
              value.tileCode,
              8
            ).toUpperCase(),
            tileVariant: Number.isFinite(requestedVariant)
              ? Math.round(
                  Math.min(8, Math.max(1, requestedVariant))
                )
              : (index % 8) + 1,
          };
        })
        .filter((option) => option.label)
    : [];

  if (question.length < 3) {
    throw clientError(
      "invalid_question",
      "The question must contain at least 3 characters."
    );
  }

  if (!POLL_STYLES.has(pollStyle)) {
    throw clientError(
      "invalid_style",
      "That poll style is not supported."
    );
  }

  if (!RESULT_MODES.has(resultsMode)) {
    throw clientError(
      "invalid_results_mode",
      "That result setting is not supported."
    );
  }

  if (
    !Number.isInteger(durationSeconds) ||
    durationSeconds < 30 ||
    durationSeconds > 1800
  ) {
    throw clientError(
      "invalid_duration",
      "Poll duration must be between 30 seconds and 30 minutes."
    );
  }

  if (
    optionRows.length < 2 ||
    optionRows.length > 10
  ) {
    throw clientError(
      "invalid_options",
      "A poll must contain between 2 and 10 choices."
    );
  }

  const uniqueOptions = new Set(
    optionRows.map((option) => option.label.toLowerCase())
  );

  if (uniqueOptions.size !== optionRows.length) {
    throw clientError(
      "duplicate_options",
      "Every poll choice must be different."
    );
  }

  await closeAllExpiredPolls(env);

  const activeCount = await env.DB.prepare(
    "SELECT COUNT(*) AS total FROM polls WHERE status = 'active'"
  ).first();

  if (
    Number(activeCount.total || 0) >= maxActivePolls(env)
  ) {
    throw clientError(
      "poll_limit_reached",
      `The maximum of ${maxActivePolls(
        env
      )} active polls has been reached. Close one before opening another.`,
      409
    );
  }

  const id = crypto.randomUUID();
  const now = Date.now();
  const closesAt = now + durationSeconds * 1000;

  const reminderIntervalSeconds = null;
  const nextReminderAt = null;

  const statements = [
    env.DB.prepare(
      `INSERT INTO polls
        (id, question, created_by, created_at, closes_at, status, poll_style, results_mode,
         reminder_interval_seconds, next_reminder_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`
    ).bind(
      id,
      question,
      createdBy,
      now,
      closesAt,
      pollStyle,
      resultsMode,
      reminderIntervalSeconds,
      nextReminderAt
    ),

    ...optionRows.map((option, index) =>
      env.DB.prepare(
        `INSERT INTO poll_options
          (id, poll_id, label, position, tile_code, tile_variant)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(
        crypto.randomUUID(),
        id,
        option.label,
        index,
        option.tileCode,
        option.tileVariant
      )
    ),

    eventStatement(
      env,
      id,
      "poll_opened",
      "opened",
      now
    ),
  ];

  await env.DB.batch(statements);

  return json(
    {
      poll: await serializePoll(env, id, true),
    },
    201,
    request,
    env
  );
}

async function submitVote(request, env, pollId) {
  const body = await readJson(request);
  const optionId = cleanText(body.optionId, 80);
  const voterId = cleanText(body.voterId, 160);

  if (voterId.length < 12) {
    throw clientError(
      "invalid_voter",
      "A valid viewer identifier is required."
    );
  }

  const poll = await env.DB.prepare(
    "SELECT * FROM polls WHERE id = ?"
  )
    .bind(pollId)
    .first();

  if (!poll) {
    throw notFound(
      "poll_not_found",
      "That poll does not exist."
    );
  }

  await closePollIfExpired(env, poll);

  const refreshedPoll = await env.DB.prepare(
    "SELECT * FROM polls WHERE id = ?"
  )
    .bind(pollId)
    .first();

  if (refreshedPoll.status !== "active") {
    throw clientError(
      "poll_closed",
      "Voting has ended for this poll.",
      409
    );
  }

  const option = await env.DB.prepare(
    "SELECT id FROM poll_options WHERE id = ? AND poll_id = ?"
  )
    .bind(optionId, pollId)
    .first();

  if (!option) {
    throw clientError(
      "invalid_option",
      "That choice is not part of this poll."
    );
  }

  try {
    await env.DB.prepare(
      "INSERT INTO votes (poll_id, option_id, voter_id, created_at) VALUES (?, ?, ?, ?)"
    )
      .bind(
        pollId,
        optionId,
        voterId,
        Date.now()
      )
      .run();
  } catch (error) {
    if (
      String(error.message)
        .toLowerCase()
        .includes("unique")
    ) {
      throw clientError(
        "already_voted",
        "This viewer has already voted in the poll.",
        409
      );
    }

    throw error;
  }

  return json(
    {
      poll: await serializePoll(env, pollId),
    },
    200,
    request,
    env
  );
}

async function getPollResults(request, env, pollId) {
  const poll = await env.DB.prepare(
    "SELECT * FROM polls WHERE id = ?"
  )
    .bind(pollId)
    .first();

  if (!poll) {
    throw notFound(
      "poll_not_found",
      "That poll does not exist."
    );
  }

  await closePollIfExpired(env, poll);

  return json(
    {
      poll: await serializePoll(env, pollId),
    },
    200,
    request,
    env
  );
}

async function changePollStatus(
  request,
  env,
  pollId,
  action
) {
  const poll = await env.DB.prepare(
    "SELECT id FROM polls WHERE id = ?"
  )
    .bind(pollId)
    .first();

  if (!poll) {
    throw notFound(
      "poll_not_found",
      "That poll does not exist."
    );
  }

  const status =
    action === "cancel" ? "cancelled" : "closed";

  const eventType =
    action === "cancel"
      ? "poll_cancelled"
      : "poll_closed";

  const now = Date.now();

  await env.DB.batch([
    env.DB.prepare(
      "UPDATE polls SET status = ? WHERE id = ?"
    ).bind(status, pollId),

    eventStatement(
      env,
      pollId,
      eventType,
      action,
      now
    ),
  ]);

  return json(
    {
      poll: await serializePoll(env, pollId, true),
    },
    200,
    request,
    env
  );
}

async function closePollIfExpired(env, poll) {
  if (
    poll.status !== "active" ||
    Date.now() < Number(poll.closes_at)
  ) {
    return false;
  }

  const now = Date.now();

  const result = await env.DB.prepare(
    "UPDATE polls SET status = 'closed' WHERE id = ? AND status = 'active'"
  )
    .bind(poll.id)
    .run();

  if (result.meta.changes) {
    await eventStatement(
      env,
      poll.id,
      "poll_closed",
      "closed",
      now
    ).run();

    return true;
  }

  return false;
}

async function closeAllExpiredPolls(env) {
  const result = await env.DB.prepare(
    "SELECT * FROM polls WHERE status = 'active' AND closes_at <= ?"
  )
    .bind(Date.now())
    .all();

  for (const poll of result.results) {
    await closePollIfExpired(env, poll);
  }
}

async function serializePoll(
  env,
  pollId,
  forceReveal = false
) {
  const poll = await env.DB.prepare(
    "SELECT * FROM polls WHERE id = ?"
  )
    .bind(pollId)
    .first();

  if (!poll) {
    return null;
  }

  const optionResult = await env.DB.prepare(
    `SELECT o.id, o.label, o.position, o.tile_code, o.tile_variant,
            COUNT(v.option_id) AS votes
     FROM poll_options o
     LEFT JOIN votes v ON v.option_id = o.id
     WHERE o.poll_id = ?
     GROUP BY o.id, o.label, o.position, o.tile_code, o.tile_variant
     ORDER BY o.position ASC`
  )
    .bind(pollId)
    .all();

  const hideResults =
    !forceReveal &&
    poll.status === "active" &&
    String(poll.results_mode) === "after_close";

  const actualOptions = optionResult.results.map(
    (option) => ({
      id: option.id,
      label: option.label,
      votes: Number(option.votes || 0),
      tileCode: option.tile_code || "",
      tileVariant: Number(option.tile_variant || 1),
    })
  );

  const actualTotalVotes = actualOptions.reduce(
    (sum, option) => sum + option.votes,
    0
  );

  const options = actualOptions.map((option) => ({
    ...option,
    votes: hideResults ? 0 : option.votes,
    percentage:
      hideResults || !actualTotalVotes
        ? 0
        : Math.round(
            (option.votes / actualTotalVotes) * 1000
          ) / 10,
  }));

  return {
    id: poll.id,
    question: poll.question,
    createdBy: poll.created_by,
    createdAt: new Date(
      Number(poll.created_at)
    ).toISOString(),
    closesAt: new Date(
      Number(poll.closes_at)
    ).toISOString(),
    status: poll.status,
    pollStyle: poll.poll_style || "multiple",
    resultsMode: poll.results_mode || "after_vote",
    totalVotes: hideResults ? 0 : actualTotalVotes,
    resultsHidden: hideResults,
    options,
  };
}

async function getPendingEvents(request, env) {
  await closeAllExpiredPolls(env);

  const result = await env.DB.prepare(
    `SELECT id, poll_id, event_type, created_at
     FROM poll_events
     WHERE acknowledged_at IS NULL
     ORDER BY created_at ASC
     LIMIT 20`
  ).all();

  const events = [];

  for (const event of result.results) {
    const poll = await serializePoll(
      env,
      event.poll_id,
      true
    );

    if (!poll) {
      continue;
    }

    events.push({
      id: event.id,
      type: event.event_type,
      createdAt: new Date(
        Number(event.created_at)
      ).toISOString(),
      poll,
      chatMessage: buildChatMessage(
        event.event_type,
        poll,
        env
      ),
    });
  }

  return json(
    {
      events,
    },
    200,
    request,
    env
  );
}

async function acknowledgeEvent(request, env, eventId) {
  const result = await env.DB.prepare(
    "UPDATE poll_events SET acknowledged_at = ? WHERE id = ? AND acknowledged_at IS NULL"
  )
    .bind(Date.now(), eventId)
    .run();

  if (!result.meta.changes) {
    throw notFound(
      "event_not_found",
      "That pending event was not found."
    );
  }

  return json(
    {
      ok: true,
      eventId,
    },
    200,
    request,
    env
  );
}

function buildChatMessage(eventType, poll, env) {
  const publicUrl = String(
    env.PUBLIC_POLL_URL ||
      "https://thy-toxic-gamer.github.io/thytoxicgamer-polls/"
  );

  if (eventType === "poll_opened") {
    const votingUrl = pollUrl(publicUrl, poll.id);

    return truncateChatMessage(
      `New 𝐓☣︎𝐱𝐢c Poll: ${poll.question} Vote before time runs out. Vote here: ${votingUrl}`
    );
  }

  if (eventType === "poll_cancelled") {
    return truncateChatMessage(
      `𝐓☣︎𝐱𝐢c Poll cancelled: ${poll.question}`
    );
  }

  if (!poll.totalVotes) {
    return truncateChatMessage(
      `𝐓☣︎𝐱𝐢c Poll closed with no votes: ${poll.question}`
    );
  }

  const topVotes = Math.max(
    ...poll.options.map((option) => option.votes)
  );

  const winners = poll.options.filter(
    (option) => option.votes === topVotes
  );

  const resultList = poll.options
    .map(
      (option) =>
        `${shortChatText(
          option.label,
          34
        )} ${formatPercent(option.percentage)}%`
    )
    .join(" | ");

  const outcome =
    winners.length > 1
      ? `Tie: ${winners
          .map((winner) => winner.label)
          .join(" / ")}`
      : `Winner: ${winners[0].label}`;

  return truncateChatMessage(
    `Poll results — ${shortChatText(
      poll.question,
      110
    )} | ${outcome} | ${resultList} | ${
      poll.totalVotes
    } total votes`
  );
}

function eventStatement(
  env,
  pollId,
  eventType,
  eventKey,
  createdAt
) {
  return env.DB.prepare(
    `INSERT OR IGNORE INTO poll_events
      (id, poll_id, event_type, event_key, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(
    crypto.randomUUID(),
    pollId,
    eventType,
    eventKey,
    createdAt
  );
}

function pollUrl(baseUrl, pollId) {
  const url = new URL(baseUrl);
  url.searchParams.set("poll", pollId);
  return url.toString();
}

function maxActivePolls(env) {
  const configured = Number(
    env.MAX_ACTIVE_POLLS || 3
  );

  return Number.isInteger(configured)
    ? Math.min(3, Math.max(1, configured))
    : 3;
}

function requireAdminKey(request, env) {
  if (!env.ADMIN_KEY) {
    throw clientError(
      "server_misconfigured",
      "ADMIN_KEY is not configured.",
      500
    );
  }

  if (getBearerToken(request) !== env.ADMIN_KEY) {
    throw clientError(
      "unauthorized",
      "A valid Poll API administrator key is required.",
      401
    );
  }
}

async function requireAdmin(request, env) {
  const token = getBearerToken(request);

  if (!token) {
    throw clientError(
      "unauthorized",
      "A valid poll creator session is required.",
      401
    );
  }

  if (env.ADMIN_KEY && token === env.ADMIN_KEY) {
    return {
      adminName: "Streamer.bot",
      expiresAt: null,
    };
  }

  const tokenHash = await hashToken(token);

  const row = await env.DB.prepare(
    `SELECT admin_name, session_expires_at
     FROM admin_sessions
     WHERE session_token_hash = ?
       AND session_expires_at > ?`
  )
    .bind(tokenHash, Date.now())
    .first();

  if (!row) {
    throw clientError(
      "creator_session_expired",
      "This poll creator session has expired.",
      401
    );
  }

  return {
    adminName: row.admin_name,
    expiresAt: new Date(
      Number(row.session_expires_at)
    ).toISOString(),
  };
}

function getBearerToken(request) {
  const authorization =
    request.headers.get("Authorization") || "";

  return authorization.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : "";
}

async function hashToken(token) {
  const encoded = new TextEncoder().encode(token);

  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoded
  );

  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0")
  ).join("");
}

function randomToken(byteLength) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);

  let binary = "";

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function formatPercent(value) {
  return Number.isInteger(value)
    ? String(value)
    : Number(value).toFixed(1);
}

function truncateChatMessage(value) {
  const message = String(value || "");

  return message.length <= 480
    ? message
    : `${message.slice(0, 477)}...`;
}

function shortChatText(value, limit) {
  const text = String(value || "");

  return text.length <= limit
    ? text
    : `${text.slice(
        0,
        Math.max(1, limit - 3)
      )}...`;
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw clientError(
      "invalid_json",
      "The request must contain valid JSON."
    );
  }
}

function cleanText(value, maxLength) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, maxLength);
}

function clientError(
  code,
  message,
  status = 400
) {
  return Object.assign(
    new Error(message),
    {
      code,
      status,
    }
  );
}

function notFound(code, message) {
  return clientError(code, message, 404);
}

function json(data, status, request, env) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...corsHeaders(request, env),
    },
  });
}

function corsHeaders(request, env) {
  const origin =
    request.headers.get("Origin") || "";

  const configuredOrigin =
    env.SITE_ORIGIN || "*";

  const localOrigin =
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(
      origin
    );

  const allowedOrigin =
    configuredOrigin === "*" ||
    origin === configuredOrigin ||
    localOrigin
      ? origin || configuredOrigin
      : configuredOrigin;

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers":
      "Authorization, Content-Type",
    "Access-Control-Allow-Methods":
      "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}