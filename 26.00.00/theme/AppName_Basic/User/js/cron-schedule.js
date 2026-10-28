function parseField(field, min, max, normalizeSunday = false) {
  if (typeof field !== "string" || !field.length) throw new Error("Cron fields cannot be empty.");
  const values = new Set();
  for (const segment of field.split(",")) {
    if (!segment) throw new Error("Cron fields cannot contain empty list items.");
    const pieces = segment.split("/");
    if (pieces.length > 2) throw new Error("Cron fields may contain at most one step separator.");
    const base = pieces[0];
    const step = pieces.length === 2 ? Number(pieces[1]) : 1;
    if (!Number.isInteger(step) || step < 1 || step > max - min + 1) throw new Error("Cron steps must be a positive integer within the field range.");
    let start, end;
    if (base === "*") {
      start = min;
      end = max;
    } else if (base.includes("-")) {
      const range = base.split("-");
      if (range.length !== 2 || !/^\d+$/.test(range[0]) || !/^\d+$/.test(range[1])) throw new Error("Cron ranges must use numeric start-end values.");
      start = Number(range[0]);
      end = Number(range[1]);
    } else {
      if (!/^\d+$/.test(base)) throw new Error("Cron fields support only numeric values, ranges, lists, wildcards and steps.");
      start = Number(base);
      end = pieces.length === 2 ? max : start;
    }
    if (start < min || start > max || end < min || end > max || start > end) throw new Error(`Cron value must be between ${min} and ${max}.`);
    for (let value = start; value <= end; value += step) {
      values.add(normalizeSunday && value === 7 ? 0 : value);
    }
  }
  return { values, wildcard: field === "*" };
}

export function parseCronExpression(expression) {
  if (typeof expression !== "string") throw new Error("Cron expression must be a string.");
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error("Cron expression must have five fields: minute hour day-of-month month day-of-week.");
  return {
    minute: parseField(parts[0], 0, 59),
    hour: parseField(parts[1], 0, 23),
    dayOfMonth: parseField(parts[2], 1, 31),
    month: parseField(parts[3], 1, 12),
    dayOfWeek: parseField(parts[4], 0, 7, true)
  };
}

export function cronMatches(expression, date = new Date()) {
  const parsed = typeof expression === "string" ? parseCronExpression(expression) : expression;
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw new Error("A valid Date is required.");
  const minuteMatch = parsed.minute.values.has(date.getUTCMinutes());
  const hourMatch = parsed.hour.values.has(date.getUTCHours());
  const domMatch = parsed.dayOfMonth.values.has(date.getUTCDate());
  const monthMatch = parsed.month.values.has(date.getUTCMonth() + 1);
  const dowMatch = parsed.dayOfWeek.values.has(date.getUTCDay());
  const dayMatch = parsed.dayOfMonth.wildcard ? dowMatch
    : parsed.dayOfWeek.wildcard ? domMatch
    : domMatch || dowMatch;
  return minuteMatch && hourMatch && monthMatch && dayMatch;
}

export function isValidCronExpression(expression) {
  try { parseCronExpression(expression); return true; }
  catch { return false; }
}
