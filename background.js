// Универсальная функция логирования с единым префиксом
function log(...args) {
  console.log("[RM8H][background]", ...args);
}

log("Background script initialized");

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
chrome.runtime.onInstalled.addListener(() => {
  log("onInstalled event received – reinitializing schedules");
  initSchedules();
});
chrome.runtime.onStartup.addListener(() => {
  log("onStartup event received – reinitializing schedules");
  initSchedules();
});

// Клик по иконке — принудительная проверка (всегда открываем отчёт в фоне)
chrome.action.onClicked.addListener(() => {
  log("Browser action clicked – triggering manual check");
  triggerCheck("manual");
});

// Реакция на срабатывание любого аларма расширения
chrome.alarms.onAlarm.addListener(alarm => {
  log("Alarm fired", alarm);
  // Игнорируем сторонние алармы, обрабатываем только свои
  if (!alarm.name.startsWith("rm8h:")) {
    log("Ignoring alarm without rm8h prefix", alarm?.name);
    return;
  }
  // Запускаем автоматическую проверку
  triggerCheck("scheduled");
});

function notify(title, message) {
  log("Creating notification", { title, message });
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
  log("Initializing schedules");
  // Получаем актуальные настройки пользователя
  const settings = await getSettings();
  log("Fetched settings for schedule initialization", settings);

  // Сначала очищаем старые алармы, чтобы не было дубликатов расписания
  const alarms = await chrome.alarms.getAll();
  log("Existing alarms", alarms);
  const ownAlarms = alarms.filter(a => a.name.startsWith("rm8h:"));
  log("Alarms to clear", ownAlarms);
  await Promise.all(ownAlarms.map(a => chrome.alarms.clear(a.name)));
  log("Cleared old alarms");

  // Генерируем список времени для проверок и создаём алармы на каждый слот
  const times = buildCheckTimes(settings);
  log("Generated check times", times);
  times.forEach(t => scheduleDailyAlarm(`rm8h:${t}`, t));
}

function scheduleDailyAlarm(name, hhmm) {
  log("Scheduling daily alarm", { name, hhmm });
  // Разбираем строку времени в часы и минуты
  const [h, m] = hhmm.split(":").map(Number);
  const now = new Date();
  const next = new Date();
  // Выставляем ближайшее время срабатывания на указанный слот
  next.setHours(h, m, 0, 0);
  // Если время уже прошло сегодня, переносим на следующий день
  if (next <= now) next.setDate(next.getDate() + 1);
  // Создаём ежедневный аларм с периодом в сутки
  const when = next.getTime();
  log("Creating alarm", { name, when, humanTime: new Date(when).toISOString() });
  chrome.alarms.create(name, {
    when,
    periodInMinutes: 1440
  });
}

async function triggerCheck(source) {
  log("Trigger check invoked", { source });
  // Берём текущие настройки и время
  const settings = await getSettings();
  log("Settings for trigger check", settings);
  const now = new Date();
  log("Current time", now.toISOString());

  if (source !== "manual") {
    // Для автоматических запусков проверяем, что сегодня рабочий день
    const workingDay = isWorkingDay(now, settings.workingDays);
    log("Is working day?", workingDay);
    if (!workingDay) {
      log("Aborting scheduled check: not a working day");
      return;
    }
    // ...и что сейчас рабочее время (не обед и не вне смены)
    const withinWindow = isWithinWorkingWindow(now, settings);
    log("Within working window?", withinWindow);
    if (!withinWindow) {
      log("Aborting scheduled check: outside working window");
      return;
    }
  }

  const reportUrl = settings.reportUrl || DEFAULT_REPORT_URL;
  log("Checking report availability", reportUrl);
  const availability = await checkReportAvailability(reportUrl);
  log("Report availability result", availability);

  if (!availability.ok) {
    const message = availability.message || "Redmine недоступен";
    log("Report unavailable – applying default day state", message);
    await applyDefaultDayState({
      errorMessage: message,
      errorTitle: "Не удалось открыть отчёт",
      checkedAt: new Date(),
      url: reportUrl
    });
    return;
  }

  log("Opening report tab", reportUrl);
  // Открываем вкладку с отчётом в фоне — контент-скрипт продолжит работу
  chrome.tabs.create({ url: reportUrl, active: false });
}

async function checkReportAvailability(url) {
  log("Performing availability check", url);
  try {
    const response = await fetch(url, {
      method: "GET",
      credentials: "include",
      redirect: "manual",
      cache: "no-store"
    });
    const status = response.status;
    const redirected = response.type === "opaqueredirect" || (status >= 300 && status < 400);
    log("Availability response", {
      status,
      redirected,
      type: response.type,
      redirectedFlag: response.redirected
    });

    if (redirected) {
      return {
        ok: false,
        reason: "redirect",
        message: "Redmine перенаправил запрос — требуется авторизация"
      };
    }

    if (response.ok) {
      return { ok: true };
    }

    return {
      ok: false,
      reason: `status_${status}`,
      message: status === 0 ? "Redmine недоступен" : `Redmine ответил со статусом ${status}`
    };
  } catch (error) {
    log("Error while checking report availability", error);
    return {
      ok: false,
      reason: "network_error",
      message: "Не удалось подключиться к Redmine"
    };
  }
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  log("Message received", { msg, sender });
  if (msg?.type === "RM8H_RESULT") {
    // Контент-скрипт прислал результат проверки — обрабатываем
    handleResultMessage(msg.payload || {}, sender);
  } else if (msg?.type === "RM8H_RESCHEDULE") {
    // Опции изменились, пересобираем расписание проверок
    log("Reschedule message received – reinitializing schedules");
    initSchedules();
  }
});

async function handleResultMessage(payload, sender) {
  log("Handling result message", { payload, sender });
  // Берём настройки, чтобы знать рабочие дни и нормы
  const settings = await getSettings();
  log("Settings while handling result", settings);

  const hasError = Boolean(payload?.error);
  log("Result contains error?", hasError);
  if (hasError) {
    // Если контент-скрипт сообщил об ошибке, показываем уведомление
    const errorTitle = payload.errorTitle || "Не удалось проверить отчёт";
    log("Sending error notification", { message: payload.error, title: errorTitle });
    notify(errorTitle, payload.error);
  }

  const missingDays = !hasError && Array.isArray(payload.missingDays) ? payload.missingDays : [];
  log("Missing days list", missingDays);
  if (missingDays.length > 0) {
    // Если есть дни с недобором часов, выводим список в уведомлении
    const lines = missingDays
      .map(d => `${d.date}: ${d.hours.toFixed(2)} ч`)
      .join("\n");
    log("Sending missing days notification", lines);
    notify("Недобор часов по будням", lines);
  }

  // Определяем дату проверки и ожидаемое количество часов к текущему моменту
  const checkedAt = payload.checkedAt ? new Date(payload.checkedAt) : new Date();
  log("Checked at", checkedAt.toISOString());
  const isWorkDay = isWorkingDay(checkedAt, settings.workingDays);
  log("Is checked day working day?", isWorkDay);
  const expectedHours = isWorkDay ? calculateExpectedHours(checkedAt, settings) : 0;
  log("Expected hours for day", expectedHours);
  // Фактически заполненное количество часов за сегодня
  const loggedHours = !hasError && typeof payload.hoursToday === "number" && isFinite(payload.hoursToday)
    ? payload.hoursToday
    : 0;
  log("Logged hours for today", loggedHours);
  const deficit = Math.max(0, expectedHours - loggedHours);
  const badgeValue = Math.max(0, Math.ceil(deficit - 1e-9));
  log("Calculated deficit and badge value", { deficit, badgeValue });

  if (badgeValue > 0) {
    // Если есть недобор, подсвечиваем и ставим значение на бейдже иконки
    log("Setting badge for deficit", badgeValue);
    chrome.action.setBadgeBackgroundColor({ color: "#d00" });
    chrome.action.setBadgeText({ text: String(badgeValue) });
  } else {
    // В противном случае очищаем бейдж
    log("Clearing badge – no deficit");
    chrome.action.setBadgeText({ text: "" });
  }

  // Закрываем техническую вкладку, если она не нужна пользователю
  closeTechnicalTab(sender);
}

function applyDefaultDayState({ errorMessage, errorTitle, checkedAt = new Date(), url } = {}) {
  log("Applying default day state", { errorMessage, errorTitle, checkedAt, url });
  const payload = {
    missingDays: [],
    hoursToday: 0,
    todayFound: false,
    error: errorMessage,
    errorTitle,
    checkedAt: checkedAt instanceof Date ? checkedAt.toISOString() : checkedAt,
    url
  };
  return handleResultMessage(payload, null);
}

async function getSettings() {
  log("Fetching settings from storage");
  // Забираем настройки из синхронизированного хранилища и подмешиваем значения по умолчанию
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  log("Raw stored settings", stored);
  const workingDays = Array.isArray(stored.workingDays) && stored.workingDays.length
    ? stored.workingDays.map(Number)
    : DEFAULT_SETTINGS.workingDays;
  log("Normalized working days", workingDays);
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    workingDays
  };
}

function isWorkingDay(date, workingDays) {
  log("Checking if date is working day", { date: date.toISOString(), workingDays });
  // Получаем номер дня недели и проверяем, есть ли он в списке рабочих
  const day = date.getDay();
  log("Day index", day);
  return workingDays.includes(day);
}

function isWithinWorkingWindow(date, settings) {
  log("Checking if within working window", { date: date.toISOString(), settings });
  // Переводим текущее время в минуты с начала суток
  const minutes = date.getHours() * 60 + date.getMinutes();
  log("Minutes since start of day", minutes);
  const start = parseTime(settings.workStart);
  const end = parseTime(settings.workEnd);
  log("Parsed start/end", { start, end });
  // Если границы не заданы — считаем, что работать можно всегда
  if (start == null || end == null) return true;
  // Если текущее время вне диапазона — завершить проверку
  if (minutes < start || minutes > end) return false;

  const lunchStart = parseTime(settings.lunchStart);
  const lunchEnd = lunchStart != null
    ? lunchStart + (Number(settings.lunchDurationMinutes) || 0)
    : null;

  log("Lunch window", { lunchStart, lunchEnd });

  // Исключаем из рабочего окна период обеда
  if (lunchStart != null && lunchEnd != null && minutes >= lunchStart && minutes < lunchEnd) {
    log("Time falls into lunch window");
    return false;
  }
  log("Time within working window");
  return true;
}

function calculateExpectedHours(date, settings) {
  log("Calculating expected hours", { date: date.toISOString(), settings });
  // Подсчитываем, сколько часовых слотов уже завершилось к текущему времени
  const minutes = date.getHours() * 60 + date.getMinutes();
  log("Minutes for expected hours", minutes);
  const slots = buildWorkingHourSlots(settings);
  log("Slots for expected hours", slots);
  if (!slots.length) return 0;
  const completed = slots.filter(min => minutes >= min).length;
  log("Completed slots count", completed);
  return Math.min(completed, slots.length);
}

function buildWorkingHourSlots(settings) {
  log("Building working hour slots", settings);
  // Строим массив стартов рабочих часов с учётом обеда
  const start = parseTime(settings.workStart);
  const end = parseTime(settings.workEnd);
  log("Parsed start/end for slots", { start, end });
  if (start == null || end == null || end <= start) return [];

  const lunchStart = parseTime(settings.lunchStart);
  const lunchDuration = Number(settings.lunchDurationMinutes) || 0;
  const lunchEnd = lunchStart != null ? lunchStart + lunchDuration : null;

  log("Lunch configuration", { lunchStart, lunchEnd, lunchDuration });

  const slots = [];
  for (let t = start; t < end; t += 60) {
    // Пропускаем часы, приходящиеся на обеденный перерыв
    if (lunchStart != null && lunchEnd != null && t >= lunchStart && t < lunchEnd) {
      log("Skipping slot due to lunch", t);
      continue;
    }
    log("Adding slot", t);
    slots.push(t);
  }
  log("Final slots list", slots);
  return slots;
}

function buildCheckTimes(settings) {
  log("Building check times", settings);
  // Переводим минутные отметки в формат "HH:MM" для создания алармов
  const slots = buildWorkingHourSlots(settings);
  log("Slots for check times", slots);
  const times = slots.map(minutesToTime);
  log("Converted time strings", times);
  const end = parseTime(settings.workEnd);
  const start = parseTime(settings.workStart);
  log("Parsed start/end for check times", { start, end });
  if (end != null && start != null && end > start) {
    const endStr = minutesToTime(end);
    if (!times.includes(endStr)) times.push(endStr);
  }
  log("Final check times", times);
  return times;
}

function parseTime(str) {
  log("Parsing time string", str);
  // Валидируем и преобразуем строку времени в количество минут
  if (typeof str !== "string") return null;
  const match = str.trim().match(/^([0-1]?\d|2[0-3]):([0-5]\d)$/);
  log("Time parse regex result", match);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function minutesToTime(min) {
  log("Converting minutes to HH:MM", min);
  // Форматируем минуты в строку вида "HH:MM"
  const hh = String(Math.floor(min / 60)).padStart(2, "0");
  const mm = String(min % 60).padStart(2, "0");
  log("Formatted parts", { hh, mm });
  return `${hh}:${mm}`;
}

function closeTechnicalTab(sender) {
  log("Checking whether to close technical tab", sender);
  // Проверяем, что сообщение пришло с вкладки Redmine
  if (!sender?.tab?.id) return;
  const tabUrl = sender.tab.pendingUrl || sender.tab.url || "";
  log("Sender tab URL", tabUrl);
  if (!tabUrl.startsWith("https://max.rm.mosreg.ru")) return;

  // Если вкладка неактивна, закрываем её, чтобы не мешать пользователю
  chrome.tabs.get(sender.tab.id, t => {
    if (chrome.runtime.lastError) {
      log("Error fetching tab", chrome.runtime.lastError);
      return;
    }
    log("Tab info", t);
    if (!t.active) {
      log("Closing inactive technical tab", sender.tab.id);
      chrome.tabs.remove(sender.tab.id);
    } else {
      log("Keeping active tab open", sender.tab.id);
    }
  });
}

