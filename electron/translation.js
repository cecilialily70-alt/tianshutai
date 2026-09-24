const LANG_LABELS = {
  auto: '客户语言',
  'zh-CN': '中文',
  'zh-TW': '繁体中文',
  en: '英语',
  he: '希伯来语',
  ar: '阿拉伯语',
  es: '西班牙语',
  pt: '葡萄牙语',
  ru: '俄语',
  fr: '法语',
  de: '德语',
  ja: '日语',
  ko: '韩语',
  th: '泰语',
  vi: '越南语',
  id: '印尼语',
};

const CHANNEL_LABELS = {
  deepseek: 'DeepSeek',
  google: '谷歌翻译',
  openai: 'GPT',
  claude: 'Claude',
};

const DEFAULT_TRANSLATION = {
  channel: 'deepseek',
  apiKey: '',
  baseUrl: '',
  roleId: '',
  translateOutgoing: true,
  translateIncoming: true,
  // 发出翻译的目标语言：把客服写的中文译成什么语言发给客户
  outgoingLang: 'he',
  // 旧字段名（等价于 outgoingLang），保留以兼容历史数据
  sourceLang: 'he',
  // 接收翻译的目标语言：把客户消息译成什么语言（默认中文）
  targetLang: 'zh-CN',
  smartReply: false,
  enterSendMode: 'enter',
  // 禁止发送中文：默认开启，杜绝把中文直接发给客户
  blockChinese: true,
};

const SEED_ROLES = [
  {
    title: '中希女性翻译专家',
    type: '翻译',
    prompt:
      '你是一名精通中文和现代希伯来语的女性翻译专家。请在保持原意、语气与礼貌程度的前提下进行翻译：口语自然，不添加解释，不使用括号注释，专有名词按当地习惯处理。客户消息译成中文，客服回复译成现代希伯来语。',
  },
  {
    title: '跨境电商客服',
    type: '客服',
    prompt:
      '你是跨境电商售前客服。语气友好克制，优先回答价格、尺码、物流与售后。不要承诺无法兑现的时效，必要时用简短问句澄清需求。',
  },
];

function createRole(partial = {}) {
  return {
    id: crypto.randomUUID(),
    title: String(partial.title || '未命名角色').trim() || '未命名角色',
    type: partial.type || '翻译',
    prompt: String(partial.prompt || '').trim(),
    updatedAt: Date.now(),
  };
}

/** 旧版本用 sourceLang 表示「发出翻译的目标语言」，这里统一迁移到 outgoingLang */
function resolveOutgoingLang(value = {}) {
  const direct = String(value.outgoingLang || '').trim();
  if (direct) return direct;
  const legacy = String(value.sourceLang || '').trim();
  if (legacy && legacy !== 'auto') return legacy;
  return DEFAULT_TRANSLATION.outgoingLang;
}

// ---------- 三层配置：对话（最具体）> 环境（按标签/账号）> 全局 ----------
// 环境级只保存用户显式改过的字段，其它字段「跟随全局」；
// 对话级同理，只保存相对环境/全局的差异。这样改环境默认值时，
// 没有被单独改过的对话会立刻跟着变，不会被历史快照悄悄挡住。

/** 环境级可以覆盖的字段 */
const ENV_TRANSLATION_KEYS = [
  'channel',
  'roleId',
  'apiKey',
  'baseUrl',
  'translateOutgoing',
  'translateIncoming',
  'outgoingLang',
  'targetLang',
  'blockChinese',
  'enterSendMode',
];

const BOOLEAN_TRANSLATION_KEYS = ['translateOutgoing', 'translateIncoming', 'blockChinese'];
const ENTER_SEND_MODE_IDS = ['enter', 'ctrlEnter', 'dualInput'];

function hasKey(obj, key) {
  return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
}

/** 把单个字段的原始输入清洗成可存储的值；null 表示「跟随上一级」 */
function cleanTranslationValue(key, value) {
  if (value == null) return null;
  if (BOOLEAN_TRANSLATION_KEYS.includes(key)) return !!value;
  if (key === 'enterSendMode') return ENTER_SEND_MODE_IDS.includes(value) ? value : null;
  const text = String(value).trim();
  return text || null;
}

/**
 * 把渲染进程提交的补丁合并进某层配置。
 * 传 null（或空串）表示该字段「跟随上一级」→ 从本层删除。
 */
function mergeTranslationLayer(current, patch) {
  const out = { ...(current || {}) };
  if (!patch || typeof patch !== 'object') return out;
  ENV_TRANSLATION_KEYS.forEach((key) => {
    if (!hasKey(patch, key)) return;
    const value = cleanTranslationValue(key, patch[key]);
    if (value == null) delete out[key];
    else out[key] = value;
  });
  return out;
}

/** 用一层（可能为空的）配置覆盖基础配置 */
function applyTranslationLayer(base, layer) {
  if (!layer) return { ...base };
  const out = { ...base };
  ENV_TRANSLATION_KEYS.forEach((key) => {
    if (!hasKey(layer, key)) return;
    const value = layer[key];
    if (value == null) return;
    out[key] = value;
  });
  return out;
}

function normalizeTranslation(value = {}) {
  const raw = value || {};
  const outgoingLang = resolveOutgoingLang(raw);
  return {
    ...DEFAULT_TRANSLATION,
    ...raw,
    outgoingLang,
    // sourceLang 与 outgoingLang 始终一致，避免老逻辑读到过期值
    sourceLang: outgoingLang,
    translateOutgoing: raw.translateOutgoing !== false,
    translateIncoming: raw.translateIncoming !== false,
    smartReply: !!raw.smartReply,
    // 缺省即视为开启，只有显式关掉才允许发送中文
    blockChinese: raw.blockChinese !== false,
    enterSendMode: ['enter', 'ctrlEnter', 'dualInput'].includes(raw.enterSendMode)
      ? raw.enterSendMode
      : 'enter',
  };
}

function normalizeRole(role) {
  return {
    id: role.id || crypto.randomUUID(),
    title: String(role.title || '未命名角色').trim() || '未命名角色',
    type: role.type || '自定义',
    prompt: String(role.prompt || ''),
    updatedAt: role.updatedAt || Date.now(),
  };
}

module.exports = {
  DEFAULT_TRANSLATION,
  SEED_ROLES,
  LANG_LABELS,
  CHANNEL_LABELS,
  ENV_TRANSLATION_KEYS,
  createRole,
  normalizeTranslation,
  normalizeRole,
  resolveOutgoingLang,
  cleanTranslationValue,
  mergeTranslationLayer,
  applyTranslationLayer,
};
