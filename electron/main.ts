import * as electron from 'electron'
// import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

type RenderMode = 'cpu' | 'gpu';
type GpuBackend = 'd3d11' | 'd3d9' | 'opengl' | 'vulkan' | 'desktop';
const settingsPath = path.join(electron.app.getPath('userData'), 'settings.json');
let renderMode: RenderMode = 'gpu';
let allowGpuFallback = true;
let gpuBackend: GpuBackend = 'd3d11';
let ignoreGpuBlocklist = false;
let disableGpuSandbox = false;
let rendererReady = false;
let gpuFallbackTimer: ReturnType<typeof setTimeout> | null = null;
try {
  const raw = fs.readFileSync(settingsPath, 'utf-8');
  const parsed = JSON.parse(raw) as {
    renderMode?: RenderMode;
    allowGpuFallback?: boolean;
    gpuBackend?: GpuBackend;
    ignoreGpuBlocklist?: boolean;
    disableGpuSandbox?: boolean;
  };
  if (parsed.renderMode === 'gpu' || parsed.renderMode === 'cpu') {
    renderMode = parsed.renderMode;
  }
  if (typeof parsed.allowGpuFallback === 'boolean') {
    allowGpuFallback = parsed.allowGpuFallback;
  }
  if (
    parsed.gpuBackend === 'd3d11'
    || parsed.gpuBackend === 'd3d9'
    || parsed.gpuBackend === 'opengl'
    || parsed.gpuBackend === 'vulkan'
    || parsed.gpuBackend === 'desktop'
  ) {
    gpuBackend = parsed.gpuBackend;
  }
  if (typeof parsed.ignoreGpuBlocklist === 'boolean') {
    ignoreGpuBlocklist = parsed.ignoreGpuBlocklist;
  }
  if (typeof parsed.disableGpuSandbox === 'boolean') {
    disableGpuSandbox = parsed.disableGpuSandbox;
  }
} catch {
  // Ignore missing/invalid settings and use defaults.
}

const persistRenderMode = () => {
  try {
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ renderMode, allowGpuFallback, gpuBackend, ignoreGpuBlocklist, disableGpuSandbox }, null, 2),
      'utf-8'
    );
  } catch (error) {
    console.error('Failed to write settings:', error);
  }
};

const fallbackToCpu = (reason: string) => {
  if (!allowGpuFallback) {
    console.warn(`[GPU mode] ${reason} Auto fallback disabled.`);
    return;
  }
  if (renderMode === 'cpu') return;
  console.warn(`[GPU mode] ${reason} Falling back to CPU.`);
  renderMode = 'cpu';
  persistRenderMode();
  electron.app.relaunch();
  electron.app.exit(0);
};

electron.app.commandLine.appendSwitch('force_high_performance_gpu');

electron.app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

const cacheRoot = path.join(electron.app.getPath('temp'), `face-swap-cache-${process.pid}`);
const diskCacheDir = path.join(cacheRoot, 'disk');
const gpuCacheDir = path.join(cacheRoot, 'gpu');
try {
  fs.mkdirSync(diskCacheDir, { recursive: true });
  fs.mkdirSync(gpuCacheDir, { recursive: true });
} catch (error) {
  console.warn('Failed to prepare cache directories:', error);
}
electron.app.commandLine.appendSwitch('disk-cache-dir', diskCacheDir);
electron.app.commandLine.appendSwitch('gpu-disk-cache-dir', gpuCacheDir);
if (ignoreGpuBlocklist) {
  electron.app.commandLine.appendSwitch('ignore-gpu-blocklist');
}
if (disableGpuSandbox) {
  electron.app.commandLine.appendSwitch('disable-gpu-sandbox');
}

const disabledFeatures = ['CalculateNativeWinOcclusion', 'WebGPU'];
if (gpuBackend !== 'vulkan') {
  disabledFeatures.push('Vulkan');
}
electron.app.commandLine.appendSwitch('disable-features', disabledFeatures.join(','));

const forceSoftwareRendering = renderMode !== 'gpu';
if (forceSoftwareRendering) {
  electron.app.disableHardwareAcceleration();
  electron.app.commandLine.appendSwitch('use-angle', 'swiftshader');
  electron.app.commandLine.appendSwitch('enable-unsafe-swiftshader');
} else {
  const useDesktopGL = gpuBackend === 'desktop';
  if (useDesktopGL) {
    electron.app.commandLine.appendSwitch('use-gl', 'desktop');
  } else {
    electron.app.commandLine.appendSwitch('use-gl', 'angle');
    if (gpuBackend === 'vulkan') {
      electron.app.commandLine.appendSwitch('use-angle', 'vulkan');
      electron.app.commandLine.appendSwitch('enable-features', 'Vulkan');
    } else {
      const angleBackend = gpuBackend === 'opengl' ? 'gl' : gpuBackend;
      electron.app.commandLine.appendSwitch('use-angle', angleBackend);
    }
  }
  // Avoid forcing GPU rasterization; let Chromium decide for stability.
}
electron.app.commandLine.appendSwitch('disable-renderer-backgrounding');
electron.app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
electron.app.commandLine.appendSwitch('disable-background-timer-throttling');

// const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, '..')

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: electron.BrowserWindow | null

function createWindow() {
  rendererReady = false;
  win = new electron.BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC, 'electron-vite.svg'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      backgroundThrottling: false,
    },
  })

  // Test active push message to Renderer-process.
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
    if (renderMode === 'gpu') {
      rendererReady = true;
      if (gpuFallbackTimer) {
        clearTimeout(gpuFallbackTimer);
        gpuFallbackTimer = null;
      }
    }
  })
  win.webContents.setBackgroundThrottling?.(false)

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    // win.loadFile(path.join(RENDERER_DIST, 'index.html'))
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }

  if (renderMode === 'gpu') {
    if (gpuFallbackTimer) {
      clearTimeout(gpuFallbackTimer);
    }
    gpuFallbackTimer = setTimeout(() => {
      if (!rendererReady) {
        fallbackToCpu('Renderer did not become ready in time.');
      }
    }, 12000);
  }

  win.webContents.on('did-fail-load', (_event, _code, description) => {
    if (renderMode === 'gpu') {
      fallbackToCpu(`Renderer failed to load: ${description}`);
    }
  });

  win.webContents.on('render-process-gone', (_event, details) => {
    if (renderMode === 'gpu') {
      fallbackToCpu(`Renderer process gone: ${details.reason}`);
    }
  });

}

electron.ipcMain.handle('app:get-render-mode', () => renderMode);
electron.ipcMain.handle('app:get-gpu-fallback', () => allowGpuFallback);
electron.ipcMain.handle('app:get-gpu-backend', () => gpuBackend);
electron.ipcMain.handle('app:get-ignore-gpu-blocklist', () => ignoreGpuBlocklist);
electron.ipcMain.handle('app:get-disable-gpu-sandbox', () => disableGpuSandbox);
electron.ipcMain.handle('app:set-render-mode', (_event, mode: RenderMode) => {
  if (mode === 'cpu' || mode === 'gpu') {
    renderMode = mode;
    persistRenderMode();
    return true;
  }
  return false;
});
electron.ipcMain.handle('app:set-gpu-fallback', (_event, enabled: boolean) => {
  if (typeof enabled === 'boolean') {
    allowGpuFallback = enabled;
    persistRenderMode();
    return true;
  }
  return false;
});
electron.ipcMain.handle('app:set-gpu-backend', (_event, backend: GpuBackend) => {
  if (
    backend === 'd3d11'
    || backend === 'd3d9'
    || backend === 'opengl'
    || backend === 'vulkan'
    || backend === 'desktop'
  ) {
    gpuBackend = backend;
    persistRenderMode();
    return true;
  }
  return false;
});
electron.ipcMain.handle('app:set-ignore-gpu-blocklist', (_event, enabled: boolean) => {
  if (typeof enabled === 'boolean') {
    ignoreGpuBlocklist = enabled;
    persistRenderMode();
    return true;
  }
  return false;
});
electron.ipcMain.handle('app:set-disable-gpu-sandbox', (_event, enabled: boolean) => {
  if (typeof enabled === 'boolean') {
    disableGpuSandbox = enabled;
    persistRenderMode();
    return true;
  }
  return false;
});
electron.ipcMain.handle('app:get-gpu-status', async () => {
  const status = typeof electron.app.getGPUFeatureStatus === 'function'
    ? electron.app.getGPUFeatureStatus()
    : {};
  let info = null;
  try {
    if (typeof electron.app.getGPUInfo === 'function') {
      info = await electron.app.getGPUInfo('basic');
    }
  } catch (error) {
    console.warn('Failed to read GPU info:', error);
  }
  return { status, info };
});
electron.ipcMain.on('app:renderer-ready', () => {
  rendererReady = true;
  if (gpuFallbackTimer) {
    clearTimeout(gpuFallbackTimer);
    gpuFallbackTimer = null;
  }
});
electron.ipcMain.on('app:relaunch', () => {
  electron.app.relaunch();
  electron.app.exit(0);
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
electron.app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    electron.app.quit()
    win = null
  }
})

electron.app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (electron.BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

electron.app.whenReady().then(() => {
  const ses = electron.session.defaultSession;
  ses.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (permission === 'media') {
      return callback(true);
    }
    callback(false);
  });
  ses.setPermissionCheckHandler((_webContents, permission) => permission === 'media');

  electron.app.on('child-process-gone', (_event, details) => {
    if (renderMode === 'gpu' && details.type === 'GPU') {
      fallbackToCpu(`GPU process gone: ${details.reason}`);
    }
  });
  if (renderMode === 'gpu' && typeof electron.app.getGPUFeatureStatus === 'function') {
    console.log('GPU feature status:', electron.app.getGPUFeatureStatus());
    if (typeof electron.app.getGPUInfo === 'function') {
      electron.app.getGPUInfo('basic')
        .then((info) => console.log('GPU info:', info))
        .catch((error) => console.warn('GPU info error:', error));
    }
  }
  createWindow();
})
