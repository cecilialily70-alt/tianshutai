import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Sidebar from './components/Sidebar.jsx';
import TabBar from './components/TabBar.jsx';
import EnvConfigDrawer from './components/EnvConfigDrawer.jsx';
import EnvTranslateModal from './components/EnvTranslateModal.jsx';
import ZoomPanel from './components/ZoomPanel.jsx';
import PerChatConfigPanel from './components/PerChatConfigPanel.jsx';
import InboxPage from './pages/InboxPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import WindowEdgeDrag from './components/WindowEdgeDrag.jsx';
import { useChatConfig } from './context/ChatConfigContext.jsx';
import { createAccountTab, normalizeTab } from './lib/accountTab.js';

function nextAccountName(tabs) {
  const used = new Set(tabs.map((tab) => tab.name));
  let index = tabs.length + 1;
  while (used.has(`账户 ${index}`)) {
    index += 1;
  }
  return `账户 ${index}`;
}

export default function App() {
  const { activeChat } = useChatConfig();
  const [tabs, setTabs] = useState([]);
  const [activeTabId, setActiveTabId] = useState(null);
  const [nav, setNav] = useState('home');
  const [ready, setReady] = useState(false);
  const [envTabId, setEnvTabId] = useState(null);
  const [zoomTabId, setZoomTabId] = useState(null);
  const [envTranslateTabId, setEnvTranslateTabId] = useState(null);
  const [renameSignal, setRenameSignal] = useState({ tabId: null, n: 0 });
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const prevSidebarWidth = useRef(300);
  const persistTimer = useRef(null);
  const browserRef = useRef(null);
  const overlayOpen = Boolean(envTabId || zoomTabId || envTranslateTabId);

  const persist = useCallback((nextTabs, nextActiveId) => {
    if (!window.shellAPI?.tabs) return;
    window.clearTimeout(persistTimer.current);
    // 立即落盘，避免删除/新增在防抖窗口内被 tabs:load 或退出丢失
    window.shellAPI.tabs
      .save({ tabs: nextTabs, activeTabId: nextActiveId })
      .catch((error) => {
        console.error('[Renderer] 标签持久化失败', error);
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      try {
        if (!window.shellAPI?.tabs) {
          const fallback = createAccountTab('账户 1');
          if (!cancelled) {
            setTabs([fallback]);
            setActiveTabId(fallback.id);
            setReady(true);
          }
          return;
        }
        const data = await window.shellAPI.tabs.load();
        if (cancelled) return;
        setTabs((data.tabs || []).map(normalizeTab));
        setActiveTabId(data.activeTabId || data.tabs?.[0]?.id || null);
        setReady(true);
      } catch (error) {
        console.error('[Renderer] 读取标签失败', error);
        setReady(true);
      }
    }
    bootstrap();
    return () => {
      cancelled = true;
      window.clearTimeout(persistTimer.current);
    };
  }, []);

  useEffect(() => {
    window.shellAPI?.nav?.setView(nav);
  }, [nav]);

  useEffect(() => {
    window.shellAPI?.tabs?.setActive(activeTabId);
  }, [activeTabId]);

  useEffect(() => {
    const unsub = window.shellAPI?.tabs?.onStatus?.(({ tabId, status }) => {
      setTabs((prev) => prev.map((tab) => (tab.id === tabId ? { ...tab, status } : tab)));
    });
    return () => {
      unsub?.();
    };
  }, []);

  useEffect(() => {
    const unsub = window.shellAPI?.tabs?.onName?.(({ tabId, name }) => {
      setTabs((prev) => prev.map((tab) => (tab.id === tabId ? { ...tab, name } : tab)));
    });
    return () => {
      unsub?.();
    };
  }, []);

  // 注入脚本探测到本账号号码后同步到标签，用于右侧面板显示「所属账户」
  useEffect(() => {
    const unsub = window.shellAPI?.tabs?.onSelfPhone?.(({ tabId, selfPhone }) => {
      if (!tabId) return;
      setTabs((prev) =>
        prev.map((tab) => (tab.id === tabId ? { ...tab, selfPhone } : tab)),
      );
    });
    return () => {
      unsub?.();
    };
  }, []);

  // 主进程按出口 IP 自动探测时区/语言后，同步更新本地标签状态（无代理时同样生效）
  useEffect(() => {
    const unsub = window.shellAPI?.view?.onGeo?.((payload) => {
      if (!payload?.tabId) return;
      setTabs((prev) =>
        prev.map((tab) => {
          if (tab.id !== payload.tabId) return tab;
          return {
            ...tab,
            env: {
              ...(tab.env || {}),
              timezone: payload.timezone ?? tab.env?.timezone ?? '',
              language: payload.language ?? tab.env?.language ?? 'zh-CN',
            },
          };
        }),
      );
    });
    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, []);

  useEffect(() => {
    window.shellAPI?.overlay?.setOpen(overlayOpen);
    return () => {
      window.shellAPI?.overlay?.setOpen(false);
    };
  }, [overlayOpen]);

  useEffect(() => {
    const el = browserRef.current;
    if (!el || !window.shellAPI?.layout) return undefined;

    const report = () => {
      const rect = el.getBoundingClientRect();
      window.shellAPI.layout.reportBrowserBounds({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      });
    };

    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    window.addEventListener('resize', report);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', report);
    };
  }, [ready, nav]);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) || null,
    [tabs, activeTabId],
  );

  const commitState = useCallback(
    (nextTabs, nextActive) => {
      setTabs(nextTabs);
      setActiveTabId(nextActive);
      persist(nextTabs, nextActive);
    },
    [persist],
  );

  const handleAddTab = useCallback(() => {
    const tab = createAccountTab(nextAccountName(tabs));
    commitState([...tabs, tab], tab.id);
  }, [tabs, commitState]);

  const handleCloseTab = useCallback(
    (tabId) => {
      const index = tabs.findIndex((tab) => tab.id === tabId);
      if (index < 0) return;
      const next = tabs.filter((tab) => tab.id !== tabId);
      let nextActive = activeTabId;
      if (tabId === activeTabId) {
        const neighbor = next[index] || next[index - 1] || null;
        nextActive = neighbor?.id || null;
      }
      if (envTabId === tabId) setEnvTabId(null);
      if (zoomTabId === tabId) setZoomTabId(null);
      if (envTranslateTabId === tabId) setEnvTranslateTabId(null);
      commitState(next, nextActive);
    },
    [tabs, activeTabId, envTabId, zoomTabId, envTranslateTabId, commitState],
  );

  const handleRenameTab = useCallback(
    (tabId, name) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      commitState(
        tabs.map((tab) => (tab.id === tabId ? { ...tab, name: trimmed } : tab)),
        activeTabId,
      );
    },
    [tabs, activeTabId, commitState],
  );

  const handleReorder = useCallback(
    (fromId, toId) => {
      if (fromId === toId) return;
      const fromIndex = tabs.findIndex((tab) => tab.id === fromId);
      const toIndex = tabs.findIndex((tab) => tab.id === toId);
      if (fromIndex < 0 || toIndex < 0) return;
      const next = [...tabs];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      commitState(next, activeTabId);
    },
    [tabs, activeTabId, commitState],
  );

  const patchTab = useCallback(
    (tabId, patch) => {
      commitState(
        tabs.map((tab) => (tab.id === tabId ? { ...tab, ...patch } : tab)),
        activeTabId,
      );
    },
    [tabs, activeTabId, commitState],
  );

  const handleContextAction = useCallback(
    async (action, tab) => {
      if (action === 'env') {
        window.shellAPI?.overlay?.setOpen(true);
        setZoomTabId(null);
        setEnvTranslateTabId(null);
        setEnvTabId(tab.id);
        return;
      }
      if (action === 'zoom') {
        window.shellAPI?.overlay?.setOpen(true);
        setEnvTabId(null);
        setEnvTranslateTabId(null);
        setZoomTabId(tab.id);
        return;
      }
      if (action === 'envTranslate') {
        // 独立翻译设置：弹窗里配置「这个环境（这个标签/账号）所有对话」的翻译默认值
        window.shellAPI?.overlay?.setOpen(true);
        setEnvTabId(null);
        setZoomTabId(null);
        setEnvTranslateTabId(tab.id);
        return;
      }
      if (action === 'chat') {
        // 独立设置面板已停靠右侧，切回首页即可见
        setEnvTabId(null);
        setZoomTabId(null);
        setNav('home');
        return;
      }
      if (action === 'translation') {
        const visible = tab.translationVisible === false;
        patchTab(tab.id, { translationVisible: visible });
        try {
          await window.shellAPI?.view?.setTranslationVisible(tab.id, visible);
        } catch (error) {
          console.error('[Renderer] 切换译文显隐失败', error);
        }
      }
    },
    [patchTab],
  );

  useEffect(() => {
    const unsub = window.shellAPI?.tabs?.onContextAction?.(({ tabId, action }) => {
      if (action === 'edit') {
        setRenameSignal((prev) => ({ tabId, n: prev.n + 1 }));
        return;
      }
      const tab = tabs.find((item) => item.id === tabId);
      if (tab) handleContextAction(action, tab);
    });
    return () => {
      unsub?.();
    };
  }, [tabs, handleContextAction]);

  const handleZoomChange = useCallback(
    async (tabId, factor) => {
      patchTab(tabId, { zoomFactor: factor });
      try {
        await window.shellAPI?.view?.setZoom(tabId, factor);
      } catch (error) {
        console.error('[Renderer] 设置缩放失败', error);
      }
    },
    [patchTab],
  );

  const handleEnvSave = useCallback(
    async (tabId, env) => {
      patchTab(tabId, { env });
      try {
        await window.shellAPI?.view?.applyEnv(tabId, env);
      } catch (error) {
        console.error('[Renderer] 保存环境配置失败', error);
      }
      setEnvTabId(null);
    },
    [patchTab],
  );

  const envTab = tabs.find((tab) => tab.id === envTabId) || null;
  const zoomTab = tabs.find((tab) => tab.id === zoomTabId) || null;
  const envTranslateTab = tabs.find((tab) => tab.id === envTranslateTabId) || null;

  const handleToggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      if (!prev) prevSidebarWidth.current = sidebarWidth || 300;
      return !prev;
    });
    // 折叠/展开后显式通知主进程重算 BrowserView bounds
    window.setTimeout(() => {
      window.shellAPI?.layout?.updateBrowserViewBounds?.();
    }, 0);
  }, [sidebarWidth]);

  const handleSidebarResizeEnd = useCallback(() => {
    window.setTimeout(() => {
      window.shellAPI?.layout?.updateBrowserViewBounds?.();
    }, 0);
  }, []);

  return (
    <div className="relative flex h-full flex-col bg-shell-bg">
      <WindowEdgeDrag className="absolute bottom-0 left-0 top-10 w-1.5" />
      <WindowEdgeDrag className="absolute bottom-0 right-0 top-10 w-1.5" />
      <WindowEdgeDrag className="absolute inset-x-0 bottom-0 h-1.5" />
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelect={setActiveTabId}
        onAdd={handleAddTab}
        onClose={handleCloseTab}
        onRename={handleRenameTab}
        onReorder={handleReorder}
        renameSignal={renameSignal}
      />
      <div className="flex min-h-0 flex-1">
        <Sidebar active={nav} onChange={setNav} />
        <main className="relative flex min-w-0 flex-1 bg-shell-bg">
          {nav === 'inbox' && (
            <div className="min-w-0 flex-1">
              <InboxPage />
            </div>
          )}
          {nav === 'settings' && (
            <div className="min-w-0 flex-1">
              <SettingsPage />
            </div>
          )}
          {nav === 'home' && (
            <>
              <div id="browser-container" ref={browserRef} className="relative min-w-0 flex-1">
                {!activeTab && ready && (
                  <div className="flex h-full items-center justify-center text-sm text-shell-muted">
                    点击右上角 + 新增账户标签
                  </div>
                )}
              </div>
              <PerChatConfigPanel
                tab={activeTab}
                chat={activeChat[activeTabId] || null}
                width={sidebarWidth}
                collapsed={sidebarCollapsed}
                onWidthChange={setSidebarWidth}
                onToggleCollapse={handleToggleSidebar}
                onResizeEnd={handleSidebarResizeEnd}
              />
            </>
          )}
          {envTab && (
            <EnvConfigDrawer tab={envTab} onClose={() => setEnvTabId(null)} onSave={handleEnvSave} />
          )}
          {envTranslateTab && (
            <EnvTranslateModal tab={envTranslateTab} onClose={() => setEnvTranslateTabId(null)} />
          )}
          {zoomTab && (
            <ZoomPanel tab={zoomTab} onClose={() => setZoomTabId(null)} onChange={handleZoomChange} />
          )}
        </main>
      </div>
    </div>
  );
}
