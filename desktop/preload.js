// The bridge between the pet's window and the page inside it.
//
// Deliberately tiny, and deliberately the ONLY way the page can talk to Electron: the page
// is a normal web page loading the plugin's own sources, and it runs with
// `contextIsolation: true` and no Node integration. Everything crossing this bridge is a
// plain number or a boolean, so a compromised page cannot reach the filesystem, the
// process, or any other window.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vrmpet3dDesktop', {
  /**
   * Ask for the launch configuration: which model to show, where the asset route lives.
   * Sent as an invoke so the page can await it before mounting anything.
   */
  config: () => ipcRenderer.invoke('vrmpet3d:config'),

  /** The global cursor position, pushed by the main process at frame rate. */
  onCursor: (callback) => {
    if (typeof callback !== 'function') return;
    ipcRenderer.on('vrmpet3d:cursor', (_event, point) => callback(point));
  },

  /**
   * Tell the main process where the pet is, so it can decide between receiving clicks and
   * passing them through. `dragging` keeps the window interactive for the whole gesture
   * rather than only while the cursor happens to be over the pet.
   */
  reportRect: (rect) => ipcRenderer.send('vrmpet3d:rect', rect),

  /** Announce that the pet is mounted and drawing, with the facts the launcher reports. */
  ready: (info) => ipcRenderer.send('vrmpet3d:ready', info),

  /**
   * Ask for a MODEL FILE, with a NATIVE file picker.
   *
   * A FILE, not a folder, and the operator's reason is the design: 「选择VRM模型所在的文件，并导入到插件的本地配置
   * 中去，不再是选中一个文件夹了，万一文件夹移位了，也会出bug」. The launcher answers with the chosen path — or null
   * when the user cancelled — and the PAGE hands it to the HOST over `/vrmpet3d/models`, which COPIES it into the
   * plugin's own storage. The host stays the only writer of that list, and the `VRMPET3D_MODEL_FILES_FILE` /
   * `VRMPET3D_IMPORT_DIR` overrides the suites rely on are not bypassed.
   */
  pickModelFile: () => ipcRenderer.invoke('vrmpet3d:pick-path', { kind: 'model' }),

  /**
   * The same dialog for an imported MOTION folder (`/vrmpet3d/motions`), which stays a DIRECTORY: a motion pack is
   * a folder of clips filed by state, and the host copies the folder rather than a single file out of it.
   *
   * One channel for both, with `kind` deciding a FILE dialog from a folder one and the title each shows.
   */
  pickMotionDir: () => ipcRenderer.invoke('vrmpet3d:pick-path', { kind: 'motion' }),

  /**
   * Tell the launcher that a VIEW ORBIT is starting or ending — and let IT take the pointer lock.
   *
   * The page cannot do it itself, and that is a measurement rather than a rule of thumb: this window is created
   * `focusable: false`, and Chromium refuses a lock request from a document that is not focused (「The root
   * document of this element is not valid for pointer lock.」). Even once the launcher has focused it, a request
   * that the PAGE makes has crossed an IPC boundary, and that is not the moment Chromium wants. So the launcher
   * owns both halves: it focuses the window and requests the lock with Electron's `userGesture` flag, and it
   * exits the lock when the drag ends. The page only READS the result (`pointerlockchange`).
   */
  orbit: (active) => ipcRenderer.send('vrmpet3d:orbit', active === true),

  /** The one control the page has over its own window. */
  quit: () => ipcRenderer.send('vrmpet3d:quit'),
});
