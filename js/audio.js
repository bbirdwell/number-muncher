/* audio.js — synthesized sound via Web Audio (scope decision 2). No asset
 * files. The AudioContext is created/resumed inside the first user gesture
 * (decision 9) — call unlock() from the start button handler. Every play
 * function is a no-op until unlocked, and when muted.
 */
(function () {
  'use strict';

  var ctx = null;
  var muted = false;

  function unlock() {
    try {
      if (!ctx) {
        var AC = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!AC) return; // no Web Audio: game continues silent
        ctx = new AC();
      }
      if (ctx.state === 'suspended') ctx.resume();
    } catch (e) {
      ctx = null;
    }
  }

  function setMuted(m) { muted = !!m; }

  function ready() { return ctx && ctx.state === 'running' && !muted; }

  function tone(freq, startIn, dur, type, gainPeak, freqEnd) {
    if (!ready()) return;
    var t0 = ctx.currentTime + startIn;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = type || 'square';
    osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(gainPeak || 0.15, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function noise(startIn, dur, gainPeak) {
    if (!ready()) return;
    var t0 = ctx.currentTime + startIn;
    var len = Math.floor(ctx.sampleRate * dur);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var src = ctx.createBufferSource();
    src.buffer = buf;
    var gain = ctx.createGain();
    gain.gain.setValueAtTime(gainPeak || 0.2, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    var filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 2200;
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start(t0);
  }

  var api = {
    unlock: unlock,
    setMuted: setMuted,
    // the crunch you can feel: noise burst + falling blip
    crunch: function () { noise(0, 0.09, 0.25); tone(300, 0, 0.08, 'square', 0.12, 140); },
    buzz: function () { tone(110, 0, 0.28, 'sawtooth', 0.12, 90); },
    click: function () { tone(500, 0, 0.04, 'square', 0.05); },
    hit: function () { tone(220, 0, 0.12, 'square', 0.14, 70); noise(0.02, 0.15, 0.15); },
    extraLife: function () { tone(660, 0, 0.09, 'triangle', 0.12); tone(880, 0.09, 0.14, 'triangle', 0.12); },
    fanfare: function () {
      tone(523, 0, 0.11, 'triangle', 0.13);
      tone(659, 0.11, 0.11, 'triangle', 0.13);
      tone(784, 0.22, 0.11, 'triangle', 0.13);
      tone(1047, 0.33, 0.24, 'triangle', 0.15);
    },
    timeUp: function () { tone(392, 0, 0.15, 'triangle', 0.12); tone(262, 0.16, 0.3, 'triangle', 0.12); }
  };

  globalThis.NMAudio = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
