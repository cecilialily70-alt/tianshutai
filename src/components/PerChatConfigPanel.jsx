import { useEffect, useMemo, useRef, useState } from 'react';
import Switch from './ui/Switch.jsx';
import Field, { DarkInput, DarkSelect } from './ui/Field.jsx';
import { CHANNELS, INCOMING_LANGUAGES, OUTGOING_LANGUAGES } from '../lib/translation.js';

const EMPTY = {
  channel: 'deepseek',
  roleId: '',
  translateOutgoing: true,
  translateIncoming: true,
  outgoingLang: 'he',
  targetLang: 'zh-CN',
  nickname: '',
  remark: '',
  // 禁止发送中文：默认打开
  blockChinese: true,
};

// 对话级可以单独覆盖的翻译字段（其余字段永远跟随「环境默认」）
const OVERRIDE_KEYS = [
  'channel',
  'roleId',
  'translateOutgoing',
  'translateIncoming',
  'outgoingLang',
  'targetLang',
  'blockChinese',
];

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
  const [form, setForm] = useState(EMPTY);
  // 「环境默认」基线：没被单独改过的字段显示/保存的就是它
  const [envDefaults, setEnvDefaults] = useState(null);
  const [roles, setRoles] = useState([]);
  const [perChat, setPerChat] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hint, setHint] = useState('');
  const [copied, setCopied] = useState(false);
  const resizeRef = useRef(null);
  const copyTimer = useRef(null);

  // 对话已经单独改过哪些翻译项（用于提示 + 决定是否显示「恢复环境默认」）
  const overrideKeys = useMemo(
    () => OVERRIDE_KEYS.filter((key) => perChat && perChat[key] != null),
    [perChat],
  );

  // 对话只展示纯数字号码（WhatsApp 标题常带 + 号、空格、连字符）
  const displayChatId = chatId.replace(/\D/g, '') || chatId;

  const handleCopyChatId = async () => {
    if (!displayChatId) return;
    try {
      const result = await window.shellAPI?.clipboard?.writeText?.(displayChatId);
      if (result && result.ok === false) throw new Error(result.error || '复制失败');
      setCopied(true);
      window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 1600);
    } catch (error) {
      console.error('[Renderer] 复制号码失败', error);
      setHint('复制失败');
    }
  };

  useEffect(
    () => () => {
      window.clearTimeout(copyTimer.current);
    },
    [],
  );

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
        setEnvDefaults(data.envDefaults || data.global || null);
        setForm({
          ...EMPTY,
          ...(data.envDefaults || data.global || {}),
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

  /**
   * 只提交「与环境默认不同」的翻译字段。
   * 相同且之前单独设置过的，显式传 null 取消覆盖，回到跟随环境默认。
   * 这样改环境默认值时，没被单独调过的对话会自动跟着变。
   */
  const buildPatch = () => {
    const patch = { nickname: form.nickname || '', remark: form.remark || '' };
    const base = envDefaults || {};
    OVERRIDE_KEYS.forEach((key) => {
      const value = form[key];
      const baseValue = base[key];
      const differs =
        typeof value === 'boolean' || typeof baseValue === 'boolean'
          ? value !== baseValue
          : String(value ?? '') !== String(baseValue ?? '');
      if (differs) patch[key] = value;
      else if (perChat && perChat[key] != null) patch[key] = null;
    });
    return patch;
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await window.shellAPI.chatConfig.save({
        accountId: tab.accountId,
        chatId,
        ...buildPatch(),
      });
      if (result && result.ok === false) throw new Error(result.error || '保存失败');
      setPerChat(result?.config || null);
      setHint('已保存到本机');
    } catch (error) {
      console.error('[Renderer] 保存独立配置失败', error);
      setHint('保存失败');
    } finally {
      setSaving(false);
    }
  };

  // 恢复「环境默认」：只清掉本对话的翻译覆盖，昵称/备注保留
  const handleReset = async () => {
    setSaving(true);
    try {
      const result = await window.shellAPI.chatConfig.resetTranslate(tab.accountId, chatId);
      const config = result?.config || null;
      setPerChat(config);
      setForm((prev) => ({
        ...prev,
        ...(envDefaults || {}),
        ...(config || {}),
        nickname: config?.nickname ?? prev.nickname,
        remark: config?.remark ?? prev.remark,
      }));
      setHint('已恢复环境默认设置');
    } catch (error) {
      console.error('[Renderer] 恢复环境默认失败', error);
      setHint('恢复失败');
    } finally {
      setSaving(false);
    }
  };

  // 昵称/备注失焦即保存（同时把已改动的翻译项一起落盘）
  const handleIdentityBlur = async () => {
    if (!chatId) return;
    try {
      const result = await window.shellAPI.chatConfig.save({
        accountId: tab.accountId,
        chatId,
        ...buildPatch(),
      });
      if (result && result.ok === false) throw new Error(result.error || '保存失败');
      setPerChat(result?.config || null);
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
          <span className="rounded-full bg-[#202c33] px-2 py-[2px] text-[10px] text-shell-muted">
            仅当前对话
          </span>
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
              <div
                role="button"
                tabIndex={0}
                title={`点击复制号码 ${displayChatId}`}
                onClick={handleCopyChatId}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    handleCopyChatId();
                  }
                }}
                className="flex cursor-pointer items-center gap-2 rounded transition hover:text-shell-text"
              >
                <span className="shrink-0">对话：</span>
                <span className="truncate font-medium text-shell-text" title={displayChatId}>
                  {displayChatId}
                </span>
                <span className="shrink-0 text-[10px]">{copied ? '已复制' : '复制'}</span>
              </div>
            </div>

            {overrideKeys.length > 0 ? (
              <div className="rounded-lg border border-[#005c4b]/40 bg-[#005c4b]/10 px-3 py-2 text-[11px] text-shell-wa">
                本对话单独设置了 {overrideKeys.length} 项，优先级高于环境默认和全局
              </div>
            ) : (
              <div className="rounded-lg border border-shell-line bg-[#111b21] px-3 py-2 text-[11px] text-shell-muted">
                当前跟随「环境默认」设置（右键标签 →「独立翻译设置」可改本环境默认值）
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
                  <Switch
                    label="禁止发送中文"
                    checked={form.blockChinese !== false}
                    onChange={(value) => setField('blockChinese', value)}
                  />
                </div>
                <p className="-mt-1 text-[11px] leading-5 text-shell-muted">
                  打开后，任何含中文的内容都不会发给客户（会自动先翻译成目标语言）。
                </p>

                <div className="grid grid-cols-1 gap-3">
                  <Field label="发出翻译目标语言">
                    <DarkSelect
                      value={form.outgoingLang || 'he'}
                      onChange={(value) => setField('outgoingLang', value)}
                      options={OUTGOING_LANGUAGES}
                    />
                  </Field>
                  <p className="-mt-1 text-[11px] leading-5 text-shell-muted">
                    你写的中文会翻译成这个语言发给客户。
                  </p>
                  <Field label="接收翻译目标语言">
                    <DarkSelect
                      value={form.targetLang || 'zh-CN'}
                      onChange={(value) => setField('targetLang', value)}
                      options={INCOMING_LANGUAGES}
                    />
                  </Field>
                  <p className="-mt-1 text-[11px] leading-5 text-shell-muted">
                    客户发来的消息会翻译成这个语言给你看。
                  </p>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <span className="text-xs text-shell-muted">{hint}</span>
                  <div className="flex gap-2">
                    {overrideKeys.length > 0 && (
                      <button
                        type="button"
                        disabled={saving}
                        title="只清掉本对话的翻译覆盖，昵称/备注保留"
                        className="rounded-lg px-3 py-1.5 text-sm text-[#f87171] transition hover:bg-shell-hover"
                        onClick={handleReset}
                      >
                        恢复环境默认
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
