const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rockyBuddy', {
  getState: () => ipcRenderer.invoke('buddy:get-state'),
  getMenuPlacement: point => ipcRenderer.invoke('buddy:get-menu-placement', point),
  onStateChanged: callback => ipcRenderer.on('buddy:state-changed', (_event, state) => callback(state)),
  dragStart: () => ipcRenderer.send('buddy:drag-start'),
  dragMove: delta => ipcRenderer.send('buddy:drag-move', delta),
  dragEnd: () => ipcRenderer.send('buddy:drag-end'),
  showMenu: () => ipcRenderer.send('buddy:show-menu'),
  setSizeFactor: value => ipcRenderer.send('buddy:set-size-factor', value),
  setPerchMode: value => ipcRenderer.send('buddy:set-perch-mode', value),
  openSupport: () => ipcRenderer.send('buddy:open-support'),
  parkTaskbarEdge: () => ipcRenderer.send('buddy:park-taskbar-edge'),
  parkTopEdge: () => ipcRenderer.send('buddy:park-top-edge')
});
