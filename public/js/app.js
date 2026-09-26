(function () {
  "use strict";

  /* ---------------------------------------------------------------- */
  /* Config                                                            */
  /* ---------------------------------------------------------------- */

  const WORKER_ENDPOINT = "/api/holidays";
  const DIRECT_SHEET_URL =
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vRmdr9UYdJ5vV_s1su3WeLlMvMk1qsGIko2QxLI5y4MVOy-ZwSGF6WWJ3QhnLIV9d4CzRtxjqO3myez/pub?gid=863779762&single=true&output=csv";
  const APP_URL = "https://global-holidays.suvadipchakraborty.workers.dev";
  const FEEDBACK_EMAIL = "suvadipchakraborty@gmail.com";

  const TYPE_COLORS = {
    "public holiday": "#E8A33D",
    "bank holiday": "#3E7CB1",
    religious: "#8E5B9F",
    cultural: "#D9534F",
    observance: "#2C8C7C",
    national: "#E8A33D",
    default: "#8A8272",
  };

  const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

  /* ---------------------------------------------------------------- */
  /* State                                                              */
  /* ---------------------------------------------------------------- */

  const today = new Date();
  const todayISO = isoOf(today);

  const state = {
    holidays: [],
    byDate: new Map(),
    byCountry: new Map(),
    view: "month", // month | week | day
    cursor: startOfDay(today), // date currently centered in the active view
    tab: "home", // home | about
    countryFilter: null,
  };

  /* ---------------------------------------------------------------- */
  /* DOM refs                                                           */
  /* ---------------------------------------------------------------- */

  const $ = (sel) => document.querySelector(sel);
  const el = {
    splash: $("#splash"),
    banner: $("#today-banner"),
    bannerTrack: $("#today-banner-track"),
    monthLabel: $("#current-period-label"),
    grid: $("#calendar-grid"),
    weekdayRow: $("#weekday-row"),
    viewSwitch: $("#view-switch"),
    prevBtn: $("#nav-prev"),
    todayBtn: $("#nav-today"),
    nextPeriodBtn: $("#nav-next"),
    sheet: $("#holiday-sheet"),
    sheetBackdrop: $("#sheet-backdrop"),
    sheetTitle: $("#sheet-title"),
    sheetList: $("#sheet-list"),
    explorer: $("#country-explorer"),
    explorerList: $("#explorer-list"),
    explorerSearch: $("#explorer-search"),
    explorerClose: $("#explorer-close"),
    explorerOpen: $("#open-explorer"),
    creditModal: $("#credit-modal"),
    creditOpen: $("#open-credit"),
    creditClose: $("#credit-close"),
    tabHome: $("#tab-home"),
    tabAbout: $("#tab-about"),
    viewHome: $("#view-home"),
    viewAbout: $("#view-about"),
    liveRegion: $("#a11y-live"),
  };

  /* ---------------------------------------------------------------- */
  /* Data loading                                                       */
  /* ---------------------------------------------------------------- */

  async function loadHolidays() {
    const attempts = [];
    let text = null;
    let sourceLabel = null;

    try {
      const res = await fetch(WORKER_ENDPOINT, { cache: "no-store" });
      const body = res.ok ? await res.text() : await res.text().catch(() => "");
      attempts.push({
        label: "Worker proxy (/api/holidays)",
        url: WORKER_ENDPOINT,
        ok: res.ok,
        status: res.status,
        length: body.length,
        preview: body.slice(0, 300),
      });
      if (res.ok && body) {
        text = body;
        sourceLabel = "Worker proxy (/api/holidays)";
      }
    } catch (err) {
      attempts.push({
        label: "Worker proxy (/api/holidays)",
        url: WORKER_ENDPOINT,
        ok: false,
        status: "network error",
        length: 0,
        preview: String(err && err.message ? err.message : err),
      });
    }

    if (!text) {
      try {
        const res = await fetch(DIRECT_SHEET_URL, { cache: "no-store" });
        const body = res.ok ? await res.text() : await res.text().catch(() => "");
        attempts.push({
          label: "Direct Google Sheets fetch",
          url: DIRECT_SHEET_URL,
          ok: res.ok,
          status: res.status,
          length: body.length,
          preview: body.slice(0, 300),
        });
        if (res.ok && body) {
          text = body;
          sourceLabel = "Direct Google Sheets fetch";
        }
      } catch (err) {
        attempts.push({
          label: "Direct Google Sheets fetch",
          url: DIRECT_SHEET_URL,
          ok: false,
          status: "network error (likely CORS)",
          length: 0,
          preview: String(err && err.message ? err.message : err),
        });
      }
    }

    if (!text) {
      const err = new Error("Could not load holiday data from either source.");
      err.diagnostics = { attempts, sourceLabel: null };
      throw err;
    }

    const trimmed = text.trim();
    if (trimmed.startsWith("<!DOCTYPE") || trimmed.startsWith("<html")) {
      const err = new Error(
        "The data source returned a webpage instead of CSV data — the Google Sheet may not be published, or the link may have changed. In Google Sheets, check File → Share → Publish to web is still active for this sheet/tab."
      );
      err.diagnostics = { attempts, sourceLabel };
      throw err;
    }

    const rows = parseCSV(text);
    const analysis = analyzeCSV(rows);
    analysis.diagnostics = { attempts, sourceLabel };
    return analysis;
  }

  function indexHolidays(list) {
    state.holidays = list;
    state.byDate = new Map();
    state.byCountry = new Map();

    for (const h of list) {
      if (!state.byDate.has(h.dateISO)) state.byDate.set(h.dateISO, []);
      state.byDate.get(h.dateISO).push(h);

      const key = h.country || "Global";
      if (!state.byCountry.has(key)) state.byCountry.set(key, []);
      state.byCountry.get(key).push(h);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Date helpers                                                       */
  /* ---------------------------------------------------------------- */

  function isoOf(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`;
  }
  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  function addDays(d, n) {
    const copy = new Date(d);
    copy.setDate(copy.getDate() + n);
    return copy;
  }
  function addMonths(d, n) {
    return new Date(d.getFullYear(), d.getMonth() + n, 1);
  }
  function startOfWeek(d) {
    return addDays(d, -d.getDay());
  }

  /* ---------------------------------------------------------------- */
  /* Flags                                                              */
  /* ---------------------------------------------------------------- */

  const COUNTRY_TO_ISO2 = {
    "united states": "US", usa: "US", america: "US",
    "united kingdom": "GB", uk: "GB", britain: "GB",
    india: "IN", china: "CN", japan: "JP", "south korea": "KR", korea: "KR",
    france: "FR", germany: "DE", italy: "IT", spain: "ES", portugal: "PT",
    russia: "RU", brazil: "BR", mexico: "MX", canada: "CA", australia: "AU",
    "new zealand": "NZ", netherlands: "NL", belgium: "BE", switzerland: "CH",
    austria: "AT", sweden: "SE", norway: "NO", denmark: "DK", finland: "FI",
    poland: "PL", greece: "GR", turkey: "TR", israel: "IL", "saudi arabia": "SA",
    "united arab emirates": "AE", uae: "AE", egypt: "EG", "south africa": "ZA",
    nigeria: "NG", kenya: "KE", morocco: "MA", ghana: "GH", ethiopia: "ET",
    indonesia: "ID", malaysia: "MY", singapore: "SG", thailand: "TH",
    vietnam: "VN", philippines: "PH", pakistan: "PK", bangladesh: "BD",
    "sri lanka": "LK", nepal: "NP", ireland: "IE", scotland: "GB", wales: "GB",
    ukraine: "UA", romania: "RO", hungary: "HU", "czech republic": "CZ",
    czechia: "CZ", "saudi arabia ": "SA", argentina: "AR", chile: "CL",
    colombia: "CO", peru: "PE", venezuela: "VE", cuba: "CU", jamaica: "JM",
    iceland: "IS", "hong kong": "HK", taiwan: "TW", iran: "IR", iraq: "IQ",
    jordan: "JO", lebanon: "LB", qatar: "QA", kuwait: "KW", oman: "OM",
    bahrain: "BH", global: "", world: "", international: "",
  };

  function flagFor(country) {
    if (!country) return "🌍";
    const key = country.trim().toLowerCase();
    if (key === "global" || key === "world" || key === "international") return "🌍";
    const iso2 = COUNTRY_TO_ISO2[key];
    if (iso2 === "") return "🌍";
    const code = iso2 || guessISO2(key);
    if (!code || code.length !== 2) return "🏳️";
    const base = 127397;
    return String.fromCodePoint(...[...code.toUpperCase()].map((c) => base + c.charCodeAt(0)));
  }

  function guessISO2(name) {
    // Very light heuristic fallback for names not in the table: try the
    // first two letters. Better than nothing, never breaks rendering.
    return null;
  }

  function colorFor(type) {
    const key = (type || "").trim().toLowerCase();
    return TYPE_COLORS[key] || TYPE_COLORS.default;
  }

  /* ---------------------------------------------------------------- */
  /* Rendering: Today banner                                            */
  /* ---------------------------------------------------------------- */

  function renderTodayBanner() {
    const list = state.byDate.get(todayISO) || [];
    el.bannerTrack.innerHTML = "";

    if (!list.length) {
      el.banner.classList.add("is-empty");
      el.bannerTrack.innerHTML = `<p class="banner-empty">No recorded observances today — check tomorrow, or browse the calendar.</p>`;
      return;
    }

    el.banner.classList.remove("is-empty");
    list.forEach((h) => {
      const chip = document.createElement("button");
      chip.className = "banner-chip";
      chip.style.setProperty("--chip-color", colorFor(h.type));
      chip.innerHTML = `
        <span class="banner-chip__flag">${flagFor(h.country)}</span>
        <span class="banner-chip__text">
          <span class="banner-chip__name">${escapeHTML(h.name)}</span>
          <span class="banner-chip__country">${escapeHTML(h.country)}</span>
        </span>`;
      chip.addEventListener("click", () => openSingleHoliday(h));
      el.bannerTrack.appendChild(chip);
    });
  }

  /* ---------------------------------------------------------------- */
  /* Rendering: Calendar (month / week / day)                          */
  /* ---------------------------------------------------------------- */

  function renderCalendar() {
    el.weekdayRow.style.display = state.view === "day" ? "none" : "grid";
    if (state.view === "month") renderMonth();
    else if (state.view === "week") renderWeek();
    else renderDay();
  }

  function renderMonth() {
    const cursor = state.cursor;
    el.monthLabel.textContent = `${MONTH_NAMES[cursor.getMonth()]} ${cursor.getFullYear()}`;
    el.weekdayRow.innerHTML = WEEKDAY_LABELS.map((w) => `<span>${w}</span>`).join("");

    const firstOfMonth = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const gridStart = startOfWeek(firstOfMonth);

    el.grid.className = "calendar-grid calendar-grid--month";
    el.grid.innerHTML = "";

    for (let i = 0; i < 42; i++) {
      const day = addDays(gridStart, i);
      const iso = isoOf(day);
      const inMonth = day.getMonth() === cursor.getMonth();
      const isToday = iso === todayISO;
      const dayHolidays = state.byDate.get(iso) || [];

      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "day-cell" + (inMonth ? "" : " day-cell--muted") + (isToday ? " day-cell--today" : "");
      cell.setAttribute("aria-label", `${day.toDateString()}${dayHolidays.length ? `, ${dayHolidays.length} observance(s)` : ""}`);

      const dots = dayHolidays
        .slice(0, 3)
        .map((h) => `<span class="day-dot" style="background:${colorFor(h.type)}"></span>`)
        .join("");

      cell.innerHTML = `
        <span class="day-number">${day.getDate()}</span>
        ${isToday ? '<span class="day-stamp" aria-hidden="true"></span>' : ""}
        <span class="day-dots">${dots}${dayHolidays.length > 3 ? '<span class="day-dot day-dot--more"></span>' : ""}</span>`;

      if (dayHolidays.length) {
        cell.addEventListener("click", () => openDateSheet(iso));
      } else {
        cell.classList.add("day-cell--empty");
        cell.addEventListener("click", () => openDateSheet(iso));
      }
      el.grid.appendChild(cell);
    }

    attachSwipe(el.grid, () => changeMonth(1), () => changeMonth(-1));
  }

  function renderWeek() {
    const start = startOfWeek(state.cursor);
    const end = addDays(start, 6);
    el.monthLabel.textContent = `${MONTH_NAMES[start.getMonth()].slice(0, 3)} ${start.getDate()} – ${MONTH_NAMES[end.getMonth()].slice(0, 3)} ${end.getDate()}, ${end.getFullYear()}`;
    el.weekdayRow.innerHTML = WEEKDAY_LABELS.map((w) => `<span>${w}</span>`).join("");

    el.grid.className = "calendar-grid calendar-grid--week";
    el.grid.innerHTML = "";

    for (let i = 0; i < 7; i++) {
      const day = addDays(start, i);
      const iso = isoOf(day);
      const isToday = iso === todayISO;
      const dayHolidays = state.byDate.get(iso) || [];

      const col = document.createElement("div");
      col.className = "week-col" + (isToday ? " week-col--today" : "");
      col.innerHTML = `
        <button type="button" class="week-col__head">
          <span class="day-number">${day.getDate()}</span>
          ${isToday ? '<span class="day-stamp" aria-hidden="true"></span>' : ""}
        </button>
        <div class="week-col__items"></div>`;

      const itemsWrap = col.querySelector(".week-col__items");
      dayHolidays.slice(0, 4).forEach((h) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "week-item";
        item.style.setProperty("--chip-color", colorFor(h.type));
        item.innerHTML = `${flagFor(h.country)} <span>${escapeHTML(h.name)}</span>`;
        item.addEventListener("click", (e) => {
          e.stopPropagation();
          openSingleHoliday(h);
        });
        itemsWrap.appendChild(item);
      });
      if (dayHolidays.length > 4) {
        const more = document.createElement("span");
        more.className = "week-item week-item--more";
        more.textContent = `+${dayHolidays.length - 4} more`;
        itemsWrap.appendChild(more);
      }

      col.querySelector(".week-col__head").addEventListener("click", () => openDateSheet(iso));
      el.grid.appendChild(col);
    }

    attachSwipe(el.grid, () => changeWeek(1), () => changeWeek(-1));
  }

  function renderDay() {
    const day = state.cursor;
    const iso = isoOf(day);
    const isToday = iso === todayISO;
    el.monthLabel.textContent = `${day.toLocaleDateString(undefined, { weekday: "long" })}, ${MONTH_NAMES[day.getMonth()]} ${day.getDate()}, ${day.getFullYear()}`;

    el.grid.className = "calendar-grid calendar-grid--day";
    el.grid.innerHTML = "";

    const list = state.byDate.get(iso) || [];
    if (!list.length) {
      el.grid.innerHTML = `<div class="day-empty">
        <p>No recorded holidays or observances on this date${isToday ? " — yet." : "."}</p>
      </div>`;
    } else {
      list.forEach((h) => el.grid.appendChild(buildHolidayRow(h, { standalone: true })));
    }

    attachSwipe(el.grid, () => changeDay(1), () => changeDay(-1));
  }

  function changeMonth(delta) {
    state.cursor = addMonths(state.cursor, delta);
    renderCalendar();
  }
  function changeWeek(delta) {
    state.cursor = addDays(state.cursor, delta * 7);
    renderCalendar();
  }
  function changeDay(delta) {
    state.cursor = addDays(state.cursor, delta);
    renderCalendar();
  }
  function goToToday() {
    state.cursor = startOfDay(new Date());
    renderCalendar();
  }

  /* Simple swipe: left = next period, right = previous period. */
  function attachSwipe(node, onNext, onPrev) {
    let startX = null;
    let startY = null;
    node.addEventListener(
      "touchstart",
      (e) => {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
      },
      { passive: true }
    );
    node.addEventListener(
      "touchend",
      (e) => {
        if (startX === null) return;
        const dx = e.changedTouches[0].clientX - startX;
        const dy = e.changedTouches[0].clientY - startY;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
          if (dx < 0) onNext();
          else onPrev();
        }
        startX = null;
        startY = null;
      },
      { passive: true }
    );
  }

  /* ---------------------------------------------------------------- */
  /* Bottom sheet + holiday rows                                       */
  /* ---------------------------------------------------------------- */

  function buildHolidayRow(h, opts = {}) {
    const row = document.createElement("article");
    row.className = "holiday-row";
    row.style.setProperty("--chip-color", colorFor(h.type));
    row.innerHTML = `
      <header class="holiday-row__head">
        <span class="holiday-row__flag">${flagFor(h.country)}</span>
        <div class="holiday-row__titles">
          <h3>${escapeHTML(h.name)}</h3>
          <p class="holiday-row__meta">${escapeHTML(h.country)} · <span class="type-tag">${escapeHTML(h.type)}</span></p>
        </div>
        <button type="button" class="icon-btn share-btn" aria-label="Share ${escapeHTML(h.name)}">${ICONS.share}</button>
      </header>
      ${h.description ? `<p class="holiday-row__desc">${escapeHTML(h.description)}</p>` : ""}
    `;
    row.querySelector(".share-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      shareHoliday(h);
    });
    if (!opts.standalone) {
      row.classList.add("holiday-row--compact");
    }
    return row;
  }

  function openDateSheet(iso) {
    const list = state.byDate.get(iso) || [];
    const d = new Date(iso + "T00:00:00");
    el.sheetTitle.textContent = `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
    el.sheetList.innerHTML = "";

    if (!list.length) {
      el.sheetList.innerHTML = `<p class="day-empty">No recorded holidays or observances on this date.</p>`;
    } else {
      list.forEach((h) => el.sheetList.appendChild(buildHolidayRow(h, { standalone: true })));
    }
    openSheet();
  }

  function openSingleHoliday(h) {
    el.sheetTitle.textContent = h.name;
    el.sheetList.innerHTML = "";
    el.sheetList.appendChild(buildHolidayRow(h, { standalone: true }));
    openSheet();
  }

  function openSheet() {
    el.sheet.classList.add("is-open");
    el.sheetBackdrop.classList.add("is-open");
    el.sheet.setAttribute("aria-hidden", "false");
    document.body.classList.add("no-scroll");
  }
  function closeSheet() {
    el.sheet.classList.remove("is-open");
    el.sheetBackdrop.classList.remove("is-open");
    el.sheet.setAttribute("aria-hidden", "true");
    document.body.classList.remove("no-scroll");
  }

  /* ---------------------------------------------------------------- */
  /* Country explorer                                                   */
  /* ---------------------------------------------------------------- */

  function renderExplorerList(filterText = "") {
    const countries = [...state.byCountry.keys()].sort((a, b) => a.localeCompare(b));
    const q = filterText.trim().toLowerCase();
    el.explorerList.innerHTML = "";

    countries
      .filter((c) => c.toLowerCase().includes(q))
      .forEach((c) => {
        const count = state.byCountry.get(c).length;
        const item = document.createElement("button");
        item.type = "button";
        item.className = "explorer-item";
        item.innerHTML = `
          <span class="explorer-item__flag">${flagFor(c)}</span>
          <span class="explorer-item__name">${escapeHTML(c)}</span>
          <span class="explorer-item__count">${count}</span>`;
        item.addEventListener("click", () => openCountryHolidays(c));
        el.explorerList.appendChild(item);
      });

    if (!el.explorerList.children.length) {
      el.explorerList.innerHTML = `<p class="day-empty">No countries match "${escapeHTML(filterText)}".</p>`;
    }
  }

  function openCountryHolidays(country) {
    closeExplorer();
    const list = (state.byCountry.get(country) || [])
      .slice()
      .sort((a, b) => a.dateISO.localeCompare(b.dateISO));
    el.sheetTitle.textContent = `${flagFor(country)} ${country}`;
    el.sheetList.innerHTML = "";
    if (!list.length) {
      el.sheetList.innerHTML = `<p class="day-empty">No recorded holidays for ${escapeHTML(country)} yet.</p>`;
    } else {
      list.forEach((h) => {
        const row = buildHolidayRow(h, { standalone: true });
        const dateLine = document.createElement("p");
        dateLine.className = "holiday-row__date";
        dateLine.textContent = formatLongDate(h.dateISO);
        row.querySelector(".holiday-row__titles").appendChild(dateLine);
        el.sheetList.appendChild(row);
      });
    }
    openSheet();
  }

  function openExplorer() {
    el.explorer.classList.add("is-open");
    el.explorer.setAttribute("aria-hidden", "false");
    el.explorerSearch.value = "";
    renderExplorerList();
    document.body.classList.add("no-scroll");
    setTimeout(() => el.explorerSearch.focus(), 150);
  }
  function closeExplorer() {
    el.explorer.classList.remove("is-open");
    el.explorer.setAttribute("aria-hidden", "true");
    document.body.classList.remove("no-scroll");
  }

  function formatLongDate(iso) {
    const d = new Date(iso + "T00:00:00");
    return `${d.toLocaleDateString(undefined, { weekday: "long" })}, ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  }

  /* ---------------------------------------------------------------- */
  /* Sharing                                                            */
  /* ---------------------------------------------------------------- */

  async function shareHoliday(h) {
    const text = `${h.name} (${h.country}) — ${h.description || "a global observance"}. Discovered on Cultural Compass.`;
    const shareData = { title: h.name, text, url: APP_URL };
    if (navigator.share) {
      try {
        await navigator.share(shareData);
        return;
      } catch (_) {
        /* user cancelled — no-op */
        return;
      }
    }
    fallbackShare(text + " " + APP_URL);
  }

  async function shareApp() {
    const shareData = {
      title: "Cultural Compass",
      text: "Discover global cultural holidays and observances, every day.",
      url: APP_URL,
    };
    if (navigator.share) {
      try {
        await navigator.share(shareData);
        return;
      } catch (_) {
        return;
      }
    }
    fallbackShare(APP_URL);
  }

  function fallbackShare(text) {
    if (navigator.clipboard) {
      navigator.clipboard
        .writeText(text)
        .then(() => announce("Link copied to clipboard."))
        .catch(() => announce(text));
    } else {
      window.open(
        `https://wa.me/?text=${encodeURIComponent(text)}`,
        "_blank",
        "noopener"
      );
    }
  }

  /* ---------------------------------------------------------------- */
  /* Tabs                                                               */
  /* ---------------------------------------------------------------- */

  function setTab(tab) {
    state.tab = tab;
    el.viewHome.classList.toggle("is-active", tab === "home");
    el.viewAbout.classList.toggle("is-active", tab === "about");
    el.tabHome.classList.toggle("is-active", tab === "home");
    el.tabAbout.classList.toggle("is-active", tab === "about");
    el.tabHome.setAttribute("aria-current", tab === "home" ? "page" : "false");
    el.tabAbout.setAttribute("aria-current", tab === "about" ? "page" : "false");
  }

  /* ---------------------------------------------------------------- */
  /* Misc utils                                                         */
  /* ---------------------------------------------------------------- */

  function escapeHTML(str) {
    return String(str ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function announce(msg) {
    if (!el.liveRegion) return;
    el.liveRegion.textContent = "";
    requestAnimationFrame(() => (el.liveRegion.textContent = msg));
  }

  const ICONS = {
    share:
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/><line x1="15.4" y1="6.5" x2="8.6" y2="10.5"/></svg>',
  };

  /* ---------------------------------------------------------------- */
  /* Wire up events                                                     */
  /* ---------------------------------------------------------------- */

  function bindEvents() {
    el.viewSwitch.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-view]");
      if (!btn) return;
      state.view = btn.dataset.view;
      [...el.viewSwitch.children].forEach((c) =>
        c.classList.toggle("is-active", c === btn)
      );
      renderCalendar();
    });

    $("#nav-prev").addEventListener("click", () => stepPeriod(-1));
    $("#nav-next").addEventListener("click", () => stepPeriod(1));
    $("#nav-today").addEventListener("click", goToToday);

    el.sheetBackdrop.addEventListener("click", closeSheet);
    $("#sheet-close").addEventListener("click", closeSheet);

    el.explorerOpen.addEventListener("click", openExplorer);
    el.explorerClose.addEventListener("click", closeExplorer);
    el.explorerSearch.addEventListener("input", (e) => renderExplorerList(e.target.value));

    el.creditOpen.addEventListener("click", () => el.creditModal.classList.add("is-open"));
    el.creditClose.addEventListener("click", () => el.creditModal.classList.remove("is-open"));
    el.creditModal.addEventListener("click", (e) => {
      if (e.target === el.creditModal) el.creditModal.classList.remove("is-open");
    });

    el.tabHome.addEventListener("click", () => setTab("home"));
    el.tabAbout.addEventListener("click", () => setTab("about"));

    $("#share-app-btn").addEventListener("click", shareApp);

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeSheet();
        closeExplorer();
        el.creditModal.classList.remove("is-open");
      }
    });
  }

  function stepPeriod(delta) {
    if (state.view === "month") changeMonth(delta);
    else if (state.view === "week") changeWeek(delta);
    else changeDay(delta);
  }

  /* ---------------------------------------------------------------- */
  /* Init                                                               */
  /* ---------------------------------------------------------------- */

  function renderDiagnostics(diag, extra = "") {
    const attempts = (diag && diag.attempts) || [];
    const attemptsHTML = attempts
      .map(
        (a) => `
        <div class="diag-attempt">
          <p><strong>${escapeHTML(a.label)}</strong> — status: ${escapeHTML(String(a.status))}, ${a.length} chars received</p>
          <pre class="diag-pre">${escapeHTML(a.preview || "(empty)")}</pre>
        </div>`
      )
      .join("");

    return `
      <details class="diag-block" open>
        <summary>Diagnostics (what the app actually received)</summary>
        ${extra ? `<p>${extra}</p>` : ""}
        ${attemptsHTML || "<p>No fetch attempts were recorded.</p>"}
      </details>`;
  }

  async function init() {
    bindEvents();
    try {
      const result = await loadHolidays();
      const list = result.holidays;
      indexHolidays(list);

      if (!list.length) {
        const cols = result.columns || {};
        const colLine = (label, idx) =>
          `${label}: ${idx >= 0 ? `matched column "${escapeHTML(result.header[idx] || "")}"` : "<strong>no matching column found</strong>"}`;

        const rejectedHTML = (result.rejectedSample || [])
          .map((r) => `<li>${escapeHTML(r.reason)} — row: ${escapeHTML(JSON.stringify(r.row))}</li>`)
          .join("");

        console.warn("[Cultural Compass] 0 holiday rows recognized.", result);

        el.splash.innerHTML = `
          <div class="splash-error">
            <p>Connected, but couldn't turn the feed into any holidays.</p>
            <p style="font-size:0.8rem;opacity:0.75;">
              Header row seen: ${result.header && result.header.length ? escapeHTML(result.header.join(" | ")) : "(no header row found)"}<br/>
              ${colLine("Date", cols.dateIdx)}<br/>
              ${colLine("Name", cols.nameIdx)}<br/>
              ${colLine("Country", cols.countryIdx)}<br/>
              Data rows seen: ${result.totalDataRows || 0}
            </p>
            ${rejectedHTML ? `<details class="diag-block" open><summary>Why rows were skipped</summary><ul style="text-align:left;font-size:0.75rem;">${rejectedHTML}</ul></details>` : ""}
            ${renderDiagnostics(result.diagnostics)}
            <button id="retry-btn" class="btn-primary">Try again</button>
          </div>`;
        $("#retry-btn").addEventListener("click", () => location.reload());
        return;
      }

      renderTodayBanner();
      renderCalendar();
      el.splash.classList.add("is-hidden");
      setTimeout(() => el.splash.remove(), 500);
    } catch (err) {
      console.error("[Cultural Compass] Failed to load holidays:", err);
      el.splash.innerHTML = `
        <div class="splash-error">
          <p>We couldn't load the holiday calendar.</p>
          <p style="font-size:0.8rem;opacity:0.75;">${escapeHTML(err && err.message ? err.message : "Unknown error")}</p>
          ${renderDiagnostics(err && err.diagnostics)}
          <button id="retry-btn" class="btn-primary">Try again</button>
        </div>`;
      $("#retry-btn").addEventListener("click", () => location.reload());
    }

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
