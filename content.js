(async function main() {
  // Считываем настройки подсчёта часов из синхронизированного хранилища
  const cfg = await chrome.storage.sync.get({
    minHoursPerDay: 8,             // минимум часов
    highlight: true                // подсветить проблемные ячейки на странице
  });

  try {
    // Ждём появления таблицы отчёта (до 10 секунд)
    const table = await waitForTable("#time-report", 10000);
    // Анализируем таблицу и собираем данные о часах
    const result = checkTable(table, cfg);
    // Отправляем фоновой части результат проверки
    chrome.runtime.sendMessage({ type: "RM8H_RESULT", payload: { ...result, url: location.href, checkedAt: new Date().toISOString() } });
  } catch (e) {
    // В случае ошибки формируем сообщение и уведомляем фон
    const message = e && e.message ? e.message : String(e);
    chrome.runtime.sendMessage({
      type: "RM8H_RESULT",
      payload: {
        missingDays: [],
        hoursToday: 0,
        todayFound: false,
        error: message,
        url: location.href,
        checkedAt: new Date().toISOString()
      }
    });
  }
})();

function waitForTable(sel, timeoutMs) {
  // Возвращаем промис, который резолвится, когда нужная таблица появится в DOM
  return new Promise((resolve, reject) => {
    const el = document.querySelector(sel);
    // Если уже есть — возвращаем сразу
    if (el) return resolve(el);

    // Подписываемся на изменения DOM и ждём таблицу
    const obs = new MutationObserver(() => {
      const t = document.querySelector(sel);
      if (t) {
        obs.disconnect();
        resolve(t);
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });

    // Ставим таймер, после которого считаем, что таблицы нет
    const to = setTimeout(() => {
      obs.disconnect();
      reject(new Error("Таблица отчёта не найдена"));
    }, timeoutMs);

    // На всякий случай также проверим при полной загрузке
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
  // "YYYY-MM-DD" → Date (локальная полночь)
  const [Y, M, D] = ymd.split("-").map(Number);
  return new Date(Y, M - 1, D);
}
function isWeekday(d) {
  const day = d.getDay(); // 0=вс, 6=сб
  return day >= 1 && day <= 5;
}
function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function checkTable(table, cfg) {
  // Собираем список дат из заголовка таблицы
  const theadDates = Array.from(table.querySelectorAll("thead th.period")).map(th => th.textContent.trim());
  if (!theadDates.length) throw new Error("Заголовки с датами не найдены");

  // Тело: ищем строку с суммами по дням
  const totalRow = table.querySelector("tbody tr.total");
  if (!totalRow) throw new Error("Строка 'Общее время' не найдена");

  // В totalRow: первый <td> — текст "Общее время", затем по одному <td.hours> на каждую дату, затем общий итог
  const dayCells = Array.from(totalRow.querySelectorAll("td.hours")); // включает и последний общий итог
  const perDayCells = dayCells.slice(0, theadDates.length); // ровно столько, сколько заголовков-дней

  // Определяем текущую дату без учёта времени
  const today = new Date();
  today.setHours(0,0,0,0);

  const missingDays = [];
  let todayFound = false;
  let todayHours = 0;
  perDayCells.forEach((td, i) => {
    // Для каждой ячейки определяем дату и её показатели
    const ymd = theadDates[i];
    const d = parseYMD(ymd);
    const isToday = sameDay(d, today);
    if (d > today) return;
    if (!isWeekday(d)) return;

    // Приводим текст ячейки к числу часов
    const txt = (td.textContent || "").replace(/\s+/g, "").replace(",", ".").trim(); // например "8.00"
    const parsed = txt ? parseFloat(txt) : 0;
    const hours = isFinite(parsed) ? parsed : 0;
    const ok = hours >= cfg.minHoursPerDay; // допускаем >= 8.00

    if (isToday) {
      todayFound = true;
      todayHours = hours;
    } else if (!ok) {
      missingDays.push({ date: ymd, hours });
    }

    if (cfg.highlight) {
      // Подсвечиваем ячейку в зависимости от выполнения нормы
      td.style.outline = `2px solid ${ok ? "#2e7d32" : "#d32f2f"}`;
      td.title = `${ok ? "OK" : "Недобор"}: ${hours.toFixed(2)} ч`;
    }
  });

  return { missingDays, hoursToday: todayFound ? todayHours : 0, todayFound };
}

