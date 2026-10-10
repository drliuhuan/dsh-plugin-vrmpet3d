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
   * Ask for a model directory, with a NATIVE folder picker.
   *
   * The settings page needs this and cannot do it itself: a web page cannot open a native dialog, and the
   * page has no filesystem access by design (`contextIsolation`, no Node). The launcher shows the dialog and
   * answers with the chosen path — or null when the user cancelled — and the PAGE then tells the HOST about
   * it over `/vrmpet3d/models`, so there is still exactly one writer of the imported-directory list.
   */
  pickModelDir: () => ipcRenderer.invoke('vrmpet3d:pick-dir', { kind: 'model' }),

  /**
   * The same dialog for an imported MOTION directory (`/vrmpet3d/motions`).
   *
   * A separate name rather than one `pickDirectory(kind)` because the two call sites read differently and the
   * launcher uses `kind` only for the dialog's own title; the HOST still does the writing, exactly as for models.
   */
  pickMotionDir: () => ipcRenderer.invoke('vrmpet3d:pick-dir', { kind: 'motion' }),

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
