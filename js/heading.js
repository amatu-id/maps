// Amatu Maps · compass: absolute heading of the phone (Android "deviceorientationabsolute", iOS webkitCompassHeading),
// low-pass filtered, plus the angle helpers the animation loops use. Angles: degrees clockwise from north.
(function () {
  'use strict';
  const AM = window.AM = window.AM || {};
  const rad = Math.PI / 180;
  const norm = a => ((a % 360) + 360) % 360;
  const diff = (a, b) => ((b - a) % 360 + 540) % 360 - 180;          // shortest turn a → b (−180…180)
  function screenAngle() {
    const o = screen.orientation;
    const a = o && typeof o.angle === 'number' ? o.angle : typeof window.orientation === 'number' ? window.orientation : 0;
    return norm(a);
  }
  // Heading of the way the user faces from the absolute rotation (alpha, beta, gamma; W3C R = Rz·Rx·Ry, world = east,
  // north, up): the screen's "up" axis while the phone lies flat, the back camera while it is held upright, and the sum
  // of both in between — they point the same way, so the heading stays steady through every tilt.
  function fromEuler(al, be, ga, sa) {
    const a = al * rad, b = be * rad, g = ga * rad;
    const ca = Math.cos(a), sA = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cg = Math.cos(g), sg = Math.sin(g);
    const xe = ca * cg - sA * sb * sg, xn = sA * cg + ca * sb * sg;        // device x (right edge)
    const ye = -sA * cb, yn = ca * cb;                                      // device y (top edge)
    const ze = ca * sg + sA * sb * cg, zn = sA * sg - ca * sb * cg;        // device z (out of the screen)
    const s = Math.sin(sa * rad), c = Math.cos(sa * rad);
    const e = s * xe + c * ye - ze, n = s * xn + c * yn - zn;              // screen up (after rotation) + back camera
    if (e * e + n * n < 1e-6) return NaN;
    return norm(Math.atan2(e, n) / rad);
  }

  const H = AM.H = {
    raw: NaN, t: 0, acc: NaN, src: '', started: false, perm: '', sx: 0, sy: 0, onchange: null,
    norm, diff,
    start() {
      if (H.started) return;
      H.started = true;
      if ('ondeviceorientationabsolute' in window) addEventListener('deviceorientationabsolute', H.ev, true);
      addEventListener('deviceorientation', H.ev, true);       // iOS (webkitCompassHeading), Firefox (absolute flag)
    },
    ev(e) {
      let hd = NaN, src = '';
      if (e.webkitCompassHeading != null && isFinite(e.webkitCompassHeading) && e.webkitCompassHeading >= 0) {
        hd = norm(e.webkitCompassHeading + screenAngle()); src = 'ios';
        H.acc = e.webkitCompassAccuracy != null ? +e.webkitCompassAccuracy : NaN;
      } else if ((e.type === 'deviceorientationabsolute' || e.absolute === true) && e.alpha != null) {
        if (e.type === 'deviceorientation' && H.src === 'abs' && performance.now() - H.t < 500) return;
        hd = fromEuler(e.alpha, e.beta || 0, e.gamma || 0, screenAngle()); src = 'abs';
      } else return;
      if (!isFinite(hd)) return;
      const now = performance.now(), x = Math.cos(hd * rad), y = Math.sin(hd * rad);
      // light low-pass on the unit vector (no jump at 359°→0°); readings come at 20–60 Hz
      if (!H.t || now - H.t > 800) { H.sx = x; H.sy = y; }
      else { const k = 0.35; H.sx += (x - H.sx) * k; H.sy += (y - H.sy) * k; }
      H.raw = norm(Math.atan2(H.sy, H.sx) / rad);
      H.t = now; H.src = src;
      if (H.onchange) H.onchange(H.raw);
    },
    fresh(ms = 1500) { return isFinite(H.raw) && performance.now() - H.t < ms; },
    // iOS 13+ shows a permission prompt, and only from inside a tap: call this first thing in a click handler
    need() { return typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function'; },
    ask() {
      H.start();
      if (!H.need() || H.perm === 'granted') return Promise.resolve(true);
      let p;
      try { p = DeviceOrientationEvent.requestPermission(); } catch (e) { return Promise.resolve(false); }
      return Promise.resolve(p).then(r => { H.perm = r; if (r === 'granted') AM.U.set('pt.maps.cmp', 1); return r === 'granted'; }).catch(() => false);
    },
    // move angle `cur` toward `to` with time constant tau (ms) — frame-rate independent
    approach(cur, to, dt, tau) {
      if (!isFinite(to)) return cur;
      if (!isFinite(cur) || tau <= 0) return norm(to);
      return norm(cur + diff(cur, to) * (1 - Math.exp(-dt / tau)));
    },
    poor() { return H.src === 'ios' && (H.acc < 0 || H.acc > 30); },
  };
  // a second visit after the user allowed the compass: start it again on the first tap (iOS forgets per page load)
  if (H.need() && AM.U && AM.U.get('pt.maps.cmp', 0)) {
    const once = () => { removeEventListener('touchend', once, true); removeEventListener('click', once, true); H.ask(); };
    addEventListener('touchend', once, true); addEventListener('click', once, true);
  }
})();
