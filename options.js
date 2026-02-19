const { DEFAULT_SETTINGS, sanitizeReportUrl, normalizeExcludedDateRanges } = RM8H_SHARED;

let excludedDateRanges = [];

const els = {
  reportUrl: document.getElementById("reportUrl"),
  minHoursPerDay: document.getElementById("minHoursPerDay"),
  highlight: document.getElementById("highlight"),
  debug: document.getElementById("debug"),
  workStart: document.getElementById("workStart"),
  workEnd: document.getElementById("workEnd"),
  lunchStart: document.getElementById("lunchStart"),
  lunchDurationMinutes: document.getElementById("lunchDurationMinutes"),
  workingDays: Array.from(document.querySelectorAll("input[name='workingDays']")),
  excludedRangesList: document.getElementById("excludedRangesList"),
  excludeFrom: document.getElementById("excludeFrom"),
  excludeTo: document.getElementById("excludeTo"),
  addExcludedRange: document.getElementById("addExcludedRange"),
  save: document.getElementById("save"),
  reset: document.getElementById("reset")
};

async function load() {
  const cfg = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const normalized = {
    ...DEFAULT_SETTINGS,
    ...cfg,
    reportUrl: sanitizeReportUrl(cfg.reportUrl),
    excludedDateRanges: normalizeExcludedDateRanges(cfg.excludedDateRanges)
  };

  els.reportUrl.value = normalized.reportUrl;
  els.minHoursPerDay.value = normalized.minHoursPerDay;
  els.highlight.checked = normalized.highlight;
  els.debug.checked = Boolean(normalized.debug);
  els.workStart.value = normalized.workStart;
  els.workEnd.value = normalized.workEnd;
  els.lunchStart.value = normalized.lunchStart;
  els.lunchDurationMinutes.value = normalized.lunchDurationMinutes;

  const selectedDays = Array.isArray(normalized.workingDays) && normalized.workingDays.length
    ? normalized.workingDays.map(Number)
    : DEFAULT_SETTINGS.workingDays;
  els.workingDays.forEach(cb => {
    cb.checked = selectedDays.includes(Number(cb.value));
  });

  excludedDateRanges = normalized.excludedDateRanges;
  renderExcludedRanges();
}

function renderExcludedRanges() {
  els.excludedRangesList.innerHTML = "";
  if (excludedDateRanges.length === 0) {
    els.excludedRangesList.innerHTML = "<p><small>Нет исключаемых дат</small></p>";
    return;
  }

  excludedDateRanges.forEach((range, index) => {
    const div = document.createElement("div");
    div.className = "excluded-range";
    const text = range.from === range.to
      ? `${formatDate(range.from)}`
      : `${formatDate(range.from)} — ${formatDate(range.to)}`;
    div.innerHTML = `
      <span>${text}</span>
      <button data-index="${index}">Удалить</button>
    `;
    div.querySelector("button").addEventListener("click", e => {
      const idx = Number(e.target.dataset.index);
      excludedDateRanges.splice(idx, 1);
      excludedDateRanges = normalizeExcludedDateRanges(excludedDateRanges);
      renderExcludedRanges();
    });
    els.excludedRangesList.appendChild(div);
  });
}

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split("-");
  return `${d}.${m}.${y}`;
}

function sanitizeTime(value, fallback) {
  return value && /^([0-1]?\d|2[0-3]):([0-5]\d)$/.test(value) ? value : fallback;
}

async function save() {
  const workingDays = els.workingDays.filter(cb => cb.checked).map(cb => Number(cb.value));
  excludedDateRanges = normalizeExcludedDateRanges(excludedDateRanges);

  await chrome.storage.sync.set({
    reportUrl: sanitizeReportUrl(els.reportUrl.value.trim()),
    minHoursPerDay: Number(els.minHoursPerDay.value),
    highlight: !!els.highlight.checked,
    debug: !!els.debug.checked,
    workStart: sanitizeTime(els.workStart.value, DEFAULT_SETTINGS.workStart),
    workEnd: sanitizeTime(els.workEnd.value, DEFAULT_SETTINGS.workEnd),
    lunchStart: sanitizeTime(els.lunchStart.value, DEFAULT_SETTINGS.lunchStart),
    lunchDurationMinutes: Number(els.lunchDurationMinutes.value) || 0,
    workingDays: workingDays.length ? workingDays : DEFAULT_SETTINGS.workingDays,
    excludedDateRanges
  });

  chrome.runtime.reload();
}

els.addExcludedRange.addEventListener("click", () => {
  const from = els.excludeFrom.value;
  const to = els.excludeTo.value || from;

  if (!from) {
    alert("Укажите дату начала");
    return;
  }

  excludedDateRanges.push({ from, to });
  excludedDateRanges = normalizeExcludedDateRanges(excludedDateRanges);

  els.excludeFrom.value = "";
  els.excludeTo.value = "";

  renderExcludedRanges();
});

els.save.addEventListener("click", save);
els.reset.addEventListener("click", async () => {
  await chrome.storage.sync.set(DEFAULT_SETTINGS);
  await load();
  chrome.runtime.reload();
});

load();
