const DEFAULT_REPORT_URL =
  "https://max.rm.mosreg.ru/time_entries/report?utf8=%E2%9C%93&criteria%5B%5D=user&columns=day&criteria%5B%5D=&set_filter=1&type=TimeEntryQuery&f%5B%5D=spent_on&op%5Bspent_on%5D=%3E%3Ct-&v%5Bspent_on%5D%5B%5D=14&f%5B%5D=user_id&op%5Buser_id%5D=%3D&v%5Buser_id%5D%5B%5D=me&query%5Bsort_criteria%5D%5B0%5D%5B%5D=spent_on&query%5Bsort_criteria%5D%5B0%5D%5B%5D=desc&query%5Bgroup_by%5D=spent_on&t%5B%5D=hours&c%5B%5D=project&c%5B%5D=spent_on&c%5B%5D=user&c%5B%5D=activity&c%5B%5D=issue&c%5B%5D=comments&c%5B%5D=hours&saved_query_id=0";

const DEFAULT_TIMES = ["08:00", "09:00", "10:00", "17:00", "18:00", "19:00"];

chrome.runtime.onInstalled.addListener(() => initSchedules());
chrome.runtime.onStartup.addListener(() => initSchedules());

// Клик по иконке — принудительная проверка (всегда открываем отчёт в фоне)
chrome.action.onClicked.addListener(() => triggerCheck("manual"));

chrome.alarms.onAlarm.addListener(alarm => {
  if (!alarm.name.startsWith("rm8h:")) return;
  triggerCheck("scheduled");
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === "RM8H_RESULT") {
    const { missingDays, checkedAt, url, error } = msg.payload || {};
    // Показ уведомления только при проблеме или ошибке
    if (error) {
      notify("Не удалось проверить отчёт", error);
    } else if (Array.isArray(missingDays) && missingDays.length > 0) {
      const lines = missingDays
        .map(d => `${d.date}: ${d.hours.toFixed(2)} ч`)
        .join("\n");
      notify("Недобор часов по будням", lines);
      chrome.action.setBadgeText({ text: "!" });
      chrome.action.setBadgeBackgroundColor({ color: "#d00" });
    } else {
      // Всё ок — очищаем бейдж
      chrome.action.setBadgeText({ text: "" });
    }
    // Закрываем технический таб, если он наш
    if (sender?.tab?.id && sender.tab.pendingUrl?.startsWith("https://max.rm.mosreg.ru")
        || sender.tab.url?.startsWith("https://max.rm.mosreg.ru")) {
      // Закрываем только если таб не активный, чтобы не мешать пользователю
      chrome.tabs.get(sender.tab.id, t => {
        if (chrome.runtime.lastError) return;
        if (!t.active) chrome.tabs.remove(sender.tab.id);
      });
    }
  }
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
  const { times, reportUrl } = await chrome.storage.sync.get({
    times: DEFAULT_TIMES,
    reportUrl: DEFAULT_REPORT_URL
  });

  // Сначала очищаем старые алармы
  const alarms = await chrome.alarms.getAll();
  await Promise.all(alarms.filter(a => a.name.startsWith("rm8h:")).map(a => chrome.alarms.clear(a.name)));

  // Создаём ежедневные алармы
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
  const { reportUrl } = await chrome.storage.sync.get({ reportUrl: DEFAULT_REPORT_URL });
  // Открываем в фоне; контент-скрипт сам проверит и пришлёт результат
  chrome.tabs.create({ url: reportUrl, active: false });
}

