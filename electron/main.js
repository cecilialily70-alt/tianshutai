const { app, BrowserWindow, BrowserView, session, ipcMain, Menu } = require('electron');
const path = require('path');
const Store = require('electron-store');

// 反检测：禁用 WebRTC 本地 IP 枚举（配合 stealth-preload.js 的 JS 层兜底）
// 必须在 app.ready 之前设置才生效
try {
  app.commandLine.appendSwitch('webrtc-ip-handling-policy', 'disable_non_proxied_udp');
  app.commandLine.appendSwitch('force-webrtc-ip-handling-policy');
  // 抹除 Chromium 的自动化控制痕迹（AutomationControlled），使 navigator.webdriver 保持 false/undefined
  app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');
} catch (e) {
  // 忽略开关设置失败
}

const {
  SEED_ROLES,
  createRole,
  normalizeTranslation,
  normalizeRole,
  LANG_LABELS,
  CHANNEL_LABELS,
} = require('./translation');
const { translateText } = require('./translator');
const { createTranslateCache } = require('./translateCache');
const { createChatConfig } = require('./chatConfig');

const isDev = !app.isPackaged;
const WHATSAPP_URL = 'https://web.whatsapp.com';
// 与 Electron 内置 Chromium 152 及 stealth-preload.js 保持一致
const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';
const WHATSAPP_PRELOAD = path.join(__dirname, 'preload-whatsapp.js');
const STEALTH_PRELOAD = path.join(__dirname, 'stealth-preload.js');
const proxyLoginBound = new WeakSet();
const stealthState = new WeakMap(); // ses -> { timezone, language }（供请求头动态读取）
const stealthHeadersBound = new WeakSet();
const stealthScriptBound = new WeakSet();

const store = new Store({
  name: 'shell-state',
  defaults: {
    tabs: [],
    activeTabId: null,
    translation: {},
    roles: [],
    seeded: false,
  },
});

let windowDrag = null;
let translateCache = null;
let chatConfigStore = null;
const translatePending = new Map();
const translateQueue = [];
let translateActive = 0;
const TRANSLATE_CONCURRENCY = 2;
/** @type {Map<string, { chatId: string, chatTitle: string }>} */
const activeChatMap = new Map();

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {Map<string, BrowserView>} */
const viewMap = new Map();
/** @type {Map<string, Promise<BrowserView>>} */
const viewCreating = new Map();
let activeTabId = store.get('activeTabId');
let currentNav = 'home';
let overlayOpen = false;
let attachGeneration = 0;
let lastBounds = { x: 56, y: 40, width: 800, height: 600 };

function defaultEnv() {
  return {
    homepage: WHATSAPP_URL,
    proxyMode: 'direct',
    proxyHost: '',
    proxyPort: '',
    proxyUser: '',
    proxyPass: '',
    userAgent: '',
    timezone: '',
    language: 'zh-CN',
    autoGeo: true,
    // WebRTC 策略：'filtered' = 剥离 host/srflx 候选（保留通话能力，但绝不漏 IP）；
    //             'disabled' = 彻底置空 RTCPeerConnection（100% 不漏，但语音/视频通话失效）
    webrtc: 'filtered',
  };
}

function createDefaultTab() {
  const id = crypto.randomUUID();
  return normalizeTab({
    id,
    accountId: id,
    name: '账户 1',
    status: 'offline',
  });
}

function normalizeTab(tab) {
  return {
    ...tab,
    accountId: tab.accountId || tab.id,
    status: tab.status || 'offline',
    zoomFactor: typeof tab.zoomFactor === 'number' ? tab.zoomFactor : 1,
    translationVisible: tab.translationVisible !== false,
    env: { ...defaultEnv(), ...(tab.env || {}) },
  };
}

function ensureRoles() {
  let roles = store.get('roles');
  const firstSeed = !Array.isArray(roles) || roles.length === 0;
  if (firstSeed) {
    roles = SEED_ROLES.map((item) => createRole(item));
    store.set('roles', roles);
  } else {
    roles = roles.map(normalizeRole);
    store.set('roles', roles);
  }
  const translation = normalizeTranslation(store.get('translation') || {});
  if (firstSeed && !translation.roleId) {
    translation.roleId = roles[0]?.id || '';
  }
  store.set('translation', translation);
  return roles;
}

function ensureTabs() {
  let tabs = (store.get('tabs') || []).map(normalizeTab);
  const seeded = store.get('seeded');
  if (!seeded) {
    // 首次启动才补一个默认标签；之后尊重用户显式清空的列表
    if (tabs.length === 0) {
      tabs = [createDefaultTab()];
    }
    store.set('seeded', true);
    store.set('tabs', tabs);
    activeTabId = tabs[0]?.id || null;
    store.set('activeTabId', activeTabId);
  } else {
    store.set('tabs', tabs);
  }
  if (!tabs.some((tab) => tab.id === activeTabId)) {
    activeTabId = tabs[0]?.id || null;
    store.set('activeTabId', activeTabId);
  }
  return tabs;
}

function getTab(tabId) {
  return (store.get('tabs') || []).map(normalizeTab).find((tab) => tab.id === tabId) || null;
}

function patchTab(tabId, patch) {
  const tabs = (store.get('tabs') || []).map(normalizeTab);
  const next = tabs.map((tab) => (tab.id === tabId ? normalizeTab({ ...tab, ...patch }) : tab));
  store.set('tabs', next);
  return next.find((tab) => tab.id === tabId) || null;
}

// 将标签重命名为当前对话对象（对方）的手机号
function renameTabToPeer(tabId, phoneOrId) {
  try {
    const digits = String(phoneOrId || '').replace(/\D/g, '');
    if (digits.length < 6) return; // 群组/无效标识不重命名
    const tab = getTab(tabId);
    if (!tab) return;
    const current = (tab.name || '').trim();
    // 仅当仍为自动生成的“账户 N”或已是手机号时才替换，避免覆盖用户手动命名
    const isAuto = !current || /^账户\s*\d*$/.test(current) || /^\+?\d{6,}$/.test(current);
    if (!isAuto) return;
    const name = `+${digits}`;
    if (current === name) return;
    patchTab(tabId, { name });
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('tabs:name', { tabId, name });
    }
    console.log('[Main] 标签重命名为对方号码', { tabId: tabId.slice(0, 8), name });
  } catch (error) {
    console.error('[Main] 重命名标签失败', error);
  }
}

function getEffectiveTranslation(accountId, chatId) {
  const global = normalizeTranslation(store.get('translation') || {});
  if (!accountId || !chatId || !chatConfigStore) return global;
  const perChat = chatConfigStore.get(accountId, chatId);
  if (!perChat) return global;
  // 存在独立配置则覆盖全局配置，缺失字段回退全局
  return {
    ...global,
    channel: perChat.channel || global.channel,
    roleId: perChat.roleId ?? global.roleId,
    translateOutgoing: perChat.translateOutgoing ?? global.translateOutgoing,
    translateIncoming: perChat.translateIncoming ?? global.translateIncoming,
    sourceLang: perChat.sourceLang || global.sourceLang,
    targetLang: perChat.targetLang || global.targetLang,
  };
}

function getBridgePayload(tab, chatId) {
  const accountId = tab?.accountId || tab?.id;
  const translation = getEffectiveTranslation(accountId, chatId);
  const roles = store.get('roles') || [];
  const role = roles.find((item) => item.id === translation.roleId);
  return {
    translationVisible: !tab || tab.translationVisible !== false,
    enterSendMode: translation.enterSendMode,
    translateOutgoing: translation.translateOutgoing,
    translateIncoming: translation.translateIncoming,
    sourceLang: translation.sourceLang,
    targetLang: translation.targetLang,
    channel: translation.channel,
    channelLabel: CHANNEL_LABELS[translation.channel] || 'GPT',
    outgoingLangLabel:
      translation.sourceLang && translation.sourceLang !== 'auto'
        ? LANG_LABELS[translation.sourceLang] || translation.sourceLang
        : LANG_LABELS.he,
    incomingLangLabel: LANG_LABELS[translation.targetLang] || '中文',
    roleTitle: role?.title || '',
  };
}

function sendWaBridge(view, tab, chatId) {
  try {
    if (!view || view.webContents.isDestroyed()) return;
    const payload = getBridgePayload(tab, chatId);
    view.webContents.send('wa:bootstrap', payload);
    view.webContents.send('wa:settings', payload);
  } catch (error) {
    console.error('[Main] 向 WhatsApp 视图推送设置失败', error);
  }
}

function sendWaRemark(view, tab, chatId) {
  try {
    if (!view || view.webContents.isDestroyed()) return;
    const accountId = tab?.accountId || tab?.id;
    const perChat = accountId && chatId ? chatConfigStore?.get(accountId, chatId) : null;
    view.webContents.send('wa:custom-remark', {
      id: chatId || '',
      nickname: (perChat?.nickname || '').trim(),
      remark: (perChat?.remark || '').trim(),
    });
  } catch (error) {
    console.error('[Main] 推送自定义昵称/备注失败', error);
  }
}

// 全局联系人映射表：{ 纯ID: 自定义昵称 }，供左侧列表持续劫持
function buildContactMap(accountId) {
  const map = {};
  if (!accountId || !chatConfigStore) return map;
  try {
    const list = chatConfigStore.getAllIdentity(accountId);
    for (const item of list) {
      const id = String(item.chatId || '').trim();
      const name = String(item.nickname || item.remark || '').trim();
      if (!id || !name) continue;
      map[id] = name;
      // 兼容带区号/空格等原始形态的 ID（如 +44 7934...）
      const cleaned = id.replace(/[^\p{L}\p{N}]/gu, '');
      if (cleaned && cleaned !== id && !map[cleaned]) map[cleaned] = name;
    }
  } catch (error) {
    console.error('[Main] 构建全局联系人映射表失败', error);
  }
  return map;
}

function sendWaContactMap(view, tab) {
  try {
    if (!view || view.webContents.isDestroyed()) return;
    const accountId = tab?.accountId || tab?.id;
    view.webContents.send('wa:contact-map', { map: buildContactMap(accountId) });
  } catch (error) {
    console.error('[Main] 推送全局联系人映射表失败', error);
  }
}

function broadcastWaSettings() {
  for (const [tabId, view] of viewMap.entries()) {
    const chatId = activeChatMap.get(tabId)?.chatId;
    const tab = getTab(tabId);
    sendWaBridge(view, tab, chatId);
    sendWaRemark(view, tab, chatId);
    sendWaContactMap(view, tab);
  }
}

function findViewSession(webContents) {
  for (const [tabId, view] of viewMap.entries()) {
    if (view.webContents === webContents) {
      const tab = getTab(tabId);
      const accountId = tab?.accountId || tabId;
      return session.fromPartition(`persist:${accountId}`, { cache: true });
    }
  }
  return session.defaultSession;
}

function findTabIdByWebContents(webContents) {
  for (const [tabId, view] of viewMap.entries()) {
    if (view.webContents === webContents) return tabId;
  }
  return null;
}

function pumpTranslateQueue() {
  if (translateActive >= TRANSLATE_CONCURRENCY) return;
  const job = translateQueue.shift();
  if (!job) return;
  translateActive += 1;
  Promise.resolve()
    .then(job.fn)
    .then(job.resolve, job.reject)
    .finally(() => {
      translateActive -= 1;
      pumpTranslateQueue();
    });
}

function enqueueTranslate(fn) {
  return new Promise((resolve, reject) => {
    translateQueue.push({ fn, resolve, reject });
    pumpTranslateQueue();
  });
}

async function handleTranslateMsg(event, payload = {}) {
  const text = String(payload.text || '').trim();
  const msgId = String(payload.msgId || '');
  const direction = payload.direction === 'out' ? 'out' : 'in';
  const isHistory = !!payload.isHistory;
  const forcePremium = !!payload.forcePremium;
  const skipCache = !!payload.skipCache;
  if (!text) return { ok: true, text: '', cached: true };

  const tabId = findTabIdByWebContents(event.sender);
  const tab = tabId ? getTab(tabId) : null;
  const accountId = tab?.accountId || tabId || '';
  const chatId = String(payload.chatId || (tabId ? activeChatMap.get(tabId)?.chatId : '') || '');
  const settings = getEffectiveTranslation(accountId, chatId);
  const roles = store.get('roles') || [];
  const role = roles.find((item) => item.id === settings.roleId);
  const channelOverride = forcePremium ? settings.channel || 'deepseek' : isHistory ? 'google' : settings.channel || 'deepseek';

  if (msgId && forcePremium) {
    translateCache?.delete(msgId);
  }
  if (msgId && !skipCache && !forcePremium) {
    const hit = translateCache?.get(msgId);
    if (hit && hit.text === text && hit.translated) {
      console.log('[Main] 翻译缓存命中', { msgId: msgId.slice(0, 24), channel: hit.channel });
      return { ok: true, text: hit.translated, cached: true, channel: hit.channel };
    }
  }

  const dedupeKey = `${msgId}|${direction}|${channelOverride}|${text}`;
  if (translatePending.has(dedupeKey)) {
    return translatePending.get(dedupeKey);
  }

  const work = enqueueTranslate(async () => {
    const ses = findViewSession(event.sender);
    console.log('[Main] 翻译请求', {
      direction,
      chars: text.length,
      channel: channelOverride,
      isHistory,
      forcePremium,
      cached: false,
    });

    // 历史消息默认走免费谷歌，但该接口易被限流/拦截；失败时自动回退到付费渠道，
    // 保证历史消息「必然出译文」并被缓存，避免再次打开时历史翻译缺失。
    let translated = '';
    let usedChannel = channelOverride;
    try {
      translated = await translateText({
        ses,
        text,
        direction,
        settings,
        rolePrompt: role?.prompt || '',
        channelOverride,
      });
    } catch (error) {
      const premium = settings.channel || 'deepseek';
      if (channelOverride === 'google' && premium !== 'google') {
        console.warn('[Main] 谷歌翻译失败，回退付费渠道', {
          error: error.message || error,
          fallback: premium,
        });
        usedChannel = premium;
        translated = await translateText({
          ses,
          text,
          direction,
          settings,
          rolePrompt: role?.prompt || '',
          channelOverride: premium,
        });
      } else {
        throw error;
      }
    }
    if (msgId && translated) {
      translateCache?.set(msgId, { text, translated, channel: usedChannel });
    }
    return { ok: true, text: translated, cached: false, channel: usedChannel };
  }).catch((error) => {
    console.error('[Main] 翻译失败', error.message || error);
    return { ok: false, error: error.message || '翻译失败' };
  });

  translatePending.set(dedupeKey, work);
  try {
    return await work;
  } finally {
    translatePending.delete(dedupeKey);
  }
}

function emitStatus(tabId, status) {
  patchTab(tabId, { status });
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('tabs:status', { tabId, status });
  }
}

function sendTabAction(win, tabId, action) {
  if (win && !win.isDestroyed()) {
    win.webContents.send('tab:context-action', { tabId, action });
  }
}

function showTabContextMenu(win, tabId) {
  const tab = getTab(tabId);
  if (!tab) return;
  const template = [
    { label: '编辑', click: () => sendTabAction(win, tabId, 'edit') },
    { label: '环境配置', click: () => sendTabAction(win, tabId, 'env') },
    { label: '独立翻译设置', click: () => sendTabAction(win, tabId, 'chat') },
    { label: '缩放页面', click: () => sendTabAction(win, tabId, 'zoom') },
    { type: 'separator' },
    {
      label: tab.translationVisible === false ? '显示译文' : '隐藏译文',
      click: () => sendTabAction(win, tabId, 'translation'),
    },
  ];
  const menu = Menu.buildFromTemplate(template);
  menu.popup({ window: win });
}

function bindProxyLogin(ses, accountId) {
  if (proxyLoginBound.has(ses)) return;
  proxyLoginBound.add(ses);
  ses.on('login', (event, _wc, _request, authInfo, callback) => {
    try {
      if (!authInfo.isProxy) {
        callback();
        return;
      }
      event.preventDefault();
      const tab = (store.get('tabs') || []).find((item) => item.accountId === accountId);
      const env = tab?.env || {};
      callback(env.proxyUser || '', env.proxyPass || '');
    } catch (error) {
      console.error('[Main] 代理鉴权失败', error);
      callback();
    }
  });
}

// 反检测：给会话注入 stealth 预加载 + 客户端提示头，使指纹接近真实 Chrome。
// 时区/语言不再通过字符串占位符或临时文件传递（存在多窗口竞态），
// 改为在创建 BrowserView 时通过 webPreferences.additionalArguments 注入，
// stealth-preload.js 启动时从 process.argv 解析，天然做到「每个渲染进程一份、无竞态」。

// 组装传给渲染进程的指纹参数（additionalArguments）
function buildGeoArgs(env) {
  const timezone = String(env?.timezone || '').trim();
  const language = String(env?.language || 'zh-CN').trim();
  const webrtc = String(env?.webrtc || 'filtered').trim();
  return [
    `--geo-timezone=${timezone}`,
    `--geo-language=${language}`,
    `--geo-webrtc=${webrtc}`,
  ];
}

function ensureStealth(ses, env, accountId) {
  if (!ses) return;
  const timezone = String(env?.timezone || '').trim();
  const language = String(env?.language || 'zh-CN').trim();

  // 记录当前解析出的时区/语言，供请求头在发送时动态读取（避免闭包过期）
  stealthState.set(ses, { timezone, language });

  // 头处理只绑定一次（语言在请求时动态读取）
  if (!stealthHeadersBound.has(ses)) {
    stealthHeadersBound.add(ses);
    try {
      ses.webRequest.onBeforeSendHeaders((details, callback) => {
        try {
          const headers = details.requestHeaders || {};
          const setLower = (name, value) => {
            for (const k of Object.keys(headers)) {
              if (k.toLowerCase() === name) delete headers[k];
            }
            headers[name] = value;
          };
          // UA-CH 头：强制与 navigator.userAgentData 完全一致（Chrome 152）
          setLower('sec-ch-ua', '"Google Chrome";v="152", "Chromium";v="152", "Not)A;Brand";v="99"');
          setLower('sec-ch-ua-mobile', '?0');
          setLower('sec-ch-ua-platform', '"Windows"');
          setLower(
            'sec-ch-ua-full-version-list',
            '"Google Chrome";v="152.0.0.0", "Chromium";v="152.0.0.0", "Not)A;Brand";v="99.0.0.0"',
          );
          setLower('sec-ch-ua-platform-version', '"10.0.0"');
          const curLang = (stealthState.get(ses)?.language) || 'zh-CN';
          // 强制覆写 Accept-Language 为动态获取的 env.language，与 navigator.language 一致。
          // 采用真实 Chrome 的权重格式：主语言全权，区域根语言 0.9，en-US 0.8，en 0.7。
          const langBase = curLang.split('-')[0];
          setLower('Accept-Language', `${curLang},${langBase};q=0.9,en-US;q=0.8,en;q=0.7`);
          delete headers['X-Electron'];
          callback({ requestHeaders: headers });
        } catch (error) {
          callback({ requestHeaders: details.requestHeaders });
        }
      });
    } catch (error) {
      console.warn('[Main] 客户端提示头注入失败', error.message || error);
    }
  }

  // stealth 脚本本身是静态的（运行时读取 additionalArguments），每个 session 只注册一次，
  // 覆盖该 session 下所有 frame（含 iframe），彻底避免「卸载旧脚本 → 重新生成」的竞态窗口。
  if (!stealthScriptBound.has(ses)) {
    stealthScriptBound.add(ses);
    try {
      ses.registerPreloadScript({ filePath: STEALTH_PRELOAD, type: 'frame' });
      console.log('[Main] 已注册 stealth 预加载', { accountId });
    } catch (error) {
      console.warn('[Main] 注册 stealth 预加载失败（可能为旧版 Electron）', error.message || error);
    }
  }
}

// 国家码 → 浏览器界面语言（用于与出口 IP 归属地对齐）
function countryToLanguage(countryCode) {
  const map = {
    CN: 'zh-CN', HK: 'zh-HK', TW: 'zh-TW', MO: 'zh-HK', SG: 'zh-CN', MY: 'zh-CN',
    US: 'en-US', GB: 'en-GB', AU: 'en-AU', CA: 'en-CA', NZ: 'en-NZ', IE: 'en-IE',
    IL: 'he-IL',
    SA: 'ar-SA', AE: 'ar-AE', EG: 'ar-EG', QA: 'ar-QA', KW: 'ar-KW', BH: 'ar-BH', OM: 'ar-OM',
    RU: 'ru-RU', JP: 'ja-JP', KR: 'ko-KR', DE: 'de-DE', FR: 'fr-FR', ES: 'es-ES', IT: 'it-IT',
    BR: 'pt-BR', PT: 'pt-PT', NL: 'nl-NL', PL: 'pl-PL', TR: 'tr-TR', TH: 'th-TH', VN: 'vi-VN',
    ID: 'id-ID', PH: 'en-PH', IN: 'en-IN', PK: 'en-PK', BD: 'en-BD',
  };
  return map[String(countryCode || '').toUpperCase()] || 'en-US';
}

// 国家码 → 时区（当 Geo API 未返回 timezone 字段时的兜底）
function countryToTimezone(countryCode) {
  const map = {
    CN: 'Asia/Shanghai', HK: 'Asia/Hong_Kong', MO: 'Asia/Macau', TW: 'Asia/Taipei',
    SG: 'Asia/Singapore', MY: 'Asia/Kuala_Lumpur', JP: 'Asia/Tokyo', KR: 'Asia/Seoul',
    TH: 'Asia/Bangkok', VN: 'Asia/Ho_Chi_Minh', ID: 'Asia/Jakarta', PH: 'Asia/Manila',
    IN: 'Asia/Kolkata', PK: 'Asia/Karachi', BD: 'Asia/Dhaka', AE: 'Asia/Dubai',
    SA: 'Asia/Riyadh', QA: 'Asia/Qatar', KW: 'Asia/Kuwait', BH: 'Asia/Bahrain', OM: 'Asia/Muscat',
    IL: 'Asia/Jerusalem', RU: 'Europe/Moscow', TR: 'Europe/Istanbul',
    GB: 'Europe/London', IE: 'Europe/Dublin', DE: 'Europe/Berlin', FR: 'Europe/Paris',
    ES: 'Europe/Madrid', IT: 'Europe/Rome', NL: 'Europe/Amsterdam', PL: 'Europe/Warsaw',
    US: 'America/New_York', CA: 'America/Toronto', BR: 'America/Sao_Paulo',
    AU: 'Australia/Sydney', NZ: 'Pacific/Auckland',
    EG: 'Africa/Cairo',
  };
  return map[String(countryCode || '').toUpperCase()] || '';
}

// 通过隔离会话（走代理）探测出口 IP 的时区与国家，返回 { timezone, countryCode, language, ip }
async function detectGeo(ses) {
  const runner = ses && typeof ses.fetch === 'function' ? ses.fetch.bind(ses) : fetch;

  const probe = async (url) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    try {
      const res = await runner(url, { signal: ctrl.signal });
      if (!res || !res.ok) return null;
      const data = await res.json();
      const timezone =
        typeof data.timezone === 'string' ? data.timezone
        : typeof data.time_zone === 'string' ? data.time_zone : '';
      const rawCountry = data.country_code || data.countryCode || data.country || data.country_iso || '';
      const countryCode = String(rawCountry).toUpperCase();
      if (!timezone && !countryCode) return null;
      const resolvedTz = timezone || countryToTimezone(countryCode);
      const ip = typeof (data.query || data.ip) === 'string' ? (data.query || data.ip) : '';
      return {
        timezone: resolvedTz,
        countryCode,
        language: countryToLanguage(countryCode),
        ip,
      };
    } catch (error) {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  // ip-api.com 最快最稳，优先；其余兜底（串行，任一成功即返回）
  const endpoints = [
    'http://ip-api.com/json/?fields=status,countryCode,timezone,query',
    'https://ipwho.is/',
    'https://ipinfo.io/json',
    'https://ipapi.co/json/',
  ];
  for (const url of endpoints) {
    const geo = await probe(url);
    if (geo) return geo;
  }
  return null;
}

// 时区/语言跟随出口 IP 自动适配：无论是否使用代理都强制探测，并确保 stealth 拿到最终值
async function autoApplyGeo(ses, env, accountId, tabId) {
  const wantAuto = env?.autoGeo !== false;
  const hasManualTz = !!String(env?.timezone || '').trim();
  const hasManualLang = !!String(env?.language || '').trim();
  // 自动模式，或手动模式但未填时区/语言时，都需要探测出口 IP
  const needDetect = wantAuto || !hasManualTz || !hasManualLang;

  if (!needDetect) {
    ensureStealth(ses, env, accountId);
    return;
  }

  let geo = null;
  try {
    geo = await detectGeo(ses);
  } catch (error) {
    console.warn('[Main] 出口 IP 地理探测失败', error.message || error);
  }

  if (!geo) {
    // 探测失败也注入一次，保证至少用 env（或系统）值覆盖，避免时序空值
    ensureStealth(ses, env, accountId);
    return;
  }

  if (typeof geo.timezone === 'string' && geo.timezone && geo.timezone !== env.timezone) {
    env.timezone = geo.timezone;
  }
  if (typeof geo.language === 'string' && geo.language && geo.language !== env.language) {
    env.language = geo.language;
  }

  // 关键：无论是否变化，都用最终解析出的时区/语言重新注入 stealth
  ensureStealth(ses, env, accountId);

  console.log('[Main] 出口 IP 地理信息', { accountId, ...geo });
  if (tabId) {
    patchTab(tabId, { env });
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('env:geo', {
        tabId,
        geo,
        timezone: env.timezone,
        language: env.language,
      });
    }
  }
}

async function applySessionEnv(ses, env, accountId, tabId) {
  const ua = (env?.userAgent || '').trim() || DEFAULT_UA;
  ses.setUserAgent(ua);
  bindProxyLogin(ses, accountId);

  // 反检测：最严格 WebRTC IP 策略，强制 UDP 走代理，杜绝绕过代理直连泄露真实网卡 IP。
  // 直连（无代理）时同样设置，Chromium 会禁用非代理 UDP 候选，配合 preload 层候选剥离双保险。
  try {
    ses.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
  } catch (error) {
    console.warn('[Main] 设置 WebRTC IP 策略失败', error.message || error);
  }

  if (!env || env.proxyMode === 'direct' || !String(env.proxyHost || '').trim()) {
    await ses.setProxy({ mode: 'direct' });
  } else {
    const host = String(env.proxyHost).trim();
    const port = String(env.proxyPort || '').trim();
    const scheme = env.proxyMode === 'socks5' ? 'socks5' : 'http';
    const proxyRules = port ? `${scheme}://${host}:${port}` : `${scheme}://${host}`;
    await ses.setProxy({
      proxyRules,
      proxyBypassRules: '<local>',
    });
    console.log('[Main] 已应用代理规则', { accountId, scheme, host });
  }

  // 无论是否使用代理，都强制按出口 IP 动态探测并覆盖时区/语言（内部会完成 stealth 注入）
  await autoApplyGeo(ses, env, accountId, tabId);
  return env;
}

// 应用内打开站外链接：新建一个使用当前账户隔离 session 的浏览器窗口，不弹系统浏览器
const internalWindows = new Set();

function openInternalWindow(tab, url) {
  try {
    if (!url || !/^https?:\/\//i.test(url)) return;
    const accountId = tab?.accountId || tab?.id;
    const ses = session.fromPartition(`persist:${accountId}`, { cache: true });
    ensureStealth(ses, tab?.env, accountId);
    const win = new BrowserWindow({
      width: 1100,
      height: 720,
      minWidth: 480,
      minHeight: 360,
      backgroundColor: '#111b21',
      autoHideMenuBar: true,
      title: url,
      webPreferences: {
        session: ses,
        additionalArguments: buildGeoArgs(tab?.env),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    internalWindows.add(win);
    win.setMenuBarVisibility(false);
    win.loadURL(url).catch((error) => {
      console.error('[Main] 内部窗口加载失败', error);
    });
    win.on('closed', () => {
      internalWindows.delete(win);
    });
    console.log('[Main] 应用内打开链接', url);
  } catch (error) {
    console.error('[Main] 打开内部窗口失败', error);
  }
}

function bindViewEvents(tab, view) {
  const { webContents } = view;

  const isWhatsAppUrl = (url) =>
    /^https:\/\/([a-z0-9.-]*\.)?whatsapp\.(com|net)/i.test(url) ||
    /^https:\/\/web\.whatsapp\.com/i.test(url);

  // 站内链接：在当前隔离视图内跳转；站外链接：应用内新开一个隔离浏览器窗口（不弹系统浏览器）
  webContents.setWindowOpenHandler(({ url }) => {
    try {
      if (isWhatsAppUrl(url)) {
        webContents.loadURL(url).catch((error) => {
          console.error('[Main] 站内跳转失败', error);
        });
      } else {
        openInternalWindow(tab, url);
      }
    } catch (error) {
      console.error('[Main] setWindowOpenHandler 异常', error);
    }
    return { action: 'deny' };
  });

  // 阻止浏览器视图离开 WhatsApp：点击消息里的外部链接（YouTube/文档等）时，应用内新开窗口
  webContents.on('will-navigate', (event, url) => {
    try {
      if (isWhatsAppUrl(url)) return;
      event.preventDefault();
      openInternalWindow(tab, url);
    } catch (error) {
      console.error('[Main] will-navigate 拦截异常', error);
    }
  });

  webContents.on('did-start-loading', () => emitStatus(tab.id, 'connecting'));
  // 页面停止加载并不等于已登录：是否在线由注入脚本探测登录状态后上报
  webContents.on('did-stop-loading', () => {
    if (!webContents.isDestroyed()) emitStatus(tab.id, 'connecting');
  });
  webContents.on('did-fail-load', (_event, errorCode, errorDescription, _url, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return;
    console.error('[Main] 页面加载失败', { tabId: tab.id, errorCode, errorDescription });
    emitStatus(tab.id, 'offline');
  });
  webContents.on('did-finish-load', () => {
    try {
      const latest = getTab(tab.id);
      if (!latest || webContents.isDestroyed()) return;
      webContents.setZoomFactor(latest.zoomFactor || 1);
      const chatId = activeChatMap.get(tab.id)?.chatId;
      sendWaBridge(view, latest, chatId);
      sendWaRemark(view, latest, chatId);
      sendWaContactMap(view, latest);
    } catch (error) {
      console.error('[Main] 完成加载后同步状态失败', error);
    }
  });
}

function getOrCreateView(tab) {
  const existing = viewMap.get(tab.id);
  if (existing && !existing.webContents.isDestroyed()) {
    return existing;
  }
  if (viewCreating.has(tab.id)) {
    return viewCreating.get(tab.id);
  }
  const promise = createView(tab);
  viewCreating.set(tab.id, promise);
  promise.then(
    () => viewCreating.delete(tab.id),
    () => viewCreating.delete(tab.id),
  );
  return promise;
}

async function createView(tab) {
  const accountId = tab.accountId || tab.id;
  const partition = `persist:${accountId}`;
  const ses = session.fromPartition(partition, { cache: true });

  try {
    await applySessionEnv(ses, tab.env, accountId, tab.id);
  } catch (error) {
    console.error('[Main] 会话环境应用失败', accountId, error);
  }

  const view = new BrowserView({
    webPreferences: {
      session: ses,
      preload: WHATSAPP_PRELOAD,
      // 通过 additionalArguments 把探测到的时区/语言/WebRTC 策略安全传给渲染进程
      additionalArguments: buildGeoArgs(tab.env),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  view.setBackgroundColor('#111b21');
  bindViewEvents(tab, view);
  viewMap.set(tab.id, view);

  const homepage = tab.env?.homepage || WHATSAPP_URL;
  console.log('[Main] 已创建隔离视图', { tabId: tab.id, partition, homepage });
  view.webContents.loadURL(homepage).catch((error) => {
    console.error('[Main] WhatsApp 挂载失败', tab.id, error);
    emitStatus(tab.id, 'offline');
  });
  return view;
}

function destroyView(tabId) {
  const view = viewMap.get(tabId);
  if (!view) return;
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.removeBrowserView(view);
    }
    if (!view.webContents.isDestroyed()) {
      view.webContents.destroy();
    }
  } catch (error) {
    console.error('[Main] 销毁视图失败', tabId, error);
  }
  viewMap.delete(tabId);
  console.log('[Main] 已销毁隔离视图', tabId);
}

function syncViews(tabs) {
  const livingIds = new Set(tabs.map((tab) => tab.id));
  for (const tabId of [...viewMap.keys()]) {
    if (!livingIds.has(tabId)) destroyView(tabId);
  }
}

function applyBounds(view) {
  if (!view || !lastBounds) return;
  const { x, y, width, height } = lastBounds;
  if (width < 8 || height < 8) return;
  view.setBounds({
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  });
}

function detachAllViews() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  for (const view of viewMap.values()) {
    try {
      mainWindow.removeBrowserView(view);
    } catch {
      /* 视图可能未挂载 */
    }
  }
}

async function attachActiveView() {
  const gen = ++attachGeneration;
  if (!mainWindow || mainWindow.isDestroyed()) return;

  if (overlayOpen || currentNav !== 'home' || !activeTabId) {
    detachAllViews();
    return;
  }

  const tab = getTab(activeTabId);
  if (!tab) {
    detachAllViews();
    return;
  }

  const view = await getOrCreateView(tab);
  if (gen !== attachGeneration || !mainWindow || mainWindow.isDestroyed()) return;
  const current = typeof mainWindow.getBrowserView === 'function' ? mainWindow.getBrowserView() : null;
  if (current !== view) {
    detachAllViews();
    mainWindow.setBrowserView(view);
  }
  applyBounds(view);
  try {
    if (!view.webContents.isDestroyed()) {
      view.webContents.setZoomFactor(tab.zoomFactor || 1);
      const chatId = activeChatMap.get(tab.id)?.chatId;
      sendWaBridge(view, tab, chatId);
      sendWaRemark(view, tab, chatId);
      sendWaContactMap(view, tab);
    }
  } catch (error) {
    console.error('[Main] 激活视图同步失败', error);
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#111b21',
    frame: false,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow.show();
    attachActiveView();
  });

  const emitMaximized = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('window:maximized', mainWindow.isMaximized());
  };
  mainWindow.on('maximize', emitMaximized);
  mainWindow.on('unmaximize', emitMaximized);

  mainWindow.on('closed', () => {
    for (const tabId of [...viewMap.keys()]) {
      destroyView(tabId);
    }
    mainWindow = null;
  });

  if (isDev) {
    mainWindow.loadURL('http://127.0.0.1:5173').catch((error) => {
      console.error('[Main] 开发服务器连接失败', error);
    });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

function bindIpc() {
  ipcMain.handle('tabs:load', async () => {
    const tabs = ensureTabs();
    syncViews(tabs);
    await attachActiveView();
    return { tabs, activeTabId };
  });

  ipcMain.handle('tabs:save', async (_event, payload) => {
    const tabs = (Array.isArray(payload?.tabs) ? payload.tabs : []).map(normalizeTab);
    const nextActive = payload?.activeTabId ?? null;
    store.set('tabs', tabs);
    store.set('activeTabId', nextActive);
    activeTabId = nextActive;
    syncViews(tabs);
    await attachActiveView();
    return { ok: true };
  });

  ipcMain.on('tabs:set-active', async (_event, tabId) => {
    activeTabId = tabId || null;
    store.set('activeTabId', activeTabId);
    await attachActiveView();
  });

  ipcMain.handle('show-tab-context-menu', (event, tabId) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    showTabContextMenu(win, tabId);
    return { ok: true };
  });

  ipcMain.on('nav:set-view', async (_event, viewId) => {
    currentNav = viewId || 'home';
    await attachActiveView();
  });

  ipcMain.on('layout:bounds', (_event, bounds) => {
    if (!bounds) return;
    lastBounds = bounds;
    if (overlayOpen || currentNav !== 'home' || !activeTabId) return;
    const view = viewMap.get(activeTabId);
    if (view) applyBounds(view);
  });

  ipcMain.on('update-browser-view-bounds', (_event) => {
    // 折叠/缩放侧栏后显式重算 BrowserView bounds，避免黑边或遮挡
    if (overlayOpen || currentNav !== 'home' || !activeTabId) return;
    const view = viewMap.get(activeTabId);
    if (view) applyBounds(view);
  });

  ipcMain.on('overlay:set-open', async (_event, open) => {
    overlayOpen = !!open;
    await attachActiveView();
  });

  ipcMain.handle('view:set-zoom', async (_event, payload) => {
    const tabId = payload?.tabId;
    const factor = Math.min(2, Math.max(0.5, Number(payload?.factor) || 1));
    patchTab(tabId, { zoomFactor: factor });
    const view = viewMap.get(tabId);
    try {
      if (view && !view.webContents.isDestroyed()) {
        view.webContents.setZoomFactor(factor);
      }
    } catch (error) {
      console.error('[Main] 设置缩放失败', error);
    }
    return { ok: true, factor };
  });

  ipcMain.handle('view:set-translation-visible', async (_event, payload) => {
    const tabId = payload?.tabId;
    const visible = payload?.visible !== false;
    patchTab(tabId, { translationVisible: visible });
    const view = viewMap.get(tabId);
    try {
      if (view && !view.webContents.isDestroyed()) {
        view.webContents.send('wa:translation-visible', visible);
      }
    } catch (error) {
      console.error('[Main] 设置译文显隐失败', error);
    }
    return { ok: true, visible };
  });

  ipcMain.handle('view:apply-env', async (_event, payload) => {
    const tabId = payload?.tabId;
    const env = { ...defaultEnv(), ...(payload?.env || {}) };
    const tab = patchTab(tabId, { env });
    if (!tab) return { ok: false };
    const ses = session.fromPartition(`persist:${tab.accountId}`, { cache: true });
    try {
      await applySessionEnv(ses, env, tab.accountId, tabId);
      // additionalArguments 在渲染进程创建时即固化，环境（时区/语言/UA/WebRTC）变更后
      // 必须重建视图，让新参数注入到全新渲染进程；否则 loadURL 仍沿用旧的指纹参数。
      destroyView(tabId);
      if (tabId === activeTabId) {
        await attachActiveView();
      }
    } catch (error) {
      console.error('[Main] 应用环境配置失败', error);
      return { ok: false };
    }
    return { ok: true };
  });

  // 手动触发：重新探测出口 IP，自动更新时区/语言
  ipcMain.handle('view:detect-geo', async (_event, payload) => {
    try {
      const tabId = payload?.tabId;
      const tab = getTab(tabId);
      if (!tab) return { ok: false };
      const ses = session.fromPartition(`persist:${tab.accountId}`, { cache: true });
      const env = { ...tab.env };
      await autoApplyGeo(ses, env, tab.accountId, tabId);
      return { ok: true, timezone: env.timezone, language: env.language };
    } catch (error) {
      console.error('[Main] 手动地理探测失败', error);
      return { ok: false };
    }
  });

  ipcMain.on('view:reload', (_event, tabId) => {
    const view = viewMap.get(tabId);
    if (view && !view.webContents.isDestroyed()) {
      view.webContents.reload();
    }
  });

  ipcMain.handle('paths:partition-info', (_event, accountId) => {
    const ses = session.fromPartition(`persist:${accountId}`, { cache: true });
    return {
      partition: `persist:${accountId}`,
      storagePath: ses.storagePath || path.join(app.getPath('userData'), 'Partitions', String(accountId)),
    };
  });

  ipcMain.handle('settings:get', () => {
    ensureRoles();
    return normalizeTranslation(store.get('translation') || {});
  });

  ipcMain.handle('settings:save', (_event, payload) => {
    const next = normalizeTranslation(payload || {});
    store.set('translation', next);
    console.log('[Main] 已保存全局翻译设置', {
      channel: next.channel,
      roleId: next.roleId,
      enterSendMode: next.enterSendMode,
    });
    broadcastWaSettings();
    return next;
  });

  ipcMain.on('wa:login-state', (event, payload) => {
    const tabId = findTabIdByWebContents(event.sender);
    if (!tabId) return;
    emitStatus(tabId, payload?.loggedIn ? 'online' : 'offline');
  });

  ipcMain.on('chat:active', (event, payload) => {
    const tabId = findTabIdByWebContents(event.sender);
    if (!tabId) return;
    const chatId = String(payload?.chatId || payload?.phoneOrId || '').trim();
    const chatTitle = String(payload?.chatTitle || chatId || '').trim();
    if (!chatId) return;
    const prev = activeChatMap.get(tabId);
    if (prev?.chatId === chatId && prev?.chatTitle === chatTitle) return;
    activeChatMap.set(tabId, { chatId, chatTitle });
    renameTabToPeer(tabId, chatId);
    const tab = getTab(tabId);
    const view = viewMap.get(tabId);
    if (tab && view && !view.webContents.isDestroyed()) {
      sendWaBridge(view, tab, chatId);
      sendWaRemark(view, tab, chatId);
      sendWaContactMap(view, tab);
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('chat:active', { tabId, chatId, chatTitle });
    }
  });

  // 别名：精准捕获当前对话（手机号/ID）
  ipcMain.on('active-chat-changed', (event, payload) => {
    const tabId = findTabIdByWebContents(event.sender);
    if (!tabId) return;
    const chatId = String(payload?.phoneOrId || payload?.chatId || '').trim();
    if (!chatId) return;
    const chatTitle = String(payload?.chatTitle || chatId || '').trim();
    const prev = activeChatMap.get(tabId);
    if (prev?.chatId === chatId && prev?.chatTitle === chatTitle) return;
    activeChatMap.set(tabId, { chatId, chatTitle });
    renameTabToPeer(tabId, chatId);
    const tab = getTab(tabId);
    const view = viewMap.get(tabId);
    if (tab && view && !view.webContents.isDestroyed()) {
      sendWaBridge(view, tab, chatId);
      sendWaRemark(view, tab, chatId);
      sendWaContactMap(view, tab);
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('chat:active', { tabId, chatId, chatTitle });
    }
  });

  ipcMain.handle('chat-config:get', (_event, payload) => {
    const accountId = String(payload?.accountId || '');
    const chatId = String(payload?.chatId || '');
    const global = normalizeTranslation(store.get('translation') || {});
    const roles = store.get('roles') || [];
    const perChat = accountId && chatId ? chatConfigStore?.get(accountId, chatId) : null;
    return { accountId, chatId, global, roles, perChat };
  });

  ipcMain.handle('chat-config:save', (_event, payload) => {
    const accountId = String(payload?.accountId || '');
    const chatId = String(payload?.chatId || '');
    if (!accountId || !chatId) return { ok: false, error: '缺少账户或对话标识' };
    const config = {
      channel: payload?.channel || '',
      roleId: payload?.roleId || '',
      translateOutgoing: payload?.translateOutgoing !== false,
      translateIncoming: payload?.translateIncoming !== false,
      sourceLang: payload?.sourceLang || 'auto',
      targetLang: payload?.targetLang || 'zh-CN',
      nickname: String(payload?.nickname || '').trim(),
      remark: String(payload?.remark || '').trim(),
    };
    chatConfigStore?.set(accountId, chatId, config);
    console.log('[Main] 已保存独立翻译配置', { accountId, chatId: chatId.slice(0, 24), nickname: config.nickname, remark: config.remark });
    broadcastWaSettings();
    return { ok: true, config };
  });

  ipcMain.handle('chat-config:remove', (_event, payload) => {
    const accountId = String(payload?.accountId || '');
    const chatId = String(payload?.chatId || '');
    chatConfigStore?.remove(accountId, chatId);
    console.log('[Main] 已恢复全局翻译配置', { accountId, chatId: chatId.slice(0, 24) });
    broadcastWaSettings();
    return { ok: true };
  });

  ipcMain.handle('translate:run', (event, payload) =>
    handleTranslateMsg(event, {
      ...payload,
      msgId: '',
      isHistory: false,
      forcePremium: true,
      skipCache: true,
    }),
  );

  ipcMain.handle('translate-msg', (event, payload) => handleTranslateMsg(event, payload));

  ipcMain.handle('roles:list', () => ensureRoles());

  ipcMain.handle('roles:create', (_event, payload) => {
    const roles = ensureRoles();
    const role = createRole(payload || {});
    roles.push(role);
    store.set('roles', roles);
    console.log('[Main] 已新增角色', role.title);
    broadcastWaSettings();
    return role;
  });

  ipcMain.handle('roles:update', (_event, payload) => {
    const id = payload?.id;
    const roles = ensureRoles().map((role) =>
      role.id === id ? normalizeRole({ ...role, ...payload, updatedAt: Date.now() }) : role,
    );
    store.set('roles', roles);
    broadcastWaSettings();
    return roles.find((role) => role.id === id) || null;
  });

  ipcMain.handle('roles:remove', (_event, id) => {
    const roles = ensureRoles().filter((role) => role.id !== id);
    store.set('roles', roles);
    const translation = normalizeTranslation(store.get('translation') || {});
    if (translation.roleId === id) {
      translation.roleId = '';
      store.set('translation', translation);
    }
    console.log('[Main] 已删除角色', id);
    broadcastWaSettings();
    return { ok: true };
  });

  ipcMain.on('window:drag-start', (event, point) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isMaximized()) return;
    const [x, y] = win.getPosition();
    windowDrag = {
      x,
      y,
      screenX: point?.screenX || 0,
      screenY: point?.screenY || 0,
    };
  });

  ipcMain.on('window:drag-move', (event, point) => {
    if (!windowDrag) return;
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isMaximized()) return;
    win.setPosition(
      Math.round(windowDrag.x + (point?.screenX || 0) - windowDrag.screenX),
      Math.round(windowDrag.y + (point?.screenY || 0) - windowDrag.screenY),
    );
  });

  ipcMain.on('window:drag-end', () => {
    windowDrag = null;
  });

  ipcMain.on('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  ipcMain.on('window:maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });

  ipcMain.on('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });
}

app.whenReady().then(() => {
  console.log('[Main] 应用就绪');
  translateCache = createTranslateCache(app.getPath('userData'));
  chatConfigStore = createChatConfig(app.getPath('userData'));
  ensureTabs();
  ensureRoles();
  bindIpc();
  createMainWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});

app.on('before-quit', () => {
  // 退出前强制落盘翻译缓存，避免历史翻译在 debounce 窗口内丢失
  try { translateCache?.flush?.(); } catch (error) {
    console.error('[Main] 翻译缓存落盘失败', error.message || error);
  }
  for (const tabId of [...viewMap.keys()]) {
    destroyView(tabId);
  }
});
