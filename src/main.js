const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, screen, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { getWindowBounds, listWindows } = require('./windowLocator');

const FRAME_WIDTH = 874;
const FRAME_HEIGHT = 700;
const DEFAULT_SCALE = 0.36;
const MIN_SIZE_FACTOR = 0.5;
const MAX_SIZE_FACTOR = 1;
const PERCH_LINE_RATIO = 0.58;
const PERCH_SNAP_DISTANCE = 52;
const PERCH_POLL_MS = 350;
const SUPPORT_URL = 'https://motionpotion.lemonsqueezy.com/checkout/buy/418d40cb-a4de-43b0-ad6c-f73adf805357';

let buddyWindow;
let tray;
let clickThrough = false;
let locked = false;
let perchMode = false;
let perchTarget = null;
let perchTimer = null;
let sizeFactor = MAX_SIZE_FACTOR;
let dragStartBounds = null;
let saveTimer = null;
let quitting = false;

const statePath = () => path.join(app.getPath('userData'), 'buddy-state.json');

function readState() {
  try {
    return JSON.parse(fs.readFileSync(statePath(), 'utf8'));
  } catch {
    return {};
  }
}

function writeState(patch) {
  const current = readState();
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(statePath(), JSON.stringify({ ...current, ...patch }, null, 2));
}

function queueBoundsSave() {
  if (!buddyWindow) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!buddyWindow || buddyWindow.isDestroyed()) return;
    writeState({ bounds: buddyWindow.getBounds(), clickThrough, locked, perchMode, perchTarget, sizeFactor });
  }, 150);
}

function clampSizeFactor(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return MAX_SIZE_FACTOR;
  return Math.min(MAX_SIZE_FACTOR, Math.max(MIN_SIZE_FACTOR, numeric));
}

function getBuddySize() {
  return {
    width: Math.round(FRAME_WIDTH * DEFAULT_SCALE),
    height: Math.round(FRAME_HEIGHT * DEFAULT_SCALE)
  };
}

function getDefaultBounds() {
  const display = screen.getPrimaryDisplay();
  const { width, height } = getBuddySize();
  return {
    width,
    height,
    x: display.workArea.x + display.workArea.width - width - 28,
    y: display.workArea.y + display.workArea.height - height + 8
  };
}

function normalizeBounds(bounds) {
  const fallback = getDefaultBounds();
  if (!bounds || typeof bounds !== 'object') return fallback;

  const expected = getBuddySize();
  const width = expected.width;
  const height = expected.height;
  const nearest = screen.getDisplayMatching({
    x: Math.round(bounds.x || fallback.x),
    y: Math.round(bounds.y || fallback.y),
    width,
    height
  });
  const area = nearest.bounds;
  const x = Math.min(Math.max(Math.round(bounds.x || fallback.x), area.x - width + 24), area.x + area.width - 24);
  const y = Math.min(Math.max(Math.round(bounds.y || fallback.y), area.y - height + 24), area.y + area.height - 24);

  return { x, y, width, height };
}

function applyWindowLevel() {
  if (!buddyWindow) return;
  buddyWindow.setAlwaysOnTop(true, process.platform === 'darwin' ? 'screen-saver' : 'pop-up-menu');
  buddyWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
}

function setClickThrough(value) {
  clickThrough = value;
  if (!buddyWindow) return;
  buddyWindow.setIgnoreMouseEvents(clickThrough, { forward: true });
  buddyWindow.webContents.send('buddy:state-changed', { clickThrough, locked, perchMode, sizeFactor });
  writeState({ clickThrough });
  buildMenu();
}

function setLocked(value) {
  locked = value;
  if (buddyWindow) buddyWindow.webContents.send('buddy:state-changed', { clickThrough, locked, perchMode, sizeFactor });
  writeState({ locked });
  buildMenu();
}

function setPerchMode(value) {
  perchMode = value;
  if (!perchMode) {
    stopPerchFollow();
    perchTarget = null;
  } else if (perchTarget) {
    startPerchFollow();
  }
  if (buddyWindow) buddyWindow.webContents.send('buddy:state-changed', { clickThrough, locked, perchMode, sizeFactor });
  writeState({ perchMode, perchTarget });
  buildMenu();
}

function setSizeFactor(value) {
  const next = clampSizeFactor(value);
  if (!buddyWindow || next === sizeFactor) return;

  sizeFactor = next;
  buddyWindow.webContents.send('buddy:state-changed', { clickThrough, locked, perchMode, sizeFactor });
  writeState({ sizeFactor });
  updatePerchPosition();
  buildMenu();
}

function parkOnTaskbarEdge() {
  if (!buddyWindow) return;
  const current = buddyWindow.getBounds();
  const display = screen.getDisplayMatching(current);
  const area = display.workArea;
  buddyWindow.setBounds({
    x: area.x + area.width - current.width - 28,
    y: area.y + area.height - current.height + 8,
    width: current.width,
    height: current.height
  });
  queueBoundsSave();
}

function centerOnTopEdge() {
  if (!buddyWindow) return;
  const current = buddyWindow.getBounds();
  const display = screen.getDisplayMatching(current);
  const area = display.workArea;
  buddyWindow.setBounds({
    x: area.x + Math.round((area.width - current.width) / 2),
    y: area.y - Math.round(current.height * 0.24),
    width: current.width,
    height: current.height
  });
  queueBoundsSave();
}

function setStartAtLogin(value) {
  app.setLoginItemSettings({
    openAtLogin: value,
    path: process.execPath
  });
  buildMenu();
}

function getMenuPlacement(point) {
  if (!buddyWindow) return { x: 8, y: 8 };
  const padding = 8;
  const bounds = buddyWindow.getBounds();
  const display = screen.getDisplayNearestPoint({
    x: Math.round(point.screenX || bounds.x),
    y: Math.round(point.screenY || bounds.y)
  });
  const area = display.workArea;
  const menuWidth = Math.max(1, Math.round(point.width || 180));
  const menuHeight = Math.max(1, Math.round(point.height || 180));
  const visibleLeft = Math.max(bounds.x, area.x);
  const visibleTop = Math.max(bounds.y, area.y);
  const visibleRight = Math.min(bounds.x + bounds.width, area.x + area.width);
  const visibleBottom = Math.min(bounds.y + bounds.height, area.y + area.height);

  const minScreenX = visibleLeft + padding;
  const minScreenY = visibleTop + padding;
  const maxScreenX = Math.max(minScreenX, visibleRight - menuWidth - padding);
  const maxScreenY = Math.max(minScreenY, visibleBottom - menuHeight - padding);
  const desiredX = Math.round(point.screenX || bounds.x);
  const desiredY = Math.round(point.screenY || bounds.y);
  const screenX = Math.min(Math.max(desiredX, minScreenX), maxScreenX);
  const screenY = Math.min(Math.max(desiredY, minScreenY), maxScreenY);

  return {
    x: screenX - bounds.x,
    y: screenY - bounds.y
  };
}

function perchLineOffset(bounds = buddyWindow?.getBounds()) {
  if (!bounds) return 0;
  return Math.round(bounds.height - bounds.height * (1 - PERCH_LINE_RATIO) * sizeFactor);
}

function targetCenterX(targetBounds, centerRatio) {
  const left = targetBounds.x;
  const right = targetBounds.x + targetBounds.width;
  return Math.round(left + targetBounds.width * centerRatio);
}

function centerRatioForBounds(targetBounds, centerX) {
  if (!targetBounds.width) return 0.5;
  return Math.min(0.96, Math.max(0.04, (centerX - targetBounds.x) / targetBounds.width));
}

function setPerchedBounds(targetBounds, centerRatio) {
  if (!buddyWindow) return;
  const current = buddyWindow.getBounds();
  const centerX = targetCenterX(targetBounds, centerRatio);
  buddyWindow.setBounds({
    ...current,
    x: Math.round(centerX - current.width / 2),
    y: Math.round(targetBounds.y - perchLineOffset(current))
  });
}

function getTaskbarEdges(bounds) {
  const edges = [];
  for (const display of screen.getAllDisplays()) {
    const full = display.bounds;
    const work = display.workArea;
    if (work.y + work.height < full.y + full.height) {
      edges.push({
        type: 'taskbar',
        displayId: display.id,
        x: work.x,
        y: work.y + work.height,
        width: work.width,
        height: Math.max(1, full.y + full.height - (work.y + work.height))
      });
    }
    if (work.y > full.y) {
      edges.push({
        type: 'taskbar',
        displayId: display.id,
        x: work.x,
        y: work.y,
        width: work.width,
        height: Math.max(1, work.y - full.y)
      });
    }
  }
  return edges.filter(edge => rangesOverlap(bounds.x, bounds.x + bounds.width, edge.x, edge.x + edge.width));
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return Math.max(aStart, bStart) <= Math.min(aEnd, bEnd);
}

function candidateScore(bounds, edge) {
  const lineY = bounds.y + perchLineOffset(bounds);
  const vertical = Math.abs(lineY - edge.y);
  const centerX = bounds.x + bounds.width / 2;
  const horizontal = centerX < edge.x ? edge.x - centerX : centerX > edge.x + edge.width ? centerX - (edge.x + edge.width) : 0;
  return vertical + horizontal * 0.35;
}

async function findPerchTarget(bounds) {
  const candidates = getTaskbarEdges(bounds).map(edge => ({ edge, score: candidateScore(bounds, edge) }));

  const windows = await listWindows(process.pid);
  for (const win of windows) {
    const edge = { type: 'window', hwnd: win.hwnd, title: win.title, x: win.x, y: win.y, width: win.width, height: win.height };
    candidates.push({ edge, score: candidateScore(bounds, edge) });
  }

  candidates.sort((a, b) => a.score - b.score);
  const best = candidates[0];
  if (!best || best.score > PERCH_SNAP_DISTANCE) return null;

  const centerX = bounds.x + bounds.width / 2;
  return {
    type: best.edge.type,
    hwnd: best.edge.hwnd,
    displayId: best.edge.displayId,
    centerRatio: centerRatioForBounds(best.edge, centerX),
    bounds: {
      x: best.edge.x,
      y: best.edge.y,
      width: best.edge.width,
      height: best.edge.height
    }
  };
}

async function attachToNearestPerchTarget() {
  if (!buddyWindow || !perchMode) return;
  const bounds = buddyWindow.getBounds();
  const target = await findPerchTarget(bounds);
  if (!target) {
    perchTarget = null;
    stopPerchFollow();
    queueBoundsSave();
    return;
  }

  perchTarget = target;
  setPerchedBounds(target.bounds, target.centerRatio);
  startPerchFollow();
  writeState({ bounds: buddyWindow.getBounds(), perchMode, perchTarget });
}

function stopPerchFollow() {
  clearInterval(perchTimer);
  perchTimer = null;
}

function startPerchFollow() {
  stopPerchFollow();
  if (!perchMode || !perchTarget) return;
  perchTimer = setInterval(updatePerchPosition, PERCH_POLL_MS);
}

async function updatePerchPosition() {
  if (!buddyWindow || !perchMode || !perchTarget) return;
  if (perchTarget.type === 'window') {
    const bounds = await getWindowBounds(perchTarget.hwnd);
    if (!bounds) return;
    perchTarget = { ...perchTarget, bounds };
    setPerchedBounds(bounds, perchTarget.centerRatio);
    return;
  }

  if (perchTarget.type === 'taskbar') {
    const current = buddyWindow.getBounds();
    const taskbar = getTaskbarEdges(current).find(edge => edge.displayId === perchTarget.displayId) || getTaskbarEdges(current)[0];
    if (!taskbar) return;
    perchTarget = { ...perchTarget, bounds: taskbar };
    setPerchedBounds(taskbar, perchTarget.centerRatio);
  }
}

function buildMenu() {
  const login = app.getLoginItemSettings().openAtLogin;
  const scaleChoices = [1, 0.9, 0.8, 0.7, 0.6, 0.5].map(value => ({
    label: `${Math.round(value * 100)}%`,
    type: 'radio',
    checked: Math.round(sizeFactor * 100) === Math.round(value * 100),
    click: () => setSizeFactor(value)
  }));
  const template = [
    { label: 'Park on taskbar edge', click: parkOnTaskbarEdge },
    { label: 'Park on top screen edge', click: centerOnTopEdge },
    { label: 'Size', submenu: scaleChoices },
    { type: 'separator' },
    { label: 'Perch mode', type: 'checkbox', checked: perchMode, click: item => setPerchMode(item.checked) },
    { label: 'Click-through', type: 'checkbox', checked: clickThrough, click: item => setClickThrough(item.checked) },
    { label: 'Lock position', type: 'checkbox', checked: locked, click: item => setLocked(item.checked) },
    { label: 'Start at login', type: 'checkbox', checked: login, click: item => setStartAtLogin(item.checked) },
    { label: '☕ Support development', click: () => shell.openExternal(SUPPORT_URL) },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
  if (tray) tray.setContextMenu(menu);
}

function createTray() {
  const sheet = nativeImage.createFromPath(path.join(__dirname, '..', 'rocky-sleep-breathing-64f.png'));
  const icon = sheet.crop({ x: 0, y: 0, width: FRAME_WIDTH, height: FRAME_HEIGHT }).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('Rocky Desktop Buddy');
  buildMenu();
}

function createWindow() {
  const state = readState();
  clickThrough = Boolean(state.clickThrough);
  locked = Boolean(state.locked);
  perchMode = Boolean(state.perchMode);
  perchTarget = state.perchTarget || null;
  sizeFactor = clampSizeFactor(state.sizeFactor);

  buddyWindow = new BrowserWindow({
    ...normalizeBounds(state.bounds),
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    show: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    fullscreenable: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  buddyWindow.loadFile(path.join(__dirname, 'index.html'));
  buddyWindow.once('ready-to-show', () => {
    applyWindowLevel();
    setClickThrough(clickThrough);
    buddyWindow.showInactive();
    if (perchMode && perchTarget) startPerchFollow();
  });

  buddyWindow.on('moved', queueBoundsSave);
  buddyWindow.on('closed', () => {
    buddyWindow = null;
  });
}

ipcMain.handle('buddy:get-state', () => ({ locked, clickThrough, perchMode, sizeFactor }));
ipcMain.handle('buddy:get-menu-placement', (_event, point) => getMenuPlacement(point || {}));

ipcMain.on('buddy:drag-start', () => {
  if (!buddyWindow || locked || clickThrough) return;
  stopPerchFollow();
  perchTarget = null;
  dragStartBounds = buddyWindow.getBounds();
});

ipcMain.on('buddy:drag-move', (_event, delta) => {
  if (!buddyWindow || locked || clickThrough || !dragStartBounds) return;
  buddyWindow.setBounds({
    ...dragStartBounds,
    x: dragStartBounds.x + Math.round(delta.x),
    y: dragStartBounds.y + Math.round(delta.y)
  });
});

ipcMain.on('buddy:drag-end', () => {
  dragStartBounds = null;
  if (perchMode) {
    attachToNearestPerchTarget();
  } else {
    queueBoundsSave();
  }
});

ipcMain.on('buddy:show-menu', () => {
  if (!tray) return;
  tray.popUpContextMenu();
});

ipcMain.on('buddy:set-size-factor', (_event, value) => {
  setSizeFactor(value);
});

ipcMain.on('buddy:set-perch-mode', (_event, value) => {
  setPerchMode(Boolean(value));
});

ipcMain.on('buddy:open-support', () => {
  shell.openExternal(SUPPORT_URL);
});

ipcMain.on('buddy:park-taskbar-edge', parkOnTaskbarEdge);
ipcMain.on('buddy:park-top-edge', centerOnTopEdge);

app.setName('Rocky Desktop Buddy');

app.whenReady().then(() => {
  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  quitting = true;
});

app.on('window-all-closed', () => {
  if (quitting) app.exit(0);
});
