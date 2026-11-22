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
  css.textContent = 'html.native-app a[href^="/upgrade"],html.native-app a[href^="upgrade"],html.native-app a[href*="#pricing"],html.native-app [data-hide-in-app]{display:none!important}';
  (document.head || root).appendChild(css);

  // The app is free: strip any price or upgrade wording that pages or server
  // messages put on screen (purchases happen only on the website).
  var PRICE = /\s*(starting at|from)?\s*\$\s?\d[\d,]*(\.\d+)?\s*(\/|per)\s*(mo|month|yr|year)\b\)?/gi;
  var UPSELL = /\s*(→\s*)?\b(Upgrade|Subscribe)\b[^.!?\n]*[.!?→]?/g;
  function scrubText(node) {
    var t = node.nodeValue;
    if (!t || (t.indexOf('$') < 0 && !/Upgrade|Subscribe/.test(t))) return;
    var n = t.replace(PRICE, '').replace(UPSELL, '').replace(/\(\s*\)/g, '');
    if (n !== t) node.nodeValue = n;
  }
  function scrub(rootNode) {
    if (!rootNode) return;
    if (rootNode.nodeType === 3) return scrubText(rootNode);
    if (rootNode.nodeType !== 1 || /^(SCRIPT|STYLE|TEXTAREA|INPUT)$/.test(rootNode.nodeName)) return;
    var w = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT, null);
    var x; while ((x = w.nextNode())) scrubText(x);
  }
  function start() {
    scrub(document.body);
    new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        if (m.type === 'characterData') scrubText(m.target);
        m.addedNodes && m.addedNodes.forEach(scrub);
      });
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
