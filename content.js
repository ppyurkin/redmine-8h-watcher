function log(...args) {
  console.log("[RM8H][content]", ...args);
}

log("Content script injected", { url: location.href, injectedAt: new Date().toISOString() });

(async function main() {
  log("Main routine started");
  // Считываем настройки подсчёта часов из синхронизированного хранилища
  const cfg = await chrome.storage.sync.get({
    minHoursPerDay: 8,             // минимум часов
    highlight: true,               // подсветить проблемные ячейки на странице
    excludedDateRanges: []         // диапазоны исключаемых дат
  });
  log("Fetched content settings", cfg);

  try {
    // Ждём появления таблицы отчёта (до 10 секунд)
    const selector = "#time-report";
    const timeoutMs = 10000;
    log("Waiting for report table", { selector, timeoutMs });
    const table = await waitForTable(selector, timeoutMs);
    log("Report table acquired", { selector, found: Boolean(table) });
    // Анализируем таблицу и собираем данные о часах
    const result = checkTable(table, cfg);
    log("Table processed", result);
    // Отправляем фоновой части результат проверки
    const payload = { ...result, url: location.href, checkedAt: new Date().toISOString() };
    log("Sending success payload", payload);
    chrome.runtime.sendMessage({ type: "RM8H_RESULT", payload });
  } catch (e) {
    // В случае ошибки формируем сообщение и уведомляем фон
    const message = e && e.message ? e.message : String(e);
    log("Error during table handling", { error: e, message });
    chrome.runtime.sendMessage({
      type: "RM8H_RESULT",
      payload: {
        error: message,
        url: location.href,
        checkedAt: new Date().toISOString()
      }
    });
    log("Error payload sent", { message });
  }
})();

function waitForTable(sel, timeoutMs) {
  log("waitForTable invoked", { sel, timeoutMs });
  // Возвращаем промис, который резолвится, когда нужная таблица появится в DOM
  return new Promise((resolve, reject) => {
    const el = document.querySelector(sel);
    // Если уже есть — возвращаем сразу
    if (el) {
      log("Table already present", { sel });
      return resolve(el);
    }

    // Подписываемся на изменения DOM и ждём таблицу
    const obs = new MutationObserver(() => {
      const t = document.querySelector(sel);
      if (t) {
        log("MutationObserver detected table", { sel });
        obs.disconnect();
        resolve(t);
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    log("MutationObserver attached", { sel });

    // Ставим таймер, после которого считаем, что таблицы нет
    const to = setTimeout(() => {
      log("waitForTable timeout elapsed", { sel, timeoutMs });
      obs.disconnect();
      reject(new Error("Таблица отчёта не найдена"));
    }, timeoutMs);

    // На всякий случай также проверим при полной загрузке
    window.addEventListener("load", () => {
      const t = document.querySelector(sel);
      if (t) {
        log("Window load handler located table", { sel });
        clearTimeout(to);
        obs.disconnect();
        resolve(t);
      }
    });
  });
}

function parseYMD(ymd) {
  log("parseYMD called", { ymd });
  // "YYYY-MM-DD" → Date (локальная полночь)
  const [Y, M, D] = ymd.split("-").map(Number);
  log("parseYMD parts", { Y, M, D });
  const result = new Date(Y, M - 1, D);
  log("parseYMD result", { result: result.toISOString() });
  return result;
}
function isWeekday(d) {
  const day = d.getDay(); // 0=вс, 6=сб
  const result = day >= 1 && day <= 5;
  log("isWeekday evaluated", { date: d.toISOString(), day, result });
  return result;
}
function sameDay(a, b) {
  const result = a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  log("sameDay compared", { a: a.toISOString(), b: b.toISOString(), result });
  return result;
}
function isDateExcluded(ymd, excludedRanges) {
  // Проверяет, входит ли дата в один из исключаемых диапазонов
  log("isDateExcluded checking", { ymd, excludedRanges });
  if (!Array.isArray(excludedRanges) || excludedRanges.length === 0) {
    log("No excluded ranges configured");
    return false;
  }
  for (const range of excludedRanges) {
    if (ymd >= range.from && ymd <= range.to) {
      log("Date is excluded", { ymd, range });
      return true;
    }
  }
  log("Date is not excluded", { ymd });
  return false;
}

function checkTable(table, cfg) {
  log("checkTable invoked", { cfg });
  // Собираем список дат из заголовка таблицы
  const theadDates = Array.from(table.querySelectorAll("thead th.period")).map(th => th.textContent.trim());
  log("Table header dates", { theadDates });
  if (!theadDates.length) {
    log("No header dates found", { error: "missing_dates" });
    throw new Error("Заголовки с датами не найдены");
  }

  // Тело: ищем строку с суммами по дням
  const totalRow = table.querySelector("tbody tr.total");
  log("Total row located", { exists: Boolean(totalRow) });
  if (!totalRow) {
    throw new Error("Строка 'Общее время' не найдена");
  }

  // В totalRow: первый <td> — текст "Общее время", затем по одному <td.hours> на каждую дату, затем общий итог
  const dayCells = Array.from(totalRow.querySelectorAll("td.hours")); // включает и последний общий итог
  const perDayCells = dayCells.slice(0, theadDates.length); // ровно столько, сколько аголовков-дней
  log("Collected cells", { totalCells: dayCells.length, perDay: perDayCells.length });

  // Определяем текущую дату без учёта времени
  const today = new Date();
  today.setHours(0,0,0,0);
  log("Normalized today", { today: today.toISOString() });

  const missingDays = [];
  let todayFound = false;
  let todayHours = 0;
  perDayCells.forEach((td, i) => {
    // Для каждой ячейки определяем дату и её показатели
    const ymd = theadDates[i];
    const d = parseYMD(ymd);
    const isToday = sameDay(d, today);
    log("Processing day cell", { index: i, ymd, isToday });
    if (d > today) {
      log("Skipping future date", { ymd });
      return;
    }
    if (!isWeekday(d)) {
      log("Skipping non-weekday", { ymd });
      return;
    }
    // Проверяем, не входит ли дата в исключаемые диапазоны
    if (isDateExcluded(ymd, cfg.excludedDateRanges)) {
      log("Skipping excluded date", { ymd });
      return;
    }

    // Приводим текст ячейки к числу часов
    const txt = (td.textContent || "").replace(/\s+/g, "").replace(",", ".").trim(); // например "8.00"
    log("Raw cell text", { ymd, txt });
    const parsed = txt ? parseFloat(txt) : 0;
    const hours = isFinite(parsed) ? parsed : 0;
    const ok = hours >= cfg.minHoursPerDay; // допускаем >= 8.00
    log("Parsed cell", { ymd, parsed, hours, ok });

    if (isToday) {
      todayFound = true;
      todayHours = hours;
      log("Updated today hours", { hours });
    } else if (!ok) {
      missingDays.push({ date: ymd, hours });
      log("Recorded missing day", { ymd, hours });
    }

    if (cfg.highlight) {
      // Подсвечиваем ячейку в зависимости от выполнения нормы
      td.style.outline = `2px solid ${ok ? "#2e7d32" : "#d32f2f"}`;
      td.title = `${ok ? "OK" : "Недобор"}: ${hours.toFixed(2)} ч`;
      log("Applied highlight", { ymd, ok, outline: td.style.outline, title: td.title });
    }
  });

  const summary = { missingDays, hoursToday: todayFound ? todayHours : 0, todayFound };
  log("checkTable summary", summary);
  return summary;
}
