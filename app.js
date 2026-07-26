/**
 * GNOME desktop preview — interactive shell
 * Layouts: Dash to Dock (bottom floating), Left panel (side panel, no floating dock)
 */

const APPS = [
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

function placeNautilusOnWorkspace() {
  const nau = document.getElementById("nautilus-window");
  if (!nau) return;
  const host = document.getElementById(`workspace-windows-${nautilusWorkspace}`);
  if (host && nau.parentElement !== host) {
    host.appendChild(nau);
  }
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
    // Apps intentionally do nothing beyond a brief press feedback
    btn.addEventListener("click", () => {
      btn.classList.add("pressed");
      setTimeout(() => btn.classList.remove("pressed"), 150);
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
    } else if (btn.dataset.toggle === "night") {
      setNightLight(on);
    } else if (btn.dataset.toggle === "power-mode") {
      updatePowerMode(on);
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
}

// Defaults
setDarkStyle(true);
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
  closeAll();
});

// Keyboard
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (!powerMenu.hidden) {
      powerMenu.hidden = true;
      return;
    }
    if (overviewOpen || !appMenu.hidden || !quickSettings.hidden || !calendarPopover.hidden) {
      closeAll();
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

  // Type-to-search when overview closed: open it
  if (
    !overviewOpen &&
    appMenu.hidden &&
    nautilusWindow.hidden &&
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
  e.stopPropagation();
});

// Don't open overview type-to-search while typing in Nautilus
nauSearchInput.addEventListener("click", (e) => e.stopPropagation());

/* Boot workspace layer (must run after DOM + nautilus node exist) */
initWorkspaces();
