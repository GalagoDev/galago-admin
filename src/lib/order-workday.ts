const WORKDAY_TIME_ZONE = "Europe/Sarajevo";
const CUTOFF_HOUR = 8;

type CalendarDate = {
  year: number;
  month: number;
  day: number;
};

type ZonedDateParts = CalendarDate & {
  hour: number;
  minute: number;
  second: number;
};

const zonedPartsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: WORKDAY_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function zonedParts(date: Date): ZonedDateParts {
  const parts = Object.fromEntries(
    zonedPartsFormatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );

  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

function addCalendarDays(date: CalendarDate, days: number): CalendarDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days, 12));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function weekday(date: CalendarDate) {
  return new Date(Date.UTC(date.year, date.month - 1, date.day, 12)).getUTCDay();
}

function nextWeekday(date: CalendarDate) {
  let result = date;
  while (weekday(result) === 0 || weekday(result) === 6) result = addCalendarDays(result, 1);
  return result;
}

function previousWeekday(date: CalendarDate) {
  let result = addCalendarDays(date, -1);
  while (weekday(result) === 0 || weekday(result) === 6) result = addCalendarDays(result, -1);
  return result;
}

function timeZoneOffsetMs(date: Date) {
  const local = zonedParts(date);
  const representedAsUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
  return representedAsUtc - Math.floor(date.getTime() / 1000) * 1000;
}

function atSarajevoCutoff(date: CalendarDate) {
  const approximateUtc = Date.UTC(date.year, date.month - 1, date.day, CUTOFF_HOUR);
  let result = new Date(approximateUtc - timeZoneOffsetMs(new Date(approximateUtc)));
  result = new Date(approximateUtc - timeZoneOffsetMs(result));
  return result;
}

export function formatWorkdayLabel(date: CalendarDate) {
  return `${String(date.day).padStart(2, "0")}/${String(date.month).padStart(2, "0")}/${date.year}`;
}

export function getTargetWorkdayLabel(now = new Date()) {
  const local = zonedParts(now);
  const calendarDate = { year: local.year, month: local.month, day: local.day };
  const cycleEndDate = nextWeekday(local.hour >= CUTOFF_HOUR ? addCalendarDays(calendarDate, 1) : calendarDate);
  return formatWorkdayLabel(cycleEndDate);
}

export function getLatestCompletedExportWindow(now = new Date()) {
  const local = zonedParts(now);
  let endDate: CalendarDate = { year: local.year, month: local.month, day: local.day };

  if (local.hour < CUTOFF_HOUR) endDate = addCalendarDays(endDate, -1);
  while (weekday(endDate) === 0 || weekday(endDate) === 6) endDate = addCalendarDays(endDate, -1);

  const startDate = previousWeekday(endDate);
  const start = atSarajevoCutoff(startDate);
  const end = atSarajevoCutoff(endDate);

  return {
    start,
    end,
    startLabel: formatWorkdayLabel(startDate),
    endLabel: formatWorkdayLabel(endDate),
    marker: `export:${end.toISOString()}`,
  };
}

