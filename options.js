const DEFAULTS = {
  reportUrl: "https://max.rm.mosreg.ru/time_entries/report?utf8=%E2%9C%93&criteria%5B%5D=user&columns=day&criteria%5B%5D=&set_filter=1&type=TimeEntryQuery&f%5B%5D=spent_on&op%5Bspent_on%5D=%3E%3Ct-&v%5Bspent_on%5D%5B%5D=14&f%5B%5D=user_id&op%5Buser_id%5D=%3D&v%5Buser_id%5D%5B%5D=me&query%5Bsort_criteria%5D%5B0%5D%5B%5D=spent_on&query%5Bsort_criteria%5D%5B0%5D%5B%5D=desc&query%5Bgroup_by%5D=spent_on&t%5B%5D=hours&c%5B%5D=project&c%5B%5D=spent_on&c%5B%5D=user&c%5B%5D=activity&c%5B%5D=issue&c%5B%5D=comments&c%5B%5D=hours&saved_query_id=0",
  minHoursPerDay: 8,
  excludeToday: true,
  highlight: true,
  times: ["08:00", "17:00", "18:00", "19:00"]
};

const els = {
  reportUrl: document.getElementById("reportUrl"),
  minHoursPerDay: document.getElementById("minHoursPerDay"),
  excludeToday: document.getElementById("excludeToday"),
  highlight: document.getElementById("highlight"),
  times: document.getElementById("times"),
  save: document.getElementById("save"),
  reset: document.getElementById("reset")
};

async function load() {
  const cfg = await chrome.storage.sync.get(DEFAULTS);
  els.reportUrl.value = cfg.reportUrl;
  els.minHoursPerDay.value = cfg.minHoursPerDay;
  els.excludeToday.checked = cfg.excludeToday;
  els.highlight.checked = cfg.highlight;
  els.times.value = (cfg.times || DEFAULTS.times).join(",");
}
async function save() {
  const times = els.times.value.split(",").map(s => s.trim()).filter(Boolean);
  await chrome.storage.sync.set({
    reportUrl: els.reportUrl.value.trim(),
    minHoursPerDay: Number(els.minHoursPerDay.value),
    excludeToday: !!els.excludeToday.checked,
    highlight: !!els.highlight.checked,
    times
  });
  // Пересоздаём алармы
  chrome.runtime.getBackgroundPage
    ? chrome.runtime.getBackgroundPage(() => {}) // старый API не нужен, просто заглушка
    : chrome.runtime.sendMessage({ type: "RM8H_RESCHEDULE" }, () => {});
  // Так как сервис-воркер, просто перезапустим логику:
  chrome.runtime.reload();
}

els.save.addEventListener("click", save);
els.reset.addEventListener("click", async () => {
  await chrome.storage.sync.set(DEFAULTS);
  await load();
  chrome.runtime.reload();
});

load();

