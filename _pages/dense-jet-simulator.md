---
layout: single
title: "Dense Jet Simulator"
permalink: /dense-jet-simulator/
author_profile: false
---

<div class="jet-app" id="jet-app">
  <div class="jet-controls" role="group" aria-label="Dense jet controls">
    <div class="jet-control">
      <label for="angle">Release Angle: <span id="angle-value">60</span> deg</label>
      <input id="angle" type="range" min="5" max="85" step="1" value="60" />
    </div>
    <div class="jet-control">
      <label for="speed">Jet Speed (m/s): <span id="speed-value">2.0</span></label>
      <input id="speed" type="range" min="0.5" max="4.0" step="0.1" value="2.0" />
    </div>
    <div class="jet-control">
      <label for="buoyancy">Negative Buoyancy g' (m/s^2): <span id="buoyancy-value">0.25</span></label>
      <input id="buoyancy" type="range" min="0.05" max="0.60" step="0.01" value="0.25" />
    </div>
    <div class="jet-control">
      <label for="crossflow">Ambient Crossflow (m/s): <span id="crossflow-value">0.35</span></label>
      <input id="crossflow" type="range" min="0.00" max="1.20" step="0.01" value="0.35" />
    </div>
    <div class="jet-control jet-actions">
      <button id="toggle-run" type="button">Pause</button>
      <button id="reset" type="button">Reset</button>
    </div>
  </div>

  <div class="jet-canvas-wrap">
    <canvas id="jet-canvas" width="1400" height="800" aria-label="Dense jet animation"></canvas>
    <div class="jet-metrics" id="jet-metrics"></div>
  </div>
</div>

<style>
  .jet-app {
    display: grid;
    gap: 1.25rem;
  }

  .jet-controls {
    display: grid;
    gap: 0.75rem;
    padding: 0.9rem;
    border: 1px solid #d2d9e6;
    border-radius: 6px;
    background: #f8fafc;
  }

  .jet-control {
    display: grid;
    gap: 0.3rem;
  }

  .jet-control label {
    margin: 0;
    color: #243042;
    font-weight: 600;
    font-size: 0.95rem;
  }

  .jet-control input[type="range"] {
    width: 100%;
  }

  .jet-actions {
    grid-template-columns: repeat(2, minmax(110px, 160px));
  }

  .jet-actions button {
    border: 1px solid #3f5f8a;
    background: #4f709c;
    color: #ffffff;
    padding: 0.45rem 0.7rem;
    border-radius: 6px;
    font-weight: 600;
    cursor: pointer;
  }

  .jet-actions button:hover {
    background: #3f5f8a;
  }

  .jet-canvas-wrap {
    position: relative;
    border: 1px solid #c6cedd;
    border-radius: 6px;
    overflow: hidden;
    background: #ffffff;
    min-height: 420px;
  }

  #jet-canvas {
    display: block;
    width: 100%;
    height: 100%;
    min-height: 420px;
    aspect-ratio: 8 / 5;
    background: linear-gradient(to bottom, #f1f6fb, #dbe8f6);
  }

  .jet-metrics {
    display: none;
  }

  @media (min-width: 960px) {
    .jet-app {
      grid-template-columns: minmax(220px, 280px) minmax(0, 1fr);
      align-items: start;
    }
  }
</style>
