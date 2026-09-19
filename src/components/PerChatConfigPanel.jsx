import { useEffect, useRef, useState } from 'react';
import Switch from './ui/Switch.jsx';
import Field, { DarkInput, DarkSelect } from './ui/Field.jsx';
import { CHANNELS, LANGUAGES } from '../lib/translation.js';

const EMPTY = {
  channel: 'deepseek',
  roleId: '',
  translateOutgoing: true,
  translateIncoming: true,
  sourceLang: 'auto',
  targetLang: 'zh-CN',
  nickname: '',
  remark: '',
};

const MIN_WIDTH = 240;
const MAX_WIDTH = 520;

export default function PerChatConfigPanel({
  tab,
  chat,
  width,
  collapsed,
  onWidthChange,
  onToggleCollapse,
  onResizeEnd,
}) {
  const chatId = chat?.chatId || '';
  const chatTitle = chat?.chatTitle || '';
  const [form, setForm] = useState(EMPTY);
  const [roles, setRoles] = useState([]);
  const [perChat, setPerChat] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hint, setHint] = useState('');
  const resizeRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    if (!chatId) {
      setLoading(false);
      setPerChat(null);
      setForm(EMPTY);
      return () => {
        cancelled = true;
      };
    }
    setLoading(true);
    window.shellAPI?.chatConfig
      ?.get(tab.accountId, chatId)
      .then((data) => {
        if (cancelled) return;
        setRoles(data.roles || []);
        setPerChat(data.perChat || null);
        setForm({
          ...EMPTY,
          ...(data.global || {}),
          ...(data.perChat || {}),
        });
      })
      .catch((error) => {
        console.error('[Renderer] 读取独立配置失败', error);
        if (!cancelled) setHint('读取失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab?.accountId, chatId]);

  // 拖拽手柄调整侧栏宽度；松开时通过 onResizeEnd 通知主进程重算 BrowserView bounds
  useEffect(() => {
    const handle = resizeRef.current;
    if (!handle) return undefined;
    const onPointerDown = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const startX = event.clientX;
      const startWidth = width;
      const onMove = (moveEvent) => {
        const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth - (moveEvent.clientX - startX)));
        onWidthChange?.(next);
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        onResizeEnd?.();
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    };
    handle.addEventListener('pointerdown', onPointerDown);
    return () => {
      handle.removeEventListener('pointerdown', onPointerDown);
    };
  }, [width, onWidthChange, onResizeEnd]);

  const roleOptions = [
    { id: '', label: '继承全局角色' },
    ...roles.map((role) => ({ id: role.id, label: `${role.title} · ${role.type}` })),
  ];

  const setField = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setHint('');
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await window.shellAPI.chatConfig.save({ accountId: tab.accountId, chatId, ...form });
      setPerChat({ ...form });
      setHint('已保存到本机');
    } catch (error) {
      console.error('[Renderer] 保存独立配置失败', error);
      setHint('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setSaving(true);
    try {
      await window.shellAPI.chatConfig.remove(tab.accountId, chatId);
      setPerChat(null);
      setHint('已恢复全局配置');
    } catch (error) {
      console.error('[Renderer] 恢复全局配置失败', error);
      setHint('恢复失败');
    } finally {
      setSaving(false);
    }
  };

  // 昵称/备注失焦即保存（只更新昵称/备注，不影响其它配置）
  const handleIdentityBlur = async () => {
    if (!chatId) return;
    try {
      await window.shellAPI.chatConfig.save({
        accountId: tab.accountId,
        chatId,
        channel: form.channel,
        roleId: form.roleId,
        translateOutgoing: form.translateOutgoing,
        translateIncoming: form.translateIncoming,
        sourceLang: form.sourceLang,
        targetLang: form.targetLang,
        nickname: form.nickname,
        remark: form.remark,
      });
      setPerChat({ ...form });
      setHint('已保存');
    } catch (error) {
      console.error('[Renderer] 保存昵称/备注失败', error);
      setHint('保存失败');
    }
  };

  if (collapsed) {
    return (
      <aside
        id="chat-settings-sidebar"
        className="relative flex shrink-0 flex-col items-center border-l border-shell-line bg-[#0b141a]"
        style={{ width: 32 }}
      >
        <button
          type="button"
          title="展开独立翻译设置"
          onClick={onToggleCollapse}
          className="mt-2 flex h-7 w-7 items-center justify-center rounded-lg text-shell-muted transition hover:bg-shell-hover hover:text-shell-text"
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M6 3 11 8 6 13" />
          </svg>
        </button>
      </aside>
    );
  }

  return (
    <aside
      id="chat-settings-sidebar"
      className="relative flex shrink-0 flex-col border-l border-shell-line bg-[#0b141a]"
      style={{ width }}
    >
      <div
        ref={resizeRef}
        className="absolute left-0 top-0 z-20 h-full w-1 cursor-col-resize bg-transparent transition hover:bg-shell-wa"
        title="拖拽调整宽度"
      />
      <div className="flex items-center justify-between border-b border-shell-line px-4 py-3">
        <div className="flex items-center gap-2">
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 text-shell-muted" fill="currentColor" aria-hidden="true">
            <circle cx="5" cy="3" r="1.2" />
            <circle cx="11" cy="3" r="1.2" />
            <circle cx="5" cy="8" r="1.2" />
            <circle cx="11" cy="8" r="1.2" />
            <circle cx="5" cy="13" r="1.2" />
            <circle cx="11" cy="13" r="1.2" />
          </svg>
          <h2 className="text-sm font-medium text-shell-text">独立翻译设置</h2>
        </div>
        <button
          type="button"
          title="折叠侧栏"
          onClick={onToggleCollapse}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-shell-muted transition hover:bg-shell-hover hover:text-shell-text"
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M10 3 5 8 10 13" />
          </svg>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {!chatId ? (
          <div className="py-6 text-center text-sm text-shell-muted">
            请先在 WhatsApp 中打开一个对话
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-lg border border-shell-line bg-[#111b21] px-3 py-2 text-xs text-shell-muted">
              <div>
                账户：<span className="text-shell-text">{tab?.name}</span>
              </div>
              <div className="truncate" title={chatTitle}>
                对话：<span className="text-shell-text">{chatTitle || chatId}</span>
              </div>
            </div>

            {perChat ? (
              <div className="rounded-lg border border-[#005c4b]/40 bg-[#005c4b]/10 px-3 py-2 text-[11px] text-shell-wa">
                已启用独立配置，覆盖全局翻译设置
              </div>
            ) : (
              <div className="rounded-lg border border-shell-line bg-[#111b21] px-3 py-2 text-[11px] text-shell-muted">
                当前使用全局默认配置
              </div>
            )}

            {loading ? (
              <div className="py-4 text-center text-xs text-shell-muted">加载中…</div>
            ) : (
              <>
                <Field label="ID">
                  <input
                    readOnly
                    value={chatId}
                    className="w-full rounded-xl border border-shell-line bg-[#0b141a] px-3 py-2.5 text-sm text-shell-muted outline-none"
                  />
                </Field>

                <Field label="昵称">
                  <DarkInput
                    value={form.nickname}
                    onChange={(value) => setField('nickname', value)}
                    onBlur={handleIdentityBlur}
                    placeholder="如：拉菲·梅辛格 5409"
                  />
                </Field>

                <Field label="备注">
                  <div className="relative">
                    <textarea
                      rows={3}
                      value={form.remark}
                      maxLength={120}
                      onChange={(event) => setField('remark', event.target.value)}
                      onBlur={handleIdentityBlur}
                      placeholder="如：资深机械技术员"
                      className="w-full resize-y rounded-xl border border-shell-line bg-[#111b21] px-3 py-2 text-sm leading-6 text-shell-text outline-none transition focus:border-shell-accent"
                    />
                    <span className="absolute bottom-2 right-3 text-[11px] text-shell-muted">
                      {form.remark.length}/120
                    </span>
                  </div>
                </Field>

                <Field label="翻译通道">
                  <DarkSelect
                    value={form.channel}
                    onChange={(value) => setField('channel', value)}
                    options={CHANNELS}
                  />
                </Field>

                <Field label="翻译角色">
                  <DarkSelect
                    value={form.roleId}
                    onChange={(value) => setField('roleId', value)}
                    options={roleOptions}
                  />
                </Field>

                <div className="grid grid-cols-1 gap-3">
                  <Switch
                    label="发送翻译"
                    checked={form.translateOutgoing}
                    onChange={(value) => setField('translateOutgoing', value)}
                  />
                  <Switch
                    label="收信翻译"
                    checked={form.translateIncoming}
                    onChange={(value) => setField('translateIncoming', value)}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="源语言">
                    <DarkSelect
                      value={form.sourceLang}
                      onChange={(value) => setField('sourceLang', value)}
                      options={LANGUAGES}
                    />
                  </Field>
                  <Field label="目标语言">
                    <DarkSelect
                      value={form.targetLang}
                      onChange={(value) => setField('targetLang', value)}
                      options={LANGUAGES.filter((item) => item.id !== 'auto')}
                    />
                  </Field>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <span className="text-xs text-shell-muted">{hint}</span>
                  <div className="flex gap-2">
                    {perChat && (
                      <button
                        type="button"
                        disabled={saving}
                        className="rounded-lg px-3 py-1.5 text-sm text-[#f87171] transition hover:bg-shell-hover"
                        onClick={handleReset}
                      >
                        恢复全局
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={saving}
                      className="rounded-lg bg-shell-accent px-4 py-1.5 text-sm text-white transition hover:brightness-110 disabled:opacity-60"
                      onClick={handleSave}
                    >
                      {saving ? '保存中…' : '保存'}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
