import { withSupabase } from "jsr:@supabase/server@^1";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SITE_ORIGIN = Deno.env.get("SITE_ORIGIN") ?? "https://thy-toxic-gamer.github.io";
const PUBLIC_POLL_URL = Deno.env.get("PUBLIC_POLL_URL") ?? "https://thy-toxic-gamer.github.io/thytoxicgamer-polls/";
const INTEGRATION_KEY = Deno.env.get("POLL_INTEGRATION_KEY") ?? "";
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type PollRow = {
  id: string;
  question: string;
  created_by: string | null;
  creator_name: string;
  created_at: string;
  updated_at: string;
  closes_at: string;
  status: "active" | "closed" | "cancelled";
  poll_style: "multiple";
  results_mode: "live" | "after_vote" | "after_close";
};

class ApiError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

export default {
  fetch: withSupabase({ auth: "none" }, async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  try {
    const url = new URL(request.url);
    const path = normalizePath(url.pathname);

    if (request.method === "GET" && path === "/api/health") {
      return json(request, { ok: true, service: "Poll Center API", version: "1.0" });
    }

    if (request.method === "GET" && path === "/api/admin/session") {
      const staff = await requireStaff(request);
      return json(request, { ok: true, adminName: staff.displayName, role: staff.role });
    }

    if (request.method === "GET" && path === "/api/admin/polls") {
      await requireStaff(request);
      return getAdminPolls(request);
    }

    if (request.method === "GET" && path === "/api/polls/active") {
      return getActivePolls(request);
    }

    if (request.method === "POST" && path === "/api/polls") {
      const staff = await requireStaff(request);
      return createPoll(request, staff);
    }

    if (request.method === "GET" && path === "/api/events/pending") {
      requireIntegration(request);
      return getPendingEvents(request);
    }

    const ackMatch = path.match(/^\/api\/events\/(\d+)\/ack$/);
    if (request.method === "POST" && ackMatch) {
      requireIntegration(request);
      return acknowledgeEvent(request, Number(ackMatch[1]));
    }

    const resultMatch = path.match(/^\/api\/polls\/([0-9a-f-]+)\/results$/i);
    if (request.method === "GET" && resultMatch) {
      await closeExpired();
      const poll = await serializePoll(resultMatch[1]);
      if (!poll) throw new ApiError("poll_not_found", "That poll does not exist.", 404);
      return json(request, { poll });
    }

    const voteMatch = path.match(/^\/api\/polls\/([0-9a-f-]+)\/votes$/i);
    if (request.method === "POST" && voteMatch) {
      return submitVote(request, voteMatch[1]);
    }

    const updateMatch = path.match(/^\/api\/polls\/([0-9a-f-]+)\/update$/i);
    if (request.method === "POST" && updateMatch) {
      const staff = await requireStaff(request);
      return updatePoll(request, updateMatch[1], staff);
    }

    const statusMatch = path.match(/^\/api\/polls\/([0-9a-f-]+)\/(close|cancel)$/i);
    if (request.method === "POST" && statusMatch) {
      const staff = await requireStaff(request);
      return changePollStatus(request, statusMatch[1], statusMatch[2], staff);
    }

    throw new ApiError("not_found", "Route not found.", 404);
  } catch (error) {
    const typed = normalizeError(error);
    if (typed.status >= 500) console.error(error);
    return json(request, { error: typed.code, message: typed.message }, typed.status);
  }
  }),
};

function normalizePath(pathname: string) {
  const stripped = pathname.replace(/^\/(?:functions\/v1\/)?poll-center-api/, "");
  return stripped || "/";
}

async function requireStaff(request: Request) {
  const token = bearerToken(request);
  if (!token) throw new ApiError("unauthorized", "Sign in with Twitch to continue.", 401);

  const { data: userResult, error: userError } = await db.auth.getUser(token);
  if (userError || !userResult.user) {
    throw new ApiError("unauthorized", "Your Twitch session has expired. Sign in again.", 401);
  }

  const { data: staff, error: staffError } = await db
    .from("poll_staff")
    .select("role, display_name, active")
    .eq("user_id", userResult.user.id)
    .maybeSingle();

  if (staffError) throw staffError;
  if (!staff?.active) {
    throw new ApiError("forbidden", "This Twitch account is not authorized for Poll Center controls.", 403);
  }

  return {
    userId: userResult.user.id,
    role: staff.role as "owner" | "moderator",
    displayName: staff.display_name as string,
  };
}

function requireIntegration(request: Request) {
  if (!INTEGRATION_KEY) {
    throw new ApiError("integration_not_configured", "Poll integration access is not configured.", 503);
  }
  if (bearerToken(request) !== INTEGRATION_KEY) {
    throw new ApiError("unauthorized", "A valid Poll integration key is required.", 401);
  }
}

async function closeExpired() {
  const { error } = await db.rpc("poll_close_expired");
  if (error) throw error;
}

async function getActivePolls(request: Request) {
  await closeExpired();
  const { data, error } = await db
    .from("polls")
    .select("id")
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(3);
  if (error) throw error;
  if (!data?.length) {
    throw new ApiError("no_poll", "There are no active polls.", 404);
  }

  const polls = [];
  for (const row of data) polls.push(await serializePoll(row.id));
  return json(request, { polls, maxActivePolls: 3 });
}

async function getAdminPolls(request: Request) {
  await closeExpired();
  const [{ data: activeRows, error: activeError }, { data: recentRows, error: recentError }] = await Promise.all([
    db.from("polls").select("id").eq("status", "active").order("created_at"),
    db.from("polls").select("id").neq("status", "active").order("created_at", { ascending: false }).limit(12),
  ]);
  if (activeError) throw activeError;
  if (recentError) throw recentError;

  const active = [];
  const recent = [];
  for (const row of activeRows ?? []) active.push(await serializePoll(row.id, true));
  for (const row of recentRows ?? []) recent.push(await serializePoll(row.id, true));
  return json(request, { active, recent, maxActivePolls: 3 });
}

async function createPoll(request: Request, staff: Awaited<ReturnType<typeof requireStaff>>) {
  const body = await readJson(request);
  const question = cleanText(body.question, 180);
  const options = normalizeNewOptions(body.options);
  const durationSeconds = Number(body.durationSeconds);
  const resultsMode = cleanText(body.resultsMode || "after_vote", 30);

  if (!Number.isInteger(durationSeconds) || durationSeconds < 30 || durationSeconds > 1800) {
    throw new ApiError("invalid_duration", "Poll duration must be between 30 seconds and 30 minutes.");
  }

  const { data: pollId, error } = await db.rpc("poll_create", {
    p_question: question,
    p_creator: staff.userId,
    p_creator_name: staff.displayName,
    p_closes_at: new Date(Date.now() + durationSeconds * 1000).toISOString(),
    p_results_mode: resultsMode,
    p_options: options,
  });
  if (error) throw error;
  return json(request, { poll: await serializePoll(pollId, true) }, 201);
}

async function updatePoll(
  request: Request,
  pollId: string,
  staff: Awaited<ReturnType<typeof requireStaff>>,
) {
  const body = await readJson(request);
  const durationSeconds = Number(body.durationSeconds);
  let resetClosesAt: string | null = null;
  if (body.resetTimer === true) {
    if (!Number.isInteger(durationSeconds) || durationSeconds < 30 || durationSeconds > 1800) {
      throw new ApiError("invalid_duration", "Poll duration must be between 30 seconds and 30 minutes.");
    }
    resetClosesAt = new Date(Date.now() + durationSeconds * 1000).toISOString();
  }

  const options = normalizeEditOptions(body.options);
  const { error } = await db.rpc("poll_update", {
    p_poll_id: pollId,
    p_actor: staff.userId,
    p_question: cleanText(body.question, 180),
    p_results_mode: cleanText(body.resultsMode || "after_vote", 30),
    p_reset_closes_at: resetClosesAt,
    p_options: options,
  });
  if (error) throw error;
  return json(request, { poll: await serializePoll(pollId, true) });
}

async function changePollStatus(
  request: Request,
  pollId: string,
  action: string,
  staff: Awaited<ReturnType<typeof requireStaff>>,
) {
  const { error } = await db.rpc("poll_change_status", {
    p_poll_id: pollId,
    p_actor: staff.userId,
    p_status: action === "cancel" ? "cancelled" : "closed",
  });
  if (error) throw error;
  return json(request, { poll: await serializePoll(pollId, true) });
}

async function submitVote(request: Request, pollId: string) {
  const body = await readJson(request);
  const optionId = cleanText(body.optionId, 80);
  const voterId = cleanText(body.voterId, 180);
  if (voterId.length < 12) throw new ApiError("invalid_voter", "A valid viewer identifier is required.");

  const { error } = await db.rpc("poll_submit_vote", {
    p_poll_id: pollId,
    p_option_id: optionId,
    p_voter_key: await hashText(voterId),
  });
  if (error) throw error;
  return json(request, { poll: await serializePoll(pollId, true) });
}

async function serializePoll(pollId: string, forceReveal = false) {
  const [{ data: poll, error: pollError }, { data: options, error: optionError }, { data: votes, error: voteError }] = await Promise.all([
    db.from("polls").select("*").eq("id", pollId).maybeSingle<PollRow>(),
    db.from("poll_options").select("id, label, position").eq("poll_id", pollId).order("position"),
    db.from("poll_votes").select("option_id").eq("poll_id", pollId),
  ]);
  if (pollError) throw pollError;
  if (optionError) throw optionError;
  if (voteError) throw voteError;
  if (!poll) return null;

  const counts = new Map<string, number>();
  for (const vote of votes ?? []) counts.set(vote.option_id, (counts.get(vote.option_id) ?? 0) + 1);
  const actualTotal = (votes ?? []).length;
  const hideResults = !forceReveal && poll.status === "active" && poll.results_mode === "after_close";
  const serializedOptions = (options ?? []).map((option, index) => {
    const actualVotes = counts.get(option.id) ?? 0;
    return {
      id: option.id,
      label: option.label,
      votes: hideResults ? 0 : actualVotes,
      percentage: hideResults || !actualTotal ? 0 : Math.round((actualVotes / actualTotal) * 1000) / 10,
      tileCode: "",
      tileVariant: (index % 8) + 1,
    };
  });

  return {
    id: poll.id,
    question: poll.question,
    createdBy: poll.creator_name,
    createdAt: poll.created_at,
    updatedAt: poll.updated_at,
    closesAt: poll.closes_at,
    status: poll.status,
    pollStyle: poll.poll_style,
    resultsMode: poll.results_mode,
    totalVotes: hideResults ? 0 : actualTotal,
    resultsHidden: hideResults,
    options: serializedOptions,
  };
}

async function getPendingEvents(request: Request) {
  await closeExpired();
  const { data, error } = await db
    .from("poll_events")
    .select("id, poll_id, event_type, created_at")
    .is("acknowledged_at", null)
    .order("created_at")
    .limit(20);
  if (error) throw error;

  const events = [];
  for (const event of data ?? []) {
    const poll = await serializePoll(event.poll_id, true);
    if (!poll) continue;
    events.push({
      id: event.id,
      type: event.event_type,
      createdAt: event.created_at,
      poll,
      chatMessage: buildChatMessage(event.event_type, poll),
    });
  }
  return json(request, { events });
}

async function acknowledgeEvent(request: Request, eventId: number) {
  const { data, error } = await db
    .from("poll_events")
    .update({ acknowledged_at: new Date().toISOString() })
    .eq("id", eventId)
    .is("acknowledged_at", null)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiError("event_not_found", "That pending event was not found.", 404);
  return json(request, { ok: true, eventId });
}

function buildChatMessage(eventType: string, poll: NonNullable<Awaited<ReturnType<typeof serializePoll>>>) {
  const voteUrl = new URL(PUBLIC_POLL_URL);
  voteUrl.searchParams.set("poll", poll.id);
  if (eventType === "poll_opened") return truncate(`New 𝐓☣︎𝐱𝐢c Poll: ${poll.question} Vote here: ${voteUrl}`);
  if (eventType === "poll_updated") return truncate(`𝐓☣︎𝐱𝐢c Poll updated: ${poll.question} Vote here: ${voteUrl}`);
  if (eventType === "poll_cancelled") return truncate(`𝐓☣︎𝐱𝐢c Poll cancelled: ${poll.question}`);
  if (!poll.totalVotes) return truncate(`𝐓☣︎𝐱𝐢c Poll closed with no votes: ${poll.question}`);

  const topVotes = Math.max(...poll.options.map((option) => option.votes));
  const winners = poll.options.filter((option) => option.votes === topVotes);
  const outcome = winners.length > 1
    ? `Tie: ${winners.map((winner) => winner.label).join(" / ")}`
    : `Winner: ${winners[0].label}`;
  return truncate(`Poll results — ${poll.question} | ${outcome} | ${poll.totalVotes} total votes`);
}

function normalizeNewOptions(value: unknown) {
  if (!Array.isArray(value)) throw new ApiError("invalid_options", "Enter between 2 and 10 answers.");
  return value.map((item) => cleanText(typeof item === "string" ? item : (item as { label?: unknown })?.label, 80));
}

function normalizeEditOptions(value: unknown) {
  if (!Array.isArray(value)) throw new ApiError("invalid_options", "Enter between 2 and 10 answers.");
  return value.map((item) => ({
    id: cleanText((item as { id?: unknown })?.id, 80) || null,
    label: cleanText((item as { label?: unknown })?.label, 80),
  }));
}

async function readJson(request: Request) {
  try {
    return await request.json() as Record<string, unknown>;
  } catch {
    throw new ApiError("invalid_json", "The request body must contain valid JSON.");
  }
}

function cleanText(value: unknown, maxLength: number) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function bearerToken(request: Request) {
  const authorization = request.headers.get("Authorization") ?? "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
}

async function hashText(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeError(error: unknown) {
  if (error instanceof ApiError) return error;
  const raw = String((error as { message?: string })?.message ?? error ?? "");
  const mappings: Array<[string, string, string, number]> = [
    ["poll_forbidden", "forbidden", "This Twitch account is not authorized for Poll Center controls.", 403],
    ["poll_limit_reached", "poll_limit_reached", "Three polls are already active. Close or cancel one first.", 409],
    ["poll_not_active", "poll_not_active", "That poll is already closed, cancelled, or expired.", 409],
    ["already_voted", "already_voted", "This viewer has already voted in the poll.", 409],
    ["option_has_votes", "option_has_votes", "A choice with votes cannot be removed. Rename it instead.", 409],
    ["duplicate_options", "duplicate_options", "Every poll choice must be different.", 400],
    ["invalid_question", "invalid_question", "The question must contain 3 to 180 characters.", 400],
    ["invalid_duration", "invalid_duration", "Poll duration must be between 30 seconds and 30 minutes.", 400],
    ["invalid_results_mode", "invalid_results_mode", "That result setting is not supported.", 400],
    ["invalid_options", "invalid_options", "Enter between 2 and 10 valid, unique answers.", 400],
    ["invalid_option", "invalid_option", "That choice is not part of this poll.", 400],
    ["option_reordering_not_supported", "option_reordering_not_supported", "Existing choices cannot be reordered after a poll opens.", 409],
  ];
  for (const [needle, code, message, status] of mappings) {
    if (raw.includes(needle)) return new ApiError(code, message, status);
  }
  return new ApiError("request_failed", "The Poll Center service encountered an error.", 500);
}

function truncate(value: string) {
  return value.length <= 450 ? value : `${value.slice(0, 447)}...`;
}

function corsHeaders(request: Request) {
  const origin = request.headers.get("Origin") ?? "";
  const allowed = origin === SITE_ORIGIN || origin === "https://thy-toxic-gamer.github.io" || origin.startsWith("http://localhost:");
  return {
    "Access-Control-Allow-Origin": allowed ? origin : SITE_ORIGIN,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(request: Request, data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(request) },
  });
}
