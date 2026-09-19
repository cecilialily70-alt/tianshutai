// 防指纹 / 反检测预加载脚本（sandbox 兼容，仅 require electron）
//
// 传参方式已升级：不再通过主进程「字符串占位符 + 临时文件」注入（多窗口竞态、时序不稳），
// 改为在创建 BrowserView 时通过 webPreferences.additionalArguments 传入：
//   --geo-timezone=Asia/Hong_Kong
//   --geo-language=zh-HK
//   --geo-webrtc=filtered|disabled
// 本脚本启动时从 process.argv 解析，再通过 webFrame.executeJavaScriptInIsolatedWorld(0, ...)
// 注入主世界（Main World），在任何页面脚本执行前运行。
const { webFrame } = require('electron');

function readArg(prefix) {
  try {
    const argv = process && process.argv;
    if (Array.isArray(argv)) {
      for (const item of argv) {
        if (typeof item === 'string' && item.startsWith(prefix)) return item.slice(prefix.length);
      }
    }
  } catch (e) { /* 忽略 */ }
  return '';
}

const GEO_TZ = readArg('--geo-timezone=');
const GEO_LANG = readArg('--geo-language=') || 'zh-CN';
const GEO_RTC = readArg('--geo-webrtc=') || 'filtered';

// 目标 Chrome 版本（须与 Electron 内置 Chromium 及 session.setUserAgent 保持一致）
const CHROME_MAJOR = '152';
const CHROME_FULL = '152.0.0.0';

const STEALTH = `(function () {
  'use strict';
  var KEY = Symbol.for('__tst_stealth_v2');
  var TZ = ${JSON.stringify(GEO_TZ)};
  var LANG = ${JSON.stringify(GEO_LANG)};
  var RTC_MODE = ${JSON.stringify(GEO_RTC)};

  var V = '${CHROME_MAJOR}';
  var FULL = '${CHROME_FULL}';
  var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/' + FULL + ' Safari/537.36';

  // ─────────────────────────────────────────────────────────────
  // 顶层无痕基础设施：原生函数伪装 + CDP 清理 + 错误堆栈抹除
  // （提升到 applyStealth 之外，供主窗口与 iframe 递归注入共用）
  // ─────────────────────────────────────────────────────────────
  var NATIVE_FN = Symbol.for('__tst_native_fn');
  function makeNative(fn, str) {
    try {
      if (typeof fn !== 'function') return fn;
      Object.defineProperty(fn, NATIVE_FN, { value: str, configurable: false });
      try {
        var nm = str.split('(')[0].replace(/^function\\s+|^get\\s+|^set\\s+/, '').trim();
        if (nm) Object.defineProperty(fn, 'name', { value: nm, configurable: true });
      } catch (e) {}
    } catch (e) {}
    return fn;
  }
  var nativeFn = function (name, fn) { return makeNative(fn, 'function ' + name + '() { [native code] }'); };
  var nativeGetter = function (name, fn) { return makeNative(fn, 'get ' + name + '() { [native code] }'); };
  try {
    var __origFToString = Function.prototype.toString;
    var FToStringProxy = new Proxy(__origFToString, {
      apply: function (target, thisArg, args) {
        try {
          if (thisArg === FToStringProxy) return 'function toString() { [native code] }';
          if (thisArg && thisArg[NATIVE_FN]) return thisArg[NATIVE_FN];
        } catch (e) {}
        return Reflect.apply(target, thisArg, args);
      }
    });
    Function.prototype.toString = FToStringProxy;
  } catch (e) {}

  // 扫雷式清理 CDP / 自动化控制变量（cdc_* 与 webdriver）
  function cleanupCdc(win) {
    try {
      var names = [];
      try { names = Object.getOwnPropertyNames(win); } catch (e) {}
      for (var i = 0; i < names.length; i++) {
        var k = names[i];
        if (/^cdc_[a-zA-Z0-9]+_/.test(k) || k === 'webdriver') {
          try { delete win[k]; } catch (e) {}
        }
      }
      try {
        for (var k2 in win) {
          if (/^cdc_[a-zA-Z0-9]+_/.test(k2)) { try { delete win[k2]; } catch (e) {} }
        }
      } catch (e) {}
    } catch (e) {}
  }

  // 错误堆栈抹除：剔除注入脚本（stealth / tst://stealth / 匿名帧）痕迹
  function maskStack(err) {
    try {
      if (err && typeof err.stack === 'string') {
        err.stack = err.stack.split('\\n').filter(function (line) {
          if (line.indexOf('stealth-preload') >= 0) return false;
          if (line.indexOf('tst://stealth') >= 0) return false;
          if (line.indexOf('applyStealth') >= 0) return false;
          if (line.indexOf('getImageData (<anonymous>)') >= 0) return false;
          return true;
        }).join('\\n');
      }
    } catch (e) {}
    return err;
  }

  // ─────────────────────────────────────────────────────────────
  // 核心：applyStealth(win) 对任意窗口（主窗口 / iframe.contentWindow）应用全套伪装。
  // 使用 Symbol.for 作跨 realm 标记，保证同一窗口只注入一次。
  // ─────────────────────────────────────────────────────────────
  function applyStealth(win) {
    if (!win) return;
    try {
      if (win[KEY]) return;
      Object.defineProperty(win, KEY, { value: 1, configurable: false, writable: false, enumerable: false });
    } catch (e) { try { win[KEY] = 1; } catch (e2) {} }

    // 进入即扫雷：清理 CDP 变量与 webdriver（iframe 同样生效）
    cleanupCdc(win);

    var nav = win.navigator;
    var IntlObj = win.Intl;
    var doc = win.document;

    // 捕获原生 Intl.DateTimeFormat（必须先于任何包装），供时区换算使用
    var __origDTF = IntlObj && IntlObj.DateTimeFormat ? IntlObj.DateTimeFormat : null;

    // 让 iframe 的 Function.prototype.toString 也走主世界的无痕代理
    try { win.Function.prototype.toString = FToStringProxy; } catch (e) {}

    // 解析 Navigator 原型：优先 win.Navigator，否则取 navigator 的 [[Prototype]]
    var NavProto = null;
    try { NavProto = win.Navigator && win.Navigator.prototype ? win.Navigator.prototype : null; } catch (e) {}
    if (!NavProto) { try { NavProto = Object.getPrototypeOf(nav); } catch (e) {} }

    var lang = LANG || 'zh-CN';
    var langBase = String(lang).split('-')[0] || lang;
    var langs = [lang];
    if (langBase !== lang) langs.push(langBase);
    langs.push('en-US', 'en');
    var __seenL = {};
    langs = langs.filter(function (l) { if (__seenL[l]) return false; __seenL[l] = 1; return true; });

    var defineReadOnly = function (obj, prop, getter) {
      try { Object.defineProperty(obj, prop, { get: nativeGetter(prop, getter), enumerable: false, configurable: true }); } catch (e) {}
    };
    // 同时打到 Navigator.prototype 与实例上，贴近真实 Chrome（属性挂在原型上）
    var patchNav = function (prop, getter) {
      var g = nativeGetter(prop, getter);
      if (NavProto) { try { Object.defineProperty(NavProto, prop, { get: g, enumerable: false, configurable: true }); } catch (e) {} }
      try { Object.defineProperty(nav, prop, { get: g, enumerable: false, configurable: true }); } catch (e) {}
    };

    // ── 1. webdriver（抹除自动化痕迹，根治底层 Descriptor）──
    // 先删实例自身可能存在的 value 属性，再在原型与实例上重写 getter 为 undefined，
    // 确保无论检测方走「原型链」还是「own property descriptor」都拿到 undefined。
    var wdUndef = nativeGetter('webdriver', function () { return undefined; });
    try { delete nav.webdriver; } catch (e) {}
    try { Object.defineProperty(NavProto, 'webdriver', { get: wdUndef, enumerable: false, configurable: true }); } catch (e) {}
    try { Object.defineProperty(nav, 'webdriver', { get: wdUndef, enumerable: false, configurable: true }); } catch (e) {}

    // ── 2. navigator 身份 ──
    patchNav('userAgent', function () { return UA; });
    patchNav('appVersion', function () { return '5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/' + FULL + ' Safari/537.36'; });
    patchNav('platform', function () { return 'Win32'; });
    patchNav('vendor', function () { return 'Google Inc.'; });
    patchNav('vendorSub', function () { return ''; });
    patchNav('product', function () { return 'Gecko'; });
    patchNav('productSub', function () { return '20030107'; });
    patchNav('appName', function () { return 'Netscape'; });
    patchNav('appCodeName', function () { return 'Mozilla'; });
    patchNav('hardwareConcurrency', function () { return 8; });
    patchNav('deviceMemory', function () { return 8; });
    patchNav('maxTouchPoints', function () { return 0; });
    patchNav('doNotTrack', function () { return null; });
    patchNav('javaEnabled', function () { return function () { return false; }; });
    defineReadOnly(nav, 'cookieEnabled', function () { return true; });

    // ── 3. 语言：Navigator.prototype 上的 getter（防御原型链探测）──
    patchNav('language', function () { return lang; });
    patchNav('languages', function () { return langs.slice(); });

    // ── 4. plugins / mimeTypes ──
    var mkPlugin = function (name, filename, desc) {
      return { name: name, filename: filename, description: desc || name, length: 1, item: function () { return null; }, namedItem: function () { return null; } };
    };
    var fakePlugins = [
      mkPlugin('Chrome PDF Plugin', 'internal-pdf-viewer', 'Portable Document Format'),
      mkPlugin('Chrome PDF Viewer', 'mhjfbmdgcfjbbpaeojofohoefgiehjai', ''),
      mkPlugin('Native Client', 'internal-nacl-plugin', '')
    ];
    try {
      Object.defineProperty(nav, 'plugins', {
        get: function () { return Object.setPrototypeOf(fakePlugins.slice(), (typeof PluginArray !== 'undefined' ? PluginArray.prototype : Object.prototype)); },
        configurable: false
      });
    } catch (e) {}
    try {
      var fakeMime = { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' };
      Object.defineProperty(nav, 'mimeTypes', {
        get: function () { return Object.setPrototypeOf([fakeMime], (typeof MimeTypeArray !== 'undefined' ? MimeTypeArray.prototype : Object.prototype)); },
        configurable: false
      });
    } catch (e) {}

    // ── 5. navigator.userAgentData ──
    var brands = [
      { brand: 'Google Chrome', version: V },
      { brand: 'Chromium', version: V },
      { brand: 'Not)A;Brand', version: '99' }
    ];
    var fullList = [
      { brand: 'Google Chrome', version: FULL },
      { brand: 'Chromium', version: FULL },
      { brand: 'Not)A;Brand', version: '99.0.0.0' }
    ];
    var uaData = {
      brands: brands,
      mobile: false,
      platform: 'Windows',
      getHighEntropyValues: nativeFn('getHighEntropyValues', function () {
        return Promise.resolve({ brands: brands, mobile: false, platform: 'Windows', platformVersion: '10.0.0', architecture: 'x86', bitness: '64', model: '', uaFullVersion: FULL, fullVersionList: fullList });
      }),
      toJSON: nativeFn('toJSON', function () { return { brands: brands, mobile: false, platform: 'Windows' }; })
    };
    try { Object.defineProperty(nav, 'userAgentData', { get: nativeGetter('userAgentData', function () { return uaData; }), enumerable: true, configurable: false }); } catch (e) {}

    // ── 6. window.chrome 存根 ──
    try {
      if (!win.chrome) win.chrome = {};
      var chrome = win.chrome;
      if (!chrome.runtime) {
        chrome.runtime = {
          id: undefined,
          lastError: undefined,
          connect: nativeFn('connect', function () { return { onDisconnect: { addListener: function () {} }, onMessage: { addListener: function () {} }, postMessage: function () {}, disconnect: function () {} }; }),
          sendMessage: nativeFn('sendMessage', function () {}),
          onMessage: { addListener: function () {}, removeListener: function () {} },
          onConnect: { addListener: function () {} },
          onInstalled: { addListener: function () {} },
          getManifest: nativeFn('getManifest', function () { return {}; }),
          getURL: nativeFn('getURL', function (p) { return 'chrome-extension://' + p; })
        };
      }
      if (!chrome.loadTimes) {
        chrome.loadTimes = nativeFn('loadTimes', function () {
          var t = Date.now() / 1000;
          return { requestTime: t, startLoadTime: t, commitLoadTime: t, finishDocumentLoadTime: t, finishLoadTime: t, firstPaintTime: t, firstPaintAfterLoadTime: 0, navigationType: 'Other', wasFetchedViaSpdy: false, wasNpnNegotiated: true, npnNegotiatedProtocol: 'h2', wasAlternateProtocolAvailable: false, connectionInfo: 'h2' };
        });
      }
      if (!chrome.csi) chrome.csi = nativeFn('csi', function () { return { startE: Date.now(), onloadT: Date.now(), pageT: 0, tran: 15 }; });
      if (!chrome.app) {
        chrome.app = { isInstalled: false, getDetails: function () { return null; }, getIsInstalled: function () { return false; }, installState: function () { return 'not_installed'; }, runningState: function () { return 'cannot_run'; }, InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' }, RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' } };
      }
    } catch (e) {}

    // ── 7. 移除 Electron 痕迹 ──
    ['process', 'require', 'module', 'exports', 'Buffer', '__dirname', '__filename', 'global'].forEach(function (k) {
      try { delete win[k]; } catch (e) {}
      try { Object.defineProperty(win, k, { get: function () { return undefined; }, configurable: true }); } catch (e) {}
    });

    // ── 8. WebGL 指纹 ──
    try {
      var GL_VENDOR = 0x1F00, GL_RENDERER = 0x1F01, GL_UNMASKED_VENDOR = 0x9245, GL_UNMASKED_RENDERER = 0x9246;
      var spoofCtx = function (ctx) {
        if (!ctx) return;
        try {
          var orig = ctx.getParameter.bind(ctx);
          ctx.getParameter = function (p) {
            if (p === GL_VENDOR) return 'Google Inc. (Intel)';
            if (p === GL_RENDERER) return 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)';
            if (p === GL_UNMASKED_VENDOR) return 'Google Inc. (Intel)';
            if (p === GL_UNMASKED_RENDERER) return 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)';
            return orig(p);
          };
        } catch (e) {}
        try {
          var origExt = ctx.getExtension.bind(ctx);
          ctx.getExtension = function (name) {
            if (name === 'WEBGL_debug_renderer_info') {
              return { UNMASKED_VENDOR_WEBGL: GL_UNMASKED_VENDOR, UNMASKED_RENDERER_WEBGL: GL_UNMASKED_RENDERER };
            }
            return origExt(name);
          };
        } catch (e) {}
      };
      var origGetContext = win.HTMLCanvasElement.prototype.getContext;
      win.HTMLCanvasElement.prototype.getContext = nativeFn('getContext', function (type) {
        var args = Array.prototype.slice.call(arguments);
        var ctx = origGetContext.apply(this, args);
        if (type === 'webgl' || type === 'experimental-webgl' || type === 'webgl2') spoofCtx(ctx);
        return ctx;
      });
    } catch (e) {}

    // ── 9. Canvas 指纹：确定性加噪（Deterministic Noise，无任何 Math.random）──
    // 真实硬件对同一绘图总是输出完全相同的像素/哈希；因此加噪必须严格确定：
    // 相同输入 → 100% 相同输出，绝不随调用次数变化。
    try {
      // 固定 Magic Number：仅 +1，且仅对 R 通道中满足固定步长的像素生效（与像素坐标无关的稳定扰动）
      var __MAGIC = 1;

      var __noiseImageData = function (imageData) {
        try {
          var d = imageData && imageData.data;
          if (!d) return imageData;
          for (var i = 0; i < d.length; i += 4) {
            if ((i % 17) === 0) {
              d[i] = (d[i] + __MAGIC) & 0xFF; // 仅 R 通道，+1 固定偏移（wrap 到 0-255）
            }
          }
        } catch (e) {}
        return imageData;
      };

      // 劫持 getImageData：读取像素时确定性加噪；抛错时抹除堆栈痕迹（Stack Trace Masking）
      var Ctx2D = win.CanvasRenderingContext2D;
      if (Ctx2D && Ctx2D.prototype && Ctx2D.prototype.getImageData) {
        var __origGetImageData = Ctx2D.prototype.getImageData;
        Ctx2D.prototype.getImageData = nativeFn('getImageData', function (x, y, w, h) {
          try {
            var imageData = __origGetImageData.apply(this, arguments);
            return __noiseImageData(imageData);
          } catch (err) {
            throw maskStack(err);
          }
        });
      }

      // 劫持 toDataURL：确定性加噪（函数已通过 makeNative 伪装为原生）；抛错时同样抹除堆栈
      var __origToDataURL = win.HTMLCanvasElement.prototype.toDataURL;
      win.HTMLCanvasElement.prototype.toDataURL = nativeFn('toDataURL', function (type, quality) {
        try {
          var r = __origToDataURL.apply(this, arguments);
          try {
            if (typeof r === 'string' && r.indexOf('data:image/png') === 0) {
              var b64 = r.split(',')[1] || '';
              if (b64.length > 10) {
                var c = b64.charAt(b64.length - 1);
                var d = b64.slice(0, -1) + (c === 'A' ? 'B' : 'A');
                return 'data:image/png;base64,' + d;
              }
            }
          } catch (e) {}
          return r;
        } catch (err) {
          throw maskStack(err);
        }
      });
    } catch (e) {}

    // ── 10. Audio 指纹轻噪声 ──
    try {
      var origGetChannelData = win.AudioBuffer.prototype.getChannelData;
      win.AudioBuffer.prototype.getChannelData = nativeFn('getChannelData', function (channel) {
        var arr = origGetChannelData.call(this, channel);
        if (arr && arr.length > 0) arr[0] = arr[0] + 1e-7;
        return arr;
      });
    } catch (e) {}

    // ── 11. Permissions API（伪装无头/自动化环境的权限行为）──
    try {
      if (nav.permissions && nav.permissions.query) {
        var origQuery = nav.permissions.query.bind(nav.permissions);
        nav.permissions.query = nativeFn('query', function (params) {
          try {
            if (params && params.name === 'notifications') {
              // 全新真实 Chrome 配置下通知未授权，state 应为 'default'；
              // 强制返回 'default'，避免 Electron 已授权状态泄露自动化/无头特征。
              return Promise.resolve({ state: 'default', onchange: null });
            }
          } catch (e) {}
          return origQuery(params);
        });
      }
    } catch (e) {}

    // ── 12. Notification 兜底 ──
    try { if (!win.Notification) win.Notification = { permission: 'default' }; } catch (e) {}

    // ── 13. WebRTC IP 泄露防护 ──
    // RTC_MODE='disabled'：彻底置空 RTCPeerConnection（100% 不漏 IP，语音/视频通话失效）。
    // RTC_MODE='filtered'：剥离 host/srflx 候选，仅保留 mDNS(.local) 与 relay。
    try {
      if (RTC_MODE === 'disabled') {
        var rtcProps = ['RTCPeerConnection', 'webkitRTCPeerConnection', 'mozRTCPeerConnection'];
        for (var ri = 0; ri < rtcProps.length; ri++) {
          try { Object.defineProperty(win, rtcProps[ri], { value: undefined, configurable: true, writable: false }); } catch (e) {}
        }
      } else {
        var __origRtc = win.RTCPeerConnection;
        if (__origRtc) {
          var stripCandidate = function (candStr) {
            try {
              if (!candStr || candStr.indexOf('candidate:') < 0) return candStr;
              if (/\\.local\\b/.test(candStr)) return candStr; // mDNS 保留
              var parts = String(candStr).split(/\\s+/);
              var typIdx = parts.indexOf('typ');
              if (typIdx >= 0 && typIdx + 1 < parts.length) {
                var typ = parts[typIdx + 1];
                if (typ === 'host' || typ === 'srflx') return '';
              }
              return candStr;
            } catch (e) { return candStr; }
          };
          var wrapSet = function (obj, key) {
            try {
              if (!obj || !obj[key]) return;
              var orig = obj[key].bind(obj);
              obj[key] = function (desc) {
                try {
                  if (desc && desc.sdp) {
                    desc.sdp = desc.sdp.replace(/(candidate:[^\\r\\n]+)/g, function (m) { return stripCandidate(m); });
                  }
                } catch (e) {}
                return orig(desc);
              };
            } catch (e) {}
          };
          win.RTCPeerConnection = function () {
            var pc = new __origRtc(Array.prototype.slice.call(arguments));
            try { wrapSet(pc, 'setLocalDescription'); } catch (e) {}
            try { wrapSet(pc, 'setRemoteDescription'); } catch (e) {}
            try {
              var origAdd = pc.addIceCandidate.bind(pc);
              pc.addIceCandidate = function (cand) {
                try { if (cand && cand.candidate && stripCandidate(cand.candidate) === '') return Promise.resolve(); } catch (e) {}
                return origAdd(cand);
              };
            } catch (e) {}
            return pc;
          };
          win.RTCPeerConnection.prototype = __origRtc.prototype;
        }
      }
    } catch (e) {}

    // ── 14. 字体枚举 ──
    try {
      if (doc.fonts && doc.fonts.check) {
        var __origFontCheck = doc.fonts.check.bind(doc.fonts);
        doc.fonts.check = function () { return __origFontCheck.apply(doc.fonts, arguments); };
      }
    } catch (e) {}

    // ── 15. 屏幕 / 窗口尺寸一致性 ──
    try {
      var __innerW = win.innerWidth || 1280;
      var __innerH = win.innerHeight || 720;
      defineReadOnly(win.screen, 'width', function () { return __innerW; });
      defineReadOnly(win.screen, 'height', function () { return __innerH; });
      defineReadOnly(win.screen, 'availWidth', function () { return __innerW; });
      defineReadOnly(win.screen, 'availHeight', function () { return __innerH; });
      defineReadOnly(win.screen, 'colorDepth', function () { return 24; });
      defineReadOnly(win.screen, 'pixelDepth', function () { return 24; });
      defineReadOnly(win, 'outerWidth', function () { return __innerW; });
      defineReadOnly(win, 'outerHeight', function () { return __innerH; });
      defineReadOnly(win, 'devicePixelRatio', function () { return 1; });
    } catch (e) {}

    // ── 16. Network Information API 存根 ──
    try {
      if (!('connection' in nav)) {
        Object.defineProperty(nav, 'connection', {
          get: function () {
            return {
              effectiveType: '4g', rtt: 50, downlink: 10, saveData: false, onchange: null,
              addEventListener: function () {}, removeEventListener: function () {}
            };
          },
          configurable: true
        });
      }
    } catch (e) {}

    // ── 17. Intl 深度伪装：默认 locale 指向目标语言；DateTimeFormat 默认 timeZone ──
    try {
      if (IntlObj) {
        var __intlNames = ['Collator', 'DateTimeFormat', 'NumberFormat', 'PluralRules', 'RelativeTimeFormat', 'ListFormat'];
        var __origIntl = {};
        for (var ii = 0; ii < __intlNames.length; ii++) { __origIntl[__intlNames[ii]] = IntlObj[__intlNames[ii]]; }
        for (var jj = 0; jj < __intlNames.length; jj++) {
          (function (name) {
            var Orig = __origIntl[name];
            if (typeof Orig !== 'function') return;
            var Wrapped = function (locales, options) {
              var loc = (locales === undefined || locales === null || locales === '' ||
                         (Array.isArray(locales) && locales.length === 0)) ? lang : locales;
              var opts = options;
              if (name === 'DateTimeFormat' && TZ) {
                opts = options ? Object.assign({}, options) : {};
                if (!opts.timeZone) opts.timeZone = TZ;
              }
              return new Orig(loc, opts);
            };
            Wrapped.prototype = Orig.prototype;
            try { Wrapped.supportedLocalesOf = function () { return Orig.supportedLocalesOf.apply(Orig, arguments); }; } catch (e) {}
            try { IntlObj[name] = Wrapped; } catch (e) {}
          })(__intlNames[jj]);
        }
        for (var kk = 0; kk < __intlNames.length; kk++) {
          (function (name) {
            try {
              var proto = __origIntl[name] && __origIntl[name].prototype;
              if (!proto || typeof proto.resolvedOptions !== 'function') return;
              var origRO = proto.resolvedOptions;
              proto.resolvedOptions = function () {
                var r = origRO.call(this);
                try { r.locale = lang; } catch (e) {}
                if (name === 'DateTimeFormat' && TZ) { try { r.timeZone = TZ; } catch (e) {} }
                return r;
              };
            } catch (e) {}
          })(__intlNames[kk]);
        }
        try {
          var __origGCL = IntlObj.getCanonicalLocales;
          IntlObj.getCanonicalLocales = function (locales) {
            if (locales === undefined || locales === null || locales === '' ||
                (Array.isArray(locales) && locales.length === 0)) {
              return __origGCL.call(IntlObj, [lang]);
            }
            return __origGCL.apply(IntlObj, arguments);
          };
        } catch (e) {}
      }
    } catch (e) {}

    // ── 18. Date 深度伪装：原型方法级劫持（底层 Getter），与出口 IP 时区对齐 ──
    if (TZ && __origDTF) {
      try {
        var __origGetOffset = win.Date.prototype.getTimezoneOffset;
        var __origToString = win.Date.prototype.toString;
        var __origToTimeString = win.Date.prototype.toTimeString;
        var __origToDateString = win.Date.prototype.toDateString;
        var __origToLocaleString = win.Date.prototype.toLocaleString;
        var __origToLocaleTimeString = win.Date.prototype.toLocaleTimeString;
        var __origToLocaleDateString = win.Date.prototype.toLocaleDateString;
        var __origGetFullYear = win.Date.prototype.getFullYear;
        var __origGetMonth = win.Date.prototype.getMonth;
        var __origGetDate = win.Date.prototype.getDate;
        var __origGetDay = win.Date.prototype.getDay;
        var __origGetHours = win.Date.prototype.getHours;
        var __origGetMinutes = win.Date.prototype.getMinutes;
        var __origGetSeconds = win.Date.prototype.getSeconds;

        var __locParts = function (d) {
          var parts = new __origDTF('en-US', {
            timeZone: TZ, hourCycle: 'h23',
            weekday: 'short', year: 'numeric', month: 'numeric', day: 'numeric',
            hour: 'numeric', minute: 'numeric', second: 'numeric'
          }).formatToParts(d);
          var m = {};
          for (var i = 0; i < parts.length; i++) { var p = parts[i]; if (p.type !== 'literal') m[p.type] = p.value; }
          return m;
        };
        var __WEEKDAY = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
        var __tzOffset = function (d) {
          var m = __locParts(d);
          var asUTC = Date.UTC(+m.year, +m.month - 1, +m.day, +m.hour, +m.minute, +m.second);
          var utc = Math.floor(d.getTime() / 1000) * 1000;
          return Math.round((utc - asUTC) / 60000);
        };

        win.Date.prototype.getTimezoneOffset = function () { try { return __tzOffset(this); } catch (e) { return __origGetOffset.call(this); } };
        win.Date.prototype.getFullYear = function () { try { return +__locParts(this).year; } catch (e) { return __origGetFullYear.call(this); } };
        win.Date.prototype.getMonth = function () { try { return +__locParts(this).month - 1; } catch (e) { return __origGetMonth.call(this); } };
        win.Date.prototype.getDate = function () { try { return +__locParts(this).day; } catch (e) { return __origGetDate.call(this); } };
        win.Date.prototype.getDay = function () { try { return __WEEKDAY[__locParts(this).weekday] || 0; } catch (e) { return __origGetDay.call(this); } };
        win.Date.prototype.getHours = function () { try { return +__locParts(this).hour; } catch (e) { return __origGetHours.call(this); } };
        win.Date.prototype.getMinutes = function () { try { return +__locParts(this).minute; } catch (e) { return __origGetMinutes.call(this); } };
        win.Date.prototype.getSeconds = function () { try { return +__locParts(this).second; } catch (e) { return __origGetSeconds.call(this); } };

        var __fmtParts = function (d, extra) {
          var opts = {
            timeZone: TZ, hourCycle: 'h23', weekday: 'short', year: 'numeric',
            month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
          };
          if (extra) opts = Object.assign(opts, extra);
          var parts = new __origDTF('en-US', opts).formatToParts(d);
          var m = {};
          for (var i = 0; i < parts.length; i++) { var p = parts[i]; if (p.type !== 'literal') m[p.type] = p.value; }
          return m;
        };
        var __gmt = function (off) {
          var tz = -off;
          var sign = tz >= 0 ? '+' : '-';
          var abs = Math.abs(tz);
          var hh = ('0' + Math.floor(abs / 60)).slice(-2);
          var mm = ('0' + (abs % 60)).slice(-2);
          return 'GMT' + sign + hh + mm;
        };
        win.Date.prototype.toString = function () {
          try {
            var m = __fmtParts(this);
            return m.weekday + ' ' + m.month + ' ' + m.day + ' ' + m.year + ' ' + m.hour + ':' + m.minute + ':' + m.second + ' ' + __gmt(__tzOffset(this));
          } catch (e) { return __origToString.call(this); }
        };
        win.Date.prototype.toTimeString = function () {
          try {
            var m = __fmtParts(this);
            return m.hour + ':' + m.minute + ':' + m.second + ' ' + __gmt(__tzOffset(this));
          } catch (e) { return __origToTimeString.call(this); }
        };
        win.Date.prototype.toDateString = function () {
          try {
            var m = __fmtParts(this);
            return m.weekday + ' ' + m.month + ' ' + m.day + ' ' + m.year;
          } catch (e) { return __origToDateString.call(this); }
        };
        win.Date.prototype.toLocaleString = function () {
          try { return new __origDTF(lang, { timeZone: TZ, dateStyle: 'medium', timeStyle: 'medium' }).format(this); }
          catch (e) { return __origToLocaleString.call(this); }
        };
        win.Date.prototype.toLocaleTimeString = function () {
          try { return new __origDTF(lang, { timeZone: TZ, timeStyle: 'medium' }).format(this); }
          catch (e) { return __origToLocaleTimeString.call(this); }
        };
        win.Date.prototype.toLocaleDateString = function () {
          try { return new __origDTF(lang, { timeZone: TZ, dateStyle: 'medium' }).format(this); }
          catch (e) { return __origToLocaleDateString.call(this); }
        };
      } catch (e) {}
    }
  }

  // 注入主窗口：先扫雷清理 CDP 变量，再应用全套伪装
  cleanupCdc(window);
  applyStealth(window);

  // ── 19. Iframe 逃逸防御 ──
  // 拦截 HTMLIFrameElement.prototype.contentWindow 的 getter，
  // 页面一旦访问 iframe.contentWindow，立即对该子窗口递归应用同样伪装。
  // 标记用 Symbol.for，避免在原型上留下可被枚举/探测的字符串属性。
  var CW_KEY = Symbol.for('__tst_cw_patched');
  try {
    var desc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
    if (desc && desc.get && !HTMLIFrameElement.prototype[CW_KEY]) {
      Object.defineProperty(HTMLIFrameElement.prototype, CW_KEY, { value: true });
      Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
        get: function () {
          var cw = desc.get.call(this);
          try { if (cw) applyStealth(cw); } catch (e) {}
          return cw;
        }
      });
    }
  } catch (e) {}

  // ── 20. 同步 Iframe 挂载拦截（appendChild 劫持）──
  // 检测脚本会动态创建 iframe 并瞬间读取其内部 Canvas；
  // 仅劫持 contentWindow getter 不够，必须在 iframe 挂载到 DOM 的瞬间同步注入伪装。
  var AP_KEY = Symbol.for('__tst_append_patched');
  try {
    if (typeof Node !== 'undefined' && Node.prototype && Node.prototype.appendChild && !Node.prototype[AP_KEY]) {
      Object.defineProperty(Node.prototype, AP_KEY, { value: true });
      var __origAppendChild = Node.prototype.appendChild;
      Node.prototype.appendChild = nativeFn('appendChild', function (node) {
        var result = __origAppendChild.apply(this, arguments);
        try {
          if (node && (node.nodeName === 'IFRAME' || node.tagName === 'IFRAME') && node.contentWindow) {
            applyStealth(node.contentWindow);
          }
        } catch (e) {}
        return result;
      });
    }
  } catch (e) {}
})();`;

try {
  webFrame.executeJavaScriptInIsolatedWorld(0, [{ code: STEALTH, url: 'tst://stealth' }]);
} catch (error) {
  console.error('[Stealth] 注入失败', error);
}
