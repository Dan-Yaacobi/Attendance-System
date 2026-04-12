const ISO_DATE_PREFIX = /^(\d{4})-(\d{2})-(\d{2})/;

export function extractCalendarDateParts(rawDate) {
  if (!rawDate) {
    return null;
  }

  const rawValue = String(rawDate).trim();
  const isoPrefixMatch = rawValue.match(ISO_DATE_PREFIX);
  if (isoPrefixMatch) {
    const [, year, month, day] = isoPrefixMatch;
    return { year, month, day };
  }

  const parsedDate = new Date(rawValue);
  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  return {
    year: String(parsedDate.getUTCFullYear()),
    month: String(parsedDate.getUTCMonth() + 1).padStart(2, '0'),
    day: String(parsedDate.getUTCDate()).padStart(2, '0')
  };
}

export function formatCalendarDate(rawDate, fallback = 'לא זמין') {
  const parts = extractCalendarDateParts(rawDate);
  if (!parts) {
    return rawDate ? String(rawDate) : fallback;
  }

  return `${parts.day}-${parts.month}-${parts.year}`;
}

export function toIsoCalendarDate(rawDate) {
  const parts = extractCalendarDateParts(rawDate);
  if (!parts) {
    return rawDate ? String(rawDate) : '';
  }

  return `${parts.year}-${parts.month}-${parts.day}`;
}
