const { DEFAULT_SETTINGS, normalizeExcludedDateRanges, normalizeSettings } = RM8H_SHARED;

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
  const normalized = normalizeSettings(cfg);

  els.reportUrl.value = normalized.reportUrl;
  els.minHoursPerDay.value = normalized.minHoursPerDay;
  els.highlight.checked = normalized.highlight;
  els.debug.checked = normalized.debug;
  els.workStart.value = normalized.workStart;
  els.workEnd.value = normalized.workEnd;
  els.lunchStart.value = normalized.lunchStart;
  els.lunchDurationMinutes.value = normalized.lunchDurationMinutes;

  els.workingDays.forEach(cb => {
    cb.checked = normalized.workingDays.includes(Number(cb.value));
  });

  excludedDateRanges = normalized.excludedDateRanges;
  renderExcludedRanges();
}

function renderExcludedRanges() {
  els.excludedRangesList.replaceChildren();
  if (excludedDateRanges.length === 0) {
    const p = document.createElement("p");
    const small = document.createElement("small");
    small.textContent = "Нет исключаемых дат";
    p.appendChild(small);
    els.excludedRangesList.appendChild(p);
    return;
  }

  excludedDateRanges.forEach((range, index) => {
    const div = document.createElement("div");
    div.className = "excluded-range";

    const text = range.from === range.to
      ? `${formatDate(range.from)}`
      : `${formatDate(range.from)} — ${formatDate(range.to)}`;

    const span = document.createElement("span");
    span.textContent = text;

    const button = document.createElement("button");
    button.type = "button";
    button.dataset.index = String(index);
    button.textContent = "Удалить";

    button.addEventListener("click", e => {
      const idx = Number(e.currentTarget.dataset.index);
      excludedDateRanges.splice(idx, 1);
      excludedDateRanges = normalizeExcludedDateRanges(excludedDateRanges);
      renderExcludedRanges();
    });

    div.append(span, button);
    els.excludedRangesList.appendChild(div);
  });
}

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split("-");
  return `${d}.${m}.${y}`;
}

async function save() {
  const workingDays = els.workingDays.filter(cb => cb.checked).map(cb => Number(cb.value));
  excludedDateRanges = normalizeExcludedDateRanges(excludedDateRanges);

  const normalized = normalizeSettings({
    reportUrl: els.reportUrl.value.trim(),
    minHoursPerDay: els.minHoursPerDay.value,
    highlight: !!els.highlight.checked,
    debug: !!els.debug.checked,
    workStart: els.workStart.value,
    workEnd: els.workEnd.value,
    lunchStart: els.lunchStart.value,
    lunchDurationMinutes: els.lunchDurationMinutes.value,
    workingDays,
    excludedDateRanges
  });

  await chrome.storage.sync.set(normalized);

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
