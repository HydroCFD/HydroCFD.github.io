// Drawing the bay: the field as a raster, the model's own coastline on top,
// the stations, and the advice markers. Everything is done in metres and
// converted to pixels once, so the map keeps its shape at any size.
(function (global) {
  "use strict";

  // RdBu reversed, sampled at 17 stops from matplotlib. Low values are
  // blue, high values red, with a pale band through the middle.
  var RAMP = [
    [5, 48, 97], [23, 82, 144], [42, 113, 178], [63, 142, 192],
    [107, 172, 209], [155, 201, 224], [194, 221, 236], [224, 236, 243],
    [247, 246, 246], [251, 229, 216], [251, 204, 180], [245, 170, 137],
    [228, 128, 102], [208, 85, 72], [186, 40, 50], [147, 14, 38],
    [103, 0, 31]
  ];
  var LAND = "#e6e2d6", WATER = "#eef1f5", COAST = "#4a4a4a";

  function ramp(t) {
    if (!(t >= 0)) t = 0;
    if (t > 1) t = 1;
    var x = t * 15, i = Math.floor(x), f = x - i,
      a = RAMP[i], b = RAMP[i + 1];
    return [a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1]),
    a[2] + f * (b[2] - a[2])];
  }

  function MapView(canvas, meta, arrays) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.meta = meta;
    this.a = arrays;
    this.nx = meta.nx;
    this.g = meta.grid;
    this.wetOfCell = new Int32Array(this.nx * this.nx).fill(-1);
    for (var i = 0; i < arrays.grid_index.length; i++)
      this.wetOfCell[arrays.grid_index[i]] = i;
    this.img = this.ctx.createImageData(this.nx, this.nx);
    this.state = { stations: [], field: null };
    this.shore = [];
    for (i = 0; i < meta.n_shore; i++)
      this.shore.push({ pts: arrays["shore" + i],
                        open: arrays["shore_open" + i] });
  }

  MapView.prototype.extent = function () {
    var g = this.g, n = this.nx;
    return {
      x0: g.x0 - g.dx / 2, x1: g.x0 + (n - 0.5) * g.dx,
      y0: g.y0 - g.dy / 2, y1: g.y0 + (n - 0.5) * g.dy
    };
  };

  MapView.prototype.layout = function () {
    var e = this.extent(), cw = this.canvas.width, ch = this.canvas.height,
      w = e.x1 - e.x0, h = e.y1 - e.y0,
      s = Math.min(cw / w, ch / h) * 0.96;
    this.s = s;
    this.ox = (cw - w * s) / 2;
    this.oy = (ch - h * s) / 2;
    this.e = e;
  };

  MapView.prototype.px = function (xm, ym) {
    return [this.ox + (xm - this.e.x0) * this.s,
    this.canvas.height - this.oy - (ym - this.e.y0) * this.s];
  };

  MapView.prototype.toMetres = function (px, py) {
    return [(px - this.ox) / this.s + this.e.x0,
    (this.canvas.height - py - this.oy) / this.s + this.e.y0];
  };

  // The wet cell under a pixel, or null when the click missed the water
  MapView.prototype.pick = function (px, py) {
    var m = this.toMetres(px, py), g = this.g,
      col = Math.round((m[0] - g.x0) / g.dx),
      row = Math.round((m[1] - g.y0) / g.dy);
    if (col < 0 || row < 0 || col >= this.nx || row >= this.nx) return null;
    var w = this.wetOfCell[row * this.nx + col];
    if (w >= 0) return w;
    // nearest wet cell within two cells, so a click near the shore still works
    var best = -1, bd = 1e18, dr, dc, r2, c2, ww, d;
    for (dr = -2; dr <= 2; dr++) for (dc = -2; dc <= 2; dc++) {
      r2 = row + dr; c2 = col + dc;
      if (r2 < 0 || c2 < 0 || r2 >= this.nx || c2 >= this.nx) continue;
      ww = this.wetOfCell[r2 * this.nx + c2];
      if (ww < 0) continue;
      d = dr * dr + dc * dc;
      if (d < bd) { bd = d; best = ww; }
    }
    return best >= 0 ? best : null;
  };

  MapView.prototype.setField = function (values, vmin, vmax) {
    var d = this.img.data, n = this.nx, i, k, c, t, rgb;
    for (i = 0; i < d.length; i++) d[i] = 0;
    if (!values) { this.state.field = null; this.state.values = null; return; }
    for (i = 0; i < values.length; i++) {
      c = this.a.grid_index[i];
      var row = Math.floor(c / n), col = c % n,
        py = n - 1 - row;                       // north at the top
      k = (py * n + col) * 4;
      if (!isFinite(values[i])) {          // nothing to report in this cell
        d[k] = 198; d[k + 1] = 198; d[k + 2] = 194; d[k + 3] = 255;
        continue;
      }
      t = (values[i] - vmin) / (vmax - vmin);
      rgb = ramp(t);
      d[k] = rgb[0]; d[k + 1] = rgb[1]; d[k + 2] = rgb[2]; d[k + 3] = 255;
    }
    // Bleed the colour of the edge cells outwards into the transparent
    // land. Without this the browser blends the coast towards black when
    // it scales the raster up, which draws a dark fringe along the shore.
    dilate(d, n, 3);
    this.state.field = { vmin: vmin, vmax: vmax };
    this.state.values = values;
  };

  function dilate(d, n, passes) {
    var p, i, j, k, kk, r, g, b, cnt, dx, dy, src = new Uint8ClampedArray(d);
    for (p = 0; p < passes; p++) {
      src.set(d);
      for (i = 0; i < n; i++) {
        for (j = 0; j < n; j++) {
          k = (i * n + j) * 4;
          if (src[k + 3] > 0) continue;
          r = g = b = cnt = 0;
          for (dy = -1; dy <= 1; dy++) {
            for (dx = -1; dx <= 1; dx++) {
              var i2 = i + dy, j2 = j + dx;
              if (i2 < 0 || j2 < 0 || i2 >= n || j2 >= n) continue;
              kk = (i2 * n + j2) * 4;
              if (src[kk + 3] === 0) continue;
              r += src[kk]; g += src[kk + 1]; b += src[kk + 2]; cnt++;
            }
          }
          if (!cnt) continue;
          d[k] = r / cnt; d[k + 1] = g / cnt; d[k + 2] = b / cnt;
          d[k + 3] = 1;              // effectively invisible, but coloured
        }
      }
    }
  }

  MapView.prototype.render = function (opts) {
    opts = opts || {};
    var ctx = this.ctx, i, j, p;
    this.layout();
    ctx.save();
    ctx.fillStyle = LAND;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    if (this.state.field) {
      var off = document.createElement("canvas");
      off.width = off.height = this.nx;
      off.getContext("2d").putImageData(this.img, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      p = this.px(this.e.x0, this.e.y1);
      ctx.drawImage(off, p[0], p[1], (this.e.x1 - this.e.x0) * this.s,
        (this.e.y1 - this.e.y0) * this.s);
    } else {
      ctx.fillStyle = WATER;
      this.pathShore(ctx, 0);
      ctx.fill();
    }

    // coastline: solid where the model has a wall, dashed at the open sea
    var lw = Math.max(1, this.canvas.width / 520);
    ctx.lineWidth = lw;
    ctx.lineJoin = "round";
    for (i = 0; i < this.shore.length; i++) {
      var pts = this.shore[i].pts, op = this.shore[i].open, m = pts.length / 2;
      for (j = 0; j < m; j++) {
        var k = (j + 1) % m, a = this.px(pts[j * 2], pts[j * 2 + 1]),
          b = this.px(pts[k * 2], pts[k * 2 + 1]);
        ctx.beginPath();
        ctx.setLineDash(op[j] && op[k] ? [4 * lw, 3 * lw] : []);
        ctx.strokeStyle = op[j] && op[k] ? "#8c8c8c" : COAST;
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);

    // Colours chosen to stay readable against both ends of the red to
    // blue scale, so a marker never disappears into the field beneath it.
    if (opts.sources) this.sourceMarks(opts.sources);
    if (opts.plan) this.markers(opts.plan, "#1f6f4a", true);
    if (opts.next) this.markers([opts.next], "#7a4b00", false, "?");
    if (opts.stations) this.markers(opts.stations, "#141414", false);
    ctx.restore();
  };

  MapView.prototype.markers = function (list, colour, hollow, glyph) {
    var ctx = this.ctx, i, p, s, item,
      r = Math.max(8, Math.min(15, this.canvas.width / 42)),
      fs = Math.round(r * 1.05);
    for (i = 0; i < list.length; i++) {
      item = list[i];
      s = typeof item === "number" ? item : item.cell;
      p = this.px(this.a.x_m[s], this.a.y_m[s]);
      ctx.beginPath();
      ctx.arc(p[0], p[1], r, 0, 2 * Math.PI);
      ctx.fillStyle = hollow ? "rgba(255,255,255,0.62)" : "rgba(255,255,255,0.96)";
      ctx.fill();
      ctx.lineWidth = Math.max(1.6, r / 6);
      ctx.strokeStyle = colour;
      ctx.stroke();
      ctx.fillStyle = colour;
      ctx.font = "600 " + fs + "px system-ui, -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      var text = glyph !== undefined ? glyph
        : (item !== null && typeof item === "object" && item.label !== undefined
          ? String(item.label) : String(i + 1));
      ctx.fillText(text, p[0], p[1] + fs * 0.05);
    }
  };


  // The release points of the model, drawn as small squares so they are not
  // mistaken for stations.
  MapView.prototype.sourceMarks = function (list) {
    var ctx = this.ctx, i, p,
      r = Math.max(5, Math.min(10, this.canvas.width / 62)),
      fs = Math.round(r * 1.15);
    for (i = 0; i < list.length; i++) {
      p = this.px(list[i].x, list[i].y);
      ctx.beginPath();
      ctx.rect(p[0] - r, p[1] - r, 2 * r, 2 * r);
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.fill();
      ctx.lineWidth = Math.max(1.4, r / 5);
      ctx.strokeStyle = "#5b2d8e";
      ctx.stroke();
      ctx.fillStyle = "#5b2d8e";
      ctx.font = "600 " + fs + "px system-ui, -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(list[i].label), p[0], p[1] + fs * 0.06);
    }
  };

  MapView.prototype.pathShore = function (ctx, i) {
    var pts = this.shore[i].pts, m = pts.length / 2, j, p;
    ctx.beginPath();
    for (j = 0; j < m; j++) {
      p = this.px(pts[j * 2], pts[j * 2 + 1]);
      if (j === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]);
    }
    ctx.closePath();
  };


  // ---- hover readout -------------------------------------------------
  // One tooltip is shared by every map. fmt(cell) returns the text, or null
  // to say there is nothing to report at that cell.
  var TIP = null;

  function tip() {
    if (!TIP) {
      TIP = document.createElement("div");
      TIP.className = "maptip";
      TIP.style.display = "none";
      document.body.appendChild(TIP);
    }
    return TIP;
  }

  function showTip(html, x, y) {
    var t = tip();
    t.innerHTML = html;
    t.style.display = "block";
    var w = t.offsetWidth, h = t.offsetHeight;
    t.style.left = Math.min(x + 14, window.innerWidth - w - 8) + "px";
    t.style.top = (y - h - 12 < 4 ? y + 18 : y - h - 12) + "px";
  }

  function hideTip() { if (TIP) TIP.style.display = "none"; }

  MapView.prototype.onHover = function (fmt) {
    var self = this, c = this.canvas;
    this._fmt = fmt;
    if (this._hoverBound) return;
    this._hoverBound = true;
    c.addEventListener("mousemove", function (ev) {
      if (!self._fmt) { hideTip(); return; }
      var r = c.getBoundingClientRect(),
        px = (ev.clientX - r.left) * c.width / r.width,
        py = (ev.clientY - r.top) * c.height / r.height,
        cell = self.pick(px, py),
        txt = cell === null ? null : self._fmt(cell);
      if (!txt) { hideTip(); return; }
      showTip(txt, ev.clientX, ev.clientY);
    });
    c.addEventListener("mouseleave", hideTip);
    c.addEventListener("mousedown", hideTip);
  };

  // Size a canvas for the display's pixel density. Without this a retina
  // screen stretches every drawing and the whole map looks soft.
  function fitCanvas(canvas, cssW, cssH) {
    var dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    return dpr;
  }

  // A horizontal colour bar drawn into its own small canvas. `fmt` turns a
  // value into its end label, so a bar can read in the user's own unit.
  function colourbar(canvas, vmin, vmax, label, fmt) {
    fmt = fmt || function (v) { return v.toFixed(2); };
    var cssW = canvas.clientWidth || 380, cssH = 32;
    var dpr = fitCanvas(canvas, cssW, cssH);
    var ctx = canvas.getContext("2d"), w = canvas.width,
      barH = Math.round(13 * dpr), i, rgb;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (i = 0; i < w; i++) {
      rgb = ramp(i / (w - 1));
      ctx.fillStyle = "rgb(" + rgb.map(Math.round).join(",") + ")";
      ctx.fillRect(i, 0, 1, barH);
    }
    ctx.strokeStyle = "#9a9a96";
    ctx.lineWidth = Math.max(1, dpr * 0.5);
    ctx.strokeRect(0.5, 0.5, w - 1, barH - 1);
    ctx.fillStyle = "#3a3a3a";
    ctx.font = Math.round(10.5 * dpr) + "px system-ui, -apple-system, sans-serif";
    ctx.textBaseline = "top";
    var y = barH + 4 * dpr;
    ctx.textAlign = "left";
    ctx.fillText(fmt(vmin), 0, y);
    ctx.textAlign = "right";
    ctx.fillText(fmt(vmax), w, y);
    // only draw the centre label when it will not collide with the ends
    var endW = Math.max(ctx.measureText(fmt(vmin)).width,
                        ctx.measureText(fmt(vmax)).width);
    if (ctx.measureText(label).width < w - 2.4 * endW - 16 * dpr) {
      ctx.textAlign = "center";
      ctx.fillText(label, w / 2, y);
    }
  }

  global.hideTip = hideTip;
  global.MapView = MapView;
  global.colourbar = colourbar;
  global.fitCanvas = fitCanvas;
  global.viridis = ramp;
})(window);
