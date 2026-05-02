# Rocky Desktop Buddy

Persistent sleeping alien desktop buddy for Windows and macOS.

## What it does

- Renders `rocky-sleep-breathing-64f.png` as a transparent 64-frame sleeping animation.
- Runs as a transparent, frameless desktop overlay.
- Stays above normal windows, taskbars, and docks.
- Drags with left mouse button.
- Remembers position between launches.
- Right-click or tray menu gives quick actions:
  - Park on taskbar edge
  - Park on top screen edge
  - Toggle Perch mode
  - Scale from 50% to 100%
  - Toggle click-through
  - Lock position
  - Start at login
  - Quit

## Install

This app uses Electron.

```powershell
npm install
```

## Run

```powershell
npm start
```

## Build

```powershell
npm run dist
```

Build output appears in `dist/`.

## Installable Windows Build

```powershell
npm run dist:win
```

The installer is written to `dist/Rocky Desktop Buddy Setup 0.1.1.exe`. A portable unpacked app is also written to `dist/win-unpacked/Rocky Desktop Buddy.exe`.

## Regenerate Animation

```powershell
C:\Users\kjspa\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe scripts\make_64f_breathing_sheet.py
```

## Notes

The first version intentionally has one behavior: alien sleeping. The transparent sprite sheet is one row with 64 frames. Current asset size is `55936x700`, so each frame is `874x700`.

The generator uses the layer files in `body parts/`. `body background.png` stays stationary, `midsection.png` inflates for breathing, and `arm.l.png` / `arm.r.png` stay unscaled with tiny positional motion.

## Perch Mode

Turn on `Perch mode`, then drag Rocky near the top edge of a window or the top edge of the taskbar. Rocky snaps so the edge line sits between the arms and midsection. On Windows, window perch follows the same target window as it moves or resizes until Rocky is dragged to a new target or perch mode is turned off. If window tracking is unavailable, perch mode safely falls back to normal dragging and taskbar snapping.
