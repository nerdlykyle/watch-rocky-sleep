const buddy = document.getElementById('buddy');
const optionsMenu = document.getElementById('options-menu');
const scaleSlider = document.getElementById('scale-slider');
const scaleOutput = document.getElementById('scale-output');
const perchModeInput = document.getElementById('perch-mode');
const supportLinkButton = document.getElementById('support-link');
const parkTaskbarButton = document.getElementById('park-taskbar');
const parkTopButton = document.getElementById('park-top');

let dragging = false;
let startPoint = null;
let menuOpen = false;

function renderState(state) {
  buddy.classList.toggle('is-locked', state.locked);
  perchModeInput.checked = Boolean(state.perchMode);
  if (typeof state.sizeFactor === 'number') {
    const percent = Math.round(state.sizeFactor * 100);
    scaleSlider.value = String(percent);
    scaleOutput.value = `${percent}%`;
    document.documentElement.style.setProperty('--buddy-scale', String(state.sizeFactor));
  }
}

function hideMenu() {
  menuOpen = false;
  optionsMenu.hidden = true;
  optionsMenu.style.visibility = '';
}

async function showMenu(event) {
  menuOpen = true;
  optionsMenu.style.visibility = 'hidden';
  optionsMenu.hidden = false;
  const placement = await window.rockyBuddy.getMenuPlacement({
    screenX: event.screenX,
    screenY: event.screenY,
    width: optionsMenu.offsetWidth,
    height: optionsMenu.offsetHeight
  });
  optionsMenu.style.left = `${placement.x}px`;
  optionsMenu.style.top = `${placement.y}px`;
  optionsMenu.style.visibility = 'visible';
}

window.rockyBuddy.getState().then(renderState);
window.rockyBuddy.onStateChanged(renderState);

buddy.addEventListener('pointerdown', event => {
  if (optionsMenu.contains(event.target)) return;
  if (menuOpen) hideMenu();
  if (event.button !== 0) return;
  dragging = true;
  startPoint = { x: event.screenX, y: event.screenY };
  buddy.setPointerCapture(event.pointerId);
  window.rockyBuddy.dragStart();
});

buddy.addEventListener('pointermove', event => {
  if (!dragging || !startPoint) return;
  window.rockyBuddy.dragMove({
    x: event.screenX - startPoint.x,
    y: event.screenY - startPoint.y
  });
});

function endDrag(event) {
  if (!dragging) return;
  dragging = false;
  startPoint = null;
  if (buddy.hasPointerCapture(event.pointerId)) {
    buddy.releasePointerCapture(event.pointerId);
  }
  window.rockyBuddy.dragEnd();
}

buddy.addEventListener('pointerup', endDrag);
buddy.addEventListener('pointercancel', endDrag);
buddy.addEventListener('contextmenu', event => {
  event.preventDefault();
  showMenu(event);
});

scaleSlider.addEventListener('input', event => {
  const percent = Number(event.target.value);
  scaleOutput.value = `${percent}%`;
  window.rockyBuddy.setSizeFactor(percent / 100);
});

perchModeInput.addEventListener('change', event => {
  window.rockyBuddy.setPerchMode(event.target.checked);
});

supportLinkButton.addEventListener('click', () => {
  window.rockyBuddy.openSupport();
  hideMenu();
});

parkTaskbarButton.addEventListener('click', () => {
  window.rockyBuddy.parkTaskbarEdge();
  hideMenu();
});

parkTopButton.addEventListener('click', () => {
  window.rockyBuddy.parkTopEdge();
  hideMenu();
});

window.addEventListener('keydown', event => {
  if (event.key === 'Escape') hideMenu();
});
