window.TOXIC_POLL_CONFIG = Object.freeze({
  apiBaseUrl: "https://hdwhhyrlmktiynyujozk.supabase.co/functions/v1/poll-center-api",
  supabaseUrl: "https://hdwhhyrlmktiynyujozk.supabase.co",
  supabasePublishableKey: "sb_publishable_JiZipr3WJnP1XoKvibaNrw_PtU2H4kW",
  refreshMs: 2500,
  siteUrl: "https://thy-toxic-gamer.github.io/thytoxicgamer-polls/",
  adminPageUrl: "https://thy-toxic-gamer.github.io/thytoxicgamer-polls/admin.html",
  streamUrl: "https://www.twitch.tv/thytoxicgamer",
  demoMode: new URLSearchParams(window.location.search).get("demo") === "1",
});
