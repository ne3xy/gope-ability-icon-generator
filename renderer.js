const form = document.querySelector('#generator-form');
const nameInput = document.querySelector('#icon-name');
const colorInput = document.querySelector('#color');
const hexInput = document.querySelector('#hex');
const button = document.querySelector('#generate-button');
const message = document.querySelector('#message');
const wowheadButton = document.querySelector('#wowhead-button');
const iconPreview = document.querySelector('#icon-preview');
const folderButton = document.querySelector('#folder-button');
const folderInput = document.querySelector('#output-folder');
let outputDirectory = null;
const iconList = document.querySelector('#icon-list');
const browserEmpty = document.querySelector('#browser-empty');
const refreshIcons = document.querySelector('#refresh-icons');
const openFolder = document.querySelector('#open-folder');

function updateColorPreview() {
  colorInput.style.backgroundColor = colorInput.value;
}

updateColorPreview();

async function loadIconList() {
  const icons = outputDirectory ? await window.iconGenerator.listIcons(outputDirectory) : [];
  iconList.replaceChildren();
  browserEmpty.hidden = icons.length > 0;
  for (const icon of icons) {
    const row = document.createElement('div');
    row.className = 'icon-row';
    row.dataset.filename = icon.filename;
    row.innerHTML = `<div class="icon-files"><img src="${icon.iconUrl}" alt="Current ${icon.filename}">${icon.backupUrl ? `<img class="backup-file" src="${icon.backupUrl}" alt="Backup ${icon.filename}">` : ''}</div><code>${icon.filename}</code><span class="icon-actions"></span>`;
    const actions = row.querySelector('.icon-actions');
    if (icon.hasBackup) {
      const restore = document.createElement('button');
      restore.className = 'secondary';
      restore.textContent = 'Restore backup';
      restore.addEventListener('click', async () => {
        if (!window.confirm(`Restore the backup for ${icon.filename}?`)) return;
        const images = row.querySelectorAll('.icon-files img');
        if (icon.backupUrl && images[0]) images[0].src = icon.backupUrl;
        if (images[1]) images[1].remove();
        const defaultIcon = document.createElement('img');
        defaultIcon.className = 'backup-file';
        defaultIcon.alt = `Default ${icon.filename}`;
        defaultIcon.src = `https://wow.zamimg.com/images/wow/icons/large/${icon.filename.replace(/\.tga$/i, '')}.jpg`;
        row.querySelector('.icon-files').appendChild(defaultIcon);
        restore.remove();
        message.className = 'message working';
        message.textContent = `Restoring ${icon.filename}...`;
        const result = await window.iconGenerator.restoreIcon({ outputDirectory, filename: icon.filename });
        message.className = result.ok ? 'message success' : 'message error';
        message.textContent = result.ok ? `Restored ${icon.filename}` : result.message;
        refreshIconList();
      });
      actions.appendChild(restore);
    }
    const remove = document.createElement('button');
    remove.className = 'danger';
    remove.textContent = 'Delete';
    remove.addEventListener('click', async () => {
      if (!window.confirm(`Delete ${icon.filename}?`)) return;
      row.remove();
      message.className = 'message working';
      message.textContent = `Deleting ${icon.filename}...`;
      const result = await window.iconGenerator.deleteIcon({ outputDirectory, filename: icon.filename });
      message.className = result.ok ? 'message success' : 'message error';
      message.textContent = result.ok ? `Deleted ${icon.filename}` : result.message;
      refreshIconList();
    });
    actions.appendChild(remove);
    iconList.appendChild(row);
  }
}

let refreshPromise = null;
function refreshIconList() {
  if (!refreshPromise) refreshPromise = loadIconList().finally(() => { refreshPromise = null; });
  return refreshPromise;
}

function addPendingIcon(filename, color, referenceIconUrl) {
  const existingRow = iconList.querySelector(`[data-filename="${CSS.escape(filename)}"]`);
  const existingBackupUrl = existingRow?.querySelector('.backup-file')?.src;
  existingRow?.remove();
  const row = document.createElement('div');
  row.className = 'icon-row';
  row.dataset.filename = filename;
  const preview = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="${color}"/></svg>`)}`;
  const referenceUrl = existingBackupUrl || referenceIconUrl;
  const referenceImage = referenceUrl ? `<img class="backup-file" src="${referenceUrl}" alt="Default ${filename}">` : '';
  row.innerHTML = `<div class="icon-files"><img src="${preview}" alt="Current ${filename}">${referenceImage}</div><code>${filename}</code><span class="icon-actions"></span>`;
  const remove = document.createElement('button');
  remove.className = 'danger';
  remove.textContent = 'Delete';
  remove.addEventListener('click', async () => {
    if (!window.confirm(`Delete ${filename}?`)) return;
    row.remove();
    const result = await window.iconGenerator.deleteIcon({ outputDirectory, filename });
    message.className = result.ok ? 'message success' : 'message error';
    message.textContent = result.ok ? `Deleted ${filename}` : result.message;
    refreshIconList();
  });
  row.querySelector('.icon-actions').appendChild(remove);
  const rows = [...iconList.children, row].sort((first, second) =>
    first.dataset.filename.localeCompare(second.dataset.filename));
  for (const sortedRow of rows) iconList.appendChild(sortedRow);
  browserEmpty.hidden = true;
}

refreshIcons.addEventListener('click', refreshIconList);

openFolder.addEventListener('click', async () => {
  const error = await window.iconGenerator.openOutputFolder(outputDirectory);
  if (error) {
    message.className = 'message error';
    message.textContent = error;
  }
});

window.iconGenerator.getOutputFolder().then((savedFolder) => {
  if (savedFolder) {
    outputDirectory = savedFolder;
    folderInput.value = savedFolder;
    button.disabled = false;
    openFolder.disabled = false;
    refreshIconList();
  }
});

folderButton.addEventListener('click', async () => {
  const selectedFolder = await window.iconGenerator.chooseOutputFolder();
  if (!selectedFolder) return;
  outputDirectory = selectedFolder;
  folderInput.value = selectedFolder;
  button.disabled = false;
  openFolder.disabled = false;
  refreshIconList();
  message.className = 'message success';
  message.textContent = `Output folder: ${selectedFolder}`;
});

wowheadButton.addEventListener('click', () => {
  window.iconGenerator.openWowhead();
  message.className = 'message working';
  message.textContent = 'Choose the spell icon on Wowhead...';
});

window.iconGenerator.onWowheadIconSelected((icon) => {
  nameInput.value = icon.filename;
  if (icon.averageColor) {
    colorInput.value = icon.averageColor.toLowerCase();
    hexInput.value = icon.averageColor;
    updateColorPreview();
  }
  if (icon.dataUrl) {
    iconPreview.src = icon.dataUrl;
    iconPreview.hidden = false;
  }
  message.className = 'message success';
  message.textContent = `Selected ${icon.filename}.tga from Wowhead`;
});

colorInput.addEventListener('input', () => {
  hexInput.value = colorInput.value.toUpperCase();
  updateColorPreview();
});

hexInput.addEventListener('input', () => {
  const value = hexInput.value.trim();
  if (/^#?[0-9a-fA-F]{6}$/.test(value)) {
    colorInput.value = value.startsWith('#') ? value : `#${value}`;
    updateColorPreview();
  }
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;

  button.disabled = true;
  message.className = 'message working';
  message.textContent = 'Forging icon...';
  const result = await window.iconGenerator.generate({
    name: nameInput.value.trim(),
    color: hexInput.value.trim(),
    outputDirectory
  });

  button.disabled = false;
  if (result.ok) {
    message.className = 'message success';
    message.textContent = `Created ${nameInput.value.trim()}.tga`;
    addPendingIcon(`${nameInput.value.trim()}.tga`, colorInput.value, iconPreview.src);
    refreshIconList();
  } else {
    message.className = 'message error';
    message.textContent = result.message;
  }
});