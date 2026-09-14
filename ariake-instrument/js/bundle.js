// Unpacks the data bundle. bundle_b64.js sets window.BUNDLE_META and
// window.BUNDLE_B64 before this runs, so nothing is fetched and the app
// works from a double-clicked index.html.
(function (global) {
  "use strict";

  var DTYPES = {
    float32: Float32Array, float64: Float64Array,
    int32: Int32Array, uint8: Uint8Array, uint16: Uint16Array
  };

  function decode(b64) {
    var bin = atob(b64), n = bin.length, buf = new Uint8Array(n), i;
    for (i = 0; i < n; i++) buf[i] = bin.charCodeAt(i);
    return buf.buffer;
  }

  function load() {
    var meta = global.BUNDLE_META;
    if (!meta) throw new Error("bundle_b64.js did not load");
    var raw = decode(global.BUNDLE_B64);
    var arr = {}, name, h, T, count;
    for (name in meta.arrays) {
      h = meta.arrays[name];
      T = DTYPES[h.dtype];
      if (!T) throw new Error("unknown dtype " + h.dtype + " for " + name);
      count = h.shape.length ? h.shape.reduce(function (a, b) {
        return a * b;
      }, 1) : 1;
      arr[name] = new T(raw, h.offset, count);
    }
    // free the base64 text, it is several megabytes
    try { delete global.BUNDLE_B64; } catch (e) { global.BUNDLE_B64 = null; }
    return { meta: meta, a: arr };
  }

  global.Bundle = { load: load };
})(window);
