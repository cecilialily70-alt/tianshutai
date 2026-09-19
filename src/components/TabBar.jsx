import { useEffect, useState } from 'react';
import WindowControls from './WindowControls.jsx';

const STATUS_COLOR = {
  online: 'bg-shell-wa',
  connecting: 'bg-[#53bdeb]',
  offline: 'bg-[#667781]',
};

export default function TabBar({
  tabs,
  activeTabId,
  onSelect,
  onAdd,
  onClose,
  onRename,
  onReorder,
  renameSignal,
}) {
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState('');
  const [draggingId, setDraggingId] = useState(null);

  const startRename = (tab) => {
    setEditingId(tab.id);
    setDraft(tab.name);
  };

  const commitRename = (tabId) => {
    onRename(tabId, draft);
    setEditingId(null);
  };

  useEffect(() => {
    if (!renameSignal?.tabId) return;
    const tab = tabs.find((item) => item.id === renameSignal.tabId);
    if (tab) startRename(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renameSignal]);

  return (
    <header className="drag-region flex h-10 shrink-0 items-stretch border-b border-shell-line bg-[#1a242b]">
      <div className="flex w-14 shrink-0 items-center justify-center text-[11px] font-semibold tracking-wide text-shell-wa">
        天枢
      </div>
      <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
        {tabs.map((tab) => {
          const active = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              draggable={editingId !== tab.id}
              onDragStart={(event) => {
                setDraggingId(tab.id);
                event.dataTransfer.setData('text/tab-id', tab.id);
                event.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
              }}
              onDrop={(event) => {
                event.preventDefault();
                const fromId = event.dataTransfer.getData('text/tab-id');
                if (fromId) onReorder(fromId, tab.id);
                setDraggingId(null);
              }}
              onDragEnd={() => setDraggingId(null)}
              className={`no-drag group relative flex max-w-[220px] min-w-[128px] items-center gap-2 border-r border-shell-line px-3 transition-colors duration-200 ease-shell ${
                active ? 'bg-shell-bg text-shell-text' : 'bg-transparent text-shell-muted hover:bg-shell-card'
              } ${draggingId === tab.id ? 'opacity-50' : ''}`}
              onClick={() => onSelect(tab.id)}
              onDoubleClick={() => startRename(tab)}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                // 不在此处 onSelect：右键切换标签会触发 attachActiveView 抢走原生菜单焦点，导致菜单闪一下就消失
                window.shellAPI?.tabs?.showContextMenu?.(tab.id);
              }}
            >
              {active && <span className="absolute inset-x-0 top-0 h-[2px] bg-shell-wa" />}
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${STATUS_COLOR[tab.status] || STATUS_COLOR.offline}`}
                title={tab.status === 'online' ? '在线' : tab.status === 'connecting' ? '连接中' : '离线'}
              />
              {editingId === tab.id ? (
                <input
                  autoFocus
                  value={draft}
                  className="w-full rounded bg-shell-card px-1 py-0.5 text-xs text-shell-text outline-none"
                  onChange={(event) => setDraft(event.target.value)}
                  onBlur={() => commitRename(tab.id)}
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') commitRename(tab.id);
                    if (event.key === 'Escape') setEditingId(null);
                  }}
                />
              ) : (
                <span className="truncate text-[12px]">{tab.name}</span>
              )}
              <button
                type="button"
                className="ml-auto flex h-5 w-5 items-center justify-center rounded text-shell-muted opacity-0 transition hover:bg-shell-hover hover:text-shell-text group-hover:opacity-100"
                title="关闭标签"
                onClick={(event) => {
                  event.stopPropagation();
                  onClose(tab.id);
                }}
              >
                ×
              </button>
            </div>
          );
        })}
        <button
          type="button"
          title="新增账户"
          onClick={onAdd}
          className="no-drag flex h-10 w-10 shrink-0 items-center justify-center text-lg text-shell-muted transition-colors hover:bg-shell-card hover:text-shell-text"
        >
          +
        </button>
      </div>
      <WindowControls />
    </header>
  );
}
