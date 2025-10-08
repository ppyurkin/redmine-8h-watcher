const DEFAULT_REPORT_URL =
  "https://max.rm.mosreg.ru/time_entries/report?utf8=%E2%9C%93&criteria%5B%5D=user&columns=day&criteria%5B%5D=&set_filter=1&type=TimeEntryQuery&f%5B%5D=spent_on&op%5Bspent_on%5D=%3E%3Ct-&v%5Bspent_on%5D%5B%5D=14&f%5B%5D=user_id&op%5Buser_id%5D=%3D&v%5Buser_id%5D%5B%5D=me&query%5Bsort_criteria%5D%5B0%5D%5B%5D=spent_on&query%5Bsort_criteria%5D%5B0%5D%5B%5D=desc&query%5Bgroup_by%5D=spent_on&t%5B%5D=hours&c%5B%5D=project&c%5B%5D=spent_on&c%5B%5D=user&c%5B%5D=activity&c%5B%5D=issue&c%5B%5D=comments&c%5B%5D=hours&saved_query_id=0";

const DEFAULT_SETTINGS = {
  reportUrl: DEFAULT_REPORT_URL,
  workStart: "09:00",
  workEnd: "18:00",
  lunchStart: "13:00",
  lunchDurationMinutes: 60,
  workingDays: [1, 2, 3, 4, 5]
};

const pendingReportTabs = new Set();

chrome.runtime.onInstalled.addListener(() => initSchedules());
chrome.runtime.onStartup.addListener(() => initSchedules());

// Клик по иконке — принудительная проверка (всегда открываем отчёт в фоне)
chrome.action.onClicked.addListener(() => triggerCheck("manual"));

chrome.alarms.onAlarm.addListener(alarm => {
  if (!alarm.name.startsWith("rm8h:")) return;
  triggerCheck("scheduled");
});

function notify(title, message) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icon128.png",
    title,
    message: message || "",
    priority: 2
  });
}

async function initSchedules() {
  const settings = await getSettings();

  // Сначала очищаем старые алармы
  const alarms = await chrome.alarms.getAll();
  await Promise.all(alarms.filter(a => a.name.startsWith("rm8h:")).map(a => chrome.alarms.clear(a.name)));

  const times = buildCheckTimes(settings);
  times.forEach(t => scheduleDailyAlarm(`rm8h:${t}`, t));
}

function scheduleDailyAlarm(name, hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const now = new Date();
  const next = new Date();
  next.setHours(h, m, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  chrome.alarms.create(name, {
    when: next.getTime(),
    periodInMinutes: 1440
  });
}

async function triggerCheck(source) {
  const settings = await getSettings();
  const now = new Date();

  if (source !== "manual") {
    if (!isWorkingDay(now, settings.workingDays)) return;
    if (!isWithinWorkingWindow(now, settings)) return;
  }

  const reportUrl = settings.reportUrl || DEFAULT_REPORT_URL;
  chrome.tabs.create({ url: reportUrl, active: false }, tab => {
    if (chrome.runtime.lastError) return;
    if (tab?.id != null) pendingReportTabs.add(tab.id);
  });
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === "RM8H_RESULT") {
    handleResultMessage(msg.payload || {}, sender);
  } else if (msg?.type === "RM8H_RESCHEDULE") {
    initSchedules();
  }
});

chrome.webNavigation.onErrorOccurred.addListener(details => {
  if (details.frameId !== 0) return;
  if (!pendingReportTabs.has(details.tabId)) return;
  if (!details.url.startsWith("https://max.rm.mosreg.ru")) return;

  pendingReportTabs.delete(details.tabId);
  handleResultMessage({ error: `Сетевая ошибка: ${details.error}` }, { tab: { id: details.tabId, url: details.url } });
});

chrome.tabs.onRemoved.addListener(tabId => {
  pendingReportTabs.delete(tabId);
});

async function handleResultMessage(payload, sender) {
  if (sender?.tab?.id != null) {
    pendingReportTabs.delete(sender.tab.id);
  }

  const settings = await getSettings();

  const hasError = Boolean(payload?.error);
  if (hasError) {
    notify("Не удалось проверить отчёт", payload.error);
  }

  const missingDays = !hasError && Array.isArray(payload.missingDays) ? payload.missingDays : [];
  if (missingDays.length > 0) {
    const lines = missingDays
      .map(d => `${d.date}: ${d.hours.toFixed(2)} ч`)
      .join("\n");
    notify("Недобор часов по будням", lines);
  }

  const checkedAt = payload.checkedAt ? new Date(payload.checkedAt) : new Date();
  const isWorkDay = isWorkingDay(checkedAt, settings.workingDays);
  const expectedHours = isWorkDay ? calculateExpectedHours(checkedAt, settings) : 0;
  const loggedHours = !hasError && typeof payload.hoursToday === "number" && isFinite(payload.hoursToday)
    ? payload.hoursToday
    : 0;
  const deficit = Math.max(0, expectedHours - loggedHours);
  const badgeValue = Math.max(0, Math.ceil(deficit - 1e-9));

  if (badgeValue > 0) {
    chrome.action.setBadgeBackgroundColor({ color: "#d00" });
    chrome.action.setBadgeText({ text: String(badgeValue) });
  } else {
    chrome.action.setBadgeText({ text: "" });
  }

  closeTechnicalTab(sender);
}

async function getSettings() {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const workingDays = Array.isArray(stored.workingDays) && stored.workingDays.length
    ? stored.workingDays.map(Number)
    : DEFAULT_SETTINGS.workingDays;
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    workingDays
  };
}

function isWorkingDay(date, workingDays) {
  const day = date.getDay();
  return workingDays.includes(day);
}

function isWithinWorkingWindow(date, settings) {
  const minutes = date.getHours() * 60 + date.getMinutes();
  const start = parseTime(settings.workStart);
  const end = parseTime(settings.workEnd);
  if (start == null || end == null) return true;
  if (minutes < start || minutes > end) return false;

  const lunchStart = parseTime(settings.lunchStart);
  const lunchEnd = lunchStart != null
    ? lunchStart + (Number(settings.lunchDurationMinutes) || 0)
    : null;

  if (lunchStart != null && lunchEnd != null && minutes >= lunchStart && minutes < lunchEnd) {
    return false;
  }
  return true;
}

function calculateExpectedHours(date, settings) {
  const minutes = date.getHours() * 60 + date.getMinutes();
  const slots = buildWorkingHourSlots(settings);
  if (!slots.length) return 0;
  const completed = slots.filter(min => minutes >= min).length;
  return Math.min(completed, slots.length);
}

function buildWorkingHourSlots(settings) {
  const start = parseTime(settings.workStart);
  const end = parseTime(settings.workEnd);
  if (start == null || end == null || end <= start) return [];

  const lunchStart = parseTime(settings.lunchStart);
  const lunchDuration = Number(settings.lunchDurationMinutes) || 0;
  const lunchEnd = lunchStart != null ? lunchStart + lunchDuration : null;

  const slots = [];
  for (let t = start; t < end; t += 60) {
    if (lunchStart != null && lunchEnd != null && t >= lunchStart && t < lunchEnd) continue;
    slots.push(t);
  }
  return slots;
}

function buildCheckTimes(settings) {
  const slots = buildWorkingHourSlots(settings);
  const times = slots.map(minutesToTime);
  const end = parseTime(settings.workEnd);
  const start = parseTime(settings.workStart);
  if (end != null && start != null && end > start) {
    const endStr = minutesToTime(end);
    if (!times.includes(endStr)) times.push(endStr);
  }
  return times;
}

function parseTime(str) {
  if (typeof str !== "string") return null;
  const match = str.trim().match(/^([0-1]?\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function minutesToTime(min) {
  const hh = String(Math.floor(min / 60)).padStart(2, "0");
  const mm = String(min % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

function closeTechnicalTab(sender) {
  if (!sender?.tab?.id) return;
  const tabUrl = sender.tab.pendingUrl || sender.tab.url || "";
  if (!tabUrl.startsWith("https://max.rm.mosreg.ru")) return;

  chrome.tabs.get(sender.tab.id, t => {
    if (chrome.runtime.lastError) return;
    if (!t.active) chrome.tabs.remove(sender.tab.id);
  });
}

