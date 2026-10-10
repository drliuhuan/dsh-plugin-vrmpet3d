// dsh-plugin-vrmpet3d — chunk delivery probe (browser body).
//
// Run:  node scripts/verify-browser.mjs --page chunk-delivery
//
// WHY THIS PAGE EXISTS
// --------------------
// The first live install of this plugin showed no pet, and nothing in the
// repository could have caught it. Every other browser page INLINES the sources
// with <script> tags, so they all exercise a delivery path that does not exist in
// the app. In the app, DSH serves a package-local file only when its name matches
//
//     /^client\.[A-Za-z0-9][A-Za-z0-9._-]*\.js$/
//
// and only at `/plugins/<package>/<file>?rev=<current revision>`. `core.js`,
// `placeholder.js` and `scene.js` matched neither rule, so they were never
// served, the globals the client half read were always undefined, and the pet
// threw `vrmpet3d: lib/scene.js is not loaded.`
//
// So this page runs the REAL module system — `@deepseek-ai/dsh-client-modules`,
// extracted verbatim from the installed app.asar by the harness — against the
// REAL committed files, and asserts that every chunk the client half asks for is
// delivered, at a URL the server would answer.
//
// The page is driven from three globals the harness fills in:
//   * `__VRMPET3D_CHUNKS__`  { '<fileName>': '<source text>' } — the payload the
//                         transport hands to a script element on request;
//   * `__VRMPET3D_BOOT__`    the boot wire, whose row URL keeps the combo shape the
//                         loader rewrites into a per-chunk request;
//   * `__VRMPET3D_LOADER__`  the registration facade, created BEFORE any bundle
//                         runs, exactly as the shell's HTML bootstrap does.
//
// NOTE ON SOURCE FORM: the harness inlines this file into a template literal, so
// avoid a backtick and avoid a dollar-brace anywhere below — the first closes the
// template, the second interpolates. Both report a syntax error pointing at prose.
(function () {
  'use strict';

  var checks = [];
  var errors = [];
  var log = [];

  window.addEventListener('error', function (event) {
    errors.push('uncaught: ' + (event && event.message ? event.message : String(event)));
  });
  window.addEventListener('unhandledrejection', function (event) {
    errors.push('unhandled rejection: ' + messageOf(event && event.reason));
  });

  function check(name, ok, value) {
    checks.push({ name: name, ok: Boolean(ok), value: value === undefined ? null : value });
  }

  function messageOf(error) {
    if (error instanceof Error) return error.message;
    return String(error);
  }

  function report() {
    var out = document.getElementById('out');
    if (!out) return;
    out.textContent = JSON.stringify({
      ok: !checks.some(function (c) { return !c.ok; }),
      checks: checks,
      errors: errors,
      log: log
    });
  }

  var FILES = globalThis.__VRMPET3D_CHUNKS__ || {};
  /** Every URL the loader asked its transport for, in order. */
  var requested = [];
  /** The script elements the transport appended, so delivery can be asserted. */
  var appended = [];

  /** The trailing file name of a chunk URL, query string removed. */
  function fileNameOf(url) {
    var path = String(url).split('?')[0];
    return path.slice(path.lastIndexOf('/') + 1);
  }

  // -------------------------------------------------------------------------
  // 1. the real module system, booted the way the web app boots it
  // -------------------------------------------------------------------------

  // The facade is the one the harness installed before the bundles ran. It has
  // to be: `create` drains its pending queue, and the module system refuses to be
  // constructed once that queue is gone ("called after module-system boot"), so a
  // facade created here, at the end of the page, would have swallowed every
  // registration instead.
  var facade = globalThis.__VRMPET3D_LOADER__;
  check('the harness installed the registration facade before the bundles',
    Boolean(facade) && Array.isArray(facade.pendingQueue),
    facade ? facade.mode : 'no facade');

  var CLIENT_MODULES_ID = '@deepseek-ai/dsh-client-modules';
  var ROW_ID = 'dsh-plugin-vrmpet3d';

  // Snapshot before boot: `create` drains the facade's queue with `splice(0)`, so
  // the array this page holds a reference to is empty afterwards.
  var queued = (facade ? facade.pendingQueue : []).slice();

  log.push('queued=' + queued.length
    + ' ids=' + queued.map(function (r) { return r.id + (r.chunk ? ('[' + r.chunk + ']') : ''); }).join('|'));

  check('the extracted client module system registered itself',
    queued.some(function (r) { return r.id === CLIENT_MODULES_ID; }),
    queued.map(function (r) { return r.id; }).join(',') || 'none');

  check('lib/client.js registered itself under the package name',
    queued.some(function (r) { return r.id === ROW_ID; }),
    queued.map(function (r) { return r.id; }).join(',') || 'none');

  var boot = globalThis.__VRMPET3D_BOOT__;
  check('the harness supplied a boot wire with the vrmpet3d row',
    Boolean(boot) && Array.isArray(boot.entries) && boot.entries.some(function (row) { return row.id === ROW_ID; }),
    boot ? boot.entries.map(function (row) { return row.id; }).join(',') : 'missing');

  var moduleSystem = null;
  try {
    moduleSystem = facade.create({
      boot: boot,
      // The real seed table is react, react-dom, cordis, the store and the slots
      // package (see the web bundle's staticModules factory). Only react is needed
      // here: this page never materialises the plugin's React tree.
      staticModules: { react: globalThis.__VRMPET3D_REACT_STUB__ },
      loadBundle: function (url) {
        requested.push(url);
        return new Promise(function (resolve, reject) {
          var name = fileNameOf(url);
          var source = name ? FILES[name] : null;
          if (!source) {
            // Mirrors the real transport: a resource that is not served is an
            // error event on the script element, not a silent empty result.
            appended.push(name + ':missing');
            reject(new Error('browser probe: no inlined chunk for ' + url));
            return;
          }
          var el = document.createElement('script');
          el.textContent = source;
          document.head.appendChild(el);
          appended.push(name);
          resolve();
        });
      }
    });
  } catch (error) {
    errors.push('module system construction failed: ' + messageOf(error));
  }

  check('the module system boots over the test boot wire', Boolean(moduleSystem), errors[0] || null);
  check('the booted graph carries the vrmpet3d row',
    Boolean(moduleSystem) && Boolean(moduleSystem.graphRows.get(ROW_ID)),
    moduleSystem ? Array.from(moduleSystem.graphRows.keys()).join(',') : null);

  // `create` drains the queue, so only now can the loader's own factory run and
  // its exports be read. This materialize-then-create order is the one the web
  // shell uses: a registration is not an execution.
  var loaderExports = null;
  if (moduleSystem) {
    try {
      loaderExports = moduleSystem.materialize(CLIENT_MODULES_ID).exports;
    } catch (error) {
      errors.push('materializing the client module system failed: ' + messageOf(error));
    }
  }
  check('the extracted loader materialized its own exports',
    Boolean(loaderExports && typeof loaderExports.createClientModuleSystem === 'function'),
    loaderExports ? Object.keys(loaderExports).join(',') : 'none');

  // -------------------------------------------------------------------------
  // 2. the real client entry, taken from its own registration
  // -------------------------------------------------------------------------

  var plugin = null;
  try {
    var registration = null;
    queued.forEach(function (candidate) {
      if (candidate.id === ROW_ID) registration = candidate;
    });
    if (registration) {
      plugin = registration.factory(function (spec) {
        if (spec === 'react') return globalThis.__VRMPET3D_REACT_STUB__;
        throw new Error('browser probe: the plugin factory required an unexpected module: ' + spec);
      });
    }
    check('the plugin factory returns a plugin with inject and apply',
      Boolean(plugin) && Array.isArray(plugin.inject) && typeof plugin.apply === 'function',
      plugin ? plugin.inject.join(',') : 'not registered');

    /**
     * An `inject` entry the composition cannot satisfy leaves the plugin waiting
     * for activation forever, and the only symptom is "is waiting for activation"
     * in the boot audit — the pet simply never appears, exactly like the delivery
     * failure this page was written for.
     *
     * `connection` is the concrete trap: it was declared and used nowhere, and the
     * running client publishes no service by that name. `remote` is resolvable (the
     * shipped chat plugin injects it) but is deliberately optional here, because
     * the pet's primary signal is the React status hooks and a missing RPC binding
     * must cost fidelity rather than the whole plugin.
     */
    if (plugin && Array.isArray(plugin.inject)) {
      var unnecessary = ['connection', 'remote'].filter(function (key) {
        return plugin.inject.indexOf(key) !== -1;
      });
      check('the plugin declares no hard dependency it does not need',
        unnecessary.length === 0, unnecessary.join(',') || 'none');
      var required = ['slots', 'sessions', 'locale'].filter(function (key) {
        return plugin.inject.indexOf(key) === -1;
      });
      check('the plugin still declares the services it does need',
        required.length === 0, required.join(',') || 'none');
    }
  } catch (error) {
    errors.push('the plugin factory threw: ' + messageOf(error));
    check('the plugin factory returns a plugin with inject and apply', false, messageOf(error));
  }

  // -------------------------------------------------------------------------
  // 3. drive the chunks exactly as the client half does
  // -------------------------------------------------------------------------

  /**
   * Whether the client half handed the 3D graph to the scene.
   *
   * Read from the client half's own record rather than by spying on
   * `globalThis.__VRMPET3D_SCENE__`, and that is not a shortcut: the scene chunk
   * REPLACES that global when it loads, so a stand-in installed earlier is gone by
   * the time the hand-off happens, and one installed later misses it entirely. Both
   * mistakes were made here before this assertion was written this way.
   *
   * It matters because the scene also reads `__VRMPET3D_VENDOR__` itself: a client half
   * that never told it "the graph has arrived" would still work, and one that read
   * the global a chunk too early would read `undefined` and leave no trace.
   */
  function handedVendor() {
    var api = globalThis.__VRMPET3D_CLIENT__;
    return api && typeof api.handedVendor === 'function' ? api.handedVendor() : undefined;
  }

  var moduleRequire = null;
  if (moduleSystem) {
    // Materializing the plugin entry also runs the client half's own `loadChunks`,
    // whose promise nothing here awaits. That is deliberate: this page asserts
    // delivery on its own terms, below, rather than trusting the client to report.
    try {
      moduleSystem.materialize(ROW_ID);
    } catch (error) {
      errors.push('materializing the plugin entry failed: ' + messageOf(error));
    }
    moduleRequire = moduleSystem.makeRequire(ROW_ID, new Set());
    check('require.async is available to the plugin entry',
      typeof moduleRequire.async === 'function', typeof moduleRequire.async);
  }

  var CHUNKS = [
    { file: './client.core.js', global: '__VRMPET3D_CORE__', api: 'cleanPreferences' },
    // `./client.placeholder.js` was delivered until 2026-10-10, when the operator removed the built-in avatar
    // ("内置的占位模型还是没删掉，把Sample Model设为内置模型"). It is no longer generated, no longer loaded by the
    // client half and no longer served, so requiring it here would assert a 404.
    { file: './client.scene.js', global: '__VRMPET3D_SCENE__', api: 'Scene' },
    // Last, and largest: the one the old hand-rolled script route could never
    // fetch, so it is the one that proves the module path end to end.
    { file: './client.vendor.js', global: '__VRMPET3D_VENDOR__', api: 'THREE' }
  ];

  var delivered = {};

  function loadChunks() {
    var chain = Promise.resolve();
    CHUNKS.forEach(function (chunk) {
      chain = chain.then(function () {
        // Asking again for a chunk whose global is already published is exactly
        // what the client half skips, so this mirrors it. On this page the client
        // half has already requested and received every chunk, so these calls
        // normally resolve straight out of the module table — which is itself the
        // proof that the earlier requests registered correctly.
        return moduleRequire.async(chunk.file).then(function (exports) {
          delivered[chunk.file] = exports;
        });
      });
    });
    return chain;
  }

  loadChunks().then(function () {
    CHUNKS.forEach(function (chunk) {
      var exports = delivered[chunk.file];
      check('the module system delivered ' + chunk.file, Boolean(exports), typeof exports);
      check(chunk.file + ' exports the API the client half reads (' + chunk.api + ')',
        Boolean(exports) && exports[chunk.api] !== undefined && exports[chunk.api] !== null,
        exports ? typeof exports[chunk.api] : 'no exports');
      check(chunk.file + ' resolved to the same object as ' + chunk.global,
        Boolean(exports) && exports === globalThis[chunk.global],
        Boolean(exports) + '/' + Boolean(globalThis[chunk.global]));
    });

    // Every request must look like something the server will answer. This is the
    // assertion the page exists for: the previous delivery path built
    // '/plugins/client.vendor.js' with no revision, and the server rejected it.
    requested.forEach(function (url) {
      check('requested URL carries the current revision: ' + url,
        /[?&]rev=test-rev-1(&|$)/.test(url), url);
      check('requested URL is a per-package client path: ' + url,
        /^\/plugins\/[^/]+\/client\.[A-Za-z0-9][A-Za-z0-9._-]*\.js\?/.test(url), url);
    });
    check('every requested file was inlined and executed',
      appended.every(function (entry) { return entry.indexOf(':missing') === -1; }),
      appended.join(','));
    // Membership rather than a request count: if the client half already asked for
    // a chunk, this page's own request resolves from the module table and never
    // reaches the transport again. What must hold either way is that each of the
    // four files was requested, by the client half or here.
    var asked = requested.map(fileNameOf);
    CHUNKS.forEach(function (chunk) {
      var name = fileNameOf(chunk.file);
      check('the transport was asked for ' + name, asked.indexOf(name) !== -1, asked.join(','));
    });

    return runNegatives();
  }).then(function () {
    // The client half's own hand-off of the 3D graph to the scene, read from the
    // client's record. The scene also reads the global itself, which is exactly
    // what would hide a missing hand-off, so this is the only assertion that sees
    // the difference. The probe's own load above resolved through the same module
    // table, so by here the client half's chain has settled.
    var handed = handedVendor();
    check('the client half handed the vendor graph to the scene',
      Boolean(handed), typeof handed);
    check('the handed-off graph is the vendor chunk\'s own export',
      Boolean(handed) && handed === delivered['./client.vendor.js'],
      Boolean(handed) + '/' + Boolean(delivered['./client.vendor.js']));

    check('no page errors were recorded', errors.length === 0, errors.join(' | ') || null);
    report();
  }).catch(function (error) {
    errors.push('chunk delivery failed: ' + messageOf(error));
    check('every chunk the client half needs is deliverable', false, messageOf(error));
    report();
  });

  // -------------------------------------------------------------------------
  // 4. negative controls — the guards the old path tripped must still bite
  // -------------------------------------------------------------------------

  function runNegatives() {
    // A name outside CLIENT_CHUNK is refused before any URL is composed. Without
    // this the page could pass while the loader accepted anything at all.
    // `require.async` is an async function, so the refusal is a rejection, not a
    // synchronous throw — and it must be caught here, before it reaches
    // `unhandledrejection`, which the error assertion at the end would count.
    return moduleRequire.async('./core.js').then(function () {
      check('a non client.<name>.js request is refused by the loader', false, 'it resolved');
    }, function (error) {
      var message = messageOf(error);
      check('a non client.<name>.js request is refused by the loader',
        message.indexOf('invalid relative chunk request') !== -1, message);

      return checkDuplicateReplay();
    });
  }

  /**
   * A chunk that loads but registers nothing is the exact silent failure this
   * repository shipped once, so replaying a real registration has to be rejected.
   *
   * The replay runs as a script element, which is how the loader really delivers
   * a chunk: its throw is a window error, not a return value, so it is read back
   * from the captured error list rather than from a try/catch here. That error is
   * EXPECTED, so it is removed again: leaving it would fail the later assertion
   * that no unexpected error occurred, which is separate and still useful.
   */
  function checkDuplicateReplay() {
    var before = errors.length;
    var replay = document.createElement('script');
    replay.textContent = FILES['client.core.js'];
    document.head.appendChild(replay);
    var raised = errors.splice(before).join(' | ');
    check('re-registering an already registered chunk is rejected',
      raised.indexOf('duplicate factory registration') !== -1, raised || 'no error was raised');

    // A registration with no id is the shape the first attempt at this fix used.
    // The loader reads the id unconditionally, so the failure has to be visible
    // rather than quietly registering under `undefined`.
    var noId = null;
    try {
      window.__ModuleLoader__.load({ chunk: 'client.no-id.js', factory: function () { return {}; } });
    } catch (error) {
      noId = messageOf(error);
    }
    check('a chunk registration without an id is rejected by the loader',
      Boolean(noId) && noId.indexOf('endsWith') !== -1, noId);

    // ...and a chunk cannot be requested on behalf of a package that is not in
    // the boot graph: that is what a wrong owner id looks like at runtime.
    var orphanRequire = moduleSystem.makeRequire('not-a-real-plugin', new Set());
    return orphanRequire.async('./client.core.js').then(function () {
      check('a chunk request from a package outside the boot graph fails loudly', false, 'it resolved');
    }, function (error) {
      var orphan = messageOf(error);
      check('a chunk request from a package outside the boot graph fails loudly',
        orphan.indexOf('is not a boot graph entry') !== -1, orphan);
    });
  }
})();
