window.TOXIC_POLL_CONFIG = Object.freeze({
  // This will be filled in after the poll API is published.
  apiBaseUrl: "",
  refreshMs: 2500,
  siteUrl: "https://thy-toxic-gamer.github.io/thytoxicgamer-polls/",
  demoMode: new URLSearchParams(window.location.search).get("demo") === "1",
});
