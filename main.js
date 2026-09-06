const { app, BrowserWindow, dialog, ipcMain, session, shell } = require('electron');
const { ElectronBlocker } = require('@ghostery/adblocker-electron');
const fetch = require('cross-fetch');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const path = require('node:path');
const sharp = require('sharp');
const TGA = require('tga');

const generatorPath = app.isPackaged
  ? path.join(process.resourcesPath, 'icon-generator.bat')
  : path.join(__dirname, 'icon-generator.bat');
const settingsPath = path.join(app.getPath('userData'), 'settings.json');
let wowheadWindow;
let wowheadPoll;

function readSavedOutputFolder() {
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    return settings.outputDirectory && fs.existsSync(settings.outputDirectory) ? settings.outputDirectory : null;
  } catch {
    return null;
  }
}

function saveOutputFolder(outputDirectory) {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify({ outputDirectory }, null, 2));
}

async function findExistingIcon(outputDirectory, filename) {
  const lowerFilename = filename.toLowerCase();
  return (await fs.promises.readdir(outputDirectory, { withFileTypes: true }))
    .find((entry) => entry.isFile() && entry.name.toLowerCase() === lowerFilename)?.name || null;
}

function getIconPath(outputDirectory, filename) {
  if (!outputDirectory || !/^[a-zA-Z0-9_-]+\.tga$/i.test(filename)) return null;
  const directory = path.resolve(outputDirectory);
  const iconPath = path.resolve(directory, filename);
  return path.dirname(iconPath).toLowerCase() === directory.toLowerCase() ? iconPath : null;
}

async function findBackup(outputDirectory, filename, backupEntries) {
  const backupsDirectory = path.join(outputDirectory, 'backups');
  if (!backupEntries) {
    try { backupEntries = await fs.promises.readdir(backupsDirectory, { withFileTypes: true }); } catch { return null; }
  }
  const expectedName = `${filename}.backup`.toLowerCase();
  const candidates = (await Promise.all(backupEntries
    .filter((entry) => entry.isFile() && (entry.name.toLowerCase() === expectedName || entry.name.toLowerCase().startsWith(`${filename.toLowerCase()}.`) && entry.name.toLowerCase().endsWith('.backup')))
    .map(async (entry) => ({ name: entry.name, modified: (await fs.promises.stat(path.join(backupsDirectory, entry.name))).mtimeMs }))))
    .sort((first, second) => second.modified - first.modified);
  return candidates[0] ? path.join(backupsDirectory, candidates[0].name) : null;
}

async function tgaPreview(filePath) {
  const image = new TGA(await fs.promises.readFile(filePath));
  const png = await sharp(Buffer.from(image.pixels), {
    raw: { width: image.width, height: image.height, channels: 4 }
  }).png().toBuffer();
  return `data:image/png;base64,${png.toString('base64')}`;
}

async function replacementPreview(filePath) {
  const bytes = await fs.promises.readFile(filePath);
  const color = `#${[bytes[20], bytes[19], bytes[18]].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="${color}"/></svg>`)}`;
}

function confirmWowheadIcon(owner, filename) {
  return dialog.showMessageBox(owner, {
    type: 'question',
    title: 'Select Wowhead icon?',
    message: `Use ${filename} for this spell?`,
    buttons: ['Select icon', 'Keep browsing'],
    defaultId: 0,
    cancelId: 1
  });
}

async function prepareIcon(imageUrl) {
  if (!imageUrl) return null;
  const response = await fetch(imageUrl);
  if (!response.ok) throw new Error(`Icon download returned HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const image = sharp(buffer);
  const stats = await image.stats();
  const average = stats.channels.slice(0, 3).map((channel) => Math.round(channel.mean));
  const preview = await image.png().toBuffer();
  return {
    averageColor: `#${average.map((value) => value.toString(16).padStart(2, '0')).join('').toUpperCase()}`,
    dataUrl: `data:image/png;base64,${preview.toString('base64')}`
  };
}

function installWowheadNavigation(window) {
  window.webContents.executeJavaScript(`
    (() => {
      if (document.getElementById('gope-navigation')) return;
      const bar = document.createElement('div');
      bar.id = 'gope-navigation';
      bar.innerHTML = '<button id="gope-back" title="Go back">&#8592; Back</button><button id="gope-forward" title="Go forward">Forward &#8594;</button>';
      Object.assign(bar.style, {
        position: 'fixed', top: '12px', left: '12px', zIndex: '2147483647',
        display: 'flex', gap: '6px', padding: '6px', background: '#17201f',
        border: '1px solid #53605d', borderRadius: '4px', boxShadow: '0 3px 12px rgba(0,0,0,.35)'
      });
      for (const button of bar.querySelectorAll('button')) {
        Object.assign(button.style, {
          padding: '7px 11px', border: '0', background: '#2b3937', color: '#e9eee9',
          cursor: 'pointer', font: '12px sans-serif'
        });
      }
      bar.querySelector('#gope-back').addEventListener('click', () => history.back());
      bar.querySelector('#gope-forward').addEventListener('click', () => history.forward());
      document.body.appendChild(bar);
    })();
  `).catch(() => {});
}

function createWindow() {
  const window = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 700,
    minHeight: 600,
    backgroundColor: '#10161b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  window.loadFile('index.html');
}

ipcMain.handle('generate-icon', async (event, { name, color, outputDirectory }) => {
  if (!outputDirectory || !fs.existsSync(outputDirectory)) {
    return { ok: false, message: 'Choose an output folder first.' };
  }
  const outputPath = path.resolve(outputDirectory);
  const filename = `${name}.tga`;
  const existingName = await findExistingIcon(outputPath, filename);
  if (existingName) {
    const { response } = await dialog.showMessageBox(BrowserWindow.fromWebContents(event.sender), {
      type: 'warning',
      title: 'Icon already exists',
      message: `${filename} already exists in this folder. Replace it?`,
      detail: 'The existing file will be moved to the backups folder first.',
      buttons: ['Replace icon', 'Cancel'],
      defaultId: 1,
      cancelId: 1
    });
    if (response !== 0) return { ok: false, message: 'Generation cancelled.' };

    const backupsDirectory = path.join(outputPath, 'backups');
    fs.mkdirSync(backupsDirectory, { recursive: true });
    const backupName = `${name}.tga.backup`;
    const backupPath = path.join(backupsDirectory, backupName);
    const safeBackupPath = fs.existsSync(backupPath)
      ? path.join(backupsDirectory, `${name}.tga.${Date.now()}.backup`)
      : backupPath;
    fs.renameSync(path.join(outputPath, existingName), safeBackupPath);
  }
  return new Promise((resolve) => {
  const process = spawn('cmd.exe', ['/d', '/c', generatorPath, name, color], {
    cwd: outputPath,
    windowsHide: true
  });
  let output = '';

  process.stdout.on('data', (data) => { output += data.toString(); });
  process.stderr.on('data', (data) => { output += data.toString(); });
  process.on('error', (error) => resolve({ ok: false, message: error.message }));
  process.on('close', (code) => {
    if (code === 0) {
      resolve({ ok: true, file: path.join(outputPath, filename) });
    } else {
      resolve({ ok: false, message: output.trim() || `Generator exited with code ${code}.` });
    }
  });
  });
});

ipcMain.handle('choose-output-folder', (event) => dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
  title: 'Choose WoW icons folder',
  defaultPath: app.getPath('documents'),
  properties: ['openDirectory', 'createDirectory']
}).then(({ canceled, filePaths }) => {
  if (canceled) return null;
  saveOutputFolder(filePaths[0]);
  return filePaths[0];
}));

ipcMain.handle('list-icons', async (_event, outputDirectory) => {
  if (!outputDirectory) return [];
  const directoryEntries = await fs.promises.readdir(outputDirectory, { withFileTypes: true }).catch(() => []);
  const backupEntries = await fs.promises.readdir(path.join(outputDirectory, 'backups'), { withFileTypes: true }).catch(() => []);
  const files = (await Promise.all(directoryEntries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.tga'))
    .map(async (entry) => {
      const filePath = path.join(outputDirectory, entry.name);
      const hasExpectedSize = (await fs.promises.stat(filePath)).size === 22;
      const backupPath = await findBackup(outputDirectory, entry.name, backupEntries);
      return hasExpectedSize ? { filename: entry.name, filePath, backupPath } : null;
    })))
    .filter(Boolean)
    .sort((first, second) => first.filename.localeCompare(second.filename));
  return Promise.all(files.map(async (icon) => {
    const defaultIconUrl = `https://wow.zamimg.com/images/wow/icons/large/${icon.filename.replace(/\.tga$/i, '')}.jpg`;
    let backupUrl = null;
    if (icon.backupPath) {
      try { backupUrl = await tgaPreview(icon.backupPath); } catch { backupUrl = null; }
    }
    if (!backupUrl) backupUrl = defaultIconUrl;
    return {
      filename: icon.filename,
      iconUrl: await replacementPreview(icon.filePath),
      backupUrl: backupUrl?.dataUrl || backupUrl,
      hasBackup: Boolean(icon.backupPath)
    };
  }));
});

ipcMain.handle('delete-icon', (_event, { outputDirectory, filename }) => {
  const iconPath = getIconPath(outputDirectory, filename);
  if (!iconPath || !fs.existsSync(iconPath) || fs.statSync(iconPath).size !== 22) return { ok: false, message: 'Icon not found.' };
  fs.unlinkSync(iconPath);
  return { ok: true };
});

ipcMain.handle('restore-icon', async (_event, { outputDirectory, filename }) => {
  const iconPath = getIconPath(outputDirectory, filename);
  const backupPath = iconPath && await findBackup(path.resolve(outputDirectory), filename.replace(/\.tga$/i, '.tga'));
  if (!iconPath || !backupPath || !fs.existsSync(iconPath) || (await fs.promises.stat(iconPath)).size !== 22) {
    return { ok: false, message: 'No restorable backup found.' };
  }
  fs.unlinkSync(iconPath);
  fs.renameSync(backupPath, iconPath);
  return { ok: true };
});

ipcMain.handle('get-output-folder', () => readSavedOutputFolder());

ipcMain.handle('open-output-folder', (_event, outputDirectory) => {
  if (!outputDirectory || !fs.existsSync(outputDirectory)) return 'Folder not found.';
  return shell.openPath(path.resolve(outputDirectory));
});

ipcMain.handle('show-file', (_event, file) => {
  const target = path.resolve(__dirname, path.basename(file));
  return dialog.showOpenDialog({ defaultPath: target, properties: ['openFile'] });
});

app.whenReady().then(async () => {
  try {
    const blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch);
    blocker.enableBlockingInSession(session.defaultSession);
    console.log('Ad blocking enabled for the Wowhead browser.');
  } catch (error) {
    console.warn(`Could not enable ad blocking: ${error.message}`);
  }
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('open-wowhead', (event) => {
  if (wowheadWindow && !wowheadWindow.isDestroyed()) {
    wowheadWindow.focus();
    return;
  }

  wowheadWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    parent: BrowserWindow.fromWebContents(event.sender),
    webPreferences: {
      preload: path.join(__dirname, 'wowhead-preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  wowheadWindow.maximize();
  wowheadWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') wowheadWindow.close();
  });
  wowheadWindow.loadURL('https://www.wowhead.com/');
  wowheadWindow.webContents.on('did-finish-load', () => installWowheadNavigation(wowheadWindow));
  const owner = BrowserWindow.fromWebContents(event.sender);
  let lastPage = '';
  let confirmedFilename = '';
  wowheadPoll = setInterval(async () => {
    if (!wowheadWindow || wowheadWindow.isDestroyed() || wowheadWindow.webContents.isLoading()) return;
    const result = await wowheadWindow.webContents.executeJavaScript(`
      (() => {
        const filenamePattern = /(?:^|[\\\\/])?((?:ability|inv|spell|trade_skill|achievement|interface)[^\\\\/]*?)(?:\\.(?:tga|blp|png|jpg|jpeg))?(?:[?#].*)?$/i;
        const pageIsSpell = /^\\/spell(?:[=/?]|$)/i.test(window.location.pathname);
        if (!pageIsSpell) return null;
        for (const field of document.querySelectorAll('input, textarea')) {
          const match = (field.value || '').trim().match(filenamePattern);
          if (match && match[1].length > 2) return { filename: match[1], imageUrl: null };
        }
        const iconPathPattern = /[\\/]icons[\\/](?:small|medium|large|tiny)[\\/]([a-z0-9][a-z0-9_-]*)\.(?:png|jpg|jpeg|blp)(?:[?#].*)?/i;
        const imagePattern = /(?:^|[\\\\/"'=])((?:ability|inv|spell|trade_skill|achievement|interface)[a-z0-9_]+?)(?:\\.(?:png|jpg|jpeg|blp))(?:[?#].*)?(?=$|[\\\\/"'&])/i;
        const findFilename = (source) => {
          const value = String(source || '');
          const iconPathMatch = value.match(iconPathPattern);
          if (iconPathMatch) return iconPathMatch[1];
          const imageMatch = value.match(imagePattern);
          return imageMatch ? imageMatch[1] : null;
        };
        const getFullSizeUrl = (source) => {
          const urlMatch = String(source || '').match(/https?:\\/\\/[^\\s"')]+/i);
          if (!urlMatch) return null;
          return urlMatch[0].replace(/\\/(?:small|medium|large|tiny)\\//i, '/large/');
        };
        const iconElements = document.querySelectorAll('img, source, [style*="icons"], [style*="Icons"], [data-icon], [data-src], [data-background]');
        for (const element of iconElements) {
          const sources = [
            element.currentSrc, element.src, element.srcset, element.dataset.src,
            element.dataset.icon, element.dataset.background, element.getAttribute('style')
          ];
          for (const source of sources) {
            const filename = findFilename(source);
            if (filename) {
              const imageUrl = getFullSizeUrl(source);
              return { filename, imageUrl };
            }
          }
        }
        const htmlFilename = findFilename(document.documentElement.innerHTML);
        if (htmlFilename) {
          return { filename: htmlFilename, imageUrl: null };
        }
        return null;
      })();
    `).catch(() => null);
    const page = wowheadWindow.webContents.getURL();
    if (page !== lastPage) {
      lastPage = page;
      confirmedFilename = '';
    }
    if (result && result.filename && result.filename !== confirmedFilename) {
      confirmedFilename = result.filename;
      const { response } = await confirmWowheadIcon(wowheadWindow, result.filename);
      if (response === 0 && !owner.isDestroyed()) {
        let icon = null;
        try { icon = await prepareIcon(result.imageUrl); } catch (error) { console.warn(`Could not process Wowhead icon: ${error.message}`); }
        event.sender.send('wowhead-icon-selected', { filename: result.filename, ...icon });
      }
      if (response === 0) {
        if (!owner.isDestroyed()) owner.focus();
        if (wowheadWindow && !wowheadWindow.isDestroyed()) wowheadWindow.close();
      }
    }
  }, 500);
  wowheadWindow.on('closed', () => {
    clearInterval(wowheadPoll);
    wowheadPoll = null;
    wowheadWindow = null;
  });
});