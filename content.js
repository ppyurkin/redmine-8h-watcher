const { DEFAULT_SETTINGS, isDateExcluded } = RM8H_SHARED;

let debugEnabled = DEFAULT_SETTINGS.debug;

function log(...args) {
  if (!debugEnabled) return;
  console.log("[RM8H][content]", ...args);
}

(async function main() {
  const cfg = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  cfg.excludedDateRanges = RM8H_SHARED.normalizeExcludedDateRanges(cfg.excludedDateRanges);
  cfg.workingDays = Array.isArray(cfg.workingDays) && cfg.workingDays.length
    ? cfg.workingDays.map(Number)
    : DEFAULT_SETTINGS.workingDays;
  cfg.debug = Boolean(cfg.debug);
  debugEnabled = cfg.debug;

  log("Content script injected", { url: location.href, injectedAt: new Date().toISOString() });

  try {
    const table = await waitForTable("#time-report", 10000);
    const result = checkTable(table, cfg);
    chrome.runtime.sendMessage({
      type: "RM8H_RESULT",
      payload: { ...result, url: location.href, checkedAt: new Date().toISOString(), workingDays: cfg.workingDays }
    });
  } catch (e) {
    const message = e && e.message ? e.message : String(e);
    chrome.runtime.sendMessage({
      type: "RM8H_RESULT",
      payload: { error: message, url: location.href, checkedAt: new Date().toISOString(), workingDays: cfg.workingDays }
    });
  }
})();

function waitForTable(sel, timeoutMs) {
  return new Promise((resolve, reject) => {
    const el = document.querySelector(sel);
    if (el) return resolve(el);

    const obs = new MutationObserver(() => {
      const t = document.querySelector(sel);
      if (t) {
        obs.disconnect();
        resolve(t);
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });

    const to = setTimeout(() => {
      obs.disconnect();
      reject(new Error("Таблица отчёта не найдена"));
    }, timeoutMs);

    window.addEventListener("load", () => {
      const t = document.querySelector(sel);
      if (t) {
        clearTimeout(to);
        obs.disconnect();
        resolve(t);
      }
    });
  });
}

function parseYMD(ymd) {
  const [Y, M, D] = ymd.split("-").map(Number);
  return new Date(Y, M - 1, D);
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function checkTable(table, cfg) {
  const theadDates = Array.from(table.querySelectorAll("thead th.period")).map(th => th.textContent.trim());
  if (!theadDates.length) {
    throw new Error("Заголовки с датами не найдены");
  }

  const totalRow = table.querySelector("tbody tr.total");
  if (!totalRow) {
    throw new Error("Строка 'Общее время' не найдена");
  }

  const dayCells = Array.from(totalRow.querySelectorAll("td.hours"));
  const perDayCells = dayCells.slice(0, theadDates.length);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const missingDays = [];
  let todayFound = false;
  let todayHours = 0;

  perDayCells.forEach((td, i) => {
    const ymd = theadDates[i];
    const d = parseYMD(ymd);
    const isToday = sameDay(d, today);
    if (d > today) return;

    const day = d.getDay();
    if (!cfg.workingDays.includes(day)) return;
    if (isDateExcluded(ymd, cfg.excludedDateRanges)) return;

    const txt = (td.textContent || "").replace(/\s+/g, "").replace(",", ".").trim();
    const parsed = txt ? parseFloat(txt) : 0;
    const hours = isFinite(parsed) ? parsed : 0;
    const ok = hours >= cfg.minHoursPerDay;

    if (isToday) {
      todayFound = true;
      todayHours = hours;
    } else if (!ok) {
      missingDays.push({ date: ymd, hours });
    }

    if (cfg.highlight) {
      td.style.outline = `2px solid ${ok ? "#2e7d32" : "#d32f2f"}`;
      td.title = `${ok ? "OK" : "Недобор"}: ${RM8H_SHARED.formatHours(hours)} ч`;
    }
  });

  return { missingDays, hoursToday: todayFound ? todayHours : 0, todayFound };
}
