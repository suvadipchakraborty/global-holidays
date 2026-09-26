/**
 * Minimal, dependency-free CSV parser.
 * Handles quoted fields, embedded commas, embedded newlines, and
 * escaped quotes ("") inside quoted fields — enough to safely read a
 * Google Sheets "publish to CSV" export without pulling in PapaParse.
 */
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  // Google Sheets' CSV export prepends a UTF-8 BOM (\uFEFF). Left in place,
  // it silently glues itself to the first header cell ("Date" becomes
  // "\uFEFFDate"), which then fails every header match below and makes
  // every row look unparseable. Strip it before anything else.
  const src = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");

  for (let i = 0; i < src.length; i++) {
    const char = src[i];
    const next = src[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  // Flush the last field/row if the file doesn't end with a newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/**
 * Turn parsed CSV rows into holiday objects, matching header names
 * loosely (case/space-insensitive) so small spreadsheet edits don't
 * break the app: Date, Holiday Name, Description, Country, Type.
 */
function rowsToHolidays(rows) {
  return analyzeCSV(rows).holidays;
}

/**
 * Same parsing as rowsToHolidays, but also returns a diagnostic report:
 * which header row we saw, which column each field matched to (or -1 if
 * unmatched), how many data rows existed vs. how many actually turned
 * into a holiday, and a sample of rejected rows with the reason. Used to
 * render an on-screen diagnostics panel when nothing loads, so the
 * problem is visible without needing devtools.
 */
function analyzeCSV(rows) {
  if (!rows.length) {
    return {
      holidays: [],
      header: [],
      columns: { dateIdx: -1, nameIdx: -1, descIdx: -1, countryIdx: -1, typeIdx: -1 },
      totalDataRows: 0,
      rejectedSample: [],
    };
  }

  const rawHeader = rows[0];
  const header = rawHeader.map((h) =>
    h.replace(/[\uFEFF\u200B]/g, "").trim().toLowerCase()
  );

  // Substring matching instead of exact matching: tolerates real-world
  // header variations like "Holiday Name", "Name of holiday", "Event",
  // "Country / Region", "Category", etc.
  const findCol = (keywords) =>
    header.findIndex((h) => keywords.some((k) => h.includes(k)));

  const dateIdx = findCol(["date"]);
  const nameIdx = findCol(["holiday name", "holiday", "event", "name", "title"]);
  const descIdx = findCol(["description", "detail", "significance", "about", "summary"]);
  const countryIdx = findCol(["country", "region", "nation"]);
  const typeIdx = findCol(["type", "categor"]);

  const holidays = [];
  const rejectedSample = [];
  let totalDataRows = 0;

  for (let i = 1; i < rows.length; i++) {
    const cols = rows[i];
    if (!cols || cols.every((c) => !c || !c.trim())) continue;
    totalDataRows++;

    const rawDate = dateIdx >= 0 ? (cols[dateIdx] || "").trim() : "";
    const iso = parseFlexibleDate(rawDate);

    if (!iso) {
      if (rejectedSample.length < 5) {
        rejectedSample.push({
          row: cols,
          reason:
            dateIdx < 0
              ? "No column looked like a Date column at all."
              : `Couldn't parse "${rawDate}" as a date.`,
        });
      }
      continue;
    }

    holidays.push({
      dateISO: iso,
      name: (nameIdx >= 0 ? cols[nameIdx] : "") || "Untitled observance",
      description: (descIdx >= 0 ? cols[descIdx] : "") || "",
      country: ((countryIdx >= 0 ? cols[countryIdx] : "") || "Global").trim(),
      type: ((typeIdx >= 0 ? cols[typeIdx] : "") || "Observance").trim(),
    });
  }

  return {
    holidays,
    header: rawHeader,
    columns: { dateIdx, nameIdx, descIdx, countryIdx, typeIdx },
    totalDataRows,
    rejectedSample,
  };
}

/**
 * Accepts YYYY-MM-DD, M/D/YYYY, D-M-YYYY, "January 1, 2026", etc.
 * Returns a YYYY-MM-DD string (local, no timezone shifting) or null.
 */
function parseFlexibleDate(raw) {
  if (!raw) return null;
  const s = raw.trim();

  // 2026-01-01
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return toISO(+m[1], +m[2], +m[3]);

  // 1/1/2026 or 01-01-2026 (assume M/D/Y, the common US sheet format)
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) return toISO(+m[3], +m[1], +m[2]);

  // "January 1, 2026" / "Jan 1 2026"
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    return toISO(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate());
  }

  return null;
}

function toISO(y, m, d) {
  const mm = String(m).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  return `${y}-${mm}-${dd}`;
}
