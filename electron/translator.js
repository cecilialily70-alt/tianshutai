const { LANG_LABELS } = require('./translation');

function langName(code) {
  return LANG_LABELS[code] || code || '目标语';
}

/** 发出翻译的目标语言：outgoingLang 优先，兼容旧的 sourceLang */
function outgoingLangCode(settings = {}) {
  const direct = String(settings.outgoingLang || '').trim();
  if (direct && direct !== 'auto') return direct;
  const legacy = String(settings.sourceLang || '').trim();
  if (legacy && legacy !== 'auto') return legacy;
  return 'he';
}

function buildPrompt({ text, direction, settings, rolePrompt }) {
  const inLang = langName(settings.targetLang || 'zh-CN');
  const outLang = langName(outgoingLangCode(settings));

  const task =
    direction === 'in'
      ? `将下列聊天消息翻译成${inLang}。只输出译文，不要解释，不要引号。`
      : `将下列客服待发消息翻译成${outLang}。只输出译文，不要解释，不要引号。`;

  const system = [rolePrompt, task].filter(Boolean).join('\n\n');
  return { system, user: text };
}

async function requestJson(ses, url, options = {}) {
  const runner = ses && typeof ses.fetch === 'function' ? ses.fetch.bind(ses) : fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 28000);
  try {
    const res = await runner(url, { ...options, signal: controller.signal });
    const raw = await res.text();
    let data = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = raw;
    }
    if (!res.ok) {
      const message = data?.error?.message || data?.message || `HTTP ${res.status}`;
      throw new Error(message);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function googleLang(code) {
  if (!code || code === 'auto') return 'auto';
  if (code === 'zh-CN') return 'zh-CN';
  if (code === 'zh-TW') return 'zh-TW';
  return String(code).split('-')[0];
}

async function translateGoogle(ses, text, direction, settings) {
  const sl = 'auto';
  const tl =
    direction === 'in'
      ? googleLang(settings.targetLang || 'zh-CN')
      : googleLang(outgoingLangCode(settings));
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(
    sl,
  )}&tl=${encodeURIComponent(tl)}&dt=t&q=${encodeURIComponent(text)}`;
  const data = await requestJson(ses, url);
  if (!Array.isArray(data) || !Array.isArray(data[0])) {
    throw new Error('谷歌翻译返回异常');
  }
  return data[0].map((part) => part?.[0] || '').join('');
}

async function translateOpenAICompat(ses, { baseUrl, apiKey, model, system, user }) {
  if (!apiKey) throw new Error('未配置 API Key');
  const endpoint = `${String(baseUrl || '').replace(/\/$/, '')}/chat/completions`;
  const data = await requestJson(ses, endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('模型未返回译文');
  return String(text).trim();
}

async function translateClaude(ses, { baseUrl, apiKey, system, user }) {
  if (!apiKey) throw new Error('未配置 API Key');
  const endpoint = `${String(baseUrl || 'https://api.anthropic.com').replace(/\/$/, '')}/v1/messages`;
  const data = await requestJson(ses, endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-3-5-sonnet-latest',
      max_tokens: 1024,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  const text = data?.content?.map((part) => part?.text || '').join('');
  if (!text) throw new Error('Claude 未返回译文');
  return String(text).trim();
}

async function translateText({ ses, text, direction, settings, rolePrompt, channelOverride }) {
  const input = String(text || '').trim();
  if (!input) return '';

  const channel = channelOverride || settings.channel || 'deepseek';
  if (channel === 'google') {
    return translateGoogle(ses, input, direction, settings);
  }

  const { system, user } = buildPrompt({ text: input, direction, settings, rolePrompt });
  if (channel === 'claude') {
    return translateClaude(ses, {
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
      system,
      user,
    });
  }

  const defaults =
    channel === 'openai'
      ? { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' }
      : { baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' };

  return translateOpenAICompat(ses, {
    baseUrl: settings.baseUrl || defaults.baseUrl,
    apiKey: settings.apiKey,
    model: defaults.model,
    system,
    user,
  });
}

module.exports = { translateText, langName, outgoingLangCode };
