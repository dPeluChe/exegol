import { app, BrowserWindow, dialog, globalShortcut, ipcMain, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { initializeDatabase, closeDatabase } from './db/client'
import { registerTrpcIpcHandler } from './ipc/trpc-ipc'
import { getAgentManager } from './agents/manager'
import { DEFAULT_SETTINGS } from '@exegol/shared'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#09090b',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerGlobalHotkey(): void {
  const hotkey = DEFAULT_SETTINGS.globalHotkey
  globalShortcut.register(hotkey, () => {
    if (!mainWindow) {
      createWindow()
      return
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    }

    if (mainWindow.isVisible()) {
      mainWindow.focus()
    } else {
      mainWindow.show()
    }
  })
}

app.setName('Exegol')

function registerIpcHandlers(): void {
  // Terminal write: renderer -> main -> pty
  ipcMain.on('terminal:write', (_event, agentId: string, data: string) => {
    const manager = getAgentManager()
    manager.write(agentId, data)
  })

  // Terminal resize: renderer -> main -> pty
  ipcMain.on('terminal:resize', (_event, agentId: string, cols: number, rows: number) => {
    const manager = getAgentManager()
    manager.resize(agentId, cols, rows)
  })

  // App version
  ipcMain.handle('app:version', () => {
    return app.getVersion()
  })

  // Dialog: open folder picker
  ipcMain.handle('dialog:showOpenDialog', async (_event, options) => {
    return dialog.showOpenDialog(options)
  })

  // Window controls
  ipcMain.on('window:minimize', () => {
    mainWindow?.minimize()
  })
  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow?.maximize()
    }
  })
  ipcMain.on('window:close', () => {
    mainWindow?.close()
  })
}

app.whenReady().then(async () => {
  await initializeDatabase()
  registerTrpcIpcHandler()
  registerIpcHandlers()
  registerGlobalHotkey()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()

  // Stop all running agents and close the database
  const manager = getAgentManager()
  for (const agentId of manager.listRunning()) {
    const proc = manager.getProcess(agentId)
    if (proc) {
      try {
        proc.kill()
      } catch {
        // Process may have already exited
      }
    }
  }

  closeDatabase()
})
