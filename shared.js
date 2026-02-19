(function initSharedConfig(global) {
  const DEFAULT_REPORT_URL =
    "https://max.rm.mosreg.ru/time_entries/report?utf8=%E2%9C%93&criteria%5B%5D=user&columns=day&criteria%5B%5D=&set_filter=1&type=TimeEntryQuery&f%5B%5D=spent_on&op%5Bspent_on%5D=%3E%3Ct-&v%5Bspent_on%5D%5B%5D=14&f%5B%5D=user_id&op%5Buser_id%5D=%3D&v%5Buser_id%5D%5B%5D=me&query%5Bsort_criteria%5D%5B0%5D%5B%5D=spent_on&query%5Bsort_criteria%5D%5B0%5D%5B%5D=desc&query%5Bgroup_by%5D=spent_on&t%5B%5D=hours&c%5B%5D=project&c%5B%5D=spent_on&c%5B%5D=user&c%5B%5D=activity&c%5B%5D=issue&c%5B%5D=comments&c%5B%5D=hours&saved_query_id=0";

  const REPORT_URL_BASE = new URL(DEFAULT_REPORT_URL);

  const DEFAULT_SETTINGS = {
    reportUrl: DEFAULT_REPORT_URL,
    minHoursPerDay: 8,
    highlight: true,
    debug: false,
    workStart: "09:00",
    workEnd: "18:00",
    lunchStart: "13:00",
    lunchDurationMinutes: 60,
    workingDays: [1, 2, 3, 4, 5],
    excludedDateRanges: []
  };

  function isValidYMD(value) {
    if (typeof value !== "string") return false;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  }

  function normalizeExcludedDateRanges(ranges) {
    if (!Array.isArray(ranges)) return [];

    const prepared = ranges
      .map(range => {
        const from = typeof range?.from === "string" ? range.from : "";
        const to = typeof range?.to === "string" ? range.to : from;
        if (!isValidYMD(from) || !isValidYMD(to)) return null;
        return from <= to ? { from, to } : { from: to, to: from };
      })
      .filter(Boolean)
      .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));

    const merged = [];
    for (const range of prepared) {
      const prev = merged[merged.length - 1];
      if (!prev) {
        merged.push(range);
        continue;
      }
      if (range.from <= prev.to) {
        if (range.to > prev.to) prev.to = range.to;
      } else {
        merged.push(range);
      }
    }

    return merged;
  }

  function isDateExcluded(ymd, excludedRanges) {
    if (!isValidYMD(ymd)) return false;
    return normalizeExcludedDateRanges(excludedRanges).some(range => ymd >= range.from && ymd <= range.to);
  }

  function sanitizeReportUrl(candidate) {
    const fallback = DEFAULT_SETTINGS.reportUrl;
    if (typeof candidate !== "string") return fallback;

    try {
      const url = new URL(candidate.trim());
      if (url.origin !== REPORT_URL_BASE.origin) return fallback;
      if (!url.pathname.startsWith("/time_entries/report")) return fallback;
      return url.toString();
    } catch {
      return fallback;
    }
  }

  function normalizeMinHours(value, fallback = DEFAULT_SETTINGS.minHoursPerDay) {
    if (value == null) return fallback;
    if (typeof value === "string" && value.trim() === "") return fallback;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 && n <= 24 ? n : fallback;
  }

  function normalizeLunchDurationMinutes(value, fallback = DEFAULT_SETTINGS.lunchDurationMinutes) {
    if (value == null) return fallback;
    if (typeof value === "string" && value.trim() === "") return fallback;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 && n <= 1440 ? n : fallback;
  }

  function isValidTime(value) {
    return typeof value === "string" && /^([0-1]?\d|2[0-3]):([0-5]\d)$/.test(value.trim());
  }

  function normalizeTime(value, fallback) {
    return isValidTime(value) ? value.trim() : fallback;
  }



  function normalizeBoolean(value, fallback) {
    return typeof value === "boolean" ? value : fallback;
  }

  function normalizeWorkingDays(value, fallback = DEFAULT_SETTINGS.workingDays) {
    if (!Array.isArray(value)) return [...fallback];

    const normalized = Array.from(
      new Set(
        value
          .map(Number)
          .filter(day => Number.isInteger(day) && day >= 0 && day <= 6)
      )
    );

    return normalized.length ? normalized : [...fallback];
  }

  function normalizeSettings(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    return {
      ...DEFAULT_SETTINGS,
      ...source,
      reportUrl: sanitizeReportUrl(source.reportUrl),
      minHoursPerDay: normalizeMinHours(source.minHoursPerDay),
      highlight: normalizeBoolean(source.highlight, DEFAULT_SETTINGS.highlight),
      debug: normalizeBoolean(source.debug, DEFAULT_SETTINGS.debug),
      workStart: normalizeTime(source.workStart, DEFAULT_SETTINGS.workStart),
      workEnd: normalizeTime(source.workEnd, DEFAULT_SETTINGS.workEnd),
      lunchStart: normalizeTime(source.lunchStart, DEFAULT_SETTINGS.lunchStart),
      lunchDurationMinutes: normalizeLunchDurationMinutes(source.lunchDurationMinutes),
      workingDays: normalizeWorkingDays(source.workingDays),
      excludedDateRanges: normalizeExcludedDateRanges(source.excludedDateRanges)
    };
  }

  function formatHours(value) {
    if (!Number.isFinite(value)) return "0";
    const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
    const normalized = Object.is(rounded, -0) ? 0 : rounded;
    if (Number.isInteger(normalized)) return String(normalized);
    return normalized.toFixed(2).replace(/\.?0+$/, "");
  }

  global.RM8H_SHARED = {
    DEFAULT_SETTINGS,
    REPORT_ORIGIN: REPORT_URL_BASE.origin,
    normalizeExcludedDateRanges,
    isDateExcluded,
    sanitizeReportUrl,
    normalizeMinHours,
    normalizeLunchDurationMinutes,
    normalizeSettings,
    formatHours
  };
})(globalThis);
