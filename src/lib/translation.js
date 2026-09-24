export const CHANNELS = [
  { id: 'deepseek', label: 'DeepSeek' },
  { id: 'google', label: '谷歌翻译' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'claude', label: 'Claude' },
];

export const LANGUAGES = [
  { id: 'auto', label: '自动检测' },
  { id: 'zh-CN', label: '中文（简体）' },
  { id: 'zh-TW', label: '中文（繁体）' },
  { id: 'en', label: '英语' },
  { id: 'he', label: '希伯来语' },
  { id: 'ar', label: '阿拉伯语' },
  { id: 'es', label: '西班牙语' },
  { id: 'pt', label: '葡萄牙语' },
  { id: 'ru', label: '俄语' },
  { id: 'fr', label: '法语' },
  { id: 'de', label: '德语' },
  { id: 'ja', label: '日语' },
  { id: 'ko', label: '韩语' },
  { id: 'th', label: '泰语' },
  { id: 'vi', label: '越南语' },
  { id: 'id', label: '印尼语' },
];

export const ROLE_TYPES = ['翻译', '客服', '智能回复', '自定义'];

// 发出翻译的目标语言：必须是一个确定语言，不能是「自动检测」
export const OUTGOING_LANGUAGES = LANGUAGES.filter((item) => item.id !== 'auto');

// 接收翻译的目标语言：同理，必须是确定语言
export const INCOMING_LANGUAGES = LANGUAGES.filter((item) => item.id !== 'auto');

export const ENTER_SEND_MODES = [
  { id: 'enter', label: 'Enter 翻译并发送' },
  { id: 'ctrlEnter', label: 'Ctrl+Enter 发送，Enter 换行' },
  { id: 'dualInput', label: '双输入框（译文区回车发送）' },
];
