const { ipcRenderer } = require('electron');

window.addEventListener('message', (event) => {
  if (event.data && ['gope-icon-selected', 'gope-icon-page-candidate'].includes(event.data.type)) {
    ipcRenderer.send(event.data.type, event.data.filename);
  }
});