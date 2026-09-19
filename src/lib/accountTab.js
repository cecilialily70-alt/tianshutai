export const DEFAULT_HOMEPAGE = 'https://web.whatsapp.com';

export const DEFAULT_ENV = {
  homepage: DEFAULT_HOMEPAGE,
  proxyMode: 'direct',
  proxyHost: '',
  proxyPort: '',
  proxyUser: '',
  proxyPass: '',
  userAgent: '',
  timezone: '',
  language: 'zh-CN',
  autoGeo: true,
  webrtc: 'filtered',
};

export function createAccountTab(name) {
  const id = crypto.randomUUID();
  return {
    id,
    accountId: id,
    name,
    status: 'offline',
    zoomFactor: 1,
    translationVisible: true,
    env: { ...DEFAULT_ENV },
  };
}

export function normalizeTab(tab) {
  return {
    ...tab,
    accountId: tab.accountId || tab.id,
    status: tab.status || 'offline',
    zoomFactor: typeof tab.zoomFactor === 'number' ? tab.zoomFactor : 1,
    translationVisible: tab.translationVisible !== false,
    env: { ...DEFAULT_ENV, ...(tab.env || {}) },
  };
}
