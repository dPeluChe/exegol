const { app, BrowserWindow } = require('electron');
const path = require('node:path');
app.disableDomainBlockingFor3DAPIs();
const plan = JSON.parse(process.env.PLAN);
app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 1280, height: 820, x: 0, y: 2000, show: false, focusable: false, webPreferences: { backgroundThrottling: false } });
  win.showInactive();
  const pid = () => win.webContents.getOSProcessId();
  const snap = () => { const m = app.getAppMetrics(); const r = m.find((p) => p.pid === pid()); const g = m.find((p) => p.type === 'GPU'); return { r: r?.cpu.cumulativeCPUUsage ?? NaN, g: g?.cpu.cumulativeCPUUsage ?? NaN, t: performance.now() }; };
  let s;
  win.webContents.on('console-message', (e) => {
    const msg = e.message ?? e;
    if (typeof msg !== 'string') return;
    if (msg.startsWith('MARK start')) { s = snap(); console.log(msg); }
    else if (msg.startsWith('MARK end')) {
      const e2 = snap(); const j = JSON.parse(msg.slice(msg.indexOf('{')));
      j.rendererCpuPerFrame = +(((e2.r - s.r) * 1000) / j.frames).toFixed(2);
      j.gpuCpuPerFrame = +(((e2.g - s.g) * 1000) / j.frames).toFixed(2);
      console.log(JSON.stringify(j));
    } else if (msg.startsWith('INFO') || msg.startsWith('ERROR') || msg.startsWith('TRIP')) console.log(msg);
    else if (msg === 'DONE') app.quit();
  });
  win.loadFile(path.join(__dirname, process.env.PAGE || 'page/index.html'), { hash: encodeURIComponent(JSON.stringify(plan)) });
  setTimeout(() => { console.log('TIMEOUT'); app.quit(); }, 600000);
});
