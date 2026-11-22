/* RoofTrace Pro iPhone app (App Store build). Loaded on every page; does nothing
 * in a normal browser. Plans are bought on the website only, so the app hides
 * upgrade links (Apple rule 3.1.3). Exposes window.rtNative for LiDAR scanning. */
(function () {
  var inApp = /RoofTraceProApp\//.test(navigator.userAgent || '');
  window.rtNative = {
    inApp: inApp,
    plugin: function () {
      var Cap = window.Capacitor;
      if (!Cap || !Cap.isNativePlatform || !Cap.isNativePlatform()) return null;
      return (Cap.Plugins && Cap.Plugins.RoomScan) || (Cap.registerPlugin && Cap.registerPlugin('RoomScan')) || null;
    },
    /** { supported: bool } — LiDAR + RoomPlan available on this iPhone */
    isSupported: async function () {
      var p = this.plugin(); if (!p) return false;
      try { return !!(await p.isSupported()).supported; } catch (e) { return false; }
    },
    /** Opens the full-screen LiDAR scanner. Resolves { scan, counts } or null when cancelled. */
    scan: async function () {
      var p = this.plugin(); if (!p) throw new Error('Room scanning needs the RoofTrace Pro iPhone app.');
      var r = await p.scan();
      return r && r.cancelled ? null : r;
    },
  };
  if (!inApp) return;
  var root = document.documentElement;
  root.classList.add('native-app');
  var css = document.createElement('style');
  css.textContent = 'html.native-app a[href^="/upgrade"],html.native-app a[href^="upgrade"],html.native-app [data-hide-in-app]{display:none!important}';
  (document.head || root).appendChild(css);
})();
