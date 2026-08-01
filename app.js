/**
 * GNOME desktop preview — interactive shell
 * Layouts: Dash to Dock (bottom floating), Left panel (side panel, no floating dock)
 */

const APPS = [
  {
    id: "software",
    name: "Software",
    icon: "assets/apps/org.gnome.Software.png",
  },
  {
    id: "contacts",
    name: "Address Book",
    icon: "assets/apps/org.gnome.Contacts.png",
  },
  {
    id: "scanner",
    name: "Document Scanner",
    icon: "assets/apps/org.gnome.SimpleScan.png",
  },
  {
    id: "startcenter",
    name: "LibreOffice",
    icon: "assets/apps/org.libreoffice.LibreOffice.startcenter.png",
  },
  {
    id: "base",
    name: "LibreOffice Base",
    icon: "assets/apps/org.libreoffice.LibreOffice.base.png",
  },
  {
    id: "calc",
    name: "LibreOffice Calc",
    icon: "assets/apps/org.libreoffice.LibreOffice.calc.png",
  },
  {
    id: "draw",
    name: "LibreOffice Draw",
    icon: "assets/apps/org.libreoffice.LibreOffice.draw.png",
  },
  {
    id: "impress",
    name: "LibreOffice Impress",
    icon: "assets/apps/org.libreoffice.LibreOffice.impress.png",
  },
  {
    id: "math",
    name: "LibreOffice Math",
    icon: "assets/apps/org.libreoffice.LibreOffice.math.png",
  },
  {
    id: "writer",
    name: "LibreOffice Writer",
    icon: "assets/apps/org.libreoffice.LibreOffice.writer.png",
  },
  {
    id: "papers",
    name: "Papers",
    icon: "assets/apps/org.gnome.Papers.png",
  },
];

const desktop = document.getElementById("desktop");
const workspaceIndicators = document.getElementById("workspace-indicators");
const workspaceLayer = document.getElementById("workspace-layer");
const workspaceTrack = document.getElementById("workspace-track");
const workspaceHitStrip = document.getElementById("workspace-hit-strip");
const showAppsBtn = document.getElementById("show-apps-btn");
const appMenu = document.getElementById("app-menu");
const appMenuBackdrop = document.getElementById("app-menu-backdrop");
const appGrid = document.getElementById("app-grid");
const appSearch = document.getElementById("app-search");
const appEmpty = document.getElementById("app-empty");

/* ---------- Workspaces (GNOME Shell parity) ----------
 * Constants from gnome-shell:
 *   ANIMATION_TIME / SIDE_CONTROLS / WINDOW_ANIMATION = 250ms
 *   SCROLL_TIMEOUT_TIME = 150ms
 *   SMALL_WORKSPACE_RATIO = 0.15
 *   WORKSPACE_MIN_SPACING = 24
 *   WORKSPACE_SPACING (switch gap) = 100
 *   WORKSPACE_INACTIVE_SCALE = 0.94
 */
const WORKSPACE_COUNT = 3;
const OVERVIEW_MS = 250;
const SWITCH_MS = 250;
const SCROLL_TIMEOUT_MS = 150;
const SMALL_WORKSPACE_RATIO = 0.15;
const WS_MIN_SPACING = 24;
const WS_SWITCH_GAP = 100;

/** Active workspace index (0-based). */
let activeWorkspace = 0;
/** Fractional progress for pill morph (tracks active during animation). */
let workspaceProgress = 0;
let canWorkspaceScroll = true;
let overviewOpen = false;
let overviewAnimating = false;
let switchAnimating = false;
let overviewCloseTimer = 0;
let switchAnimTimer = 0;
/** Workspace index that currently hosts Nautilus (if open). */
let nautilusWorkspace = 0;
/** Workspace index that currently hosts Settings (if open). */
let settingsWorkspace = 0;
/** Workspace index that currently hosts Software (if open). */
let softwareWorkspace = 0;

const workspacePanes = () =>
  workspaceTrack
    ? [...workspaceTrack.querySelectorAll(".workspace-pane")]
    : [];

function panelHeightPx() {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue("--panel-height")
    .trim();
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : 32;
}

function getWorkArea() {
  const rect = desktop.getBoundingClientRect();
  const top = panelHeightPx();
  return {
    top,
    left: 0,
    width: Math.max(1, rect.width),
    height: Math.max(1, rect.height - top),
    desktopTop: rect.top,
    desktopLeft: rect.left,
  };
}

/**
 * App-grid workspace strip geometry (overviewControls + workspacesView).
 * height ≈ 15% of work area; spacing = 24px; side padding = spacing.
 *
 * Strip top is computed from fixed CSS (not getBoundingClientRect on animated
 * overview chrome) so the open animation doesn't end with a remeasure jump.
 * Matches: .app-menu padding-top = panel + 28; search h=44; .app-search-wrap margin-bottom=28.
 */
function getOverviewStripGeometry(workArea) {
  const n = WORKSPACE_COUNT;
  const spacing = WS_MIN_SPACING;
  const stripH = Math.round(workArea.height * SMALL_WORKSPACE_RATIO);
  const aspect = workArea.width / workArea.height;
  const stripTop = panelHeightPx() + 28 + 44 + 28;

  const availableWidth = workArea.width - spacing * (n + 1);
  let paneW = availableWidth / n;
  let paneH = paneW / aspect;
  if (paneH > stripH) {
    paneH = stripH;
    paneW = paneH * aspect;
  }
  // Integer sizes; derive scale from width only so height stays aspect-true
  paneW = Math.round(paneW);
  paneH = Math.round(paneW / aspect);

  const totalW = paneW * n + spacing * (n - 1);
  const left = Math.round((workArea.width - totalW) / 2);

  return {
    top: stripTop,
    left,
    paneW,
    paneH,
    spacing,
    totalW,
    height: paneH,
    width: totalW,
  };
}

function applyWorkspaceGeometry({ mode, progress = activeWorkspace, animate = false }) {
  if (!workspaceLayer || !workspaceTrack) return;

  const wa = getWorkArea();
  const root = desktop.style;
  const layer = workspaceLayer.style;
  const track = workspaceTrack.style;
  let contentScale = 1;

  root.setProperty("--ws-full-w", `${wa.width}px`);
  root.setProperty("--ws-full-h", `${wa.height}px`);

  if (animate) {
    desktop.classList.add("ws-animate-geometry");
  } else {
    desktop.classList.remove("ws-animate-geometry");
  }

  let paneW = wa.width;

  if (mode === "overview") {
    const strip = getOverviewStripGeometry(wa);
    // Scale by width so the full work-area maps into the pane without a
    // height mismatch (which read as a jump when the transition ended).
    contentScale = strip.paneW / wa.width;
    paneW = strip.paneW;

    layer.top = `${strip.top}px`;
    layer.left = `${strip.left}px`;
    layer.width = `${strip.totalW}px`;
    layer.height = `${strip.paneH}px`;

    track.gap = `${strip.spacing}px`;
    track.transform = "translate3d(0px, 0, 0)";

    root.setProperty("--ws-hit-w", `${strip.paneW}px`);
    root.setProperty("--ws-hit-h", `${strip.paneH}px`);

    if (workspaceHitStrip) {
      workspaceHitStrip.style.setProperty("--ws-hit-w", `${strip.paneW}px`);
      workspaceHitStrip.style.setProperty("--ws-hit-h", `${strip.paneH}px`);
    }
  } else {
    // Desktop: single-fit horizontal strip (panes full work-area width)
    const trackX = -progress * paneW;

    layer.top = `${wa.top}px`;
    layer.left = "0px";
    layer.width = `${wa.width}px`;
    layer.height = `${wa.height}px`;

    track.gap = "0px";
    track.transform = `translate3d(${trackX}px, 0, 0)`;
  }

  // Per-pane size + content scale (no radius/shadow — Shell workspaces are square-edged here)
  workspaceTrack.querySelectorAll(".workspace-pane").forEach((pane) => {
    pane.style.width = `${paneW}px`;
    pane.style.borderRadius = "0";
    pane.style.boxShadow = "none";
    const scaler = pane.querySelector(".workspace-pane-scaler");
    if (scaler) scaler.style.transform = `scale(${contentScale})`;
  });
}

/**
 * Keep the layout switcher in the active workspace scaler, above the pane
 * wallpaper and under .workspace-pane-windows (so windows cover it).
 */
function placeLayoutChooser() {
  const chooser = document.getElementById("layout-chooser");
  if (!chooser) return;
  const host = document.querySelector(
    `#workspace-pane-${activeWorkspace} .workspace-pane-scaler`
  );
  const windows = document.getElementById(`workspace-windows-${activeWorkspace}`);
  if (!host || !windows) return;
  if (chooser.parentElement === host && chooser.nextElementSibling === windows) return;
  host.insertBefore(chooser, windows);
}

function updateWorkspaceChrome(progress = workspaceProgress) {
  workspaceProgress = progress;
  const panes = workspacePanes();
  const hits = workspaceHitStrip
    ? workspaceHitStrip.querySelectorAll(".workspace-hit")
    : [];
  const dots = workspaceIndicators
    ? workspaceIndicators.querySelectorAll(".workspace-indicator")
    : [];

  panes.forEach((pane, i) => {
    const on = i === activeWorkspace;
    pane.classList.toggle("active", on);
  });

  placeLayoutChooser();

  hits.forEach((hit, i) => {
    const on = i === activeWorkspace;
    hit.classList.toggle("active", on);
    hit.setAttribute("aria-selected", on ? "true" : "false");
  });

  dots.forEach((dot, i) => {
    const distance = Math.abs(i - progress);
    const expansion = Math.max(0, Math.min(1, 1 - distance));
    dot.style.setProperty("--dot-expansion", String(expansion));
    // aria / active class for non-animated consumers
    dot.classList.toggle("active", Math.round(progress) === i);
  });
}

function placeWindowOnWorkspace(el, workspaceIndex) {
  if (!el) return;
  const host = document.getElementById(`workspace-windows-${workspaceIndex}`);
  if (host && el.parentElement !== host) {
    host.appendChild(el);
  }
}

function placeNautilusOnWorkspace() {
  placeWindowOnWorkspace(
    document.getElementById("nautilus-window"),
    nautilusWorkspace
  );
}

function placeSettingsOnWorkspace() {
  placeWindowOnWorkspace(
    document.getElementById("settings-window"),
    settingsWorkspace
  );
}

function placeSoftwareOnWorkspace() {
  placeWindowOnWorkspace(
    document.getElementById("software-window"),
    softwareWorkspace
  );
}

/**
 * Switch workspace. Outside overview: 250ms horizontal slide.
 * Inside overview: update active only (all panes already visible).
 */
function switchToWorkspace(index, { animate = true } = {}) {
  const n = WORKSPACE_COUNT;
  const target = Math.max(0, Math.min(n - 1, index));
  if (target === activeWorkspace && !switchAnimating) {
    updateWorkspaceChrome(target);
    return;
  }

  const from = activeWorkspace;
  activeWorkspace = target;

  if (overviewOpen || overviewAnimating) {
    // No desktop slide while overview is open (GNOME _shouldAnimate)
    workspaceProgress = target;
    updateWorkspaceChrome(target);
    applyWorkspaceGeometry({ mode: "overview", progress: target, animate: false });
    return;
  }

  if (!animate || from === target) {
    workspaceProgress = target;
    updateWorkspaceChrome(target);
    applyWorkspaceGeometry({ mode: "desktop", progress: target, animate: false });
    return;
  }

  // Desktop slide animation (250ms ease-out-cubic)
  switchAnimating = true;

  // 1) Snap to current workspace without transition
  desktop.classList.remove("ws-animate-switch");
  applyWorkspaceGeometry({ mode: "desktop", progress: from, animate: false });
  void workspaceTrack.offsetWidth;

  // 2) Enable transition, then move track to target
  desktop.classList.add("ws-animate-switch");
  requestAnimationFrame(() => {
    applyWorkspaceGeometry({ mode: "desktop", progress: target, animate: false });
  });

  // 3) Pill expansion in lockstep with the slide
  const start = performance.now();
  const startProgress = from;
  const endProgress = target;
  updateWorkspaceChrome(startProgress);

  function tick(now) {
    const t = Math.min(1, (now - start) / SWITCH_MS);
    // ease-out-cubic
    const eased = 1 - Math.pow(1 - t, 3);
    workspaceProgress = startProgress + (endProgress - startProgress) * eased;
    updateWorkspaceChrome(workspaceProgress);
    if (t < 1) {
      requestAnimationFrame(tick);
    } else {
      workspaceProgress = endProgress;
      updateWorkspaceChrome(endProgress);
      switchAnimating = false;
      desktop.classList.remove("ws-animate-switch");
      applyWorkspaceGeometry({ mode: "desktop", progress: endProgress, animate: false });
    }
  }
  requestAnimationFrame(tick);
}

function setActiveWorkspace(index, opts) {
  switchToWorkspace(index, opts);
}

function handleWorkspaceScroll(deltaY, deltaX = 0) {
  if (!canWorkspaceScroll) return;
  if (overviewAnimating) return;

  let dir = 0;
  if (Math.abs(deltaY) >= Math.abs(deltaX)) {
    if (deltaY === 0) return;
    // Wheel down → next (matches Clutter.ScrollDirection.DOWN → RIGHT)
    dir = deltaY > 0 ? 1 : -1;
  } else {
    if (deltaX === 0) return;
    dir = deltaX > 0 ? 1 : -1;
  }

  const next = activeWorkspace + dir;
  if (next < 0 || next >= WORKSPACE_COUNT) return;

  canWorkspaceScroll = false;
  setTimeout(() => {
    canWorkspaceScroll = true;
  }, SCROLL_TIMEOUT_MS);

  switchToWorkspace(next, { animate: !overviewOpen });
}

function initWorkspaces() {
  placeNautilusOnWorkspace();
  placeSettingsOnWorkspace();
  placeSoftwareOnWorkspace();
  workspaceProgress = activeWorkspace;
  updateWorkspaceChrome(activeWorkspace);
  applyWorkspaceGeometry({ mode: "desktop", progress: activeWorkspace, animate: false });

  const onWorkspaceWheel = (e) => {
    e.preventDefault();
    e.stopPropagation();
    handleWorkspaceScroll(e.deltaY, e.deltaX);
  };

  // Scroll on workspace pills → switch (ActivitiesButton.vfunc_scroll_event)
  if (workspaceIndicators) {
    workspaceIndicators.addEventListener("wheel", onWorkspaceWheel, {
      passive: false,
    });
  }

  // Scroll on Show Apps (dash) while desktop is visible — same as Shell dash scroll
  if (showAppsBtn) {
    showAppsBtn.addEventListener(
      "wheel",
      (e) => {
        // Only when not in overview (user asked for desktop behaviour on this control)
        if (overviewOpen || overviewAnimating) return;
        onWorkspaceWheel(e);
      },
      { passive: false }
    );
  }

  // Scroll over live workspace previews while app menu is open
  if (workspaceLayer) {
    workspaceLayer.addEventListener(
      "wheel",
      (e) => {
        if (!overviewOpen) return;
        onWorkspaceWheel(e);
      },
      { passive: false }
    );
  }

  // Click workspace card in app menu → activate + leave overview
  if (workspaceHitStrip) {
    workspaceHitStrip.addEventListener("click", (e) => {
      const hit = e.target.closest(".workspace-hit");
      if (!hit) return;
      e.stopPropagation();
      const index = Number(hit.dataset.workspace);
      if (Number.isNaN(index)) return;
      enterWorkspaceFromOverview(index);
    });
  }

  // Also allow clicking the live panes in overview
  if (workspaceTrack) {
    workspaceTrack.addEventListener("click", (e) => {
      if (!overviewOpen) return;
      const pane = e.target.closest(".workspace-pane");
      if (!pane) return;
      e.stopPropagation();
      const index = Number(pane.dataset.workspace);
      if (Number.isNaN(index)) return;
      enterWorkspaceFromOverview(index);
    });
  }

  window.addEventListener("resize", () => {
    if (overviewAnimating) return;
    applyWorkspaceGeometry({
      mode: overviewOpen ? "overview" : "desktop",
      progress: activeWorkspace,
      animate: false,
    });
  });
}

const systemMenuBtn = document.getElementById("system-menu-btn");
const quickSettings = document.getElementById("quick-settings");
const powerMenuBtn = document.getElementById("power-menu-btn");
const powerMenu = document.getElementById("power-menu");
const clockBtn = document.getElementById("clock-btn");
const clockText = document.getElementById("clock-text");
const calendarPopover = document.getElementById("calendar-popover");
const calMonthLabel = document.getElementById("cal-month-label");
const calWeekday = document.getElementById("cal-weekday");
const calFullDate = document.getElementById("cal-full-date");
const calGrid = document.getElementById("cal-grid");
const calPrev = document.getElementById("cal-prev");
const calNext = document.getElementById("cal-next");
const volumeSlider = document.getElementById("volume-slider");
const worldclockAtlanta = document.getElementById("worldclock-atlanta");

/** Month currently shown in the calendar grid (year/month), not necessarily "today". */
let viewYear;
let viewMonth;

/* ---------- Clock ---------- */

function formatClock(date) {
  const weekday = date.toLocaleDateString(undefined, { weekday: "short" });
  const time = date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  });
  return `${weekday} ${time}`;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function updateWorldClock(now = new Date()) {
  // Atlanta ≈ America/New_York; use Intl when available
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/New_York",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZoneName: "shortOffset",
    }).formatToParts(now);

    const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
    const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
    const tz =
      parts.find((p) => p.type === "timeZoneName")?.value?.replace("GMT", "") ??
      "";
    const offset = tz.replace("UTC", "").trim() || "";
    worldclockAtlanta.innerHTML = `${hour}:${minute} <span class="worldclock-offset">${offset}</span>`;
  } catch {
    worldclockAtlanta.textContent = formatClock(now).split(" ").slice(1).join(" ");
  }
}

function tickClock() {
  const now = new Date();
  clockText.textContent = formatClock(now);
  if (!calendarPopover.hidden) {
    updateWorldClock(now);
  }
}

tickClock();
setInterval(tickClock, 1000 * 15);

/* ---------- Calendar (week starts Monday, GNOME style) ---------- */

function setViewToToday() {
  const now = new Date();
  viewYear = now.getFullYear();
  viewMonth = now.getMonth();
}

function buildCalendar() {
  const now = new Date();
  const todayY = now.getFullYear();
  const todayM = now.getMonth();
  const todayD = now.getDate();

  calWeekday.textContent = now.toLocaleDateString(undefined, { weekday: "long" });
  calFullDate.textContent = now.toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const labelDate = new Date(viewYear, viewMonth, 1);
  calMonthLabel.textContent = labelDate.toLocaleDateString(undefined, {
    month: "long",
  });

  // Monday-first: convert JS Sunday=0 → Monday=0
  const firstDow = new Date(viewYear, viewMonth, 1).getDay(); // 0=Sun
  const mondayIndex = (firstDow + 6) % 7;
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const daysInPrev = new Date(viewYear, viewMonth, 0).getDate();

  calGrid.innerHTML = "";

  // GNOME always paints a fixed 6×7 grid (42 cells), including months that
  // only need 4–5 weeks, so the popover height never changes or scrolls.
  const TOTAL_CELLS = 42;

  for (let i = 0; i < TOTAL_CELLS; i++) {
    const dayOffset = i - mondayIndex; // 0 = 1st of current month
    const el = document.createElement("div");

    if (dayOffset < 0) {
      el.className = "cal-day muted";
      el.textContent = pad2(daysInPrev + dayOffset + 1);
    } else if (dayOffset < daysInMonth) {
      const d = dayOffset + 1;
      const isToday =
        d === todayD && viewMonth === todayM && viewYear === todayY;
      el.className = "cal-day" + (isToday ? " today" : "");
      el.textContent = pad2(d);
    } else {
      el.className = "cal-day muted";
      el.textContent = pad2(dayOffset - daysInMonth + 1);
    }

    calGrid.appendChild(el);
  }

  updateWorldClock(now);
}

setViewToToday();

/* ---------- App grid ---------- */

function renderApps(filter = "") {
  const q = filter.trim().toLowerCase();
  const list = q
    ? APPS.filter((a) => a.name.toLowerCase().includes(q))
    : APPS;

  appGrid.innerHTML = "";
  appEmpty.hidden = list.length > 0;

  for (const app of list) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "app-tile";
    btn.setAttribute("role", "listitem");
    btn.title = app.name;
    btn.dataset.app = app.id;
    btn.innerHTML = `
      <img src="${app.icon}" alt="" draggable="false" />
      <span class="app-tile-label">${app.name}</span>
    `;
    btn.addEventListener("click", () => {
      btn.classList.add("pressed");
      setTimeout(() => btn.classList.remove("pressed"), 150);
      if (app.id === "software") {
        closeAppMenu({ activate: true });
        openSoftware();
      }
    });
    appGrid.appendChild(btn);
  }
}

renderApps();

/* ---------- Panel state helpers ---------- */

function setExpanded(btn, open) {
  if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");
}

function isAppMenuOpen() {
  return overviewOpen || (!appMenu.hidden && !appMenu.classList.contains("is-closing"));
}

/**
 * Open app grid overview: live workspaces scale from full work-area into the
 * strip under search (HIDDEN → APP_GRID box interpolation, 250ms ease-out-sine).
 */
function openAppMenu() {
  if (overviewOpen || overviewAnimating) return;

  closeQuickSettings();
  closeCalendar();

  if (overviewCloseTimer) {
    clearTimeout(overviewCloseTimer);
    overviewCloseTimer = 0;
  }

  overviewAnimating = true;
  desktop.classList.remove("overview-closing");
  appMenu.classList.remove("is-closing");
  appMenu.hidden = false;

  // Lay out hit-strip first so strip geometry can be measured
  setExpanded(showAppsBtn, true);
  setExpanded(workspaceIndicators, true);

  // Start at desktop geometry (no transition), then animate to overview
  desktop.classList.remove("ws-animate-geometry", "overview-open");
  applyWorkspaceGeometry({ mode: "desktop", progress: activeWorkspace, animate: false });
  void workspaceLayer.offsetWidth;

  desktop.classList.add("overview-animating", "ws-animate-geometry", "overview-open");
  overviewOpen = true;

  // One frame later: apply target overview geometry so CSS transitions run.
  // Geometry is stable (no live remeasure of animated chrome) to avoid an end jump.
  requestAnimationFrame(() => {
    applyWorkspaceGeometry({
      mode: "overview",
      progress: activeWorkspace,
      animate: true,
    });
    updateWorkspaceChrome(activeWorkspace);
    try {
      appSearch.focus({ preventScroll: true });
    } catch {
      appSearch.focus();
    }
  });

  window.setTimeout(() => {
    overviewAnimating = false;
    desktop.classList.remove("overview-animating");
    // Drop transition flags only — do not re-apply geometry (that caused a visible jump)
    desktop.classList.remove("ws-animate-geometry");
  }, OVERVIEW_MS + 30);
}

/**
 * Leave overview back to desktop. If `toIndex` is set, that workspace becomes
 * active (app-grid click). Animation: strip → full work-area (250ms ease-out-quad).
 */
function closeAppMenu(options = {}) {
  const { toIndex = null } = options;

  if (!overviewOpen && appMenu.hidden) {
    // Already closed — still honour forced index
    if (toIndex != null) switchToWorkspace(toIndex, { animate: false });
    return;
  }

  if (overviewAnimating && overviewOpen && toIndex == null) {
    // Ignore double-close during open animation unless selecting a workspace
  }

  if (overviewCloseTimer) {
    clearTimeout(overviewCloseTimer);
    overviewCloseTimer = 0;
  }

  if (toIndex != null && toIndex !== activeWorkspace) {
    activeWorkspace = Math.max(0, Math.min(WORKSPACE_COUNT - 1, toIndex));
    workspaceProgress = activeWorkspace;
    updateWorkspaceChrome(activeWorkspace);
  }

  overviewAnimating = true;
  overviewOpen = false;

  desktop.classList.add("overview-animating", "ws-animate-geometry", "overview-closing");
  desktop.classList.remove("overview-open");
  appMenu.classList.add("is-closing");

  // Animate layer from current overview box to full desktop
  applyWorkspaceGeometry({ mode: "desktop", progress: activeWorkspace, animate: true });

  setExpanded(showAppsBtn, false);
  setExpanded(workspaceIndicators, false);

  overviewCloseTimer = window.setTimeout(() => {
    overviewCloseTimer = 0;
    appMenu.hidden = true;
    appMenu.classList.remove("is-closing");
    desktop.classList.remove(
      "overview-animating",
      "overview-closing",
      "ws-animate-geometry"
    );
    overviewAnimating = false;
    appSearch.value = "";
    renderApps();
    // Final desktop layout without re-running a transition (values already at end state)
    applyWorkspaceGeometry({ mode: "desktop", progress: activeWorkspace, animate: false });
  }, OVERVIEW_MS + 30);
}

/** Click a workspace in the app menu: activate it and leave overview. */
function enterWorkspaceFromOverview(index) {
  if (!overviewOpen && appMenu.hidden) return;
  if (overviewAnimating && !overviewOpen) return;
  closeAppMenu({ toIndex: index });
}

function toggleAppMenu() {
  if (overviewAnimating) return;
  if (overviewOpen) closeAppMenu();
  else openAppMenu();
}

function closeQuickSettings() {
  quickSettings.hidden = true;
  powerMenu.hidden = true;
  setExpanded(systemMenuBtn, false);
}

function openQuickSettings() {
  closeAppMenu();
  closeCalendar();
  quickSettings.hidden = false;
  setExpanded(systemMenuBtn, true);
}

function toggleQuickSettings() {
  if (quickSettings.hidden) openQuickSettings();
  else closeQuickSettings();
}

function closeCalendar() {
  calendarPopover.hidden = true;
  setExpanded(clockBtn, false);
}

function openCalendar() {
  closeAppMenu();
  closeQuickSettings();
  setViewToToday();
  buildCalendar();
  calendarPopover.hidden = false;
  setExpanded(clockBtn, true);
}

function toggleCalendar() {
  if (calendarPopover.hidden) openCalendar();
  else closeCalendar();
}

function closeAll() {
  closeAppMenu();
  closeQuickSettings();
  closeCalendar();
}

/* ---------- Event wiring ---------- */

// Workspace indicator block: click toggles overview (scroll is wired in initWorkspaces)
workspaceIndicators.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleAppMenu();
});

showAppsBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleAppMenu();
});

appMenuBackdrop.addEventListener("click", () => closeAppMenu());

appSearch.addEventListener("input", () => {
  renderApps(appSearch.value);
});

systemMenuBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleQuickSettings();
});

clockBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleCalendar();
});

powerMenuBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  powerMenu.hidden = !powerMenu.hidden;
});

// Quick setting toggles
document.querySelectorAll(".qs-toggle").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const on = !btn.classList.contains("active");
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");

    if (btn.dataset.toggle === "dark") {
      setDarkStyle(on);
      if (typeof settingsState !== "undefined") settingsState.darkStyle = on;
    } else if (btn.dataset.toggle === "night") {
      setNightLight(on);
      if (typeof settingsState !== "undefined") settingsState.nightLight = on;
    } else if (btn.dataset.toggle === "power-mode") {
      updatePowerMode(on);
      if (typeof settingsState !== "undefined") {
        settingsState.powerMode = on ? "performance" : "balanced";
      }
    } else if (btn.dataset.toggle === "dnd") {
      if (typeof settingsState !== "undefined") settingsState.dnd = on;
    }
  });
});

/** Power Mode: on = Performance, off = Balanced */
function updatePowerMode(performance) {
  const btn = document.querySelector('.qs-toggle[data-toggle="power-mode"]');
  if (!btn) return;
  const sub = btn.querySelector(".qs-toggle-sub");
  const icon = btn.querySelector("img.sym");
  if (sub) sub.textContent = performance ? "Performance" : "Balanced";
  if (icon) {
    icon.src = performance
      ? "assets/status/power-profile-performance-symbolic.svg"
      : "assets/status/power-profile-balanced-symbolic.svg";
  }
}

/* ---------- Dark / light style ---------- */

function setDarkStyle(enabled) {
  document.documentElement.setAttribute(
    "data-theme",
    enabled ? "dark" : "light"
  );
  const darkToggle = document.getElementById("dark-style-toggle");
  if (darkToggle) {
    darkToggle.classList.toggle("active", enabled);
    darkToggle.setAttribute("aria-pressed", enabled ? "true" : "false");
  }
  if (typeof updateVolumeFill === "function") updateVolumeFill();
}

/* ---------- Night Light (warm color temperature) ---------- */

/**
 * Map UI temp 0…100 (cool→warm) to overlay strength.
 * GNOME range is ~4700K (cool) … ~1700K (warm); higher UI value = warmer.
 */
function applyNightLightTemperature(temp) {
  const t = Math.max(0, Math.min(100, Number(temp) || 0)) / 100;
  // Warmth: mild amber at cool end → strong orange at warm end
  const multiplyA = 0.1 + t * 0.38;
  const softA = 0.12 + t * 0.45;
  // Shift hue slightly: pale peach (cool) → deep orange (warm)
  const r = 255;
  const g = Math.round(210 - t * 90); // 210 → 120
  const b = Math.round(160 - t * 110); // 160 → 50
  const root = document.documentElement;
  root.style.setProperty("--nl-multiply-alpha", String(multiplyA));
  root.style.setProperty("--nl-soft-alpha", String(softA));
  root.style.setProperty("--nl-r", String(r));
  root.style.setProperty("--nl-g", String(g));
  root.style.setProperty("--nl-b", String(b));
}

function setNightLight(enabled) {
  document.documentElement.setAttribute(
    "data-night-light",
    enabled ? "on" : "off"
  );
  const nightToggle = document.getElementById("night-light-toggle");
  if (nightToggle) {
    nightToggle.classList.toggle("active", enabled);
    nightToggle.setAttribute("aria-pressed", enabled ? "true" : "false");
  }
  const overlay = document.getElementById("night-light-overlay");
  if (overlay) {
    overlay.setAttribute("aria-hidden", enabled ? "false" : "true");
  }
  if (enabled && typeof settingsState !== "undefined") {
    applyNightLightTemperature(settingsState.nightTemp);
  }
}

// Defaults
setDarkStyle(true);
applyNightLightTemperature(62);
setNightLight(false);

// Volume slider fill — blue filled (left) + grey track (right); thumb via CSS
function updateVolumeFill() {
  const pct = Number(volumeSlider.value);
  const light =
    document.documentElement.getAttribute("data-theme") === "light";
  if (light) {
    // Light QS: accent blue left, grey right; black thumb in CSS
    volumeSlider.style.background = `linear-gradient(to right, #3584e4 ${pct}%, #c6c6c6 ${pct}%)`;
  } else {
    volumeSlider.style.background = `linear-gradient(to right, #99c1f1 ${pct}%, rgba(255,255,255,0.18) ${pct}%)`;
  }
}
volumeSlider.addEventListener("input", updateVolumeFill);
updateVolumeFill();

// Calendar month navigation
calPrev.addEventListener("click", (e) => {
  e.stopPropagation();
  viewMonth -= 1;
  if (viewMonth < 0) {
    viewMonth = 11;
    viewYear -= 1;
  }
  buildCalendar();
});

calNext.addEventListener("click", (e) => {
  e.stopPropagation();
  viewMonth += 1;
  if (viewMonth > 11) {
    viewMonth = 0;
    viewYear += 1;
  }
  buildCalendar();
});

// Dock apps
document.querySelectorAll(".dock-item[data-app]").forEach((item) => {
  item.addEventListener("click", (e) => {
    e.stopPropagation();
    const app = item.dataset.app;
    item.style.transform = "scale(0.94)";
    setTimeout(() => {
      item.style.transform = "";
    }, 120);

    if (app === "files") {
      toggleNautilus();
      return;
    }
    if (app === "settings") {
      toggleSettings();
      return;
    }
    // Other dock apps: visual feedback only
  });
});

// Prevent popovers / overview chrome from closing via document click
quickSettings.addEventListener("click", (e) => e.stopPropagation());
powerMenu.addEventListener("click", (e) => e.stopPropagation());
calendarPopover.addEventListener("click", (e) => e.stopPropagation());
document.querySelector(".app-menu-content")?.addEventListener("click", (e) => {
  e.stopPropagation();
});

// Click outside closes shell panels (not app windows)
document.addEventListener("click", () => {
  if (typeof startOverlay !== "undefined" && startOverlay && !startOverlay.hidden) return;
  closeAll();
});

// Keyboard
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (typeof startOverlay !== "undefined" && startOverlay && !startOverlay.hidden) {
      /* Keep overlay until they choose fullscreen or continue */
      return;
    }
    if (!powerMenu.hidden) {
      powerMenu.hidden = true;
      return;
    }
    if (overviewOpen || !appMenu.hidden || !quickSettings.hidden || !calendarPopover.hidden) {
      closeAll();
      return;
    }
    if (settingsSearchOpen) {
      setSettingsSearchOpen(false);
      return;
    }
    if (settingsSubpage) {
      settingsSubpage = null;
      renderSettingsContent();
      return;
    }
    if (settingsWindow && !settingsWindow.hidden) {
      closeSettings();
      return;
    }
    if (softwareWindow && !softwareWindow.hidden) {
      if (softwareSearchOpen) {
        setSoftwareSearchOpen(false);
        return;
      }
      if (softwareView === "details" || softwareView === "category") {
        softwareShowMain();
        return;
      }
      closeSoftware();
      return;
    }
    if (nauSearchOpen) {
      setNautilusSearchOpen(false);
      return;
    }
    if (!nautilusWindow.hidden) {
      closeNautilus();
      return;
    }
    return;
  }

  // Ctrl+F in Files → search
  if (
    (e.ctrlKey || e.metaKey) &&
    e.key.toLowerCase() === "f" &&
    !nautilusWindow.hidden
  ) {
    e.preventDefault();
    setNautilusSearchOpen(true);
    return;
  }

  // Ctrl+F in Settings → search
  if (
    (e.ctrlKey || e.metaKey) &&
    e.key.toLowerCase() === "f" &&
    settingsWindow &&
    !settingsWindow.hidden
  ) {
    e.preventDefault();
    setSettingsSearchOpen(true);
    return;
  }

  // Ctrl+F in Software → search
  if (
    (e.ctrlKey || e.metaKey) &&
    e.key.toLowerCase() === "f" &&
    softwareWindow &&
    !softwareWindow.hidden &&
    softwareView === "main"
  ) {
    e.preventDefault();
    setSoftwareSearchOpen(true);
    return;
  }

  // Type-to-search when overview closed: open it
  if (
    !overviewOpen &&
    appMenu.hidden &&
    nautilusWindow.hidden &&
    (!settingsWindow || settingsWindow.hidden) &&
    (!softwareWindow || softwareWindow.hidden) &&
    e.key.length === 1 &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.altKey &&
    document.activeElement === document.body
  ) {
    openAppMenu();
    requestAnimationFrame(() => {
      appSearch.value = e.key;
      renderApps(appSearch.value);
    });
  }
});

// Stop top-bar / dock clicks from immediately closing panels
document.querySelector(".top-bar").addEventListener("click", (e) => {
  e.stopPropagation();
});

document.getElementById("dock").addEventListener("click", (e) => {
  e.stopPropagation();
});

/* ---------- Layout switching (Dash to Dock / left panel) ---------- */

const layoutChooser = document.getElementById("layout-chooser");
const LAYOUT_CLASSES = ["layout-dash", "layout-left"];

function setLayout(layout) {
  if (layout !== "left" && layout !== "dash") layout = "dash";

  desktop.classList.remove(...LAYOUT_CLASSES);
  desktop.classList.add(`layout-${layout}`);
  desktop.dataset.layout = layout;

  layoutChooser.querySelectorAll(".layout-opt").forEach((btn) => {
    const active = btn.dataset.layout === layout;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
  });

  try {
    localStorage.setItem("gnome-preview-layout", layout);
  } catch {
    /* ignore */
  }
}

layoutChooser.querySelectorAll(".layout-opt").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    setLayout(btn.dataset.layout);
  });
});

layoutChooser.addEventListener("click", (e) => e.stopPropagation());

let initialLayout = "dash";
try {
  const saved = localStorage.getItem("gnome-preview-layout");
  if (saved === "dash" || saved === "left") initialLayout = saved;
} catch {
  /* ignore */
}
setLayout(initialLayout);

/* ============================================================
   Nautilus (Files) — interactive file manager preview
   ============================================================ */

const ICON_PLACES = "assets/places/";

/**
 * Virtual filesystem.
 * - `icon`: full-color icon for grid/list content
 * - `sidebarIcon`: symbolic icon for the Nautilus places sidebar (Yaru)
 * - folders have `children` (ids); files use `type: "file"` with size/modified
 * Dummy files match the other DE mockups for consistency.
 */
const FS_NODES = {
  home: {
    id: "home",
    name: "Home",
    icon: ICON_PLACES + "user-home.png",
    sidebarIcon: ICON_PLACES + "user-home-symbolic.svg",
    /* Alphabetical by display name (sidebar order is independent) */
    children: [
      "desktop",
      "documents",
      "downloads",
      "dropbox",
      "music",
      "pictures",
      "public",
      "templates",
      "videos",
    ],
  },
  recent: {
    id: "recent",
    name: "Recent",
    icon: ICON_PLACES + "document-open-recent-symbolic.svg",
    sidebarIcon: ICON_PLACES + "document-open-recent-symbolic.svg",
    children: ["file-notes", "file-budget", "file-photo"],
    emptyTitle: "No Recent Files",
    emptySub: "Files you open will appear here",
  },
  starred: {
    id: "starred",
    name: "Starred",
    icon: ICON_PLACES + "starred-symbolic.svg",
    sidebarIcon: ICON_PLACES + "starred-symbolic.svg",
    children: [],
    emptyTitle: "No Starred Files",
    emptySub: "Star items to find them quickly",
  },
  network: {
    id: "network",
    name: "Network",
    icon: ICON_PLACES + "network-workgroup-symbolic.svg",
    sidebarIcon: ICON_PLACES + "network-workgroup-symbolic.svg",
    children: [],
    emptyTitle: "No Network Locations",
    emptySub: "",
  },
  trash: {
    id: "trash",
    name: "Trash",
    icon: ICON_PLACES + "user-trash-symbolic.svg",
    sidebarIcon: ICON_PLACES + "user-trash-symbolic.svg",
    children: [],
    emptyTitle: "Trash is Empty",
    emptySub: "",
  },
  desktop: {
    id: "desktop",
    name: "Desktop",
    icon: ICON_PLACES + "user-desktop.png",
    sidebarIcon: ICON_PLACES + "user-desktop-symbolic.svg",
    children: ["file-home-link"],
  },
  documents: {
    id: "documents",
    name: "Documents",
    icon: ICON_PLACES + "folder-documents.png",
    sidebarIcon: ICON_PLACES + "folder-documents-symbolic.svg",
    children: ["file-notes", "file-budget", "file-report"],
  },
  downloads: {
    id: "downloads",
    name: "Downloads",
    icon: ICON_PLACES + "folder-download.png",
    sidebarIcon: ICON_PLACES + "folder-download-symbolic.svg",
    children: ["file-iso", "file-readme"],
  },
  music: {
    id: "music",
    name: "Music",
    icon: ICON_PLACES + "folder-music.png",
    sidebarIcon: ICON_PLACES + "folder-music-symbolic.svg",
    children: ["folder-playlist"],
  },
  pictures: {
    id: "pictures",
    name: "Pictures",
    icon: ICON_PLACES + "folder-pictures.png",
    sidebarIcon: ICON_PLACES + "folder-pictures-symbolic.svg",
    children: ["folder-vacation", "file-photo"],
  },
  videos: {
    id: "videos",
    name: "Videos",
    icon: ICON_PLACES + "folder-videos.png",
    sidebarIcon: ICON_PLACES + "folder-videos-symbolic.svg",
    children: [],
  },
  templates: {
    id: "templates",
    name: "Templates",
    icon: ICON_PLACES + "folder-templates.png",
    sidebarIcon: ICON_PLACES + "folder-templates-symbolic.svg",
    children: [],
  },
  public: {
    id: "public",
    name: "Public",
    icon: ICON_PLACES + "folder-publicshare.png",
    sidebarIcon: ICON_PLACES + "folder-publicshare-symbolic.svg",
    children: [],
  },
  dropbox: {
    id: "dropbox",
    name: "Dropbox",
    icon: ICON_PLACES + "folder-dropbox.png",
    sidebarIcon: ICON_PLACES + "folder-symbolic.svg",
    children: [],
    emptyTitle: "Folder is Empty",
    emptySub: "",
  },
  gamedrive: {
    id: "gamedrive",
    name: "Game_Drive",
    icon: ICON_PLACES + "drive-harddisk-symbolic.svg",
    sidebarIcon: ICON_PLACES + "drive-harddisk-symbolic.svg",
    children: ["steam-folder", "steam-library"],
  },
  "steam-folder": {
    id: "steam-folder",
    name: "Steam_Folder",
    icon: ICON_PLACES + "folder.png",
    sidebarIcon: ICON_PLACES + "folder-symbolic.svg",
    children: [],
  },
  "steam-library": {
    id: "steam-library",
    name: "SteamLibrary",
    icon: ICON_PLACES + "folder.png",
    sidebarIcon: ICON_PLACES + "folder-symbolic.svg",
    children: [],
  },
  truenas: {
    id: "truenas",
    name: "truenas.local",
    icon: ICON_PLACES + "drive-harddisk-symbolic.svg",
    sidebarIcon: ICON_PLACES + "drive-harddisk-symbolic.svg",
    children: ["backups"],
  },
  backups: {
    id: "backups",
    name: "Backups",
    icon: ICON_PLACES + "folder.png",
    sidebarIcon: ICON_PLACES + "folder-symbolic.svg",
    children: [],
  },

  /* Nested folders */
  "folder-playlist": {
    id: "folder-playlist",
    name: "Playlist",
    icon: ICON_PLACES + "folder.png",
    sidebarIcon: ICON_PLACES + "folder-symbolic.svg",
    children: [],
  },
  "folder-vacation": {
    id: "folder-vacation",
    name: "Vacation",
    icon: ICON_PLACES + "folder.png",
    sidebarIcon: ICON_PLACES + "folder-symbolic.svg",
    children: [],
  },

  /* Dummy files (shared across previews) */
  "file-notes": {
    id: "file-notes",
    name: "notes.txt",
    icon: "assets/mimetypes/text-x-generic.png",
    type: "file",
    size: "2.1 kB",
    modified: "Today",
  },
  "file-budget": {
    id: "file-budget",
    name: "budget.ods",
    icon: "assets/apps/org.libreoffice.LibreOffice.calc.png",
    type: "file",
    size: "48 kB",
    modified: "Yesterday",
  },
  "file-report": {
    id: "file-report",
    name: "report.odt",
    icon: "assets/apps/org.libreoffice.LibreOffice.writer.png",
    type: "file",
    size: "112 kB",
    modified: "8 Jul 2026",
  },
  "file-iso": {
    id: "file-iso",
    name: "fedora.iso",
    icon: ICON_PLACES + "drive-harddisk.png",
    type: "file",
    size: "2.6 GB",
    modified: "Today",
  },
  "file-readme": {
    id: "file-readme",
    name: "readme.pdf",
    icon: "assets/mimetypes/application-pdf.png",
    type: "file",
    size: "340 kB",
    modified: "Yesterday",
  },
  "file-photo": {
    id: "file-photo",
    name: "photo.jpg",
    icon: "assets/thumbnails/photo.jpg",
    type: "file",
    size: "3.4 MB",
    modified: "10 Jul 2026",
  },
  "file-home-link": {
    id: "file-home-link",
    name: "Home",
    icon: ICON_PLACES + "user-home.png",
    type: "file",
    linkTo: "home",
    size: "—",
    modified: "Today",
  },
};

/** Sidebar layout (GNOME Files) — flat list, symbolic icons */
const SIDEBAR_PLACES = [
  {
    section: null,
    items: ["home", "recent", "starred", "network", "trash"],
  },
  {
    section: null,
    separator: true,
    items: [
      "dropbox",
      "documents",
      "music",
      "pictures",
      "videos",
      "downloads",
    ],
  },
  {
    section: null,
    separator: true,
    items: ["gamedrive", "truenas"],
  },
];

const nautilusWindow = document.getElementById("nautilus-window");
const nauSidebar = document.getElementById("nau-sidebar");
const nauContent = document.getElementById("nau-content");
const nauPathLabel = document.getElementById("nau-path-label");
const nauPathIcon = document.getElementById("nau-path-icon");
const nauBack = document.getElementById("nau-back");
const nauForward = document.getElementById("nau-forward");
const nauSearchBtn = document.getElementById("nau-search-btn");
const nauSearchBar = document.getElementById("nau-search-bar");
const nauSearchInput = document.getElementById("nau-search-input");
const nauViewGrid = document.getElementById("nau-view-grid");
const nauViewList = document.getElementById("nau-view-list");
const nauClose = document.getElementById("nau-close");
const dockFiles = document.getElementById("dock-files");

let nauCurrentId = "home";
let nauViewMode = "grid"; // 'grid' | 'list'
let nauSearchOpen = false;
let nauSearchQuery = "";
let nauHistory = ["home"];
let nauHistoryIndex = 0;
let nauSelectedId = null;

function openNautilus() {
  closeAppMenu();
  closeQuickSettings();
  closeCalendar();
  // Windows open on the active workspace (GNOME-like)
  nautilusWorkspace = activeWorkspace;
  nautilusWindow.dataset.workspace = String(nautilusWorkspace);
  placeNautilusOnWorkspace();
  nautilusWindow.hidden = false;
  // One-shot entry fade — do not leave a permanent animation that restarts
  // when overview classes are removed (that caused a blue wallpaper flash).
  nautilusWindow.classList.remove("is-opening");
  void nautilusWindow.offsetWidth;
  nautilusWindow.classList.add("is-opening");
  const clearOpening = () => nautilusWindow.classList.remove("is-opening");
  nautilusWindow.addEventListener("animationend", clearOpening, { once: true });
  window.setTimeout(clearOpening, 200);
  dockFiles.classList.add("running");
  nauHistory = ["home"];
  nauHistoryIndex = 0;
  nauCurrentId = "home";
  nauSelectedId = null;
  setViewMode(nauViewMode);
  setNautilusSearchOpen(false);
  renderNautilusSidebar();
  renderNautilusContent();
  updateNavButtons();
  updatePathBar();
}

function closeNautilus() {
  nautilusWindow.hidden = true;
  nautilusWindow.classList.remove("is-opening");
  dockFiles.classList.remove("running");
  setNautilusSearchOpen(false);
  nauSelectedId = null;
}

function toggleNautilus() {
  if (nautilusWindow.hidden) openNautilus();
  else closeNautilus();
}

function renderNautilusSidebar() {
  nauSidebar.innerHTML = "";
  for (const group of SIDEBAR_PLACES) {
    if (group.separator) {
      const sep = document.createElement("div");
      sep.className = "sidebar-separator";
      sep.setAttribute("role", "separator");
      nauSidebar.appendChild(sep);
    }
    if (group.section) {
      const label = document.createElement("div");
      label.className = "sidebar-section-label";
      label.textContent = group.section;
      nauSidebar.appendChild(label);
    }
    for (const id of group.items) {
      const node = FS_NODES[id];
      if (!node) continue;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "sidebar-item" + (id === nauCurrentId ? " active" : "");
      btn.dataset.place = id;
      const sideIcon = node.sidebarIcon || node.icon;
      btn.innerHTML = `
        <img class="sidebar-icon" src="${sideIcon}" alt="" draggable="false" />
        <span>${node.name}</span>
      `;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        navigateTo(id);
      });
      nauSidebar.appendChild(btn);
    }
  }
}

function getChildNodes(folderId) {
  const folder = FS_NODES[folderId];
  if (!folder) return [];
  return (folder.children || [])
    .map((id) => FS_NODES[id])
    .filter(Boolean);
}

function isFolderNode(node) {
  return node && node.type !== "file";
}

function navigateTo(id, { pushHistory = true } = {}) {
  const node = FS_NODES[id];
  if (!node || !isFolderNode(node)) return;
  nauCurrentId = id;
  nauSelectedId = null;
  if (pushHistory) {
    // Drop any forward history
    nauHistory = nauHistory.slice(0, nauHistoryIndex + 1);
    if (nauHistory[nauHistory.length - 1] !== id) {
      nauHistory.push(id);
      nauHistoryIndex = nauHistory.length - 1;
    }
  }
  // Clear search when changing location (Nautilus-like)
  if (nauSearchQuery) {
    nauSearchQuery = "";
    nauSearchInput.value = "";
  }
  renderNautilusSidebar();
  renderNautilusContent();
  updateNavButtons();
  updatePathBar();
}

/** Build parent map from FS children relationships */
function getParentId(id) {
  for (const [parentId, node] of Object.entries(FS_NODES)) {
    if (!isFolderNode(node)) continue;
    if ((node.children || []).includes(id)) return parentId;
  }
  // Standard XDG folders live under Home even when only linked from the sidebar
  const underHome = new Set([
    "desktop",
    "documents",
    "downloads",
    "music",
    "pictures",
    "videos",
    "templates",
    "public",
    "dropbox",
  ]);
  if (underHome.has(id)) return "home";
  return null;
}

/** Path segments for the header bar, e.g. ["Home", "Downloads"] */
function getPathSegments(id) {
  const segments = [];
  let current = id;
  const seen = new Set();
  while (current && FS_NODES[current] && !seen.has(current)) {
    seen.add(current);
    segments.unshift(FS_NODES[current].name);
    current = getParentId(current);
  }
  return segments.length ? segments : ["Files"];
}

function updatePathBar() {
  const node = FS_NODES[nauCurrentId];
  const path = getPathSegments(nauCurrentId).join(" / ");
  nauPathLabel.textContent = path;
  const pathEl = document.getElementById("nau-path");
  if (pathEl) pathEl.title = path;

  // Path bar shows text path only (no place icon)
  if (nauPathIcon) {
    nauPathIcon.hidden = true;
  }
}

function updateNavButtons() {
  nauBack.disabled = nauHistoryIndex <= 0;
  nauForward.disabled = nauHistoryIndex >= nauHistory.length - 1;
}

function setViewMode(mode) {
  nauViewMode = mode;
  nauContent.classList.toggle("view-grid", mode === "grid");
  nauContent.classList.toggle("view-list", mode === "list");
  nauViewGrid.classList.toggle("active", mode === "grid");
  nauViewList.classList.toggle("active", mode === "list");
  nauViewGrid.setAttribute("aria-pressed", mode === "grid" ? "true" : "false");
  nauViewList.setAttribute("aria-pressed", mode === "list" ? "true" : "false");
  renderNautilusContent();
}

function setNautilusSearchOpen(open) {
  nauSearchOpen = open;
  nauSearchBar.hidden = !open;
  nauSearchBtn.classList.toggle("active", open);
  nauSearchBtn.setAttribute("aria-pressed", open ? "true" : "false");
  if (open) {
    requestAnimationFrame(() => nauSearchInput.focus());
  } else {
    nauSearchQuery = "";
    nauSearchInput.value = "";
    renderNautilusContent();
  }
}

function formatSize(node) {
  if (node.type === "file") return node.size || "—";
  return "—";
}

function formatModified(node) {
  if (node && node.modified) return node.modified;
  return "18 Jul 2026";
}

function renderNautilusContent() {
  // Preserve list header
  const header = nauContent.querySelector(".nautilus-list-header");
  nauContent.innerHTML = "";
  if (header) nauContent.appendChild(header);

  let items = getChildNodes(nauCurrentId);
  const folder = FS_NODES[nauCurrentId];

  // Search filters current folder; empty query shows all
  if (nauSearchQuery.trim()) {
    const q = nauSearchQuery.trim().toLowerCase();
    // Search current location first; if home, also match child names
    items = items.filter((n) => n.name.toLowerCase().includes(q));
  }

  if (items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "nautilus-empty";
    if (nauSearchQuery.trim()) {
      empty.innerHTML = `
        <div class="nautilus-empty-title">No Results Found</div>
        <div class="nautilus-empty-sub">Try a different search term</div>
      `;
    } else {
      empty.innerHTML = `
        <div class="nautilus-empty-title">${folder?.emptyTitle || "Folder is Empty"}</div>
        <div class="nautilus-empty-sub">${folder?.emptySub ?? ""}</div>
      `;
    }
    nauContent.appendChild(empty);
    return;
  }

  for (const node of items) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className =
      "file-item" + (nauSelectedId === node.id ? " selected" : "");
    btn.dataset.id = node.id;
    btn.setAttribute("role", "listitem");
    btn.title = node.name;

    if (nauViewMode === "grid") {
      btn.innerHTML = `
        <img src="${node.icon}" alt="" draggable="false" />
        <span class="file-item-name">${node.name}</span>
      `;
    } else {
      btn.innerHTML = `
        <img src="${node.icon}" alt="" draggable="false" />
        <span class="file-item-name">${node.name}</span>
        <span class="file-item-meta">${formatSize(node)}</span>
        <span class="file-item-meta">${formatModified(node)}</span>
      `;
    }

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      nauSelectedId = node.id;
      renderNautilusContent();
    });

    btn.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      if (node.linkTo) navigateTo(node.linkTo);
      else if (isFolderNode(node)) navigateTo(node.id);
    });

    nauContent.appendChild(btn);
  }
}

// Nautilus controls
nauBack.addEventListener("click", (e) => {
  e.stopPropagation();
  if (nauHistoryIndex <= 0) return;
  nauHistoryIndex -= 1;
  nauCurrentId = nauHistory[nauHistoryIndex];
  nauSelectedId = null;
  renderNautilusSidebar();
  renderNautilusContent();
  updateNavButtons();
  updatePathBar();
});

nauForward.addEventListener("click", (e) => {
  e.stopPropagation();
  if (nauHistoryIndex >= nauHistory.length - 1) return;
  nauHistoryIndex += 1;
  nauCurrentId = nauHistory[nauHistoryIndex];
  nauSelectedId = null;
  renderNautilusSidebar();
  renderNautilusContent();
  updateNavButtons();
  updatePathBar();
});

nauSearchBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  setNautilusSearchOpen(!nauSearchOpen);
});

nauSearchInput.addEventListener("input", () => {
  nauSearchQuery = nauSearchInput.value;
  renderNautilusContent();
});

nauSearchInput.addEventListener("keydown", (e) => {
  e.stopPropagation();
  if (e.key === "Escape") {
    setNautilusSearchOpen(false);
  }
});

nauViewGrid.addEventListener("click", (e) => {
  e.stopPropagation();
  setViewMode("grid");
});

nauViewList.addEventListener("click", (e) => {
  e.stopPropagation();
  setViewMode("list");
});

nauClose.addEventListener("click", (e) => {
  e.stopPropagation();
  closeNautilus();
});

nautilusWindow.addEventListener("click", (e) => {
  if (overviewOpen || overviewAnimating) return;
  e.stopPropagation();
});

// Don't open overview type-to-search while typing in Nautilus
nauSearchInput.addEventListener("click", (e) => e.stopPropagation());

/* ============================================================
   GNOME Settings 50 (gnome-control-center)
   Panel order from upstream shell/cc-panel-list.c panel_order[]
   GNOME 50 highlights: first day of week, reduced motion,
   sound I/O volume levels, multitasking reopen windows,
   power charge modes, display scaling/VRR.
   ============================================================ */

const SETTINGS_ICON = "assets/settings/";

/** Official sidebar order (GNOME 50). Separators match header_func. */
const SETTINGS_PANELS = [
  {
    id: "wifi",
    name: "Wi-Fi",
    icon: SETTINGS_ICON + "network-wireless-symbolic.svg",
    keywords: ["wifi", "wireless", "network", "internet", "ssid"],
    description: "Wireless networks",
  },
  {
    id: "network",
    name: "Network",
    icon: SETTINGS_ICON + "org.gnome.Settings-network-symbolic.svg",
    keywords: ["network", "wired", "ethernet", "vpn", "proxy"],
    description: "Wired, VPN and proxy",
  },
  {
    id: "bluetooth",
    name: "Bluetooth",
    icon: SETTINGS_ICON + "org.gnome.Settings-bluetooth-symbolic.svg",
    keywords: ["bluetooth", "devices", "headphones", "mouse"],
    description: "Bluetooth devices",
    separatorAfter: true,
  },
  {
    id: "display",
    name: "Displays",
    icon: SETTINGS_ICON + "org.gnome.Settings-display-symbolic.svg",
    keywords: ["display", "monitor", "resolution", "scale", "night light", "vrr", "refresh"],
    description: "Resolution, scale, night light",
  },
  {
    id: "sound",
    name: "Sound",
    icon: SETTINGS_ICON + "org.gnome.Settings-sound-symbolic.svg",
    keywords: ["sound", "volume", "audio", "microphone", "output", "input"],
    description: "Volume and devices",
  },
  {
    id: "power",
    name: "Power",
    icon: SETTINGS_ICON + "org.gnome.Settings-power-symbolic.svg",
    keywords: ["power", "battery", "suspend", "brightness", "power mode"],
    description: "Battery and power saving",
  },
  {
    id: "multitasking",
    name: "Multitasking",
    icon: SETTINGS_ICON + "org.gnome.Settings-multitasking-symbolic.svg",
    keywords: ["multitasking", "workspaces", "hot corner", "overview"],
    description: "Workspaces and hot corner",
  },
  {
    id: "background",
    name: "Appearance",
    icon: SETTINGS_ICON + "org.gnome.Settings-appearance-symbolic.svg",
    keywords: ["appearance", "background", "wallpaper", "dark", "style", "accent"],
    description: "Style, accent and wallpaper",
    separatorAfter: true,
  },
  {
    id: "applications",
    name: "Apps",
    icon: SETTINGS_ICON + "org.gnome.Settings-applications-symbolic.svg",
    keywords: ["apps", "applications", "defaults", "permissions"],
    description: "Default apps and permissions",
  },
  {
    id: "notifications",
    name: "Notifications",
    icon: SETTINGS_ICON + "org.gnome.Settings-notifications-symbolic.svg",
    keywords: ["notifications", "do not disturb", "banner"],
    description: "Notification settings",
  },
  {
    id: "search",
    name: "Search",
    icon: SETTINGS_ICON + "org.gnome.Settings-search-symbolic.svg",
    keywords: ["search", "overview", "index"],
    description: "Search results",
  },
  {
    id: "online-accounts",
    name: "Online Accounts",
    icon: SETTINGS_ICON + "org.gnome.Settings-online-accounts-symbolic.svg",
    keywords: ["accounts", "google", "email", "calendar", "online"],
    description: "Mail, calendar and contacts",
  },
  {
    id: "sharing",
    name: "Sharing",
    icon: SETTINGS_ICON + "org.gnome.Settings-sharing-symbolic.svg",
    keywords: ["sharing", "media", "file sharing", "remote"],
    description: "File and media sharing",
  },
  {
    id: "wellbeing",
    name: "Wellbeing",
    icon: SETTINGS_ICON + "org.gnome.Settings-wellbeing-symbolic.svg",
    keywords: ["wellbeing", "screen time", "breaks", "parental"],
    description: "Screen time and breaks",
    separatorAfter: true,
  },
  {
    id: "mouse",
    name: "Mouse & Touchpad",
    icon: SETTINGS_ICON + "org.gnome.Settings-mouse-symbolic.svg",
    keywords: ["mouse", "touchpad", "pointer", "scroll", "tap"],
    description: "Pointer and touchpad",
  },
  {
    id: "keyboard",
    name: "Keyboard",
    icon: SETTINGS_ICON + "org.gnome.Settings-keyboard-symbolic.svg",
    keywords: ["keyboard", "shortcuts", "input", "layout"],
    description: "Input sources and shortcuts",
  },
  {
    id: "color",
    name: "Color Management",
    icon: SETTINGS_ICON + "org.gnome.Settings-color-symbolic.svg",
    keywords: ["color", "calibration", "profile", "icc"],
    description: "Display color profiles",
  },
  {
    id: "printers",
    name: "Printers",
    icon: SETTINGS_ICON + "org.gnome.Settings-printers-symbolic.svg",
    keywords: ["printers", "print", "cups"],
    description: "Printers and jobs",
  },
  {
    id: "wacom",
    name: "Graphics Tablets",
    icon: SETTINGS_ICON + "org.gnome.Settings-wacom-symbolic.svg",
    keywords: ["wacom", "tablet", "stylus", "graphics"],
    description: "Drawing tablets",
    separatorAfter: true,
  },
  {
    id: "universal-access",
    name: "Accessibility",
    icon: SETTINGS_ICON + "org.gnome.Settings-accessibility-symbolic.svg",
    keywords: ["accessibility", "a11y", "screen reader", "contrast", "zoom", "reduced motion"],
    description: "Vision, hearing and interaction",
  },
  {
    id: "privacy",
    name: "Privacy & Security",
    icon: SETTINGS_ICON + "org.gnome.Settings-privacy-symbolic.svg",
    keywords: ["privacy", "security", "location", "camera", "lock", "trash"],
    description: "Permissions and device security",
  },
  {
    id: "system",
    name: "System",
    icon: SETTINGS_ICON + "org.gnome.Settings-system-symbolic.svg",
    keywords: ["system", "about", "users", "date", "time", "language", "region", "remote"],
    description: "Region, users and about",
  },
];

const SETTINGS_ACCENTS = [
  { id: "blue", color: "#3584e4" },
  { id: "teal", color: "#2190a4" },
  { id: "green", color: "#3a944a" },
  { id: "yellow", color: "#c88800" },
  { id: "orange", color: "#ed5b00" },
  { id: "red", color: "#e62d42" },
  { id: "pink", color: "#d56199" },
  { id: "purple", color: "#9141ac" },
  { id: "slate", color: "#6f8396" },
  { id: "brown", color: "#b39169" },
];

const settingsWindow = document.getElementById("settings-window");
const settingsPanelList = document.getElementById("settings-panel-list");
const settingsContent = document.getElementById("settings-content");
const settingsPanelTitle = document.getElementById("settings-panel-title");
const settingsSearchBtn = document.getElementById("settings-search-btn");
const settingsSearchBar = document.getElementById("settings-search-bar");
const settingsSearchInput = document.getElementById("settings-search-input");
const settingsBackBtn = document.getElementById("settings-back-btn");
const settingsCloseBtn = document.getElementById("settings-close");
const settingsMenuBtn = document.getElementById("settings-menu-btn");
const settingsMenu = document.getElementById("settings-menu");
const qsSettingsBtn = document.getElementById("qs-settings-btn");

let settingsPanelId = "network";
/** @type {null | { id: string, title: string }} */
let settingsSubpage = null;
let settingsSearchOpen = false;
let settingsSearchQuery = "";

/** Interactive settings state (mirrors desktop mockup + GNOME 50 options). */
const settingsState = {
  darkStyle: document.documentElement.getAttribute("data-theme") !== "light",
  accent: "blue",
  wallpaper: "adwaita",
  wifiEnabled: false,
  bluetoothEnabled: true,
  nightLight: false,
  nlSchedule: "manual", // sunset | manual — screenshot shows Times always
  nightTemp: 62, // 0 cool … 100 warm (UI); maps to ~4700K–1700K
  nlFromH: 20,
  nlFromM: 0,
  nlToH: 6,
  nlToM: 0,
  dnd: false,
  lockScreenNotifications: true,
  volumeOutput: 58,
  volumeInput: 72,
  overamplification: false,
  powerMode: "performance", // power-saver | balanced | performance
  batteryCharge: "maximize", // maximize | preserve
  showBatteryPercent: false,
  dimScreen: true,
  autoSuspend: false,
  autoScreenBlank: false,
  screenBlankDelay: "5 minutes",
  suspendDelay: "1 hour",
  powerButtonBehavior: "Power Off",
  hotCorner: false,
  edgeTiling: false,
  reopenWindows: false,
  dynamicWorkspaces: true,
  workspaceCount: 4,
  multiMonitorWorkspaces: "primary", // primary | all
  appSwitchWorkspaces: "all",
  appSwitchMonitors: "all",
  primaryButton: "left",
  tapToClick: true,
  naturalScroll: false,
  mouseAcceleration: false,
  pointerSpeed: 88,
  touchpadSpeed: 55,
  disableTouchpadTyping: true,
  volumeBalance: 50,
  startupSound: false,
  appSearch: true,
  fileSharing: false,
  mediaSharing: false,
  deviceName: "linux-desktop",
  screenTimeLimit: false,
  grayscale: true,
  eyesightReminders: false,
  movementReminders: false,
  breakSounds: true,
  colorDeviceEnabled: true,
  alwaysShowA11yMenu: false,
  highContrast: false,
  reducedMotion: false,
  onOffShapes: false,
  textSize: 1, // 0..2
  cursorSize: 1,
  autoDatetime: true,
  autoTimezone: true,
  timeFormat24: true,
  firstDayOfWeek: "monday", // GNOME 50
  weekDayInClock: true,
  dateInClock: true,
  secondsInClock: false,
  weekNumbers: false,
  screenLock: true,
  location: false,
  legacyAppScaling: false,
  displayScale: "100%",
  refreshRate: "60 Hz",
  vrr: true,
};

function openSettings(panelId) {
  closeAppMenu();
  closeQuickSettings();
  closeCalendar();
  if (settingsMenu) settingsMenu.hidden = true;

  settingsWorkspace = activeWorkspace;
  settingsWindow.dataset.workspace = String(settingsWorkspace);
  placeSettingsOnWorkspace();
  settingsWindow.hidden = false;
  settingsWindow.classList.remove("is-opening");
  void settingsWindow.offsetWidth;
  settingsWindow.classList.add("is-opening");
  const clearOpening = () => settingsWindow.classList.remove("is-opening");
  settingsWindow.addEventListener("animationend", clearOpening, { once: true });
  window.setTimeout(clearOpening, 200);

  settingsSubpage = null;
  setSettingsSearchOpen(false);
  if (panelId) settingsPanelId = panelId;
  renderSettingsSidebar();
  renderSettingsContent();
}

function closeSettings() {
  settingsWindow.hidden = true;
  settingsWindow.classList.remove("is-opening");
  settingsSubpage = null;
  setSettingsSearchOpen(false);
  if (settingsMenu) settingsMenu.hidden = true;
}

function toggleSettings(panelId) {
  if (settingsWindow.hidden) openSettings(panelId);
  else if (panelId && panelId !== settingsPanelId) {
    settingsPanelId = panelId;
    settingsSubpage = null;
    renderSettingsSidebar();
    renderSettingsContent();
  } else closeSettings();
}

function setSettingsSearchOpen(open) {
  settingsSearchOpen = open;
  if (settingsSearchBar) settingsSearchBar.hidden = !open;
  settingsSearchBtn?.classList.toggle("active", open);
  settingsSearchBtn?.setAttribute("aria-pressed", open ? "true" : "false");
  if (open) {
    settingsSearchInput?.focus();
  } else {
    settingsSearchQuery = "";
    if (settingsSearchInput) settingsSearchInput.value = "";
    renderSettingsSidebar();
  }
}

function panelMatchesSearch(panel, query) {
  if (!query) return true;
  const q = query.toLowerCase().trim();
  if (!q) return true;
  const hay = [panel.name, panel.description, ...(panel.keywords || [])]
    .join(" ")
    .toLowerCase();
  return q.split(/\s+/).every((word) => hay.includes(word));
}

function renderSettingsSidebar() {
  if (!settingsPanelList) return;
  settingsPanelList.innerHTML = "";
  const q = settingsSearchQuery.trim();
  const panels = SETTINGS_PANELS.filter((p) => panelMatchesSearch(p, q));

  if (!panels.length) {
    const empty = document.createElement("div");
    empty.className = "settings-panel-empty";
    empty.innerHTML = `
      <div class="settings-panel-empty-title">No Results Found</div>
      <div>Try a different search</div>`;
    settingsPanelList.appendChild(empty);
    return;
  }

  panels.forEach((panel, index) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className =
      "settings-panel-row" + (panel.id === settingsPanelId && !q ? " active" : "");
    if (q && panel.id === settingsPanelId) row.classList.add("active");
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", panel.id === settingsPanelId ? "true" : "false");
    row.dataset.panel = panel.id;
    row.innerHTML = `
      <img class="settings-panel-icon" src="${panel.icon}" alt="" draggable="false" />
      <span class="settings-panel-meta">
        <span class="settings-panel-name">${panel.name}</span>
        ${
          q
            ? `<span class="settings-panel-desc">${panel.description || ""}</span>`
            : ""
        }
      </span>`;
    row.addEventListener("click", (e) => {
      e.stopPropagation();
      settingsPanelId = panel.id;
      settingsSubpage = null;
      if (q) {
        // Leave search mode after choosing a result (GNOME-like)
        setSettingsSearchOpen(false);
      } else {
        renderSettingsSidebar();
      }
      renderSettingsContent();
    });
    settingsPanelList.appendChild(row);

    // Separators only in main (non-search) list, after marked panels
    if (!q && panel.separatorAfter && index < panels.length - 1) {
      const sep = document.createElement("div");
      sep.className = "settings-panel-sep";
      sep.setAttribute("role", "separator");
      settingsPanelList.appendChild(sep);
    }
  });
}

function switchHtml(id, on) {
  return `<button type="button" class="settings-switch${on ? " on" : ""}" role="switch" aria-checked="${on ? "true" : "false"}" data-setting="${id}" aria-label="${id}"></button>`;
}

function radioHtml(on) {
  return `<span class="settings-radio${on ? " on" : ""}" aria-hidden="true"></span>`;
}

function chevronHtml() {
  return `<img class="settings-chevron" src="assets/settings/go-next-symbolic.svg" alt="" draggable="false" />`;
}

function addIconHtml() {
  return `<img class="sym" src="assets/settings/list-add-symbolic.svg" alt="" draggable="false" />`;
}

function groupStart(title, { description, suffix } = {}) {
  let h = `<div class="settings-group">`;
  if (title || suffix) {
    h += `<div class="settings-group-header">`;
    if (title) h += `<div class="settings-group-title">${title}</div>`;
    else h += `<div></div>`;
    if (suffix) h += `<div class="settings-group-suffix">${suffix}</div>`;
    h += `</div>`;
  }
  if (description) h += `<div class="settings-group-desc">${description}</div>`;
  h += `<div class="settings-card">`;
  return h;
}

function groupEnd() {
  return `</div></div>`;
}

function rowToggle(title, sub, settingId, on, { disabled = false } = {}) {
  return `
    <div class="settings-row${disabled ? " is-disabled" : ""}">
      <div class="settings-row-main">
        <div class="settings-row-text">
          <div class="settings-row-title">${title}</div>
          ${sub ? `<div class="settings-row-sub">${sub}</div>` : ""}
        </div>
      </div>
      <div class="settings-row-suffix">${switchHtml(settingId, on)}</div>
    </div>`;
}

function rowNav(title, sub, target, { icon, value, external = false } = {}) {
  return `
    <button type="button" class="settings-row activatable" data-nav="${target}">
      <div class="settings-row-main">
        ${icon ? `<img class="settings-row-icon" src="${icon}" alt="" draggable="false" />` : ""}
        <div class="settings-row-text">
          <div class="settings-row-title">${title}</div>
          ${sub ? `<div class="settings-row-sub">${sub}</div>` : ""}
        </div>
      </div>
      <div class="settings-row-suffix">
        ${value != null && value !== "" ? `<span class="settings-value">${value}</span>` : ""}
        ${
          external
            ? `<img class="settings-ext-link" src="assets/settings/go-next-symbolic.svg" alt="" style="transform:rotate(-45deg)" draggable="false" />`
            : chevronHtml()
        }
      </div>
    </button>`;
}

/** GNOME AdwActionRow radio: indicator on the left */
function rowRadio(title, sub, settingId, value, selected) {
  return `
    <button type="button" class="settings-row activatable radio-left" data-radio="${settingId}" data-value="${value}">
      ${radioHtml(selected)}
      <div class="settings-row-main">
        <div class="settings-row-text">
          <div class="settings-row-title">${title}</div>
          ${sub ? `<div class="settings-row-sub">${sub}</div>` : ""}
        </div>
      </div>
    </button>`;
}

function rowStatic(title, value, { disabled = false } = {}) {
  return `
    <div class="settings-row${disabled ? " is-disabled" : ""}">
      <div class="settings-row-main">
        <div class="settings-row-text">
          <div class="settings-row-title">${title}</div>
        </div>
      </div>
      <div class="settings-row-suffix"><span class="settings-value">${value}</span></div>
    </div>`;
}

/** Combo/dropdown-looking value row (non-interactive preview) */
function rowCombo(title, value, { icon, sub } = {}) {
  return `
    <div class="settings-row">
      <div class="settings-row-main">
        ${icon ? `<img class="settings-row-icon" src="${icon}" alt="" draggable="false" />` : ""}
        <div class="settings-row-text">
          <div class="settings-row-title">${title}</div>
          ${sub ? `<div class="settings-row-sub">${sub}</div>` : ""}
        </div>
      </div>
      <div class="settings-row-suffix"><span class="settings-value">${value}</span><span class="settings-value" style="opacity:.55;font-size:11px">▾</span></div>
    </div>`;
}

function rowSliderInline(title, settingId, value, { icon, min = 0, max = 100, ends } = {}) {
  return `
    <div class="settings-row slider-inline">
      <div class="settings-row-title">${title}</div>
      <div class="settings-slider-stack">
        <div class="settings-inline-slider">
          ${icon ? `<img class="settings-row-icon" src="${icon}" alt="" draggable="false" />` : ""}
          <input type="range" class="settings-range" data-slider="${settingId}" min="${min}" max="${max}" value="${value}" aria-label="${title}" />
        </div>
        ${
          ends
            ? `<div class="settings-ends"><span>${ends[0]}</span><span>${ends[1]}</span></div>`
            : ""
        }
      </div>
    </div>`;
}

function rowSlider(title, settingId, value, { min = 0, max = 100 } = {}) {
  return rowSliderInline(title, settingId, value, { min, max });
}

function pageIntro(html) {
  return `<div class="settings-page-intro">${html}</div>`;
}

function currentPanel() {
  return SETTINGS_PANELS.find((p) => p.id === settingsPanelId);
}

function renderSettingsHeaderActions() {
  const el = document.getElementById("settings-header-actions");
  if (!el) return;
  el.innerHTML = "";
  if (settingsSubpage) return;
  // Bluetooth: primary switch lives in the content header (GNOME 50)
  if (settingsPanelId === "bluetooth") {
    el.innerHTML = switchHtml("bluetoothEnabled", settingsState.bluetoothEnabled);
  }
}

function renderSettingsContent() {
  if (!settingsContent || !settingsPanelTitle) return;
  const panel = currentPanel();
  const title = settingsSubpage?.title || panel?.name || "Settings";
  settingsPanelTitle.textContent = title;
  if (settingsBackBtn) settingsBackBtn.hidden = !settingsSubpage;
  const header = settingsWindow?.querySelector(".settings-content-header");
  header?.classList.toggle("has-back", Boolean(settingsSubpage));
  renderSettingsHeaderActions();

  let html = "";
  if (settingsSubpage) {
    html = renderSettingsSubpage(settingsSubpage.id);
  } else {
    html = renderSettingsPanel(settingsPanelId);
  }
  settingsContent.innerHTML = `<div class="settings-page">${html}</div>`;
  bindSettingsContentHandlers();
  // Header-action switches (outside content root)
  document.querySelectorAll("#settings-header-actions .settings-switch").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const key = btn.dataset.setting;
      if (!key) return;
      const next = !btn.classList.contains("on");
      setSettingValue(key, next);
      renderSettingsContent();
    });
  });
}

function renderSettingsPanel(id) {
  switch (id) {
    case "wifi":
      return renderWifiPanel();
    case "network":
      return renderNetworkPanel();
    case "bluetooth":
      return renderBluetoothPanel();
    case "display":
      return renderDisplayPanel();
    case "sound":
      return renderSoundPanel();
    case "power":
      return renderPowerPanel();
    case "multitasking":
      return renderMultitaskingPanel();
    case "background":
      return renderAppearancePanel();
    case "applications":
      return renderAppsPanel();
    case "notifications":
      return renderNotificationsPanel();
    case "search":
      return renderSearchPanel();
    case "online-accounts":
      return renderOnlineAccountsPanel();
    case "sharing":
      return renderSharingPanel();
    case "wellbeing":
      return renderWellbeingPanel();
    case "mouse":
      return renderMousePanel();
    case "keyboard":
      return renderKeyboardPanel();
    case "color":
      return renderColorPanel();
    case "printers":
      return renderPrintersPanel();
    case "wacom":
      return renderWacomPanel();
    case "universal-access":
      return renderAccessibilityPanel();
    case "privacy":
      return renderPrivacyPanel();
    case "system":
      return renderSystemPanel();
    default:
      return `<div class="settings-status"><div class="settings-status-title">Panel</div></div>`;
  }
}

function renderWifiPanel() {
  if (!settingsState.wifiEnabled) {
    return `
      <div class="settings-status">
        <img class="settings-status-icon" src="${SETTINGS_ICON}network-wireless-symbolic.svg" alt="" />
        <div class="settings-status-title">Wi-Fi Turned Off</div>
        <div class="settings-status-sub">Turn on Wi-Fi to see available networks.</div>
        <button type="button" class="settings-btn suggested" data-action="enable-wifi">Turn On</button>
      </div>`;
  }
  return (
    groupStart(null, {
      suffix: `<button type="button" class="settings-add-btn" title="Add" aria-label="Add">${addIconHtml()}</button>`,
    }) +
    `
      <div class="settings-row">
        <div class="settings-row-main">
          <div class="settings-row-text">
            <div class="settings-row-title">Home-5G</div>
            <div class="settings-row-sub">Connected</div>
          </div>
        </div>
        <div class="settings-row-suffix">
          ${switchHtml("wifiEnabled", true)}
          <button type="button" class="settings-row-icon-btn" title="Options" aria-label="Options">
            <img class="sym" src="assets/status/cog-wheel-symbolic.svg" alt="" draggable="false" />
          </button>
        </div>
      </div>
    ` +
    groupEnd() +
    groupStart("Visible Networks") +
    `
      <button type="button" class="settings-row activatable">
        <div class="settings-row-main">
          <div class="settings-row-text">
            <div class="settings-row-title">Cafe_Guest</div>
            <div class="settings-row-sub">Open</div>
          </div>
        </div>
        <div class="settings-row-suffix">${chevronHtml()}</div>
      </button>
      <button type="button" class="settings-row activatable">
        <div class="settings-row-main">
          <div class="settings-row-text">
            <div class="settings-row-title">Neighbor-2.4</div>
            <div class="settings-row-sub">WPA2</div>
          </div>
        </div>
        <div class="settings-row-suffix">${chevronHtml()}</div>
      </button>
    ` +
    groupEnd()
  );
}

function renderNetworkPanel() {
  return (
    groupStart("Wired", {
      suffix: `<button type="button" class="settings-add-btn" title="Add Connection" aria-label="Add Connection">${addIconHtml()}</button>`,
    }) +
    `
      <div class="settings-row">
        <div class="settings-row-main">
          <div class="settings-row-text">
            <div class="settings-row-title">Connected — 100 Mb/s</div>
          </div>
        </div>
        <div class="settings-row-suffix">
          ${switchHtml("wiredEnabled", true)}
          <button type="button" class="settings-row-icon-btn" title="Options" aria-label="Options">
            <img class="sym" src="assets/status/cog-wheel-symbolic.svg" alt="" draggable="false" />
          </button>
        </div>
      </div>
    ` +
    groupEnd() +
    groupStart("VPN", {
      suffix: `<button type="button" class="settings-add-btn" title="Add VPN" aria-label="Add VPN">${addIconHtml()}</button>`,
    }) +
    `<div class="settings-empty-card">Not set up</div>` +
    groupEnd() +
    groupStart("Proxy") +
    rowNav("Proxy", null, "proxy", {
      icon: SETTINGS_ICON + "org.gnome.Settings-network-proxy-symbolic.svg",
      value: "Off",
    }) +
    groupEnd()
  );
}

function renderBluetoothPanel() {
  if (!settingsState.bluetoothEnabled) {
    return `
      <div class="settings-status">
        <img class="settings-status-icon" src="${SETTINGS_ICON}org.gnome.Settings-bluetooth-symbolic.svg" alt="" />
        <div class="settings-status-title">Bluetooth Turned Off</div>
        <div class="settings-status-sub">Turn on Bluetooth to connect devices.</div>
      </div>`;
  }
  return (
    pageIntro(
      `Visible as “${settingsState.deviceName}” and available for Bluetooth file transfers. Transferred files are placed in the <span class="settings-link">Downloads</span> folder.`
    ) +
    groupStart("Devices", {
      suffix: `<button type="button" class="settings-row-icon-btn" title="Refresh" aria-label="Refresh"><img class="sym" src="assets/settings/org.gnome.Settings-screen-time-symbolic.svg" alt="" draggable="false" style="opacity:.7" /></button>`,
    }) +
    `
      <button type="button" class="settings-row activatable">
        <div class="settings-row-main">
          <div class="settings-row-text">
            <div class="settings-row-title">DualSense Wireless Controller</div>
          </div>
        </div>
        <div class="settings-row-suffix"><span class="settings-value">Disconnected</span></div>
      </button>
      <button type="button" class="settings-row activatable">
        <div class="settings-row-main">
          <div class="settings-row-text">
            <div class="settings-row-title">Wireless Controller</div>
          </div>
        </div>
        <div class="settings-row-suffix"><span class="settings-value">Disconnected</span></div>
      </button>
      <button type="button" class="settings-row activatable">
        <div class="settings-row-main">
          <div class="settings-row-text">
            <div class="settings-row-title">Galaxy S26 Ultra</div>
          </div>
        </div>
        <div class="settings-row-suffix"><span class="settings-value">Not Set Up</span></div>
      </button>
    ` +
    groupEnd()
  );
}

function renderDisplayPanel() {
  const s = settingsState;
  return (
    groupStart(null) +
    rowCombo("Orientation", "Landscape") +
    rowCombo("Resolution", "1920 × 1080 (16:9)") +
    rowCombo("Refresh Rate", "100.00 Hz") +
    rowToggle("Adjust for TV", null, "adjustForTv", false) +
    rowCombo("Scale", s.displayScale.replace("%", " %")) +
    groupEnd() +
    groupStart(null) +
    rowNav("Night Light", null, "night-light", {
      icon: "assets/status/night-light-symbolic.svg",
      value: s.nightLight ? "On" : "Off",
    }) +
    groupEnd()
  );
}

function renderSoundPanel() {
  const s = settingsState;
  const spk = "assets/status/audio-volume-medium-symbolic.svg";
  return (
    groupStart("Output", {
      suffix: `<div class="settings-group-actions"><span class="settings-level-meter" title="Level"><i style="width:45%"></i></span><button type="button" class="settings-btn flat">Test…</button></div>`,
    }) +
    rowCombo("Output Device", "Line Out - Ryzen HD Audio Controller") +
    rowSliderInline("Output Volume", "volumeOutput", s.volumeOutput, { icon: spk }) +
    rowSliderInline("Balance", "volumeBalance", s.volumeBalance) +
    rowToggle(
      "Overamplification",
      "Allow volume to exceed 100%, with reduced sound quality",
      "overamplification",
      s.overamplification
    ) +
    groupEnd() +
    groupStart("Input", {
      suffix: `<span class="settings-level-meter" title="Level"><i style="width:30%"></i></span>`,
    }) +
    rowCombo("Input Device", "Rear Microphone - Ryzen HD Audio Controller") +
    rowSliderInline("Input Volume", "volumeInput", s.volumeInput, {
      icon: SETTINGS_ICON + "org.gnome.Settings-microphone-access-symbolic.svg",
    }) +
    groupEnd() +
    groupStart("Sounds") +
    rowNav("Volume Levels", null, "volume-levels") +
    rowNav("Alert Sound", null, "alert-sound", { value: "Default" }) +
    rowToggle("Startup Sound", null, "startupSound", s.startupSound) +
    groupEnd()
  );
}

function renderPowerPanel() {
  const s = settingsState;
  return (
    groupStart("Power Mode") +
    rowRadio(
      "Performance",
      "High performance and power usage",
      "powerMode",
      "performance",
      s.powerMode === "performance"
    ) +
    rowRadio(
      "Balanced",
      "Standard performance and power usage",
      "powerMode",
      "balanced",
      s.powerMode === "balanced"
    ) +
    rowRadio(
      "Power Saver",
      "Reduced performance and power usage",
      "powerMode",
      "power-saver",
      s.powerMode === "power-saver"
    ) +
    groupEnd() +
    groupStart("General") +
    rowCombo("Power Button Behavior", s.powerButtonBehavior) +
    groupEnd() +
    groupStart("Power Saving") +
    rowToggle(
      "Automatic Screen Blank",
      "Turn the screen off after a period of inactivity",
      "autoScreenBlank",
      s.autoScreenBlank
    ) +
    rowCombo("Delay", s.screenBlankDelay, { disabled: true }) +
    rowToggle("Automatic Suspend", null, "autoSuspend", s.autoSuspend) +
    rowCombo("Delay", s.suspendDelay) +
    groupEnd() +
    (s.autoSuspend
      ? ""
      : `<div class="settings-info-banner">
          <img class="settings-info-icon" src="${SETTINGS_ICON}org.gnome.Settings-about-symbolic.svg" alt="" />
          <div>Disabling automatic suspend will result in higher power consumption. It is recommended to keep automatic suspend enabled.</div>
        </div>`)
  );
}

function renderMultitaskingPanel() {
  const s = settingsState;
  const mt = "assets/settings/multitasking/";
  return (
    groupStart("Screen Edges") +
    `<div class="settings-illustrated">
      <div class="settings-illustrated-head">
        <div class="settings-row-text">
          <div class="settings-row-title">Hot Corner</div>
          <div class="settings-row-sub">Touch the top-left corner to open the Activities Overview</div>
        </div>
        ${switchHtml("hotCorner", s.hotCorner)}
      </div>
      <div class="settings-illustrated-preview">
        <img class="settings-illus-img" src="${mt}hot-corner.svg" alt="" draggable="false" />
      </div>
    </div>
    <div class="settings-illustrated">
      <div class="settings-illustrated-head">
        <div class="settings-row-text">
          <div class="settings-row-title">Window Resize</div>
          <div class="settings-row-sub">Drag windows against the top, left, and right screen edges to resize them</div>
        </div>
        ${switchHtml("edgeTiling", s.edgeTiling)}
      </div>
      <div class="settings-illustrated-preview">
        <img class="settings-illus-img" src="${mt}active-screen-edges.svg" alt="" draggable="false" />
      </div>
    </div>` +
    groupEnd() +
    groupStart("Workspaces") +
    rowRadio(
      "Dynamic Workspaces",
      "Automatically removes empty workspaces",
      "dynamicWorkspaces",
      "true",
      s.dynamicWorkspaces
    ) +
    rowRadio(
      "Fixed Number of Workspaces",
      "Specify a number of permanent workspaces",
      "dynamicWorkspaces",
      "false",
      !s.dynamicWorkspaces
    ) +
    `<div class="settings-row${!s.dynamicWorkspaces ? "" : " is-disabled"}">
      <div class="settings-row-main"><div class="settings-row-text"><div class="settings-row-title">Number of Workspaces</div></div></div>
      <div class="settings-row-suffix">
        <span class="settings-value">${s.workspaceCount}</span>
        <button type="button" class="settings-row-icon-btn" data-action="ws-dec" aria-label="Decrease">−</button>
        <button type="button" class="settings-row-icon-btn" data-action="ws-inc" aria-label="Increase">+</button>
      </div>
    </div>` +
    groupEnd() +
    groupStart("Multi-Monitor") +
    `<button type="button" class="settings-illustrated activatable" data-radio="multiMonitorWorkspaces" data-value="primary" style="width:100%;text-align:left;cursor:pointer;background:transparent;border:none;color:inherit;font:inherit">
      <div class="settings-illustrated-head">
        <div class="settings-row-main" style="gap:14px">
          ${radioHtml(s.multiMonitorWorkspaces === "primary")}
          <div class="settings-row-text"><div class="settings-row-title">Workspaces on primary display only</div></div>
        </div>
      </div>
      <div class="settings-illustrated-preview">
        <img class="settings-illus-img" src="${mt}workspaces-primary-display.svg" alt="" draggable="false" />
      </div>
    </button>
    <button type="button" class="settings-illustrated activatable" data-radio="multiMonitorWorkspaces" data-value="all" style="width:100%;text-align:left;cursor:pointer;background:transparent;border:none;color:inherit;font:inherit">
      <div class="settings-illustrated-head">
        <div class="settings-row-main" style="gap:14px">
          ${radioHtml(s.multiMonitorWorkspaces === "all")}
          <div class="settings-row-text"><div class="settings-row-title">Workspaces on all displays</div></div>
        </div>
      </div>
      <div class="settings-illustrated-preview">
        <img class="settings-illus-img" src="${mt}workspaces-span-displays.svg" alt="" draggable="false" />
      </div>
    </button>` +
    groupEnd() +
    groupStart("App Switching") +
    rowRadio(
      "Include apps from all workspaces",
      null,
      "appSwitchWorkspaces",
      "all",
      s.appSwitchWorkspaces === "all"
    ) +
    rowRadio(
      "Include apps from the current workspace only",
      null,
      "appSwitchWorkspaces",
      "current",
      s.appSwitchWorkspaces === "current"
    ) +
    rowRadio(
      "Include apps from all monitors",
      null,
      "appSwitchMonitors",
      "all",
      s.appSwitchMonitors === "all"
    ) +
    rowRadio(
      "Include apps from each monitor only",
      null,
      "appSwitchMonitors",
      "each",
      s.appSwitchMonitors === "each"
    ) +
    groupEnd()
  );
}

const SETTINGS_WALLPAPERS = {
  adwaita: {
    webp: "assets/wallpapers/adwaita-d.webp",
    jpg: "assets/wallpapers/adwaita-d.jpg",
    label: "Adwaita",
  },
  fold: {
    webp: "assets/wallpapers/fold-d.webp",
    jpg: "assets/wallpapers/fold-d.jpg",
    label: "Fold",
  },
  glass: {
    webp: "assets/wallpapers/glass-chip-l.webp",
    jpg: "assets/wallpapers/glass-chip-l.jpg",
    label: "Glass Chip",
  },
};

function applyWallpaper(id) {
  const wall = SETTINGS_WALLPAPERS[id] || SETTINGS_WALLPAPERS.adwaita;
  settingsState.wallpaper = SETTINGS_WALLPAPERS[id] ? id : "adwaita";
  document.documentElement.style.setProperty("--wallpaper-1", `url("${wall.webp}")`);
  document.documentElement.style.setProperty("--wallpaper-2", `url("${wall.jpg}")`);
  document.documentElement.style.setProperty("--wallpaper-3", `url("${wall.webp}")`);
}

function renderAppearancePanel() {
  const s = settingsState;
  const currentWall =
    SETTINGS_WALLPAPERS[s.wallpaper]?.webp || SETTINGS_WALLPAPERS.adwaita.webp;
  const accents = SETTINGS_ACCENTS.map(
    (a) =>
      `<button type="button" class="settings-accent${
        s.accent === a.id ? " selected" : ""
      }" data-accent="${a.id}" style="background:${a.color}" title="${a.id}" aria-label="${a.id}"></button>`
  ).join("");

  const walls = Object.entries(SETTINGS_WALLPAPERS)
    .map(
      ([id, w]) =>
        `<button type="button" class="settings-wallpaper${
          s.wallpaper === id ? " selected" : ""
        }" style="background-image:url('${w.webp}')" data-wall="${id}" aria-label="${w.label}"></button>`
    )
    .join("");

  return (
    groupStart("Style") +
    `<div class="settings-style-grid">
      <button type="button" class="settings-style-option${
        !s.darkStyle ? " selected" : ""
      }" data-style="default">
        <span class="settings-style-preview light" style="background-image:url('${currentWall}')">
          <span class="win-a"></span><span class="win-b"></span>
        </span>
        <span>Default</span>
      </button>
      <button type="button" class="settings-style-option${
        s.darkStyle ? " selected" : ""
      }" data-style="dark">
        <span class="settings-style-preview dark" style="background-image:url('${currentWall}')">
          <span class="win-a"></span><span class="win-b"></span>
        </span>
        <span>Dark</span>
      </button>
    </div>` +
    groupEnd() +
    groupStart("Accent Color") +
    `<div class="settings-accent-row">${accents}</div>` +
    groupEnd() +
    groupStart("Background", {
      suffix: `<button type="button" class="settings-link-btn" data-action="add-picture">+ Add Picture…</button>`,
    }) +
    `<div class="settings-wallpaper-grid">${walls}</div>` +
    groupEnd()
  );
}

function renderAppsPanel() {
  return (
    groupStart(null) +
    rowNav("Default Apps", null, "default-apps") +
    rowNav("Removable Media", null, "removable-media") +
    groupEnd() +
    groupStart(null) +
    `
      <button type="button" class="settings-row activatable">
        <div class="settings-row-main">
          <img class="settings-row-icon" src="assets/Brave.png" alt="" draggable="false" style="filter:none;width:22px;height:22px;border-radius:6px" />
          <div class="settings-row-text"><div class="settings-row-title">Brave</div></div>
        </div>
        <div class="settings-row-suffix">${chevronHtml()}</div>
      </button>
      <button type="button" class="settings-row activatable">
        <div class="settings-row-main">
          <img class="settings-row-icon" src="assets/apps/org.gnome.Nautilus.png" alt="" draggable="false" style="filter:none;width:22px;height:22px" />
          <div class="settings-row-text"><div class="settings-row-title">Files</div></div>
        </div>
        <div class="settings-row-suffix">${chevronHtml()}</div>
      </button>
      <button type="button" class="settings-row activatable">
        <div class="settings-row-main">
          <img class="settings-row-icon" src="assets/Steam_icon.png" alt="" draggable="false" style="filter:none;width:22px;height:22px;border-radius:6px" />
          <div class="settings-row-text"><div class="settings-row-title">Steam</div></div>
        </div>
        <div class="settings-row-suffix">${chevronHtml()}</div>
      </button>
    ` +
    groupEnd()
  );
}

function renderNotificationsPanel() {
  const s = settingsState;
  return (
    groupStart(null) +
    rowToggle("Do Not Disturb", null, "dnd", s.dnd) +
    rowToggle("Lock Screen Notifications", null, "lockScreenNotifications", s.lockScreenNotifications) +
    groupEnd() +
    groupStart(null) +
    `
      <button type="button" class="settings-row activatable">
        <div class="settings-row-main">
          <img class="settings-row-icon" src="assets/Brave.png" alt="" style="filter:none;width:22px;height:22px;border-radius:6px" draggable="false" />
          <div class="settings-row-text"><div class="settings-row-title">Brave</div></div>
        </div>
        <div class="settings-row-suffix"><span class="settings-value">On</span>${chevronHtml()}</div>
      </button>
      <button type="button" class="settings-row activatable">
        <div class="settings-row-main">
          <img class="settings-row-icon" src="assets/Steam_icon.png" alt="" style="filter:none;width:22px;height:22px;border-radius:6px" draggable="false" />
          <div class="settings-row-text"><div class="settings-row-title">Steam</div></div>
        </div>
        <div class="settings-row-suffix"><span class="settings-value">On</span>${chevronHtml()}</div>
      </button>
    ` +
    groupEnd()
  );
}

function renderSearchPanel() {
  return (
    groupStart(null) +
    rowToggle(
      "App Search",
      "Include app-provided search results",
      "appSearch",
      settingsState.appSearch
    ) +
    groupEnd() +
    groupStart("Search Results") +
    `
      <div class="settings-row">
        <div class="settings-row-main"><div class="settings-row-text"><div class="settings-row-title">Files</div></div></div>
        <div class="settings-row-suffix">${switchHtml("searchFiles", true)}</div>
      </div>
      <div class="settings-row">
        <div class="settings-row-main"><div class="settings-row-text"><div class="settings-row-title">Calculator</div></div></div>
        <div class="settings-row-suffix">${switchHtml("searchCalc", true)}</div>
      </div>
      <div class="settings-row">
        <div class="settings-row-main"><div class="settings-row-text"><div class="settings-row-title">Web</div></div></div>
        <div class="settings-row-suffix">${switchHtml("searchWeb", false)}</div>
      </div>
      <div class="settings-row">
        <div class="settings-row-main"><div class="settings-row-text"><div class="settings-row-title">Characters</div></div></div>
        <div class="settings-row-suffix">${switchHtml("searchChars", true)}</div>
      </div>
    ` +
    groupEnd()
  );
}

function renderOnlineAccountsPanel() {
  const providers = [
    { name: "Google", sub: "Email, calendar, contacts, files", color: "#fff", fg: "#4285F4", letter: "G" },
    { name: "Microsoft 365", sub: "Email, calendar, contacts, files", color: "#2F2A6B", letter: "❖" },
    { name: "Microsoft Exchange", sub: "Email, calendar, contacts", color: "#0078D4", letter: "E" },
    { name: "Nextcloud", sub: "Calendar, contacts, files", color: "#0082C9", letter: "☁" },
    { name: "Email Server", sub: "IMAP/SMTP", muted: true, letter: "✉" },
    { name: "Calendar, Contacts and Files", sub: "WebDAV", muted: true, letter: "📅" },
    { name: "Enterprise Authentication", sub: "Kerberos", muted: true, letter: "🔑" },
  ];
  const rows = providers
    .map((p) => {
      const icon = p.muted
        ? `<span class="settings-provider-icon muted">${p.letter}</span>`
        : `<span class="settings-provider-icon" style="background:${p.color};color:${p.fg || "#fff"}">${p.letter}</span>`;
      return `
        <button type="button" class="settings-row activatable">
          <div class="settings-row-main">
            ${icon}
            <div class="settings-row-text">
              <div class="settings-row-title">${p.name}</div>
              <div class="settings-row-sub">${p.sub}</div>
            </div>
          </div>
          <div class="settings-row-suffix">${chevronHtml()}</div>
        </button>`;
    })
    .join("");

  return (
    pageIntro("Allow apps to access online services by connecting your cloud accounts") +
    groupStart("Connect an Account") +
    rows +
    groupEnd()
  );
}

function renderSharingPanel() {
  const s = settingsState;
  return (
    groupStart(null) +
    `
      <div class="settings-row">
        <div class="settings-row-main">
          <div class="settings-row-text">
            <div class="settings-row-sub">Device Name</div>
            <div class="settings-device-name">${s.deviceName}</div>
          </div>
        </div>
        <div class="settings-row-suffix">
          <button type="button" class="settings-row-icon-btn" title="Copy" aria-label="Copy">
            <img class="sym" src="assets/settings/edit-copy-symbolic.svg" alt="" draggable="false" />
          </button>
        </div>
      </div>
    ` +
    groupEnd() +
    groupStart(null) +
    rowNav(
      "Media Sharing",
      "Stream music, photos and videos to devices on the current network",
      "media-sharing",
      {
        icon: SETTINGS_ICON + "org.gnome.Settings-sharing-symbolic.svg",
        value: s.mediaSharing ? "On" : "Off",
      }
    ) +
    groupEnd()
  );
}

function renderWellbeingPanel() {
  const s = settingsState;
  const days = [
    { d: "M", h: 72 },
    { d: "T", h: 28 },
    { d: "W", h: 4 },
    { d: "T", h: 4 },
    { d: "F", h: 4 },
    { d: "S", h: 4 },
    { d: "S", h: 4 },
  ];
  const bars = days
    .map(
      (x, i) =>
        `<div class="bar${i === 1 ? " today" : ""}" data-day="${x.d}" style="height:${x.h}%"></div>`
    )
    .join("");

  return (
    groupStart("Screen Time", {
      suffix: `<button type="button" class="settings-row-icon-btn" title="More" aria-label="More"><img class="sym" src="assets/settings/open-menu-symbolic.svg" alt="" draggable="false" /></button>`,
    }) +
    `<div class="settings-wellbeing-card">
      <div class="settings-wellbeing-stats">
        <div class="settings-wellbeing-stat">
          <div class="label">Today</div>
          <div class="value">1h 54m</div>
          <div class="avg">Average Tuesday<br/>6h 28m</div>
        </div>
        <div class="settings-wellbeing-stat">
          <div class="label">This Week</div>
          <div class="value">8h 22m</div>
          <div class="avg">Average Week<br/>63h 9m</div>
        </div>
      </div>
      <div class="settings-wellbeing-chart">
        <div class="grid-line" style="bottom:78%"></div>
        <div class="grid-line" style="bottom:56%"></div>
        ${bars}
      </div>
      <div class="settings-wellbeing-nav">
        <button type="button" aria-label="Previous"><img class="sym" src="assets/actions/go-previous-symbolic.svg" alt="" /></button>
        <button type="button" aria-label="Next"><img class="sym" src="assets/actions/go-next-symbolic.svg" alt="" /></button>
      </div>
    </div>` +
    groupEnd() +
    groupStart("Screen Limits") +
    rowToggle("Screen Time Limit", null, "screenTimeLimit", s.screenTimeLimit) +
    rowCombo("Daily Limit", "8 hours") +
    rowToggle(
      "Grayscale",
      "Black and white screen for screen limits",
      "grayscale",
      s.grayscale,
      { disabled: !s.screenTimeLimit }
    ) +
    groupEnd() +
    groupStart("Break Reminders") +
    rowToggle(
      "Eyesight Reminders",
      "Reminders to look away from the screen",
      "eyesightReminders",
      s.eyesightReminders
    ) +
    rowToggle(
      "Movement Reminders",
      "Reminders to move around",
      "movementReminders",
      s.movementReminders
    ) +
    rowCombo("Movement Break Schedule", "5 minutes / 30 minutes", {
      disabled: !s.movementReminders,
    }) +
    rowToggle(
      "Sounds",
      "Play a sound when a break ends",
      "breakSounds",
      s.breakSounds,
      { disabled: !s.eyesightReminders && !s.movementReminders }
    ) +
    groupEnd()
  );
}

function renderMousePanel() {
  const s = settingsState;
  const traditional = !s.naturalScroll;
  return (
    groupStart("General") +
    `<div class="settings-row">
      <div class="settings-row-main">
        <div class="settings-row-text">
          <div class="settings-row-title">Primary Button</div>
          <div class="settings-row-sub">Order of physical buttons on mice and touchpads</div>
        </div>
      </div>
      <div class="settings-row-suffix">
        <div class="settings-segmented" role="group" aria-label="Primary Button">
          <button type="button" class="settings-segment${
            s.primaryButton === "left" ? " selected" : ""
          }" data-primary="left">Left</button>
          <button type="button" class="settings-segment${
            s.primaryButton === "right" ? " selected" : ""
          }" data-primary="right">Right</button>
        </div>
      </div>
    </div>` +
    groupEnd() +
    groupStart("Mouse") +
    rowSliderInline("Pointer Speed", "pointerSpeed", s.pointerSpeed, {
      ends: ["Slow", "Fast"],
    }) +
    rowToggle(
      "Mouse Acceleration",
      "Recommended for most users and applications",
      "mouseAcceleration",
      s.mouseAcceleration
    ) +
    `<div class="settings-row-block" style="border-bottom:none;padding-bottom:4px">
      <div class="settings-row-title" style="margin-bottom:4px">Scroll Direction</div>
    </div>
    <div class="settings-choice-grid">
      <button type="button" class="settings-choice-card${traditional ? " selected" : ""}" data-radio="naturalScroll" data-value="false">
        <div class="settings-choice-preview"><div class="settings-scroll-illus"><div class="win"></div><div class="mouse"></div></div></div>
        <div class="settings-choice-meta">
          ${radioHtml(traditional)}
          <div class="settings-row-text">
            <div class="settings-row-title">Traditional</div>
            <div class="settings-row-sub">Scrolling moves the view</div>
          </div>
        </div>
      </button>
      <button type="button" class="settings-choice-card${!traditional ? " selected" : ""}" data-radio="naturalScroll" data-value="true">
        <div class="settings-choice-preview"><div class="settings-scroll-illus"><div class="win"></div><div class="mouse"></div></div></div>
        <div class="settings-choice-meta">
          ${radioHtml(!traditional)}
          <div class="settings-row-text">
            <div class="settings-row-title">Natural</div>
            <div class="settings-row-sub">Scrolling moves the content</div>
          </div>
        </div>
      </button>
    </div>` +
    groupEnd() +
    groupStart(null) +
    `
      <button type="button" class="settings-row activatable">
        <div class="settings-row-main" style="justify-content:center;width:100%">
          <div class="settings-row-title" style="width:100%;text-align:center">Test Settings</div>
        </div>
        <div class="settings-row-suffix">${chevronHtml()}</div>
      </button>
    ` +
    groupEnd()
  );
}

function renderKeyboardPanel() {
  return (
    groupStart("Input Sources", {
      description: "Includes keyboard layouts and input methods",
    }) +
    `
      <div class="settings-row">
        <div class="settings-row-main">
          <img class="settings-row-icon" src="${SETTINGS_ICON}org.gnome.Settings-keyboard-symbolic.svg" alt="" draggable="false" />
          <div class="settings-row-text"><div class="settings-row-title">English (US)</div></div>
        </div>
        <div class="settings-row-suffix">
          <button type="button" class="settings-row-icon-btn" title="More" aria-label="More">
            <img class="sym" src="assets/settings/open-menu-symbolic.svg" alt="" draggable="false" />
          </button>
        </div>
      </div>
      <button type="button" class="settings-row activatable">
        <div class="settings-row-main" style="justify-content:center;width:100%">
          <div class="settings-row-title" style="color:var(--accent);width:100%;text-align:center">+ Add Input Source</div>
        </div>
      </button>
    ` +
    groupEnd() +
    groupStart("Input Source Switching", {
      description:
        "Input sources can be switched using the Super+Space keyboard shortcut. This can be changed in the keyboard shortcut settings.",
    }) +
    rowRadio("Use the same source for all windows", null, "inputSourceMode", "all", true) +
    rowRadio(
      "Switch input sources individually for each window",
      null,
      "inputSourceMode",
      "per-window",
      false
    ) +
    groupEnd() +
    groupStart("Special Character Entry", {
      description: "Methods for entering symbols and letter variants using the keyboard",
    }) +
    rowNav("Alternate Characters Key", null, "alt-chars", { value: "Default" }) +
    rowNav("Compose Key", null, "compose-key", { value: "Right Alt" }) +
    groupEnd() +
    groupStart("Keyboard Shortcuts") +
    rowNav("View and Customize Shortcuts", null, "shortcuts") +
    groupEnd()
  );
}

function renderColorPanel() {
  return (
    pageIntro(
      `Each device needs an up to date color profile to be color managed — <span class="settings-link">learn more</span>.`
    ) +
    groupStart(null) +
    `
      <div class="settings-row">
        <div class="settings-row-main">
          <div class="settings-row-text">
            <div class="settings-row-title">GA2701S Monitor</div>
          </div>
        </div>
        <div class="settings-row-suffix">
          ${switchHtml("colorDeviceEnabled", settingsState.colorDeviceEnabled)}
          ${chevronHtml()}
        </div>
      </div>
    ` +
    groupEnd()
  );
}

function renderPrintersPanel() {
  return `
    <div class="settings-status">
      <img class="settings-status-icon" src="${SETTINGS_ICON}org.gnome.Settings-printers-symbolic.svg" alt="" />
      <div class="settings-status-title">No Printers</div>
      <button type="button" class="settings-btn suggested">Add Printer…</button>
    </div>`;
}

function renderWacomPanel() {
  return `
    <div class="settings-status">
      <img class="settings-status-icon" src="${SETTINGS_ICON}org.gnome.Settings-wacom-symbolic.svg" alt="" />
      <div class="settings-status-title">No tablet detected</div>
      <div class="settings-status-sub">Plug in a graphics tablet to configure it.</div>
    </div>`;
}

function renderAccessibilityPanel() {
  const s = settingsState;
  return (
    groupStart(null) +
    rowToggle(
      "Always Show Accessibility Menu",
      "Display the accessibility menu in the top bar",
      "alwaysShowA11yMenu",
      s.alwaysShowA11yMenu
    ) +
    groupEnd() +
    groupStart(null) +
    rowNav("Seeing", null, "ua-seeing", {
      icon: SETTINGS_ICON + "org.gnome.Settings-accessibility-seeing-symbolic.svg",
    }) +
    rowNav("Hearing", null, "ua-hearing", {
      icon: SETTINGS_ICON + "org.gnome.Settings-accessibility-hearing-symbolic.svg",
    }) +
    rowNav("Typing", null, "ua-typing", {
      icon: SETTINGS_ICON + "org.gnome.Settings-accessibility-typing-symbolic.svg",
    }) +
    rowNav("Pointing and Clicking", null, "ua-pointing", {
      icon: SETTINGS_ICON + "org.gnome.Settings-accessibility-pointing-symbolic.svg",
    }) +
    rowNav("Zoom", null, "ua-zoom", {
      icon: SETTINGS_ICON + "org.gnome.Settings-accessibility-zoom-symbolic.svg",
    }) +
    groupEnd()
  );
}

function renderPrivacyPanel() {
  return (
    groupStart("System") +
    rowNav("Screen Lock", "Automatic screen lock", "screen-lock", {
      icon: SETTINGS_ICON + "org.gnome.Settings-screen-lock-symbolic.svg",
    }) +
    rowNav("Location", "Control access to your location", "location", {
      icon: SETTINGS_ICON + "org.gnome.Settings-location-access-symbolic.svg",
    }) +
    rowNav("File History & Trash", "Remove saved data and files", "usage", {
      icon: SETTINGS_ICON + "org.gnome.Settings-trash-file-history-symbolic.svg",
    }) +
    rowNav("Telemetry", "Control error and system reporting", "telemetry", {
      icon: SETTINGS_ICON + "org.gnome.Settings-device-diagnostics-symbolic.svg",
    }) +
    rowNav("Connectivity", "Detect connection issues", "connectivity", {
      icon: SETTINGS_ICON + "org.gnome.Settings-network-symbolic.svg",
    }) +
    rowNav("Security Center", "Configure more security settings", "security-center", {
      icon: SETTINGS_ICON + "org.gnome.Settings-device-security-symbolic.svg",
      external: true,
    }) +
    groupEnd() +
    groupStart("Devices") +
    rowNav("Cameras", "Control camera access", "cameras", {
      icon: SETTINGS_ICON + "org.gnome.Settings-camera-access-symbolic.svg",
    }) +
    rowNav("Device Security", "Hardware security status and information", "device-security", {
      icon: SETTINGS_ICON + "org.gnome.Settings-device-security-symbolic.svg",
    }) +
    groupEnd()
  );
}

function renderSystemPanel() {
  return (
    groupStart(null) +
    rowNav("Region & Language", "System language and localization", "region", {
      icon: SETTINGS_ICON + "org.gnome.Settings-region-symbolic.svg",
    }) +
    rowNav("Date & Time", "Time zone and clock settings", "datetime", {
      icon: SETTINGS_ICON + "org.gnome.Settings-time-symbolic.svg",
    }) +
    rowNav("Users", "Add and remove accounts, change password", "users", {
      icon: SETTINGS_ICON + "org.gnome.Settings-users-symbolic.svg",
    }) +
    rowNav("Remote Desktop", "Allow this device to be used remotely", "remote-desktop", {
      icon: SETTINGS_ICON + "org.gnome.Settings-remote-desktop-symbolic.svg",
    }) +
    rowNav("Secure Shell", "SSH network access", "ssh", {
      icon: SETTINGS_ICON + "org.gnome.Settings-secure-shell-symbolic.svg",
    }) +
    rowNav("About", "Hardware details and software versions", "about", {
      icon: SETTINGS_ICON + "org.gnome.Settings-about-symbolic.svg",
    }) +
    groupEnd() +
    groupStart(null) +
    `
      <button type="button" class="settings-row activatable">
        <div class="settings-row-main">
          <img class="settings-row-icon" src="${SETTINGS_ICON}org.gnome.Settings-system-symbolic.svg" alt="" draggable="false" />
          <div class="settings-row-text"><div class="settings-row-title">Software Updates</div></div>
        </div>
        <div class="settings-row-suffix">
          <img class="settings-ext-link" src="assets/settings/go-next-symbolic.svg" alt="" style="transform:rotate(-45deg)" draggable="false" />
        </div>
      </button>
    ` +
    groupEnd()
  );
}

function renderSettingsSubpage(id) {
  const s = settingsState;
  switch (id) {
    case "night-light":
      return renderNightLightPage(s);
    case "datetime":
      return (
        groupStart("Date & Time") +
        rowToggle(
          "Automatic Date & Time",
          "Requires internet access",
          "autoDatetime",
          s.autoDatetime
        ) +
        rowToggle(
          "Automatic Time Zone",
          "Requires location services enabled and internet access",
          "autoTimezone",
          s.autoTimezone
        ) +
        rowStatic("Time Zone", "America/New_York") +
        groupEnd() +
        groupStart("Time Format") +
        rowRadio("24-hour", null, "timeFormat24", "true", s.timeFormat24) +
        rowRadio("AM / PM", null, "timeFormat24", "false", !s.timeFormat24) +
        groupEnd() +
        /* GNOME 50: First Day of the Week */
        groupStart(null) +
        `<div class="settings-row-block">
          <div class="settings-row-title" style="margin-bottom:8px">First Day of the Week</div>
          <div class="settings-segmented" role="group" aria-label="First Day of the Week">
            <button type="button" class="settings-segment${
              s.firstDayOfWeek === "sunday" ? " selected" : ""
            }" data-first-day="sunday">Sunday</button>
            <button type="button" class="settings-segment${
              s.firstDayOfWeek === "monday" ? " selected" : ""
            }" data-first-day="monday">Monday</button>
          </div>
          <div class="settings-row-sub" style="margin-top:8px">Also respected by Calendar and other apps</div>
        </div>` +
        groupEnd() +
        groupStart("Clock & Calendar") +
        rowToggle("Week Day", null, "weekDayInClock", s.weekDayInClock) +
        rowToggle("Date", null, "dateInClock", s.dateInClock) +
        rowToggle("Seconds", null, "secondsInClock", s.secondsInClock) +
        rowToggle(
          "Week Numbers",
          "Shown in the dropdown calendar",
          "weekNumbers",
          s.weekNumbers
        ) +
        groupEnd()
      );
    case "ua-seeing": {
      const textPx = [14, 15, 17][s.textSize] || 15;
      return (
        groupStart(null) +
        rowToggle(
          "Screen Reader",
          "The screen reader reads displayed text as you move the focus",
          "screenReader",
          false
        ) +
        rowToggle(
          "High Contrast",
          "Increase color contrast of foreground and background interface elements",
          "highContrast",
          s.highContrast
        ) +
        rowToggle(
          "On/Off Shapes",
          "Use shapes to indicate state in addition to or instead of color",
          "onOffShapes",
          s.onOffShapes
        ) +
        /* GNOME 50: Reduced Motion */
        rowToggle(
          "Reduced Motion",
          "Toggle reduced motion animations throughout the user interface",
          "reducedMotion",
          s.reducedMotion
        ) +
        groupEnd() +
        groupStart("Text Size") +
        `<div class="settings-text-preview">
          <div class="settings-text-preview-sample" style="font-size:${textPx}px">Sample text</div>
        </div>
        <div class="settings-row-block">
          <div class="settings-text-ends"><span class="small-a">A</span><span class="large-a">A</span></div>
          <input type="range" class="settings-range" data-slider="textSize" min="0" max="2" step="1" value="${s.textSize}" aria-label="Text Size" />
        </div>` +
        groupEnd() +
        groupStart(null) +
        rowToggle(
          "Sound Keys",
          "Beep when Num Lock or Caps Lock are turned on or off",
          "soundKeys",
          false
        ) +
        rowToggle("Always Show Scrollbars", "Make scrollbars always visible", "alwaysScrollbars", false) +
        groupEnd()
      );
    }
    case "about":
      return renderAboutPage(s);
    case "system-details":
      return renderSystemDetailsDialog();
    case "region":
      return (
        groupStart(null) +
        rowStatic("Language", "English (United States)") +
        rowStatic("Formats", "United States") +
        groupEnd()
      );
    case "users":
      return (
        groupStart("Users") +
        `
          <button type="button" class="settings-row activatable">
            <div class="settings-row-main">
              <div class="settings-row-text">
                <div class="settings-row-title">Leon</div>
                <div class="settings-row-sub">Administrator · Standard</div>
              </div>
            </div>
            <div class="settings-row-suffix">${chevronHtml()}</div>
          </button>
        ` +
        groupEnd() +
        `<div class="settings-btn-row"><button type="button" class="settings-btn">Add User…</button></div>`
      );
    case "remote-desktop":
      return (
        groupStart(null) +
        rowToggle("Desktop Sharing", "Allow remote connections to this desktop", "rdpShare", false) +
        rowToggle("Remote Login", "Allow remote login sessions", "rdpLogin", false) +
        groupEnd() +
        `<div class="settings-banner">GNOME 50 adds hardware-accelerated remote desktop (Vulkan / VA-API), HiDPI client scaling, and camera redirection.</div>`
      );
    case "screen-lock":
      return (
        groupStart(null) +
        rowToggle("Automatic Screen Lock", null, "screenLock", s.screenLock) +
        rowStatic("Blank Screen Delay", "5 minutes") +
        groupEnd()
      );
    case "location":
      return (
        groupStart(null) +
        rowToggle(
          "Location Services",
          "Allow apps to determine your location",
          "location",
          s.location
        ) +
        groupEnd()
      );
    case "ua-hearing":
    case "ua-typing":
    case "ua-pointing":
    case "ua-zoom":
      return `<div class="settings-status"><div class="settings-status-title">${
        settingsSubpage?.title || "Settings"
      }</div><div class="settings-status-sub">Preview of this accessibility page.</div></div>`;
    default:
      return `<div class="settings-status"><div class="settings-status-title">${
        settingsSubpage?.title || "Settings"
      }</div><div class="settings-status-sub">This page is a visual preview.</div></div>`;
  }
}

const ACCENT_BLUE = "#3584e4";
let accentFlashTimer = 0;

function setAccentCss(color) {
  document.documentElement.style.setProperty("--accent", color);
  document.documentElement.style.setProperty("--accent-hover", color);
}

/**
 * Accent swatches are decorative only: flash the chosen colour for 1s,
 * then snap selection and CSS back to blue.
 */
function flashAccentPreview(id) {
  const accent = SETTINGS_ACCENTS.find((a) => a.id === id);
  if (!accent) return;

  clearTimeout(accentFlashTimer);
  setAccentCss(accent.color);
  settingsState.accent = id;

  // Update selected ring without full panel re-render
  document.querySelectorAll(".settings-accent").forEach((btn) => {
    btn.classList.toggle("selected", btn.dataset.accent === id);
  });

  accentFlashTimer = window.setTimeout(() => {
    settingsState.accent = "blue";
    setAccentCss(ACCENT_BLUE);
    document.querySelectorAll(".settings-accent").forEach((btn) => {
      btn.classList.toggle("selected", btn.dataset.accent === "blue");
    });
  }, 1000);
}

function applyAccentColor(id) {
  // Kept for any callers; real accent is always blue after flash.
  flashAccentPreview(id);
}

function aboutField(label, value) {
  return `
    <div class="settings-about-field">
      <div class="settings-about-field-label">${label}</div>
      <div class="settings-about-field-value">${value}</div>
    </div>`;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** GNOME Night Light time spin (hour or minute): + / value / − */
function nlSpin(kind, value) {
  return `
    <div class="settings-nl-spin" data-nl-spin="${kind}">
      <button type="button" class="settings-nl-spin-btn" data-nl-step="${kind}" data-dir="1" aria-label="Increase">+</button>
      <div class="settings-nl-spin-val">${pad2(value)}</div>
      <button type="button" class="settings-nl-spin-btn" data-nl-step="${kind}" data-dir="-1" aria-label="Decrease">−</button>
    </div>`;
}

function renderNightLightPage(s) {
  const on = s.nightLight;
  const dim = on ? "" : " is-disabled";
  const scheduleLabel =
    s.nlSchedule === "manual" ? "Manual Schedule" : "Sunset to Sunrise";
  // Layout matches Ubuntu GNOME Settings: Night Light → Schedule → Times → Color Temperature.
  return (
    pageIntro(
      "Night light makes the screen color warmer. This can help to prevent eye strain and sleeplessness."
    ) +
    groupStart(null) +
    rowToggle("Night Light", null, "nightLight", on) +
    // AdwComboRow-style: plain label + value + chevron (popover, not native <select>)
    `<div class="settings-row settings-nl-combo-row${dim}">
      <div class="settings-row-main">
        <div class="settings-row-text"><div class="settings-row-title">Schedule</div></div>
      </div>
      <div class="settings-row-suffix settings-nl-combo-wrap">
        <button type="button" class="settings-nl-combo" data-nl-combo ${on ? "" : "disabled"} aria-haspopup="listbox" aria-expanded="false">
          <span class="settings-nl-combo-label" data-nl-combo-label>${scheduleLabel}</span>
          <img class="settings-chevron settings-nl-combo-chevron" src="assets/settings/go-next-symbolic.svg" alt="" draggable="false" />
        </button>
        <div class="settings-nl-popover" data-nl-popover hidden role="listbox" aria-label="Schedule">
          <button type="button" class="settings-nl-popover-item${
            s.nlSchedule !== "manual" ? " selected" : ""
          }" role="option" data-nl-schedule-opt="sunset" aria-selected="${
            s.nlSchedule !== "manual" ? "true" : "false"
          }">Sunset to Sunrise</button>
          <button type="button" class="settings-nl-popover-item${
            s.nlSchedule === "manual" ? " selected" : ""
          }" role="option" data-nl-schedule-opt="manual" aria-selected="${
            s.nlSchedule === "manual" ? "true" : "false"
          }">Manual Schedule</button>
        </div>
      </div>
    </div>` +
    // Times with vertical +/value/− spinbuttons (From 20:00 To 06:00 in screenshot)
    `<div class="settings-row settings-nl-times-row${dim}${
      s.nlSchedule === "manual" ? "" : " is-hidden"
    }">
      <div class="settings-row-main">
        <div class="settings-row-text"><div class="settings-row-title">Times</div></div>
      </div>
      <div class="settings-row-suffix settings-nl-times">
        <span class="settings-nl-fromto">From</span>
        ${nlSpin("fromH", s.nlFromH)}
        <span class="settings-nl-colon">:</span>
        ${nlSpin("fromM", s.nlFromM)}
        <span class="settings-nl-fromto">To</span>
        ${nlSpin("toH", s.nlToH)}
        <span class="settings-nl-colon">:</span>
        ${nlSpin("toM", s.nlToM)}
      </div>
    </div>` +
    `<div class="settings-row-block settings-nl-temp-block${dim}">
      <div class="settings-row-title">Color Temperature</div>
      <div class="settings-nl-temp-wrap">
        <input type="range" class="settings-range settings-nl-temp" data-slider="nightTemp" min="0" max="100" value="${s.nightTemp}" aria-label="Color Temperature" ${
          on ? "" : "disabled"
        } />
        <div class="settings-nl-temp-ticks" aria-hidden="true">
          <span></span><span></span><span></span><span></span>
        </div>
      </div>
    </div>` +
    groupEnd()
  );
}

function renderAboutPage(s) {
  return `
    <div class="settings-about-hero">
      <img class="settings-about-logo" src="docs/favicon/GNOME.png" alt="" draggable="false" />
      <div class="settings-about-name">GNOME</div>
    </div>
    ${groupStart(null)}
    <div class="settings-row settings-about-device-row">
      <div class="settings-row-main">
        <div class="settings-row-text">
          <div class="settings-about-field-label">Device Name</div>
          <div class="settings-about-field-value settings-device-name">${s.deviceName}</div>
        </div>
      </div>
      <div class="settings-row-suffix">
        <button type="button" class="settings-row-icon-btn" title="Copy" aria-label="Copy" data-action="copy-device-name">
          <img class="sym" src="assets/settings/edit-copy-symbolic.svg" alt="" draggable="false" />
        </button>
      </div>
    </div>
    ${groupEnd()}
    ${groupStart(null)}
    ${aboutField("Operating System", "GNOME OS")}
    ${aboutField("Hardware Model", "Micro-Star International Co., Ltd. MS-7D14")}
    ${aboutField("Processor", "AMD Ryzen™ 7 5700G with Radeon™ Graphics × 16")}
    ${aboutField("Memory", "16.0 GiB")}
    ${aboutField("Disk Capacity", "1.5 TB")}
    <button type="button" class="settings-row activatable settings-about-field-row" data-nav="system-details">
      <div class="settings-row-main">
        <div class="settings-row-text">
          <div class="settings-row-title">System Details</div>
        </div>
      </div>
      <div class="settings-row-suffix">${chevronHtml()}</div>
    </button>
    ${groupEnd()}`;
}

function renderSystemDetailsDialog() {
  // Inline page variant if navigated; prefer modal host when on About
  return `
    <div class="settings-system-details-page">
      <div class="settings-details-cols">
        <div>
          <h2 class="settings-details-heading">Hardware Information</h2>
          ${aboutField("Model", "Micro-Star International Co., Ltd. MS-7D14")}
          ${aboutField("Memory", "16.0 GiB")}
          ${aboutField("Processor", "AMD Ryzen™ 7 5700G with Radeon™ Graphics × 16")}
          ${aboutField("Graphics", "AMD Radeon™ RX 7800 XT")}
          ${aboutField("Graphics 1", "AMD Radeon™ Graphics")}
          ${aboutField("Disk Capacity", "1.5 TB")}
        </div>
        <div>
          <h2 class="settings-details-heading">Software Information</h2>
          ${aboutField("Firmware Version", "1.G0")}
          ${aboutField("OS Name", "GNOME OS")}
          ${aboutField("OS Type", "64-bit")}
          ${aboutField("GNOME Version", "50")}
          ${aboutField("Windowing System", "Wayland")}
          ${aboutField("Kernel Version", "Linux 7.0.0-28-generic")}
        </div>
      </div>
    </div>`;
}

function openSystemDetailsModal() {
  const pane = document.querySelector(".settings-content");
  if (!pane) return;
  let host = document.getElementById("settings-system-details-host");
  if (!host) {
    host = document.createElement("div");
    host.id = "settings-system-details-host";
    host.className = "settings-system-details-host";
    pane.appendChild(host);
  }
  host.hidden = false;
  host.innerHTML = `
    <div class="settings-details-backdrop" data-action="close-system-details"></div>
    <div class="settings-details-dialog" role="dialog" aria-label="System Details">
      <header class="settings-details-header">
        <button type="button" class="settings-btn flat" data-action="copy-system-details">
          <img class="sym" src="assets/settings/edit-copy-symbolic.svg" alt="" draggable="false" style="width:14px;height:14px;filter:var(--win-sym-filter);margin-right:4px" />
          Copy
        </button>
        <h2 class="settings-details-title">System Details</h2>
        <button type="button" class="settings-icon-btn" data-action="close-system-details" title="Close" aria-label="Close">
          <img class="sym" src="assets/status/window-close-symbolic.svg" alt="" draggable="false" />
        </button>
      </header>
      <div class="settings-details-cols">
        <div>
          <h3 class="settings-details-heading">Hardware Information</h3>
          ${aboutField("Model", "Micro-Star International Co., Ltd. MS-7D14")}
          ${aboutField("Memory", "16.0 GiB")}
          ${aboutField("Processor", "AMD Ryzen™ 7 5700G with Radeon™ Graphics × 16")}
          ${aboutField("Graphics", "AMD Radeon™ RX 7800 XT")}
          ${aboutField("Graphics 1", "AMD Radeon™ Graphics")}
          ${aboutField("Disk Capacity", "1.5 TB")}
        </div>
        <div>
          <h3 class="settings-details-heading">Software Information</h3>
          ${aboutField("Firmware Version", "1.G0")}
          ${aboutField("OS Name", "GNOME OS")}
          ${aboutField("OS Type", "64-bit")}
          ${aboutField("GNOME Version", "50")}
          ${aboutField("Windowing System", "Wayland")}
          ${aboutField("Kernel Version", "Linux 7.0.0-28-generic")}
        </div>
      </div>
    </div>`;
  host.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (btn.dataset.action === "close-system-details") {
        host.hidden = true;
        host.innerHTML = "";
      }
      if (btn.dataset.action === "copy-system-details") {
        const text = `Hardware Information
Model: Micro-Star International Co., Ltd. MS-7D14
Memory: 16.0 GiB
Processor: AMD Ryzen™ 7 5700G with Radeon™ Graphics × 16
Graphics: AMD Radeon™ RX 7800 XT
Graphics 1: AMD Radeon™ Graphics
Disk Capacity: 1.5 TB

Software Information
Firmware Version: 1.G0
OS Name: GNOME OS
OS Type: 64-bit
GNOME Version: 50
Windowing System: Wayland
Kernel Version: Linux 7.0.0-28-generic`;
        navigator.clipboard?.writeText(text).catch(() => {});
      }
    });
  });
}

function applyReducedMotion(on) {
  settingsState.reducedMotion = on;
  document.documentElement.classList.toggle("reduced-motion", on);
}

function setSettingValue(key, value) {
  settingsState[key] = value;

  if (key === "darkStyle" && typeof setDarkStyle === "function") {
    setDarkStyle(value);
  }
  if (key === "nightLight" && typeof setNightLight === "function") {
    setNightLight(value);
    renderSettingsContent();
    return;
  }
  if (key === "nightTemp") {
    applyNightLightTemperature(value);
  }
  if (key === "reducedMotion") applyReducedMotion(value);
  if (key === "dnd") {
    const dndBtn = document.querySelector('.qs-toggle[data-toggle="dnd"]');
    if (dndBtn) {
      dndBtn.classList.toggle("active", value);
      dndBtn.setAttribute("aria-pressed", value ? "true" : "false");
    }
  }
  if (key === "volumeOutput" && volumeSlider) {
    volumeSlider.value = String(value);
    updateVolumeFill();
  }
  if (key === "powerMode") {
    const pm = document.querySelector('.qs-toggle[data-toggle="power-mode"]');
    if (pm) {
      const sub = pm.querySelector(".qs-toggle-sub");
      const icon = pm.querySelector("img.sym");
      const labels = {
        "power-saver": "Power Saver",
        balanced: "Balanced",
        performance: "Performance",
      };
      if (sub) sub.textContent = labels[value] || value;
      if (icon) {
        icon.src =
          value === "performance"
            ? "assets/status/power-profile-performance-symbolic.svg"
            : "assets/status/power-profile-balanced-symbolic.svg";
      }
      const isPerf = value === "performance";
      pm.classList.toggle("active", isPerf || value === "balanced" || value === "power-saver");
    }
  }
  if (
    key === "wifiEnabled" ||
    key === "bluetoothEnabled" ||
    key === "autoSuspend" ||
    key === "screenTimeLimit" ||
    key === "movementReminders" ||
    key === "eyesightReminders" ||
    key === "dynamicWorkspaces" ||
    key === "nlSchedule"
  ) {
    renderSettingsContent();
  }
}

function bindSettingsContentHandlers() {
  settingsContent.querySelectorAll(".settings-switch").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const key = btn.dataset.setting;
      if (!key) return;
      const next = !btn.classList.contains("on");
      btn.classList.toggle("on", next);
      btn.setAttribute("aria-checked", next ? "true" : "false");
      // Map string keys that aren't in settingsState as soft toggles
      if (
        key in settingsState ||
        [
          "startupSound",
          "screenReader",
          "soundKeys",
          "alwaysScrollbars",
          "searchFiles",
          "searchCalc",
          "searchWeb",
          "searchChars",
          "rdpShare",
          "rdpLogin",
          "wiredEnabled",
          "adjustForTv",
        ].includes(key)
      ) {
        if (!(key in settingsState)) settingsState[key] = next;
        setSettingValue(key, next);
      }
    });
  });

  settingsContent.querySelectorAll("[data-radio]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const key = btn.dataset.radio;
      let value = btn.dataset.value;
      if (value === "true") value = true;
      else if (value === "false") value = false;
      setSettingValue(key, value);
      renderSettingsContent();
    });
  });

  settingsContent.querySelectorAll("[data-nav]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.dataset.nav;
      if (id === "system-details") {
        openSystemDetailsModal();
        return;
      }
      const titles = {
        "night-light": "Night Light",
        datetime: "Date & Time",
        region: "Region & Language",
        users: "Users",
        "remote-desktop": "Remote Desktop",
        ssh: "Secure Shell",
        about: "About",
        "system-details": "System Details",
        "ua-seeing": "Seeing",
        "ua-hearing": "Hearing",
        "ua-typing": "Typing",
        "ua-pointing": "Pointing and Clicking",
        "ua-zoom": "Zoom",
        "screen-lock": "Screen Lock",
        location: "Location",
        usage: "File History & Trash",
        telemetry: "Diagnostics",
        cameras: "Cameras",
        thunderbolt: "Thunderbolt",
        "device-security": "Device Security",
        "default-apps": "Default Apps",
        "removable-media": "Removable Media",
        "search-locations": "Search Locations",
        proxy: "Proxy",
        shortcuts: "Keyboard Shortcuts",
      };
      settingsSubpage = { id, title: titles[id] || id };
      renderSettingsContent();
    });
  });

  settingsContent.querySelectorAll("[data-style]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      setSettingValue("darkStyle", btn.dataset.style === "dark");
      renderSettingsContent();
    });
  });

  settingsContent.querySelectorAll("[data-accent]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      flashAccentPreview(btn.dataset.accent);
    });
  });

  settingsContent.querySelectorAll("[data-wall]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      applyWallpaper(btn.dataset.wall);
      settingsContent
        .querySelectorAll("[data-wall]")
        .forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      // Keep style previews in sync with the active wallpaper
      const url = SETTINGS_WALLPAPERS[btn.dataset.wall]?.webp;
      if (url) {
        settingsContent.querySelectorAll(".settings-style-preview").forEach((el) => {
          el.style.backgroundImage = `url('${url}')`;
        });
      }
    });
  });

  const paintRange = (input) => {
    const min = Number(input.min) || 0;
    const max = Number(input.max) || 100;
    const val = Number(input.value);
    const pct = ((val - min) / (max - min)) * 100;
    input.style.setProperty("--range-fill", `${pct}%`);
  };

  settingsContent.querySelectorAll("input.settings-range").forEach((input) => {
    paintRange(input);
    input.addEventListener("input", (e) => {
      e.stopPropagation();
      paintRange(input);
      const key = input.dataset.slider;
      if (!key) return;
      const val = Number(input.value);
      if (key === "textSize") {
        settingsState.textSize = val;
        const sample = settingsContent.querySelector(".settings-text-preview-sample");
        if (sample) sample.style.fontSize = `${[14, 15, 17][val] || 15}px`;
        return;
      }
      setSettingValue(key, val);
      const label = settingsContent.querySelector(`[data-slider-label="${key}"]`);
      if (label) label.textContent = `${val}%`;
    });
  });

  // Night Light schedule combo (popover, not native <select>)
  const nlCombo = settingsContent.querySelector("[data-nl-combo]");
  const nlPopover = settingsContent.querySelector("[data-nl-popover]");
  if (nlCombo && nlPopover) {
    const closePopover = () => {
      nlPopover.hidden = true;
      nlCombo.setAttribute("aria-expanded", "false");
    };
    nlCombo.addEventListener("click", (e) => {
      e.stopPropagation();
      if (nlCombo.disabled) return;
      const open = nlPopover.hidden;
      nlPopover.hidden = !open;
      nlCombo.setAttribute("aria-expanded", open ? "true" : "false");
    });
    nlPopover.querySelectorAll("[data-nl-schedule-opt]").forEach((item) => {
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        setSettingValue("nlSchedule", item.dataset.nlScheduleOpt);
        renderSettingsContent();
      });
    });
    // Close when clicking elsewhere in settings content
    settingsContent.addEventListener(
      "click",
      (e) => {
        if (!e.target.closest(".settings-nl-combo-wrap")) closePopover();
      },
      { once: true }
    );
  }

  settingsContent.querySelectorAll("[data-nl-step]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!settingsState.nightLight) return;
      const kind = btn.dataset.nlStep;
      const dir = Number(btn.dataset.dir) || 1;
      const map = {
        fromH: ["nlFromH", 24],
        fromM: ["nlFromM", 60],
        toH: ["nlToH", 24],
        toM: ["nlToM", 60],
      };
      const [key, mod] = map[kind] || [];
      if (!key) return;
      let next = (Number(settingsState[key]) + dir) % mod;
      if (next < 0) next += mod;
      settingsState[key] = next;
      renderSettingsContent();
    });
  });

  settingsContent.querySelectorAll("[data-primary]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      settingsState.primaryButton = btn.dataset.primary;
      renderSettingsContent();
    });
  });

  settingsContent.querySelectorAll("[data-first-day]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      settingsState.firstDayOfWeek = btn.dataset.firstDay;
      renderSettingsContent();
    });
  });

  settingsContent.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (btn.dataset.action === "enable-wifi") {
        setSettingValue("wifiEnabled", true);
      }
      if (btn.dataset.action === "enable-bt") {
        setSettingValue("bluetoothEnabled", true);
      }
      if (btn.dataset.action === "ws-inc") {
        settingsState.workspaceCount = Math.min(36, (settingsState.workspaceCount || 4) + 1);
        renderSettingsContent();
      }
      if (btn.dataset.action === "ws-dec") {
        settingsState.workspaceCount = Math.max(1, (settingsState.workspaceCount || 4) - 1);
        renderSettingsContent();
      }
      if (btn.dataset.action === "copy-device-name") {
        navigator.clipboard?.writeText(settingsState.deviceName).catch(() => {});
      }
    });
  });
}

// Settings chrome controls
settingsCloseBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  closeSettings();
});

settingsBackBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  settingsSubpage = null;
  renderSettingsContent();
});

settingsSearchBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  setSettingsSearchOpen(!settingsSearchOpen);
});

settingsSearchInput?.addEventListener("input", () => {
  settingsSearchQuery = settingsSearchInput.value;
  renderSettingsSidebar();
});

settingsSearchInput?.addEventListener("click", (e) => e.stopPropagation());

settingsMenuBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  if (!settingsMenu) return;
  settingsMenu.hidden = !settingsMenu.hidden;
});

settingsMenu?.addEventListener("click", (e) => {
  e.stopPropagation();
  const item = e.target.closest(".settings-menu-item");
  if (!item) return;
  settingsMenu.hidden = true;
  if (item.dataset.action === "about") {
    settingsPanelId = "system";
    settingsSubpage = { id: "about", title: "About" };
    renderSettingsSidebar();
    renderSettingsContent();
  }
});

settingsWindow?.addEventListener("click", (e) => {
  if (overviewOpen || overviewAnimating) return;
  e.stopPropagation();
  // close menu when clicking elsewhere in window
  if (settingsMenu && !settingsMenu.hidden && !e.target.closest("#settings-menu-btn") && !e.target.closest("#settings-menu")) {
    settingsMenu.hidden = true;
  }
});

qsSettingsBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  openSettings();
});


/* ============================================================
   GNOME Software 50 — Flathub app store preview
   UI based on gs-shell.ui / gs-overview-page.ui / gs-details-page.ui
   Catalog metadata sourced from Flathub (popular apps, 2025–2026)
   ============================================================ */

const softwareWindow = document.getElementById("software-window");
const swShell = document.getElementById("sw-shell");
const swBody = document.getElementById("sw-body");
const swDetails = document.getElementById("sw-details");
const swDetailsBody = document.getElementById("sw-details-body");
const swCategory = document.getElementById("sw-category");
const swCategoryBody = document.getElementById("sw-category-body");
const swCategoryTitle = document.getElementById("sw-category-title");
const swSearchBar = document.getElementById("sw-search-bar");
const swSearchInput = document.getElementById("sw-search-input");
const swSearchBtn = document.getElementById("sw-search-btn");
const swMenu = document.getElementById("sw-menu");
const swMenuBtn = document.getElementById("sw-menu-btn");
const swCloseBtn = document.getElementById("sw-close");
const swDetailsBack = document.getElementById("sw-details-back");
const swDetailsClose = document.getElementById("sw-details-close");
const swCategoryBack = document.getElementById("sw-category-back");
const swCategoryClose = document.getElementById("sw-category-close");


/** @type {"main"|"details"|"category"} */
let softwareView = "main";
/** @type {"explore"|"installed"|"updates"|"search"} */
let softwareTab = "explore";
let softwareSearchOpen = false;
let softwareSearchQuery = "";
/** Currently open app id on details page */
let softwareDetailsId = null;
/** Category id when browsing a category */
let softwareCategoryId = null;
/** Featured carousel index */
let softwareCarouselIndex = 0;
let softwareCarouselTimer = 0;
/** Active install simulations: id -> { timer, progress, phase } */
const softwareInstallJobs = new Map();

const SW_STORAGE_KEY = "gnome-preview-software-installed";

/**
 * Flatpak IDs already present on this preview desktop (dock / overview).
 * Shown as installed in Software; never cloned into the app grid.
 */
const SW_DESKTOP_PREINSTALLED = {
  "com.valvesoftware.Steam": true, // dock
  "com.brave.Browser": true, // dock
  "org.libreoffice.LibreOffice": true, // overview suite components
};

/**
 * Flathub catalog — popular apps with metadata from flathub.org API.
 * downloadSizeMB is approximate download size shown in Software's context bar.
 * brand is a hex used for screenshot placeholders.
 */
const FLATHUB_APPS = [
  {
    id: "org.mozilla.firefox",
    name: "Firefox",
    summary: "Fast, Private & Safe Web Browser",
    description:
      "When it comes to your life online, you have a choice: accept the factory settings or put your privacy first. When you choose Firefox as your default browser, you're choosing to protect your data while supporting an independent tech company. Firefox is also the only major browser backed by a non-profit fighting to give you more openness, transparency and control of your life online.",
    developer: "Mozilla",
    verified: true,
    free: true,
    license: "MPL-2.0",
    version: "153.0.1",
    categories: ["network", "create"],
    icon: "assets/flathub/org.mozilla.firefox.png",
    downloadSizeMB: 248,
    installedSizeMB: 312,
    safety: { title: "Safe", desc: "Auditable code, sandbox, few permissions", level: "ok" },
    age: "3+",
    brand: "#ff7139",
    featured: true,
    editors: true,
  },
  {
    id: "com.discordapp.Discord",
    name: "Discord",
    summary: "Talk, play, hang out",
    description:
      "Discord is a free all-in-one messaging, voice, and video client available on your computer and phone. Whether you're part of a school club, gaming group, worldwide art community, or just a handful of friends that want to spend time together, Discord makes it easy to talk every day.",
    developer: "Discord Inc.",
    verified: true,
    free: false,
    license: "Proprietary",
    version: "1.0.151",
    categories: ["socialize", "network"],
    icon: "assets/flathub/com.discordapp.Discord.png",
    downloadSizeMB: 172,
    installedSizeMB: 265,
    safety: { title: "Potentially Unsafe", desc: "Proprietary, network access, broad permissions", level: "warn" },
    age: "13+",
    brand: "#5865f2",
    popular: true,
  },
  {
    id: "com.google.Chrome",
    name: "Google Chrome",
    summary: "The browser built to be yours",
    description:
      "Google Chrome is a browser that combines a minimal design with sophisticated technology to make the web faster, safer, and easier.",
    developer: "Google",
    verified: false,
    free: false,
    license: "Proprietary",
    version: "150.0.7871.186",
    categories: ["network"],
    icon: "assets/flathub/com.google.Chrome.png",
    downloadSizeMB: 285,
    installedSizeMB: 380,
    safety: { title: "Potentially Unsafe", desc: "Proprietary, network access, broad permissions", level: "warn" },
    age: "3+",
    brand: "#4285f4",
    popular: true,
  },
  {
    id: "com.brave.Browser",
    name: "Brave",
    summary: "Fast Internet, AI, Adblock",
    description:
      "Brave is on a mission to fix the web by giving users a safer, faster and better browsing experience while growing support for content creators through a new attention-based ecosystem of rewards. Browse faster by blocking ads and trackers that violate your privacy and slow you down.",
    developer: "Brave Software",
    verified: true,
    free: true,
    license: "MPL-2.0",
    version: "1.92.144",
    categories: ["network"],
    icon: "assets/flathub/com.brave.Browser.png",
    downloadSizeMB: 210,
    installedSizeMB: 290,
    safety: { title: "Safe", desc: "Open source core, sandbox, ad & tracker blocking", level: "ok" },
    age: "3+",
    brand: "#fb542b",
    popular: true,
  },
  {
    id: "com.usebottles.bottles",
    name: "Bottles",
    summary: "Run Windows software",
    description:
      "Bottles lets you run Windows software on Linux, such as applications and games. It introduces a workflow that helps you organize by categorizing each software to your liking. Bottles provides several tools and integrations to help you manage and optimize your applications.",
    developer: "The Bottles Contributors",
    verified: true,
    free: true,
    license: "GPL-3.0-only",
    version: "64.1",
    categories: ["play", "create", "work"],
    icon: "assets/flathub/com.usebottles.bottles.png",
    downloadSizeMB: 95,
    installedSizeMB: 140,
    safety: { title: "Safe", desc: "Auditable, sandbox, needs filesystem access for bottles", level: "ok" },
    age: "3+",
    brand: "#9281ff",
    featured: true,
    popular: true,
  },
  {
    id: "org.videolan.VLC",
    name: "VLC",
    summary: "VLC media player, the open-source multimedia player",
    description:
      "VLC is a free and open source cross-platform multimedia player and framework that plays most multimedia files as well as DVDs, Audio CDs, VCDs, and various streaming protocols.",
    developer: "VideoLAN et al.",
    verified: false,
    free: true,
    license: "GPL-2.0+",
    version: "3.0.23",
    categories: ["play", "create"],
    icon: "assets/flathub/org.videolan.VLC.png",
    downloadSizeMB: 118,
    installedSizeMB: 165,
    safety: { title: "Safe", desc: "Auditable, sandbox, media device access", level: "ok" },
    age: "3+",
    brand: "#ff8800",
    popular: true,
    editors: true,
  },
  {
    id: "com.spotify.Client",
    name: "Spotify",
    summary: "Online music streaming service",
    description:
      "Access all of your favorite music, discover new songs, and share music online with your friends — all in one place. Create shared playlists or share individual songs with just a click of a button.",
    developer: "Spotify",
    verified: false,
    free: false,
    license: "Proprietary",
    version: "1.2.92",
    categories: ["play", "socialize"],
    icon: "assets/flathub/com.spotify.Client.png",
    downloadSizeMB: 155,
    installedSizeMB: 220,
    safety: { title: "Potentially Unsafe", desc: "Proprietary, network access, audio playback", level: "warn" },
    age: "3+",
    brand: "#1db954",
    popular: true,
  },
  {
    id: "com.valvesoftware.Steam",
    name: "Steam",
    summary: "Launcher for the Steam software distribution service",
    description:
      "Note: This is a community package of the Steam gaming platform not officially supported by Valve. Steam is a software distribution service with an online store, automated installation, automatic updates, achievements, Steam Cloud synchronized savegames and screenshot functionality.",
    developer: "Valve Corporation",
    verified: false,
    free: false,
    license: "Proprietary",
    version: "1.0.0.85",
    categories: ["play"],
    icon: "assets/flathub/com.valvesoftware.Steam.png",
    downloadSizeMB: 12,
    installedSizeMB: 18,
    safety: { title: "Potentially Unsafe", desc: "Proprietary, broad system and network access", level: "warn" },
    age: "13+",
    brand: "#1b2838",
    popular: true,
  },
  {
    id: "com.heroicgameslauncher.hgl",
    name: "Heroic",
    summary: "Play Epic, GOG and Amazon Games",
    description:
      "Heroic is an Open Source Games Launcher. Right now it supports launching games from the Epic Games Store using Legendary, GOG Games using a custom implementation with gogdl, and Amazon Games using Nile.",
    developer: "Heroic Games Launcher",
    verified: true,
    free: true,
    license: "GPL-3.0",
    version: "2.22.0",
    categories: ["play"],
    icon: "assets/flathub/com.heroicgameslauncher.hgl.png",
    downloadSizeMB: 185,
    installedSizeMB: 240,
    safety: { title: "Safe", desc: "Auditable, sandbox, needs filesystem for games", level: "ok" },
    age: "13+",
    brand: "#0e0e10",
    popular: true,
  },
  {
    id: "com.github.tchx84.Flatseal",
    name: "Flatseal",
    summary: "Manage Flatpak permissions",
    description:
      "Flatseal is a graphical utility to review and modify permissions from your Flatpak applications.",
    developer: "Martin Abente Lahaye",
    verified: true,
    free: true,
    license: "GPL-3.0-or-later",
    version: "2.4.1",
    categories: ["work", "develop"],
    icon: "assets/flathub/com.github.tchx84.Flatseal.png",
    downloadSizeMB: 8,
    installedSizeMB: 14,
    safety: { title: "Safe", desc: "Auditable, manages sandbox permissions only", level: "ok" },
    age: "3+",
    brand: "#62a0ea",
    editors: true,
  },
  {
    id: "com.obsproject.Studio",
    name: "OBS Studio",
    summary: "Live stream and record videos",
    description:
      "Free and open source software for video capturing, recording, and live streaming. High performance real-time video/audio capturing and mixing. Create scenes made up of multiple sources including window captures, images, text, browser windows, webcams, capture cards and more.",
    developer: "OBS Project",
    verified: true,
    free: true,
    license: "GPL-2.0-or-later",
    version: "32.2.1",
    categories: ["create", "play"],
    icon: "assets/flathub/com.obsproject.Studio.png",
    downloadSizeMB: 310,
    installedSizeMB: 480,
    safety: { title: "Safe", desc: "Auditable, needs camera, mic and desktop capture", level: "ok" },
    age: "3+",
    brand: "#302e31",
    featured: true,
    popular: true,
    editors: true,
  },
  {
    id: "org.telegram.desktop",
    name: "Telegram",
    summary: "New era of messaging",
    description:
      "Pure instant messaging — simple, fast, secure, and synced across all your devices. One of the world's top 10 most downloaded apps with over 500 million active users.",
    developer: "Telegram FZ-LLC",
    verified: true,
    free: true,
    license: "GPL-3.0",
    version: "7.0.6",
    categories: ["socialize", "network"],
    icon: "assets/flathub/org.telegram.desktop.png",
    downloadSizeMB: 95,
    installedSizeMB: 140,
    safety: { title: "Safe", desc: "Auditable client, network access, notifications", level: "ok" },
    age: "13+",
    brand: "#2aabee",
    popular: true,
  },
  {
    id: "org.gimp.GIMP",
    name: "GNU Image Manipulation Program",
    summary: "High-end image creation and manipulation",
    description:
      "GIMP is an acronym for GNU Image Manipulation Program. It is community-driven Free Software for high-end image creation and manipulation. It can be used as a paint program, an expert quality photo retouching program, an image format converter, and more.",
    developer: "The GIMP team",
    verified: true,
    free: true,
    license: "GPL-3.0+ AND LGPL-3.0+",
    version: "3.2.4",
    categories: ["create"],
    icon: "assets/flathub/org.gimp.GIMP.png",
    downloadSizeMB: 185,
    installedSizeMB: 320,
    safety: { title: "Safe", desc: "Auditable, sandbox, filesystem access for images", level: "ok" },
    age: "3+",
    brand: "#5c554b",
    featured: true,
    editors: true,
  },
  {
    id: "com.vscodium.codium",
    name: "VSCodium",
    summary: "Telemetry-less code editing",
    description:
      "VSCodium combines the simplicity of a code editor with what developers need for the core edit-build-debug cycle. This is the telemetry-less version of Visual Studio Code, packaged into a Flatpak. This repackaging is not supported by Microsoft.",
    developer: "The VSCodium team",
    verified: true,
    free: true,
    license: "MIT",
    version: "1.121.03429",
    categories: ["develop", "work"],
    icon: "assets/flathub/com.vscodium.codium.png",
    downloadSizeMB: 190,
    installedSizeMB: 330,
    safety: { title: "Safe", desc: "Auditable, no telemetry, sandbox", level: "ok" },
    age: "3+",
    brand: "#144d92",
    popular: true,
    editors: true,
  },
  {
    id: "md.obsidian.Obsidian",
    name: "Obsidian",
    summary: "Markdown-based knowledge base",
    description:
      "Obsidian is a powerful knowledge base that works on top of a local folder of plain text Markdown files. Making and following connections is frictionless, and you can explore all of your knowledge in the interactive graph view.",
    developer: "Obsidian",
    verified: true,
    free: false,
    license: "Proprietary",
    version: "1.12.7",
    categories: ["work", "learn"],
    icon: "assets/flathub/md.obsidian.Obsidian.png",
    downloadSizeMB: 145,
    installedSizeMB: 210,
    safety: { title: "Potentially Unsafe", desc: "Proprietary, local vault filesystem access", level: "warn" },
    age: "3+",
    brand: "#7c3aed",
    popular: true,
  },
  {
    id: "org.blender.Blender",
    name: "Blender",
    summary: "Free and open source 3D creation suite",
    description:
      "Blender is the free and open source 3D creation suite. It supports the entirety of the 3D pipeline — modeling, rigging, animation, simulation, rendering, compositing, motion tracking, and video editing.",
    developer: "Blender Foundation",
    verified: false,
    free: true,
    license: "GPL-3.0",
    version: "5.2",
    categories: ["create"],
    icon: "assets/flathub/org.blender.Blender.png",
    downloadSizeMB: 420,
    installedSizeMB: 980,
    safety: { title: "Safe", desc: "Auditable, sandbox, GPU and filesystem access", level: "ok" },
    age: "3+",
    brand: "#e87d0d",
    featured: true,
    editors: true,
  },
  {
    id: "org.inkscape.Inkscape",
    name: "Inkscape",
    summary: "Vector Graphics Editor",
    description:
      "A free and open source vector graphics editor. It offers a rich set of features and is widely used for both artistic and technical illustrations such as cartoons, clip art, logos, typography, diagramming and flowcharting.",
    developer: "The Inkscape Community",
    verified: true,
    free: true,
    license: "GPL-2.0-or-later",
    version: "1.4.4",
    categories: ["create"],
    icon: "assets/flathub/org.inkscape.Inkscape.png",
    downloadSizeMB: 165,
    installedSizeMB: 280,
    safety: { title: "Safe", desc: "Auditable, sandbox, filesystem access", level: "ok" },
    age: "3+",
    brand: "#000000",
    editors: true,
  },
  {
    id: "org.kde.krita",
    name: "Krita",
    summary: "Digital Painting, Creative Freedom",
    description:
      "Krita is the full-featured digital art studio. It is perfect for sketching and painting, and presents an end-to-end solution for creating digital painting files from scratch.",
    developer: "Krita Foundation",
    verified: true,
    free: true,
    license: "GPL-3.0-only",
    version: "5.3.2",
    categories: ["create"],
    icon: "assets/flathub/org.kde.krita.png",
    downloadSizeMB: 220,
    installedSizeMB: 390,
    safety: { title: "Safe", desc: "Auditable, sandbox, tablet and filesystem access", level: "ok" },
    age: "3+",
    brand: "#3daee9",
    editors: true,
  },
  {
    id: "org.signal.Signal",
    name: "Signal Desktop",
    summary: "Private messenger",
    description:
      "To use the Signal desktop app, Signal must first be installed on your phone. Millions of people use Signal every day for free and instantaneous communication anywhere in the world. Send and receive high-fidelity messages, participate in HD voice/video calls, and explore a growing set of new features that help you stay connected.",
    developer: "Signal Foundation",
    verified: false,
    free: true,
    license: "AGPL-3.0-only",
    version: "8.20.0",
    categories: ["socialize", "network"],
    icon: "assets/flathub/org.signal.Signal.png",
    downloadSizeMB: 175,
    installedSizeMB: 250,
    safety: { title: "Safe", desc: "Auditable, e2e encryption, network access", level: "ok" },
    age: "13+",
    brand: "#3a76f0",
  },
  {
    id: "com.slack.Slack",
    name: "Slack",
    summary: "Business communication",
    description:
      "Slack brings team communication and collaboration into one place so you can get more work done, whether you belong to a large enterprise or a small business.",
    developer: "Slack Technologies Inc.",
    verified: false,
    free: false,
    license: "Proprietary",
    version: "4.51.180",
    categories: ["work", "socialize"],
    icon: "assets/flathub/com.slack.Slack.png",
    downloadSizeMB: 160,
    installedSizeMB: 240,
    safety: { title: "Potentially Unsafe", desc: "Proprietary, network access, broad permissions", level: "warn" },
    age: "3+",
    brand: "#4a154b",
  },
  {
    id: "org.libreoffice.LibreOffice",
    name: "LibreOffice",
    summary: "The LibreOffice productivity suite",
    description:
      "LibreOffice is a powerful office suite. Its clean interface and feature-rich tools help you unleash your creativity and enhance your productivity. LibreOffice includes Writer, Calc, Impress, Draw, Base, and Math.",
    developer: "The Document Foundation",
    verified: true,
    free: true,
    license: "MPL-2.0",
    version: "26.2.4.2",
    categories: ["work", "learn"],
    icon: "assets/flathub/org.libreoffice.LibreOffice.png",
    downloadSizeMB: 340,
    installedSizeMB: 620,
    safety: { title: "Safe", desc: "Auditable, sandbox, document filesystem access", level: "ok" },
    age: "3+",
    brand: "#18a303",
    featured: true,
    editors: true,
  },
  {
    id: "org.qbittorrent.qBittorrent",
    name: "qBittorrent",
    summary: "An open-source Bittorrent client",
    description:
      "The qBittorrent project aims to provide an open-source software alternative to µTorrent. qBittorrent runs and provides the same features on all major platforms.",
    developer: "The qBittorrent Project",
    verified: true,
    free: true,
    license: "GPL-3.0-or-later",
    version: "5.2.3",
    categories: ["network", "work"],
    icon: "assets/flathub/org.qbittorrent.qBittorrent.png",
    downloadSizeMB: 55,
    installedSizeMB: 90,
    safety: { title: "Safe", desc: "Auditable, network access, download folder access", level: "ok" },
    age: "3+",
    brand: "#3d8ad5",
  },
  {
    id: "org.localsend.localsend_app",
    name: "LocalSend",
    summary: "Share files to nearby devices",
    description:
      "This app allows you to send files and messages over the local LAN network. In contrast to most alternatives, no external servers are needed. Everything happens locally in the wifi network.",
    developer: "Tien Do Nam",
    verified: true,
    free: true,
    license: "Apache-2.0",
    version: "1.17.0",
    categories: ["work", "network"],
    icon: "assets/flathub/org.localsend.localsend_app.png",
    downloadSizeMB: 28,
    installedSizeMB: 45,
    safety: { title: "Safe", desc: "Auditable, local network only by default", level: "ok" },
    age: "3+",
    brand: "#009688",
    editors: true,
  },
  {
    id: "com.mattjakeman.ExtensionManager",
    name: "Extension Manager",
    summary: "Install GNOME Extensions",
    description:
      "Browse and install GNOME Shell extensions to customise your desktop. Browse extensions.gnome.org right inside the app and manage the extensions you already have installed.",
    developer: "Matthew Jakeman",
    verified: true,
    free: true,
    license: "GPL-3.0-or-later",
    version: "0.6.5",
    categories: ["work", "develop"],
    icon: "assets/flathub/com.mattjakeman.ExtensionManager.png",
    downloadSizeMB: 12,
    installedSizeMB: 22,
    safety: { title: "Safe", desc: "Auditable, manages GNOME extensions only", level: "ok" },
    age: "3+",
    brand: "#3584e4",
    editors: true,
  },
  {
    id: "io.missioncenter.MissionCenter",
    name: "Mission Center",
    summary: "Monitor system resource usage",
    description:
      "Monitor your CPU, Memory, Disk, Network and GPU usage, accompanied by a per-app and process breakdown of these statistics.",
    developer: "Mission Center Developers",
    verified: true,
    free: true,
    license: "GPL-3.0-or-later",
    version: "1.2.0",
    categories: ["work", "develop"],
    icon: "assets/flathub/io.missioncenter.MissionCenter.png",
    downloadSizeMB: 18,
    installedSizeMB: 32,
    safety: { title: "Safe", desc: "Auditable, needs system monitor permissions", level: "ok" },
    age: "3+",
    brand: "#62a0ea",
    editors: true,
  },
  {
    id: "org.kde.kdenlive",
    name: "Kdenlive",
    summary: "Video editor",
    description:
      "Kdenlive is a video editing application with support for many audio and video formats. It offers advanced editing features, a variety of effects and transitions, color correction, audio post-production and subtitling tools.",
    developer: "KDE",
    verified: true,
    free: true,
    license: "GPL-3.0-only",
    version: "26.04.3",
    categories: ["create"],
    icon: "assets/flathub/org.kde.kdenlive.png",
    downloadSizeMB: 280,
    installedSizeMB: 520,
    safety: { title: "Safe", desc: "Auditable, sandbox, media filesystem access", level: "ok" },
    age: "3+",
    brand: "#4d4b8a",
  },
  {
    id: "org.onlyoffice.desktopeditors",
    name: "ONLYOFFICE Desktop Editors",
    summary: "Office productivity suite",
    description:
      "ONLYOFFICE Desktop Editors is a free and open-source office suite that comprises editors for text documents, spreadsheets, presentations, PDFs and PDF forms, along with a Diagram Viewer.",
    developer: "ONLYOFFICE",
    verified: true,
    free: true,
    license: "AGPL-3.0-only",
    version: "9.4.0",
    categories: ["work", "learn"],
    icon: "assets/flathub/org.onlyoffice.desktopeditors.png",
    downloadSizeMB: 390,
    installedSizeMB: 720,
    safety: { title: "Safe", desc: "Auditable, sandbox, document filesystem access", level: "ok" },
    age: "3+",
    brand: "#ff6f3d",
  },
  {
    id: "org.gnome.Builder",
    name: "Builder",
    summary: "Create applications for GNOME",
    description:
      "Builder is an actively developed Integrated Development Environment for GNOME. It combines integrated support for essential GNOME technologies such as GTK, GLib, and GNOME APIs with features that any developer will appreciate.",
    developer: "Christian Hergert",
    verified: true,
    free: true,
    license: "GPL-3.0+",
    version: "50.0",
    categories: ["develop"],
    icon: "assets/flathub/org.gnome.Builder.png",
    downloadSizeMB: 95,
    installedSizeMB: 180,
    safety: { title: "Safe", desc: "Auditable, SDK access for building apps", level: "ok" },
    age: "3+",
    brand: "#33d17a",
    editors: true,
  },
  {
    id: "io.github.flattool.Warehouse",
    name: "Warehouse",
    summary: "Manage Flatpak applications and data",
    description:
      "Warehouse is a toolkit to manage Flatpak applications, leftover data, and remotes from a friendly GTK interface.",
    developer: "Heliguy",
    verified: false,
    free: true,
    license: "GPL-3.0-or-later",
    version: "2.1.0",
    categories: ["work", "develop"],
    icon: "assets/flathub/io.github.flattool.Warehouse.png",
    downloadSizeMB: 10,
    installedSizeMB: 18,
    safety: { title: "Safe", desc: "Auditable, manages Flatpak data", level: "ok" },
    age: "3+",
    brand: "#c061cb",
  },
  {
    id: "com.github.IsmaelMartinez.teams_for_linux",
    name: "Teams for Linux",
    summary: "Unofficial Microsoft Teams client",
    description:
      "Unofficial Microsoft Teams client for Linux using Electron. Stay connected with your work chats, meetings and files.",
    developer: "Ismael Martinez",
    verified: false,
    free: true,
    license: "GPL-3.0-only",
    version: "2.0.0",
    categories: ["work", "socialize"],
    icon: "assets/flathub/com.github.IsmaelMartinez.teams_for_linux.png",
    downloadSizeMB: 160,
    installedSizeMB: 240,
    safety: { title: "Potentially Unsafe", desc: "Third-party client, network access", level: "warn" },
    age: "3+",
    brand: "#6264a7",
  },
  {
    id: "net.lutris.Lutris",
    name: "Lutris",
    summary: "Video game preservation platform",
    description:
      "Lutris helps you install and play video games from all eras and from most gaming systems. By leveraging and combining existing emulators, engine re-implementations and compatibility layers, it gives you a central interface to launch all your games.",
    developer: "Lutris Team",
    verified: true,
    free: true,
    license: "GPL-3.0-or-later",
    version: "0.5.22",
    categories: ["play"],
    icon: "assets/flathub/net.lutris.Lutris.png",
    downloadSizeMB: 85,
    installedSizeMB: 140,
    safety: { title: "Safe", desc: "Auditable, needs filesystem access for games", level: "ok" },
    age: "13+",
    brand: "#ff9900",
    popular: true,
    editors: true,
  },
  {
    id: "io.github.jliljebl.Flowblade",
    name: "Flowblade",
    summary: "Video Editor - Fast, Precise, Stable",
    description:
      "Flowblade is a multitrack non-linear video editor released under GPL3 license. From beginners to masters, Flowblade helps make your vision a reality of image and sound.",
    developer: "Janne Liljeblad",
    verified: true,
    free: true,
    license: "GPL-3.0+",
    version: "2.24.1",
    categories: ["create"],
    icon: "assets/flathub/io.github.jliljebl.Flowblade.png",
    downloadSizeMB: 120,
    installedSizeMB: 210,
    safety: { title: "Safe", desc: "Auditable, sandbox, media filesystem access", level: "ok" },
    age: "3+",
    brand: "#3584e4",
    editors: true,
  },
  {
    id: "io.github.fabrialberio.pinapp",
    name: "Pins",
    summary: "Create and edit app shortcuts",
    description:
      "Pins allows you to customize your app menu by editing .desktop files. Some of the things you can do are: changing an app icon that doesn't fit in with your theme, creating custom shortcuts to websites, hiding apps you don't want to see, and editing properties in .desktop files.",
    developer: "Fabrizio Alberio",
    verified: true,
    free: true,
    license: "GPL-3.0-or-later",
    version: "2.4.7",
    categories: ["work", "develop"],
    icon: "assets/flathub/io.github.fabrialberio.pinapp.png",
    downloadSizeMB: 8,
    installedSizeMB: 14,
    safety: { title: "Safe", desc: "Auditable, manages desktop entry files", level: "ok" },
    age: "3+",
    brand: "#1a5fb4",
    editors: true,
  },
  {
    id: "com.vysp3r.ProtonPlus",
    name: "ProtonPlus",
    summary: "A modern compatibility tools manager",
    description:
      "ProtonPlus is a simple tool to help you manage your compatibility tools for Steam, Lutris, Heroic Games Launcher and Bottles. Manage supported compatibility tools across supported launchers, change the compatibility tool and launch options of your Steam games, and more.",
    developer: "Vysp3r",
    verified: true,
    free: true,
    license: "GPL-3.0-or-later",
    version: "0.5.22",
    categories: ["play", "work"],
    icon: "assets/flathub/com.vysp3r.ProtonPlus.png",
    downloadSizeMB: 15,
    installedSizeMB: 28,
    safety: { title: "Safe", desc: "Auditable, manages Proton/Wine tool installs", level: "ok" },
    age: "3+",
    brand: "#993d3d",
    popular: true,
    editors: true,
  },
];

const SW_CATEGORIES = [
  { id: "create", name: "Create", icon: "assets/apps/org.gnome.Software.Create.png" },
  { id: "work", name: "Work", icon: "assets/apps/org.gnome.Software.Work.png" },
  { id: "play", name: "Play", icon: "assets/apps/org.gnome.Software.Play.png" },
  { id: "socialize", name: "Socialize", icon: "assets/apps/org.gnome.Software.Socialize.png" },
  { id: "learn", name: "Learn", icon: "assets/apps/org.gnome.Software.Learn.png" },
  { id: "develop", name: "Develop", icon: "assets/apps/org.gnome.Software.Develop.png" },
];

/** System apps already present on the desktop (not Flathub installable here). */
const SW_SYSTEM_INSTALLED = [
  {
    id: "system.files",
    name: "Files",
    summary: "Access and organize files",
    icon: "assets/apps/org.gnome.Nautilus.png",
    source: "System",
    version: "50.0",
  },
  {
    id: "system.settings",
    name: "Settings",
    summary: "System settings",
    icon: "assets/apps/org.gnome.Settings.png",
    source: "System",
    version: "50.0",
  },
  {
    id: "system.software",
    name: "Software",
    summary: "Install and update apps",
    icon: "assets/apps/org.gnome.Software.png",
    source: "System",
    version: "50.0",
  },
];

function loadInstalledFlathubIds() {
  /** Always include apps that already ship on this desktop. */
  const set = new Set(Object.keys(SW_DESKTOP_PREINSTALLED));
  try {
    const raw = localStorage.getItem(SW_STORAGE_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) arr.forEach((id) => set.add(id));
    }
  } catch {
    /* ignore */
  }
  return set;
}

function saveInstalledFlathubIds(set) {
  try {
    // Persist user installs only — desktop preinstalled stay implicit
    const userIds = [...set].filter((id) => !SW_DESKTOP_PREINSTALLED[id]);
    localStorage.setItem(SW_STORAGE_KEY, JSON.stringify(userIds));
  } catch {
    /* ignore quota */
  }
}

/** @type {Set<string>} */
let installedFlathubIds = loadInstalledFlathubIds();

function isDesktopPreinstalled(id) {
  return Boolean(SW_DESKTOP_PREINSTALLED[id]);
}

/**
 * True if this Flathub app is already represented on the shell
 * (dock favorite or an overview tile with the same display name).
 */
function isAlreadyOnDesktop(appId) {
  if (isDesktopPreinstalled(appId)) return true;
  const app = getFlathubApp(appId);
  if (!app) return false;
  const name = app.name.toLowerCase();
  return APPS.some((a) => {
    if (a.id === appId) return true;
    const n = (a.name || "").toLowerCase();
    return n === name || n.startsWith(name + " ");
  });
}

function isFlathubInstalled(id) {
  return installedFlathubIds.has(id);
}

function getFlathubApp(id) {
  return FLATHUB_APPS.find((a) => a.id === id) || null;
}

function formatSizeMB(mb) {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function openSoftware(opts = {}) {
  closeAppMenu();
  closeQuickSettings();
  closeCalendar();
  if (swMenu) swMenu.hidden = true;

  softwareWorkspace = activeWorkspace;
  softwareWindow.dataset.workspace = String(softwareWorkspace);
  placeSoftwareOnWorkspace();
  softwareWindow.hidden = false;
  softwareWindow.classList.remove("is-opening");
  void softwareWindow.offsetWidth;
  softwareWindow.classList.add("is-opening");
  const clearOpening = () => softwareWindow.classList.remove("is-opening");
  softwareWindow.addEventListener("animationend", clearOpening, { once: true });
  window.setTimeout(clearOpening, 200);

  if (opts.appId) {
    softwareOpenDetails(opts.appId);
  } else if (opts.tab) {
    softwareShowMain();
    softwareSetTab(opts.tab);
  } else if (softwareView === "details" && softwareDetailsId) {
    softwareOpenDetails(softwareDetailsId);
  } else if (softwareView === "category" && softwareCategoryId) {
    softwareOpenCategory(softwareCategoryId);
  } else {
    softwareShowMain();
    renderSoftwareBody();
  }

  startSoftwareCarousel();
}

function closeSoftware() {
  softwareWindow.hidden = true;
  softwareWindow.classList.remove("is-opening");
  stopSoftwareCarousel();
  if (swMenu) swMenu.hidden = true;
  setSoftwareSearchOpen(false);
}

function toggleSoftware() {
  if (softwareWindow.hidden) openSoftware();
  else closeSoftware();
}

function softwareShowMain() {
  softwareView = "main";
  if (swShell) swShell.hidden = false;
  if (swDetails) swDetails.hidden = true;
  if (swCategory) swCategory.hidden = true;
  softwareDetailsId = null;
  softwareCategoryId = null;
  renderSoftwareBody();
}

function setSoftwareSearchOpen(open) {
  softwareSearchOpen = open;
  if (swSearchBar) swSearchBar.hidden = !open;
  swSearchBtn?.classList.toggle("active", open);
  swSearchBtn?.setAttribute("aria-pressed", open ? "true" : "false");
  if (open) {
    softwareTab = "search";
    updateSoftwareSwitcher();
    swSearchInput?.focus();
    renderSoftwareBody();
  } else {
    softwareSearchQuery = "";
    if (swSearchInput) swSearchInput.value = "";
    if (softwareTab === "search") {
      softwareTab = "explore";
      updateSoftwareSwitcher();
    }
    renderSoftwareBody();
  }
}

function softwareSetTab(tab) {
  softwareTab = tab;
  if (tab !== "search") setSoftwareSearchOpen(false);
  updateSoftwareSwitcher();
  softwareShowMain();
}

function updateSoftwareSwitcher() {
  document.querySelectorAll(".sw-switcher-btn").forEach((btn) => {
    const on = btn.dataset.swTab === softwareTab;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  });
}

function renderSoftwareBody() {
  if (!swBody) return;
  if (softwareTab === "explore") swBody.innerHTML = renderExplorePage();
  else if (softwareTab === "installed") swBody.innerHTML = renderInstalledPage();
  else if (softwareTab === "updates") swBody.innerHTML = renderUpdatesPage();
  else if (softwareTab === "search") swBody.innerHTML = renderSearchPage();
  bindSoftwareBodyHandlers();
  if (softwareTab === "explore") {
    softwareCarouselIndex = 0;
    updateCarouselSlide();
  }
}

function renderExplorePage() {
  const featured = FLATHUB_APPS.filter((a) => a.featured);
  const editors = FLATHUB_APPS.filter((a) => a.editors);
  const popular = FLATHUB_APPS.filter((a) => a.popular);

  const slides = featured
    .map(
      (app, i) => `
      <div class="sw-carousel-slide${i === 0 ? " active" : ""}" data-sw-app="${escapeHtml(app.id)}" style="background: linear-gradient(135deg, ${app.brand}cc 0%, ${app.brand}66 40%, #1a1a1a 100%);">
        <img class="sw-carousel-icon" src="${app.icon}" alt="" draggable="false" />
        <div class="sw-carousel-meta">
          <div class="sw-carousel-name">${escapeHtml(app.name)}</div>
          <div class="sw-carousel-summary">${escapeHtml(app.summary)}</div>
          <div class="sw-carousel-source">
            <img class="sym" src="assets/software/package-generic-symbolic.svg" alt="" draggable="false" />
            <span>Flathub</span>
          </div>
        </div>
      </div>`
    )
    .join("");

  const dots = featured
    .map(
      (_, i) =>
        `<button type="button" class="sw-carousel-dot${i === 0 ? " active" : ""}" data-carousel-dot="${i}" aria-label="Featured slide ${i + 1}"></button>`
    )
    .join("");

  const cats = SW_CATEGORIES.map(
    (c) => `
    <button type="button" class="sw-category-tile" data-sw-category="${c.id}">
      <img src="${c.icon}" alt="" draggable="false" />
      <span class="sw-category-tile-name">${escapeHtml(c.name)}</span>
    </button>`
  ).join("");

  return `
    <div class="sw-clamp">
      <div class="sw-flathub-banner">
        <img class="sym" src="assets/software/package-generic-symbolic.svg" alt="" draggable="false" />
        <span><strong>Flathub</strong> — apps from the largest Linux app store, sandboxed with Flatpak</span>
      </div>
      <div class="sw-carousel" id="sw-carousel" role="region" aria-label="Featured apps">
        ${slides}
        <div class="sw-carousel-dots">${dots}</div>
      </div>
      <div class="sw-categories">${cats}</div>
      <h2 class="sw-heading">Editor’s Choice</h2>
      <div class="sw-tile-grid">${editors.map(appTileHtml).join("")}</div>
      <h2 class="sw-heading">Popular on Flathub</h2>
      <div class="sw-tile-grid">${popular.map(appTileHtml).join("")}</div>
      <h2 class="sw-heading">New &amp; Updated</h2>
      <div class="sw-tile-grid">${FLATHUB_APPS.slice(0, 9).map(appTileHtml).join("")}</div>
    </div>`;
}

function appTileHtml(app) {
  const installed = isFlathubInstalled(app.id);
  return `
    <button type="button" class="sw-app-tile" data-sw-app="${escapeHtml(app.id)}">
      <img class="sw-app-tile-icon" src="${app.icon}" alt="" draggable="false" />
      <span class="sw-app-tile-meta">
        <span class="sw-app-tile-name">${escapeHtml(app.name)}</span>
        <span class="sw-app-tile-summary">${escapeHtml(app.summary)}</span>
      </span>
      ${
        installed
          ? `<span class="sw-app-tile-badge" title="Installed"><img class="sym" src="assets/software/app-installed-symbolic.svg" alt="" draggable="false" /></span>`
          : ""
      }
    </button>`;
}

function renderInstalledPage() {
  const flathubInstalled = FLATHUB_APPS.filter((a) => isFlathubInstalled(a.id));
  const rows = [
    ...SW_SYSTEM_INSTALLED.map(
      (a) => `
      <div class="sw-app-row" data-sw-system="${escapeHtml(a.id)}">
        <img class="sw-app-row-icon" src="${a.icon}" alt="" draggable="false" />
        <span class="sw-app-row-meta">
          <span class="sw-app-row-name">${escapeHtml(a.name)}</span>
          <span class="sw-app-row-sub">${escapeHtml(a.source)} · ${escapeHtml(a.version)}</span>
        </span>
      </div>`
    ),
    ...flathubInstalled.map(
      (a) => `
      <button type="button" class="sw-app-row" data-sw-app="${escapeHtml(a.id)}">
        <img class="sw-app-row-icon" src="${a.icon}" alt="" draggable="false" />
        <span class="sw-app-row-meta">
          <span class="sw-app-row-name">${escapeHtml(a.name)}</span>
          <span class="sw-app-row-sub">Flathub · ${escapeHtml(a.version)}</span>
        </span>
        <span class="sw-app-row-action">
          <span class="sw-btn sw-btn-suggested" data-sw-open="${escapeHtml(a.id)}" style="pointer-events:none;height:28px;font-size:12px;">Open</span>
        </span>
      </button>`
    ),
  ];

  if (!flathubInstalled.length) {
    return `
      <div class="sw-clamp">
        <h2 class="sw-heading">Installed</h2>
        <div class="sw-list">${rows.join("")}</div>
        <div class="sw-status" style="min-height:160px;padding:32px 24px;">
          <div class="sw-status-title">No Flathub apps installed yet</div>
          <div class="sw-status-desc">Browse Explore to install popular apps from Flathub. Installed Flatpaks will show up here.</div>
        </div>
      </div>`;
  }

  return `
    <div class="sw-clamp">
      <h2 class="sw-heading">Installed</h2>
      <div class="sw-list">${rows.join("")}</div>
    </div>`;
}

function renderUpdatesPage() {
  return `
    <div class="sw-clamp">
      <div class="sw-status">
        <img class="sw-status-icon" src="assets/software/software-updates-symbolic.svg" alt="" draggable="false" style="filter:var(--win-sym-filter);" />
        <div class="sw-status-title">Apps are up to date</div>
        <div class="sw-status-desc">When updates are available for system packages or Flatpaks from Flathub, they will appear here.</div>
      </div>
    </div>`;
}

function renderSearchPage() {
  const q = softwareSearchQuery.trim().toLowerCase();
  if (!q) {
    return `
      <div class="sw-clamp">
        <div class="sw-status">
          <div class="sw-status-title">Search Flathub</div>
          <div class="sw-status-desc">Try “firefox”, “gimp”, “spotify”, or “code”.</div>
        </div>
      </div>`;
  }
  const hits = FLATHUB_APPS.filter((a) => {
    const hay = [a.name, a.summary, a.developer, a.id, ...(a.categories || [])]
      .join(" ")
      .toLowerCase();
    return q.split(/\s+/).every((w) => hay.includes(w));
  });
  if (!hits.length) {
    return `
      <div class="sw-clamp">
        <div class="sw-status">
          <div class="sw-status-title">No Results Found</div>
          <div class="sw-status-desc">No apps matching “${escapeHtml(softwareSearchQuery)}”.</div>
        </div>
      </div>`;
  }
  return `
    <div class="sw-clamp">
      <h2 class="sw-heading">Results</h2>
      <div class="sw-tile-grid">${hits.map(appTileHtml).join("")}</div>
    </div>`;
}

function bindSoftwareBodyHandlers() {
  swBody?.querySelectorAll("[data-sw-app]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      softwareOpenDetails(el.dataset.swApp);
    });
  });
  swBody?.querySelectorAll("[data-sw-category]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      softwareOpenCategory(el.dataset.swCategory);
    });
  });
  swBody?.querySelectorAll("[data-carousel-dot]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      softwareCarouselIndex = Number(el.dataset.carouselDot) || 0;
      updateCarouselSlide();
      startSoftwareCarousel();
    });
  });
}

function startSoftwareCarousel() {
  stopSoftwareCarousel();
  softwareCarouselTimer = window.setInterval(() => {
    if (softwareWindow.hidden || softwareView !== "main" || softwareTab !== "explore") return;
    const featured = FLATHUB_APPS.filter((a) => a.featured);
    if (featured.length < 2) return;
    softwareCarouselIndex = (softwareCarouselIndex + 1) % featured.length;
    updateCarouselSlide();
  }, 5000);
}

function stopSoftwareCarousel() {
  if (softwareCarouselTimer) {
    clearInterval(softwareCarouselTimer);
    softwareCarouselTimer = 0;
  }
}

function updateCarouselSlide() {
  const carousel = document.getElementById("sw-carousel");
  if (!carousel) return;
  carousel.querySelectorAll(".sw-carousel-slide").forEach((s, i) => {
    s.classList.toggle("active", i === softwareCarouselIndex);
  });
  carousel.querySelectorAll(".sw-carousel-dot").forEach((d, i) => {
    d.classList.toggle("active", i === softwareCarouselIndex);
  });
}

function softwareOpenCategory(catId) {
  if (overviewOpen || overviewAnimating) return;
  const cat = SW_CATEGORIES.find((c) => c.id === catId);
  if (!cat) return;
  softwareView = "category";
  softwareCategoryId = catId;
  if (swShell) swShell.hidden = true;
  if (swDetails) swDetails.hidden = true;
  if (swCategory) swCategory.hidden = false;
  if (swCategoryTitle) swCategoryTitle.textContent = cat.name;
  const apps = FLATHUB_APPS.filter((a) => (a.categories || []).includes(catId));
  swCategoryBody.innerHTML = `
    <div class="sw-clamp">
      <div class="sw-flathub-banner">
        <img class="sym" src="assets/software/package-generic-symbolic.svg" alt="" draggable="false" />
        <span>Apps in <strong>${escapeHtml(cat.name)}</strong> from Flathub</span>
      </div>
      <div class="sw-tile-grid">${apps.map(appTileHtml).join("")}</div>
    </div>`;
  swCategoryBody.querySelectorAll("[data-sw-app]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      softwareOpenDetails(el.dataset.swApp);
    });
  });
}

function softwareOpenDetails(appId) {
  // Overview workspace cards are non-interactive (Shell parity)
  if (overviewOpen || overviewAnimating) return;
  const app = getFlathubApp(appId);
  if (!app) return;
  softwareView = "details";
  softwareDetailsId = appId;
  if (swShell) swShell.hidden = true;
  if (swCategory) swCategory.hidden = true;
  if (swDetails) swDetails.hidden = false;
  renderSoftwareDetails(app);
}

function installState(appId) {
  if (softwareInstallJobs.has(appId)) {
    const job = softwareInstallJobs.get(appId);
    return { kind: "installing", ...job };
  }
  if (isFlathubInstalled(appId)) return { kind: "installed" };
  return { kind: "available" };
}

function renderSoftwareDetails(app) {
  const state = installState(app.id);
  const actions = renderDetailsActions(app, state);
  const safetyGreen = app.safety.level === "ok";
  const licenseTitle = app.free ? "Open Source" : "Proprietary";
  const licenseSub = app.free
    ? `${app.license} — source code can be audited and shared`
    : `${app.license} — source code is not publicly available`;

  swDetailsBody.innerHTML = `
    <div class="sw-details-clamp">
      <div class="sw-details-hero">
        <img class="sw-details-icon" src="${app.icon}" alt="" draggable="false" />
        <div class="sw-details-hero-main">
          <div class="sw-details-name">${escapeHtml(app.name)}</div>
          <div class="sw-details-developer">${escapeHtml(app.developer)}</div>
          ${
            app.verified
              ? `<div class="sw-details-verified"><img class="sym" src="assets/software/app-verified-symbolic.svg" alt="" draggable="false" /><span>Verified</span></div>`
              : ""
          }
        </div>
        <div class="sw-details-actions" id="sw-details-actions">
          ${actions}
        </div>
      </div>

      <div class="sw-screenshots" aria-label="Screenshots">
        <div class="sw-shot" style="--sw-brand:${app.brand}">${escapeHtml(app.name)} — main window</div>
        <div class="sw-shot" style="--sw-brand:${app.brand};opacity:0.92">Preferences</div>
        <div class="sw-shot" style="--sw-brand:${app.brand};opacity:0.85">About</div>
      </div>

      <div class="sw-details-summary">${escapeHtml(app.summary)}</div>
      <div class="sw-details-desc">${escapeHtml(app.description)}</div>

      <div class="sw-context-bar">
        <div class="sw-context-tile">
          <div class="sw-lozenge">${formatSizeMB(app.downloadSizeMB)}</div>
          <div class="sw-context-title">Download Size</div>
          <div class="sw-context-desc">Needs ${formatSizeMB(app.downloadSizeMB)} download · ${formatSizeMB(app.installedSizeMB)} installed</div>
        </div>
        <div class="sw-context-tile">
          <div class="sw-lozenge circular ${safetyGreen ? "green" : ""}">
            <img class="sym" src="assets/software/app-safety-ok-symbolic.svg" alt="" draggable="false" />
          </div>
          <div class="sw-context-title">${escapeHtml(app.safety.title)}</div>
          <div class="sw-context-desc">${escapeHtml(app.safety.desc)}</div>
        </div>
        <div class="sw-context-tile">
          <div class="sw-lozenge circular green">
            <img class="sym" src="assets/software/app-safety-ok-symbolic.svg" alt="" draggable="false" />
          </div>
          <div class="sw-context-title">Desktop</div>
          <div class="sw-context-desc">Works on desktops and large tablets</div>
        </div>
        <div class="sw-context-tile">
          <div class="sw-lozenge circular">${escapeHtml(app.age)}</div>
          <div class="sw-context-title">Age Rating</div>
          <div class="sw-context-desc">${app.age === "3+" ? "No age-inappropriate content" : "May not be suitable for children"}</div>
        </div>
      </div>

      <div class="sw-info-list">
        <div class="sw-info-row">
          <span class="sw-info-label">Version</span>
          <span class="sw-info-value">${escapeHtml(app.version)}</span>
        </div>
        <div class="sw-info-row">
          <span class="sw-info-label">Source</span>
          <span class="sw-info-value">Flathub (flatpak)</span>
        </div>
        <div class="sw-info-row">
          <span class="sw-info-label">Runtime</span>
          <span class="sw-info-value">org.freedesktop.Platform</span>
        </div>
        <div class="sw-info-row">
          <span class="sw-info-label">App ID</span>
          <span class="sw-info-value">${escapeHtml(app.id)}</span>
        </div>
      </div>

      <div class="sw-license-card">
        <div class="sw-lozenge ${app.free ? "green" : ""}">${app.free ? "FOSS" : "⊗"}</div>
        <div class="sw-license-text">
          <div class="sw-license-title">${licenseTitle}</div>
          <div class="sw-license-sub">${escapeHtml(licenseSub)}</div>
        </div>
      </div>
    </div>
    <div class="sw-toast" id="sw-toast" role="status"></div>`;

  bindDetailsActions(app);
}

function renderDetailsActions(app, state) {
  if (state.kind === "installing") {
    const phase = state.phase === "installing" ? "Installing" : "Downloading";
    const pct = Math.min(100, Math.round(state.progress || 0));
    return `
      <button type="button" class="sw-btn sw-btn-progress" id="sw-install-btn" data-action="cancel" style="--sw-progress:${pct}%" aria-label="Cancel installation">
        <span class="sw-progress-label">Cancel</span>
        <span class="sw-progress-sub"><span>${phase}</span><span>${pct}%</span></span>
      </button>
      <div class="sw-origin">
        <img class="sym" src="assets/software/package-generic-symbolic.svg" alt="" draggable="false" />
        <span>Flathub</span>
      </div>`;
  }
  if (state.kind === "installed") {
    const canRemove = !isDesktopPreinstalled(app.id);
    return `
      <div style="display:flex;gap:9px;align-items:center;">
        <button type="button" class="sw-btn sw-btn-suggested" id="sw-install-btn" data-action="open">Open</button>
        ${
          canRemove
            ? `<button type="button" class="sw-btn sw-btn-icon" id="sw-remove-btn" data-action="remove" title="Uninstall" aria-label="Uninstall">
          <img class="sym" src="assets/software/user-trash-symbolic.svg" alt="" draggable="false" />
        </button>`
            : ""
        }
      </div>
      <div class="sw-origin">
        <img class="sym" src="assets/software/package-generic-symbolic.svg" alt="" draggable="false" />
        <span>${isDesktopPreinstalled(app.id) ? "System" : "Flathub"}</span>
      </div>`;
  }
  return `
    <button type="button" class="sw-btn sw-btn-suggested" id="sw-install-btn" data-action="install">Install</button>
    <div class="sw-origin">
      <img class="sym" src="assets/software/package-generic-symbolic.svg" alt="" draggable="false" />
      <span>Flathub</span>
    </div>`;
}

function bindDetailsActions(app) {
  const installBtn = document.getElementById("sw-install-btn");
  const removeBtn = document.getElementById("sw-remove-btn");
  installBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    const action = installBtn.dataset.action;
    if (action === "install") startSoftwareInstall(app.id);
    else if (action === "cancel") cancelSoftwareInstall(app.id);
    else if (action === "open") {
      showSoftwareToast(`${app.name} would open here`);
    }
  });
  removeBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    uninstallSoftwareApp(app.id);
  });
}

/**
 * Simulate the GNOME Software + Flatpak install pipeline:
 *   available → downloading (progress on Cancel button) → installing → installed (Open)
 * Timing is shortened for the preview but stages match the real UI.
 */
function startSoftwareInstall(appId) {
  if (softwareInstallJobs.has(appId) || isFlathubInstalled(appId)) return;
  const app = getFlathubApp(appId);
  if (!app) return;

  const job = {
    progress: 0,
    phase: "downloading",
    timer: 0,
  };
  softwareInstallJobs.set(appId, job);
  refreshDetailsIfCurrent(appId);

  // Scale duration slightly with size (3.2s–7s download + install)
  const downloadMs = 2800 + Math.min(app.downloadSizeMB, 400) * 8;
  const installMs = 900;
  const tickMs = 80;
  const downloadSteps = downloadMs / tickMs;
  let step = 0;

  job.timer = window.setInterval(() => {
    step += 1;
    if (job.phase === "downloading") {
      job.progress = Math.min(92, (step / downloadSteps) * 92);
      if (step >= downloadSteps) {
        job.phase = "installing";
        job.progress = 94;
        step = 0;
      }
    } else if (job.phase === "installing") {
      job.progress = 94 + Math.min(6, (step / (installMs / tickMs)) * 6);
      if (step * tickMs >= installMs) {
        clearInterval(job.timer);
        softwareInstallJobs.delete(appId);
        finishSoftwareInstall(appId);
        return;
      }
    }
    updateInstallProgressUI(appId);
  }, tickMs);
}

function updateInstallProgressUI(appId) {
  if (softwareDetailsId !== appId) return;
  const job = softwareInstallJobs.get(appId);
  const app = getFlathubApp(appId);
  if (!job || !app) return;
  const actions = document.getElementById("sw-details-actions");
  if (!actions) return;
  actions.innerHTML = renderDetailsActions(app, { kind: "installing", ...job });
  bindDetailsActions(app);
}

function cancelSoftwareInstall(appId) {
  const job = softwareInstallJobs.get(appId);
  if (job) {
    clearInterval(job.timer);
    softwareInstallJobs.delete(appId);
  }
  refreshDetailsIfCurrent(appId);
  showSoftwareToast("Installation cancelled");
}

function finishSoftwareInstall(appId) {
  installedFlathubIds.add(appId);
  saveInstalledFlathubIds(installedFlathubIds);
  addInstalledAppToOverview(appId);
  refreshDetailsIfCurrent(appId);
  const app = getFlathubApp(appId);
  showSoftwareToast(`${app?.name || "App"} installed`);
}

function uninstallSoftwareApp(appId) {
  if (isDesktopPreinstalled(appId)) {
    const app = getFlathubApp(appId);
    showSoftwareToast(
      `${app?.name || "App"} is already part of this desktop`
    );
    return;
  }
  installedFlathubIds.delete(appId);
  saveInstalledFlathubIds(installedFlathubIds);
  removeInstalledAppFromOverview(appId);
  refreshDetailsIfCurrent(appId);
  const app = getFlathubApp(appId);
  showSoftwareToast(`${app?.name || "App"} removed`);
}

function refreshDetailsIfCurrent(appId) {
  if (softwareDetailsId === appId) {
    const app = getFlathubApp(appId);
    if (app) renderSoftwareDetails(app);
  }
}

function showSoftwareToast(message) {
  const toast = document.getElementById("sw-toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 2400);
}

/** After install, surface the app in the Shell overview grid (newcomer-friendly). */
function addInstalledAppToOverview(appId) {
  const app = getFlathubApp(appId);
  if (!app) return;
  // Dock / system apps already live on the desktop — don't create a second tile
  if (isAlreadyOnDesktop(appId)) return;
  if (APPS.some((a) => a.id === appId)) return;
  // Same display name already in the grid (e.g. LibreOffice suite)
  const name = app.name.toLowerCase();
  if (
    APPS.some((a) => {
      const n = (a.name || "").toLowerCase();
      return n === name || n.startsWith(name + " ");
    })
  ) {
    return;
  }
  APPS.push({ id: appId, name: app.name, icon: app.icon, fromFlathub: true });
  if (typeof renderApps === "function") renderApps(appSearch?.value || "");
}

function removeInstalledAppFromOverview(appId) {
  const idx = APPS.findIndex((a) => a.id === appId && a.fromFlathub);
  if (idx >= 0) {
    APPS.splice(idx, 1);
    if (typeof renderApps === "function") renderApps(appSearch?.value || "");
  }
}

/** Drop overview clones for apps that already belong on the desktop (dock/system). */
function purgeDuplicateOverviewApps() {
  let changed = false;
  for (let i = APPS.length - 1; i >= 0; i--) {
    const entry = APPS[i];
    if (entry.fromFlathub && isDesktopPreinstalled(entry.id)) {
      APPS.splice(i, 1);
      changed = true;
    }
  }
  if (changed && typeof renderApps === "function") {
    renderApps(appSearch?.value || "");
  }
}

// Restore user-installed Flathub apps into overview on load
// (skips dock/system apps so Steam/Brave never double up)
purgeDuplicateOverviewApps();
installedFlathubIds.forEach((id) => addInstalledAppToOverview(id));

// Software chrome handlers
swCloseBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  closeSoftware();
});
swDetailsClose?.addEventListener("click", (e) => {
  e.stopPropagation();
  closeSoftware();
});
swCategoryClose?.addEventListener("click", (e) => {
  e.stopPropagation();
  closeSoftware();
});
swDetailsBack?.addEventListener("click", (e) => {
  e.stopPropagation();
  if (softwareCategoryId) softwareOpenCategory(softwareCategoryId);
  else softwareShowMain();
});
swCategoryBack?.addEventListener("click", (e) => {
  e.stopPropagation();
  softwareShowMain();
});
swSearchBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  setSoftwareSearchOpen(!softwareSearchOpen);
});
swSearchInput?.addEventListener("input", () => {
  softwareSearchQuery = swSearchInput.value;
  if (softwareTab !== "search") {
    softwareTab = "search";
    updateSoftwareSwitcher();
  }
  renderSoftwareBody();
});
swSearchInput?.addEventListener("click", (e) => e.stopPropagation());

document.querySelectorAll(".sw-switcher-btn").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    softwareSetTab(btn.dataset.swTab);
  });
});

swMenuBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  if (!swMenu) return;
  swMenu.hidden = !swMenu.hidden;
});

swMenu?.addEventListener("click", (e) => {
  e.stopPropagation();
  const item = e.target.closest(".sw-menu-item");
  if (!item) return;
  swMenu.hidden = true;
  if (item.dataset.swAction === "repos") {
    showSoftwareToast("Software Repositories — Flathub is enabled");
  } else if (item.dataset.swAction === "about") {
    showSoftwareToast("Software · Flathub preview");
  }
});

softwareWindow?.addEventListener("click", (e) => {
  // In overview, window is inert — let the workspace card handle the click
  if (overviewOpen || overviewAnimating) return;
  e.stopPropagation();
  if (swMenu && !swMenu.hidden && !e.target.closest("#sw-menu-btn") && !e.target.closest("#sw-menu")) {
    swMenu.hidden = true;
  }
});

/* ---------- Start overlay / fullscreen ---------- */

const startOverlay = document.getElementById("start-overlay");
const startFullscreenBtn = document.getElementById("start-fullscreen-btn");
const startSkipBtn = document.getElementById("start-skip-btn");

function dismissStartOverlay() {
  if (startOverlay) startOverlay.hidden = true;
}

async function enterFullscreenPreview() {
  const target = document.documentElement;
  try {
    if (target.requestFullscreen) await target.requestFullscreen();
    else if (target.webkitRequestFullscreen) await target.webkitRequestFullscreen();
    else if (target.msRequestFullscreen) await target.msRequestFullscreen();
  } catch {
    /* Browser denied or unsupported — still enter the mockup */
  }
  dismissStartOverlay();
}

if (startFullscreenBtn) {
  startFullscreenBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    enterFullscreenPreview();
  });
}

if (startSkipBtn) {
  startSkipBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    dismissStartOverlay();
  });
}

if (startOverlay) {
  startOverlay.addEventListener("click", (e) => e.stopPropagation());
  startOverlay.querySelector(".start-overlay-card")?.addEventListener("click", (e) => e.stopPropagation());
}

/* Boot workspace layer (must run after DOM + nautilus node exist) */
initWorkspaces();
