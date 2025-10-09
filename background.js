// Базовый URL готового отчёта в Redmine, который открываем при проверке
const DEFAULT_REPORT_URL =
  "https://max.rm.mosreg.ru/time_entries/report?utf8=%E2%9C%93&criteria%5B%5D=user&columns=day&criteria%5B%5D=&set_filter=1&type=TimeEntryQuery&f%5B%5D=spent_on&op%5Bspent_on%5D=%3E%3Ct-&v%5Bspent_on%5D%5B%5D=14&f%5B%5D=user_id&op%5Buser_id%5D=%3D&v%5Buser_id%5D%5B%5D=me&query%5Bsort_criteria%5D%5B0%5D%5B%5D=spent_on&query%5Bsort_criteria%5D%5B0%5D%5B%5D=desc&query%5Bgroup_by%5D=spent_on&t%5B%5D=hours&c%5B%5D=project&c%5B%5D=spent_on&c%5B%5D=user&c%5B%5D=activity&c%5B%5D=issue&c%5B%5D=comments&c%5B%5D=hours&saved_query_id=0";

// Значения по умолчанию для всех настроек расширения
const DEFAULT_SETTINGS = {
  reportUrl: DEFAULT_REPORT_URL,
  workStart: "09:00",
  workEnd: "18:00",
  lunchStart: "13:00",
  lunchDurationMinutes: 60,
  workingDays: [1, 2, 3, 4, 5]
};

// При установке и запуске расширения пересоздаём расписание проверок
chrome.runtime.onInstalled.addListener(() => initSchedules());
chrome.runtime.onStartup.addListener(() => initSchedules());

// Клик по иконке — принудительная проверка (всегда открываем отчёт в фоне)
chrome.action.onClicked.addListener(() => triggerCheck("manual"));

// Реакция на срабатывание любого аларма расширения
chrome.alarms.onAlarm.addListener(alarm => {
  // Игнорируем сторонние алармы, обрабатываем только свои
  if (!alarm.name.startsWith("rm8h:")) return;
  // Запускаем автоматическую проверку
  triggerCheck("scheduled");
});

function notify(title, message) {
  // Создаём системное уведомление с заданными параметрами
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icon128.png",
    title,
    message: message || "",
    priority: 2
  });
}

async function initSchedules() {
  // Получаем актуальные настройки пользователя
  const settings = await getSettings();

  // Сначала очищаем старые алармы, чтобы не было дубликатов расписания
  const alarms = await chrome.alarms.getAll();
  await Promise.all(alarms.filter(a => a.name.startsWith("rm8h:")).map(a => chrome.alarms.clear(a.name)));

  // Генерируем список времени для проверок и создаём алармы на каждый слот
  const times = buildCheckTimes(settings);
  times.forEach(t => scheduleDailyAlarm(`rm8h:${t}`, t));
}

function scheduleDailyAlarm(name, hhmm) {
  // Разбираем строку времени в часы и минуты
  const [h, m] = hhmm.split(":").map(Number);
  const now = new Date();
  const next = new Date();
  // Выставляем ближайшее время срабатывания на указанный слот
  next.setHours(h, m, 0, 0);
  // Если время уже прошло сегодня, переносим на следующий день
  if (next <= now) next.setDate(next.getDate() + 1);
  // Создаём ежедневный аларм с периодом в сутки
  chrome.alarms.create(name, {
    when: next.getTime(),
    periodInMinutes: 1440
  });
}

async function triggerCheck(source) {
  // Берём текущие настройки и время
  const settings = await getSettings();
  const now = new Date();

  if (source !== "manual") {
    // Для автоматических запусков проверяем, что сегодня рабочий день
    if (!isWorkingDay(now, settings.workingDays)) return;
    // ...и что сейчас рабочее время (не обед и не вне смены)
    if (!isWithinWorkingWindow(now, settings)) return;
  }

  const reportUrl = settings.reportUrl || DEFAULT_REPORT_URL;
  // Открываем вкладку с отчётом в фоне — контент-скрипт продолжит работу
  chrome.tabs.create({ url: reportUrl, active: false });
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === "RM8H_RESULT") {
    // Контент-скрипт прислал результат проверки — обрабатываем
    handleResultMessage(msg.payload || {}, sender);
  } else if (msg?.type === "RM8H_RESCHEDULE") {
    // Опции изменились, пересобираем расписание проверок
    initSchedules();
  }
});

async function handleResultMessage(payload, sender) {
  // Берём настройки, чтобы знать рабочие дни и нормы
  const settings = await getSettings();

  const hasError = Boolean(payload?.error);
  if (hasError) {
    // Если контент-скрипт сообщил об ошибке, показываем уведомление
    notify("Не удалось проверить отчёт", payload.error);
  }

  const missingDays = !hasError && Array.isArray(payload.missingDays) ? payload.missingDays : [];
  if (missingDays.length > 0) {
    // Если есть дни с недобором часов, выводим список в уведомлении
    const lines = missingDays
      .map(d => `${d.date}: ${d.hours.toFixed(2)} ч`)
      .join("\n");
    notify("Недобор часов по будням", lines);
  }

  // Определяем дату проверки и ожидаемое количество часов к текущему моменту
  const checkedAt = payload.checkedAt ? new Date(payload.checkedAt) : new Date();
  const isWorkDay = isWorkingDay(checkedAt, settings.workingDays);
  const expectedHours = isWorkDay ? calculateExpectedHours(checkedAt, settings) : 0;
  // Фактически заполненное количество часов за сегодня
  const loggedHours = !hasError && typeof payload.hoursToday === "number" && isFinite(payload.hoursToday)
    ? payload.hoursToday
    : 0;
  const deficit = Math.max(0, expectedHours - loggedHours);
  const badgeValue = Math.max(0, Math.ceil(deficit - 1e-9));

  if (badgeValue > 0) {
    // Если есть недобор, подсвечиваем и ставим значение на бейдже иконки
    chrome.action.setBadgeBackgroundColor({ color: "#d00" });
    chrome.action.setBadgeText({ text: String(badgeValue) });
  } else {
    // В противном случае очищаем бейдж
    chrome.action.setBadgeText({ text: "" });
  }

  // Закрываем техническую вкладку, если она не нужна пользователю
  closeTechnicalTab(sender);
}

async function getSettings() {
  // Забираем настройки из синхронизированного хранилища и подмешиваем значения по умолчанию
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
  // Получаем номер дня недели и проверяем, есть ли он в списке рабочих
  const day = date.getDay();
  return workingDays.includes(day);
}

function isWithinWorkingWindow(date, settings) {
  // Переводим текущее время в минуты с начала суток
  const minutes = date.getHours() * 60 + date.getMinutes();
  const start = parseTime(settings.workStart);
  const end = parseTime(settings.workEnd);
  // Если границы не заданы — считаем, что работать можно всегда
  if (start == null || end == null) return true;
  // Если текущее время вне диапазона — завершить проверку
  if (minutes < start || minutes > end) return false;

  const lunchStart = parseTime(settings.lunchStart);
  const lunchEnd = lunchStart != null
    ? lunchStart + (Number(settings.lunchDurationMinutes) || 0)
    : null;

  // Исключаем из рабочего окна период обеда
  if (lunchStart != null && lunchEnd != null && minutes >= lunchStart && minutes < lunchEnd) {
    return false;
  }
  return true;
}

function calculateExpectedHours(date, settings) {
  // Подсчитываем, сколько часовых слотов уже завершилось к текущему времени
  const minutes = date.getHours() * 60 + date.getMinutes();
  const slots = buildWorkingHourSlots(settings);
  if (!slots.length) return 0;
  const completed = slots.filter(min => minutes >= min).length;
  return Math.min(completed, slots.length);
}

function buildWorkingHourSlots(settings) {
  // Строим массив стартов рабочих часов с учётом обеда
  const start = parseTime(settings.workStart);
  const end = parseTime(settings.workEnd);
  if (start == null || end == null || end <= start) return [];

  const lunchStart = parseTime(settings.lunchStart);
  const lunchDuration = Number(settings.lunchDurationMinutes) || 0;
  const lunchEnd = lunchStart != null ? lunchStart + lunchDuration : null;

  const slots = [];
  for (let t = start; t < end; t += 60) {
    // Пропускаем часы, приходящиеся на обеденный перерыв
    if (lunchStart != null && lunchEnd != null && t >= lunchStart && t < lunchEnd) continue;
    slots.push(t);
  }
  return slots;
}

function buildCheckTimes(settings) {
  // Переводим минутные отметки в формат "HH:MM" для создания алармов
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
  // Валидируем и преобразуем строку времени в количество минут
  if (typeof str !== "string") return null;
  const match = str.trim().match(/^([0-1]?\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function minutesToTime(min) {
  // Форматируем минуты в строку вида "HH:MM"
  const hh = String(Math.floor(min / 60)).padStart(2, "0");
  const mm = String(min % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

function closeTechnicalTab(sender) {
  // Проверяем, что сообщение пришло с вкладки Redmine
  if (!sender?.tab?.id) return;
  const tabUrl = sender.tab.pendingUrl || sender.tab.url || "";
  if (!tabUrl.startsWith("https://max.rm.mosreg.ru")) return;

  // Если вкладка неактивна, закрываем её, чтобы не мешать пользователю
  chrome.tabs.get(sender.tab.id, t => {
    if (chrome.runtime.lastError) return;
    if (!t.active) chrome.tabs.remove(sender.tab.id);
  });
}

