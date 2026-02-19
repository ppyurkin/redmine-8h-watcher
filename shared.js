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

  function formatHours(value) {
    if (!Number.isFinite(value)) return "0";
    if (Number.isInteger(value)) return String(value);
    return String(value);
  }

  global.RM8H_SHARED = {
    DEFAULT_SETTINGS,
    REPORT_ORIGIN: REPORT_URL_BASE.origin,
    normalizeExcludedDateRanges,
    isDateExcluded,
    sanitizeReportUrl,
    formatHours
  };
})(globalThis);
