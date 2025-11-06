// Значения по умолчанию для всех пользовательских настроек
const DEFAULTS = {
  reportUrl: "https://max.rm.mosreg.ru/time_entries/report?utf8=%E2%9C%93&criteria%5B%5D=user&columns=day&criteria%5B%5D=&set_filter=1&type=TimeEntryQuery&f%5B%5D=spent_on&op%5Bspent_on%5D=%3E%3Ct-&v%5Bspent_on%5D%5B%5D=14&f%5B%5D=user_id&op%5Buser_id%5D=%3D&v%5Buser_id%5D%5B%5D=me&query%5Bsort_criteria%5D%5B0%5D%5B%5D=spent_on&query%5Bsort_criteria%5D%5B0%5D%5B%5D=desc&query%5Bgroup_by%5D=spent_on&t%5B%5D=hours&c%5B%5D=project&c%5B%5D=spent_on&c%5B%5D=user&c%5B%5D=activity&c%5B%5D=issue&c%5B%5D=comments&c%5B%5D=hours&saved_query_id=0",
  minHoursPerDay: 8,
  highlight: true,
  workStart: "09:00",
  workEnd: "18:00",
  lunchStart: "13:00",
  lunchDurationMinutes: 60,
  workingDays: [1, 2, 3, 4, 5],
  excludedDateRanges: []
};

// Кэшируем ссылки на элементы формы настроек
const els = {
  reportUrl: document.getElementById("reportUrl"),
  minHoursPerDay: document.getElementById("minHoursPerDay"),
  highlight: document.getElementById("highlight"),
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

// Массив исключаемых диапазонов дат
let excludedDateRanges = [];

async function load() {
  // Загружаем сохранённые настройки и отображаем их в форме
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
  // Загружаем исключаемые диапазоны дат
  excludedDateRanges = Array.isArray(cfg.excludedDateRanges) ? cfg.excludedDateRanges : [];
  renderExcludedRanges();
}

function renderExcludedRanges() {
  // Отображаем список исключаемых диапазонов
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
    div.querySelector("button").addEventListener("click", (e) => {
      const idx = Number(e.target.dataset.index);
      excludedDateRanges.splice(idx, 1);
      renderExcludedRanges();
    });
    els.excludedRangesList.appendChild(div);
  });
}

function formatDate(dateStr) {
  // Форматирует дату из YYYY-MM-DD в DD.MM.YYYY
  const [y, m, d] = dateStr.split("-");
  return `${d}.${m}.${y}`;
}
async function save() {
  // Собираем выбранные пользователем дни недели
  const workingDays = els.workingDays.filter(cb => cb.checked).map(cb => Number(cb.value));
  const sanitizeTime = (value, fallback) => {
    // Проверяем формат времени HH:MM, иначе возвращаем значение по умолчанию
    return value && /^([0-1]?\d|2[0-3]):([0-5]\d)$/.test(value) ? value : fallback;
  };
  // Сохраняем настройки в синхронизированное хранилище
  await chrome.storage.sync.set({
    reportUrl: els.reportUrl.value.trim(),
    minHoursPerDay: Number(els.minHoursPerDay.value),
    highlight: !!els.highlight.checked,
    workStart: sanitizeTime(els.workStart.value, DEFAULTS.workStart),
    workEnd: sanitizeTime(els.workEnd.value, DEFAULTS.workEnd),
    lunchStart: sanitizeTime(els.lunchStart.value, DEFAULTS.lunchStart),
    lunchDurationMinutes: Number(els.lunchDurationMinutes.value) || 0,
    workingDays: workingDays.length ? workingDays : DEFAULTS.workingDays,
    excludedDateRanges: excludedDateRanges
  });
  // Пересоздаём алармы
  chrome.runtime.getBackgroundPage
    ? chrome.runtime.getBackgroundPage(() => {}) // старый API не нужен, просто заглушка
    : chrome.runtime.sendMessage({ type: "RM8H_RESCHEDULE" }, () => {});
  // Так как сервис-воркер, просто перезапустим логику:
  chrome.runtime.reload();
}

// Обработчик для добавления нового диапазона исключаемых дат
els.addExcludedRange.addEventListener("click", () => {
  const from = els.excludeFrom.value;
  const to = els.excludeTo.value || from;

  if (!from) {
    alert("Укажите дату начала");
    return;
  }

  // Проверяем, что дата окончания не раньше даты начала
  if (to < from) {
    alert("Дата окончания не может быть раньше даты начала");
    return;
  }

  // Добавляем диапазон в массив
  excludedDateRanges.push({ from, to });
  // Сортируем по дате начала
  excludedDateRanges.sort((a, b) => a.from.localeCompare(b.from));

  // Очищаем поля ввода
  els.excludeFrom.value = "";
  els.excludeTo.value = "";

  // Перерисовываем список
  renderExcludedRanges();
});

// Обработчики кнопок «Сохранить» и «Сбросить»
els.save.addEventListener("click", save);
els.reset.addEventListener("click", async () => {
  // Возвращаем стандартные значения и перезапускаем сервис-воркер
  await chrome.storage.sync.set(DEFAULTS);
  await load();
  chrome.runtime.reload();
});

// При открытии страницы сразу заполняем форму сохранёнными настройками
load();

