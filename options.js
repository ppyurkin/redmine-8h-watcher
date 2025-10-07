const DEFAULTS = {
  reportUrl: "https://max.rm.mosreg.ru/time_entries/report?utf8=%E2%9C%93&criteria%5B%5D=user&columns=day&criteria%5B%5D=&set_filter=1&type=TimeEntryQuery&f%5B%5D=spent_on&op%5Bspent_on%5D=%3E%3Ct-&v%5Bspent_on%5D%5B%5D=14&f%5B%5D=user_id&op%5Buser_id%5D=%3D&v%5Buser_id%5D%5B%5D=me&query%5Bsort_criteria%5D%5B0%5D%5B%5D=spent_on&query%5Bsort_criteria%5D%5B0%5D%5B%5D=desc&query%5Bgroup_by%5D=spent_on&t%5B%5D=hours&c%5B%5D=project&c%5B%5D=spent_on&c%5B%5D=user&c%5B%5D=activity&c%5B%5D=issue&c%5B%5D=comments&c%5B%5D=hours&saved_query_id=0",
  minHoursPerDay: 8,
  highlight: true,
  workStart: "09:00",
  workEnd: "18:00",
  lunchStart: "13:00",
  lunchDurationMinutes: 60,
  workingDays: [1, 2, 3, 4, 5]
};

const els = {
  reportUrl: document.getElementById("reportUrl"),
  minHoursPerDay: document.getElementById("minHoursPerDay"),
  highlight: document.getElementById("highlight"),
  workStart: document.getElementById("workStart"),
  workEnd: document.getElementById("workEnd"),
  lunchStart: document.getElementById("lunchStart"),
  lunchDurationMinutes: document.getElementById("lunchDurationMinutes"),
  workingDays: Array.from(document.querySelectorAll("input[name='workingDays']")),
  save: document.getElementById("save"),
  reset: document.getElementById("reset")
};

async function load() {
  const cfg = await chrome.storage.sync.get(DEFAULTS);
  els.reportUrl.value = cfg.reportUrl;
  els.minHoursPerDay.value = cfg.minHoursPerDay;
  els.highlight.checked = cfg.highlight;
  els.workStart.value = cfg.workStart || DEFAULTS.workStart;
  els.workEnd.value = cfg.workEnd || DEFAULTS.workEnd;
  els.lunchStart.value = cfg.lunchStart || DEFAULTS.lunchStart;
  els.lunchDurationMinutes.value = cfg.lunchDurationMinutes ?? DEFAULTS.lunchDurationMinutes;
  const selectedDays = Array.isArray(cfg.workingDays) && cfg.workingDays.length
    ? cfg.workingDays.map(Number)
    : DEFAULTS.workingDays;
  els.workingDays.forEach(cb => {
    cb.checked = selectedDays.includes(Number(cb.value));
  });
}
async function save() {
  const workingDays = els.workingDays.filter(cb => cb.checked).map(cb => Number(cb.value));
  const sanitizeTime = (value, fallback) => {
    return value && /^([0-1]?\d|2[0-3]):([0-5]\d)$/.test(value) ? value : fallback;
  };
  await chrome.storage.sync.set({
    reportUrl: els.reportUrl.value.trim(),
    minHoursPerDay: Number(els.minHoursPerDay.value),
    highlight: !!els.highlight.checked,
    workStart: sanitizeTime(els.workStart.value, DEFAULTS.workStart),
    workEnd: sanitizeTime(els.workEnd.value, DEFAULTS.workEnd),
    lunchStart: sanitizeTime(els.lunchStart.value, DEFAULTS.lunchStart),
    lunchDurationMinutes: Number(els.lunchDurationMinutes.value) || 0,
    workingDays: workingDays.length ? workingDays : DEFAULTS.workingDays
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

