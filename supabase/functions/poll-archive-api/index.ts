import { withSupabase } from "jsr:@supabase/server@^1";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SITE_ORIGIN = Deno.env.get("SITE_ORIGIN") ?? "https://thy-toxic-gamer.github.io";
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

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
      const path = normalizePath(new URL(request.url).pathname);
      if (request.method !== "GET" || path !== "/api/archive") {
        throw new ApiError("not_found", "Route not found.", 404);
      }
      await requireStaff(request);
      return await getPollArchive(request);
    } catch (error) {
      const typed = normalizeError(error);
      if (typed.status >= 500) console.error(error);
      return json(request, { error: typed.code, message: typed.message }, typed.status);
    }
  }),
};

function normalizePath(pathname: string) {
  const stripped = pathname.replace(/^\/(?:functions\/v1\/)?poll-archive-api/, "");
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
    .select("active")
    .eq("user_id", userResult.user.id)
    .maybeSingle();
  if (staffError) throw staffError;
  if (!staff?.active) {
    throw new ApiError("forbidden", "This Twitch account is not authorized for Poll Center controls.", 403);
  }
}

async function getPollArchive(request: Request) {
  const url = new URL(request.url);
  const rawLimit = Number(url.searchParams.get("limit") ?? 12);
  const rawOffset = Number(url.searchParams.get("offset") ?? 0);
  const limit = Number.isInteger(rawLimit) ? Math.min(Math.max(rawLimit, 1), 30) : 12;
  const offset = Number.isInteger(rawOffset) ? Math.max(rawOffset, 0) : 0;
  const status = cleanText(url.searchParams.get("status") || "closed", 20).toLowerCase();
  const search = cleanText(url.searchParams.get("search"), 80);

  if (!new Set(["closed", "cancelled", "all"]).has(status)) {
    throw new ApiError("invalid_archive_status", "Choose completed, cancelled, or all archived polls.");
  }

  let query = db
    .from("polls")
    .select("id", { count: "exact" })
    .neq("status", "active")
    .order("updated_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (status !== "all") query = query.eq("status", status);
  if (search) query = query.ilike("question", `%${search}%`);

  const { data, error, count } = await query;
  if (error) throw error;
  const polls = (await Promise.all((data ?? []).map((row) => serializePoll(row.id)))).filter(Boolean);

  return json(request, {
    polls,
    total: count ?? polls.length,
    offset,
    limit,
    hasMore: offset + polls.length < (count ?? polls.length),
  });
}

async function serializePoll(pollId: string) {
  const [
    { data: poll, error: pollError },
    { data: options, error: optionError },
    { data: votes, error: voteError },
  ] = await Promise.all([
    db.from("polls").select("id, question, creator_name, created_at, updated_at, closes_at, status, poll_style, results_mode").eq("id", pollId).maybeSingle(),
    db.from("poll_options").select("id, label, position").eq("poll_id", pollId).order("position"),
    db.from("poll_votes").select("option_id").eq("poll_id", pollId),
  ]);
  if (pollError) throw pollError;
  if (optionError) throw optionError;
  if (voteError) throw voteError;
  if (!poll) return null;

  const counts = new Map<string, number>();
  for (const vote of votes ?? []) counts.set(vote.option_id, (counts.get(vote.option_id) ?? 0) + 1);
  const totalVotes = (votes ?? []).length;

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
    totalVotes,
    resultsHidden: false,
    options: (options ?? []).map((option) => {
      const optionVotes = counts.get(option.id) ?? 0;
      return {
        id: option.id,
        label: option.label,
        votes: optionVotes,
        percentage: totalVotes ? Math.round((optionVotes / totalVotes) * 1000) / 10 : 0,
      };
    }),
  };
}

function cleanText(value: unknown, maxLength: number) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function bearerToken(request: Request) {
  const authorization = request.headers.get("Authorization") ?? "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
}

function normalizeError(error: unknown) {
  if (error instanceof ApiError) return error;
  return new ApiError("request_failed", "The Poll Archive service encountered an error.", 500);
}

function corsHeaders(request: Request) {
  const origin = request.headers.get("Origin") ?? "";
  const allowed = origin === SITE_ORIGIN || origin === "https://thy-toxic-gamer.github.io" || origin.startsWith("http://localhost:");
  return {
    "Access-Control-Allow-Origin": allowed ? origin : SITE_ORIGIN,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
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
