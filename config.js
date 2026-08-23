window.TOXIC_POLL_CONFIG = Object.freeze({
  apiBaseUrl: "https://thytoxicgamer-polls-api.thytoxicgamer.workers.dev",
  refreshMs: 2500,
  siteUrl: "https://thy-toxic-gamer.github.io/thytoxicgamer-polls/",
  adminPageUrl: "https://thy-toxic-gamer.github.io/thytoxicgamer-polls/admin.html",
  demoMode: new URLSearchParams(window.location.search).get("demo") === "1",
});
