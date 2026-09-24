const { contextBridge, ipcRenderer } = require('electron');

try {
  contextBridge.exposeInMainWorld('shellAPI', {
    platform: process.platform,
    window: {
      minimize: () => ipcRenderer.send('window:minimize'),
      maximize: () => ipcRenderer.send('window:maximize'),
      close: () => ipcRenderer.send('window:close'),
      dragStart: (point) => ipcRenderer.send('window:drag-start', point),
      dragMove: (point) => ipcRenderer.send('window:drag-move', point),
      dragEnd: () => ipcRenderer.send('window:drag-end'),
      onMaximizedChange: (callback) => {
        const listener = (_event, value) => callback(value);
        ipcRenderer.on('window:maximized', listener);
        return () => ipcRenderer.removeListener('window:maximized', listener);
      },
    },
    tabs: {
      load: () => ipcRenderer.invoke('tabs:load'),
      save: (payload) => ipcRenderer.invoke('tabs:save', payload),
      setActive: (tabId) => ipcRenderer.send('tabs:set-active', tabId),
      showContextMenu: (tabId) => ipcRenderer.invoke('show-tab-context-menu', tabId),
      onStatus: (callback) => {
        const listener = (_event, payload) => callback(payload);
        ipcRenderer.on('tabs:status', listener);
        return () => ipcRenderer.removeListener('tabs:status', listener);
      },
      onName: (callback) => {
        const listener = (_event, payload) => callback(payload);
        ipcRenderer.on('tabs:name', listener);
        return () => ipcRenderer.removeListener('tabs:name', listener);
      },
      onSelfPhone: (callback) => {
        const listener = (_event, payload) => callback(payload);
        ipcRenderer.on('tabs:self-phone', listener);
        return () => ipcRenderer.removeListener('tabs:self-phone', listener);
      },
      onContextAction: (callback) => {
        const listener = (_event, payload) => callback(payload);
        ipcRenderer.on('tab:context-action', listener);
        return () => ipcRenderer.removeListener('tab:context-action', listener);
      },
    },
    app: {
      openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
    },
    clipboard: {
      writeText: (text) => ipcRenderer.invoke('clipboard:write-text', text),
    },
    nav: {
      setView: (viewId) => ipcRenderer.send('nav:set-view', viewId),
    },
    layout: {
      reportBrowserBounds: (bounds) => ipcRenderer.send('layout:bounds', bounds),
      updateBrowserViewBounds: () => ipcRenderer.send('update-browser-view-bounds'),
    },
    overlay: {
      setOpen: (open) => ipcRenderer.send('overlay:set-open', open),
    },
    settings: {
      get: () => ipcRenderer.invoke('settings:get'),
      save: (payload) => ipcRenderer.invoke('settings:save', payload),
    },
    roles: {
      list: () => ipcRenderer.invoke('roles:list'),
      create: (payload) => ipcRenderer.invoke('roles:create', payload),
      update: (payload) => ipcRenderer.invoke('roles:update', payload),
      remove: (id) => ipcRenderer.invoke('roles:remove', id),
    },
    view: {
      setZoom: (tabId, factor) => ipcRenderer.invoke('view:set-zoom', { tabId, factor }),
      setTranslationVisible: (tabId, visible) =>
        ipcRenderer.invoke('view:set-translation-visible', { tabId, visible }),
      applyEnv: (tabId, env) => ipcRenderer.invoke('view:apply-env', { tabId, env }),
      reload: (tabId) => ipcRenderer.send('view:reload', tabId),
      getPartitionInfo: (accountId) => ipcRenderer.invoke('paths:partition-info', accountId),
      detectGeo: (tabId) => ipcRenderer.invoke('view:detect-geo', { tabId }),
      onGeo: (callback) => {
        const listener = (_event, payload) => callback(payload);
        ipcRenderer.on('env:geo', listener);
        return () => ipcRenderer.removeListener('env:geo', listener);
      },
    },
    chatConfig: {
      get: (accountId, chatId) => ipcRenderer.invoke('chat-config:get', { accountId, chatId }),
      save: (payload) => ipcRenderer.invoke('chat-config:save', payload),
      resetTranslate: (accountId, chatId) =>
        ipcRenderer.invoke('chat-config:reset-translate', { accountId, chatId }),
      remove: (accountId, chatId) => ipcRenderer.invoke('chat-config:remove', { accountId, chatId }),
      onActiveChat: (callback) => {
        const listener = (_event, payload) => callback(payload);
        ipcRenderer.on('chat:active', listener);
        return () => ipcRenderer.removeListener('chat:active', listener);
      },
    },
    // 环境级（每个标签/账号一套）翻译默认值，优先级：对话 > 环境 > 全局
    envTranslation: {
      get: (accountId, tabId) => ipcRenderer.invoke('env-translation:get', { accountId, tabId }),
      save: (accountId, patch) => ipcRenderer.invoke('env-translation:save', { accountId, patch }),
      reset: (accountId) => ipcRenderer.invoke('env-translation:reset', { accountId }),
    },
  });
} catch (error) {
  console.error('[Preload] contextBridge 暴露失败', error);
}
