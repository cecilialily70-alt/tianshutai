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
  sourceLang: 'auto',
  targetLang: 'zh-CN',
  smartReply: false,
  enterSendMode: 'enter',
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

function normalizeTranslation(value = {}) {
  return {
    ...DEFAULT_TRANSLATION,
    ...value,
    translateOutgoing: value.translateOutgoing !== false,
    translateIncoming: value.translateIncoming !== false,
    smartReply: !!value.smartReply,
    enterSendMode: ['enter', 'ctrlEnter', 'dualInput'].includes(value.enterSendMode)
      ? value.enterSendMode
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
  createRole,
  normalizeTranslation,
  normalizeRole,
};
