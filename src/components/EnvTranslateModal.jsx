import { useEffect, useMemo, useState } from 'react';
import DraggablePanel from './DraggablePanel.jsx';
import Switch from './ui/Switch.jsx';
import Field, { DarkInput, DarkSelect } from './ui/Field.jsx';
import {
  CHANNELS,
  ENTER_SEND_MODES,
  INCOMING_LANGUAGES,
  OUTGOING_LANGUAGES,
} from '../lib/translation.js';

// 环境级（每个标签 / 账号一套）可以覆盖的字段。
// 没打开「本环境自定义」的字段一律跟随全局设置。
const ENV_KEYS = [
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

const PAID_CHANNELS = ['deepseek', 'openai', 'claude'];

/** 一行字段 + 右上角「跟随全局 / 本环境自定义」切换 */
function OverrideField({ label, overridden, onToggle, children, hint }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-xs tracking-wide text-shell-muted">{label}</span>
        <button
          type="button"
          onClick={onToggle}
          title={overridden ? '点击改为跟随全局默认' : '点击为本环境单独设置'}
          className={`shrink-0 rounded-full px-2 py-[2px] text-[10px] leading-4 transition ${
            overridden
              ? 'bg-shell-wa/20 text-shell-wa hover:bg-shell-wa/30'
              : 'bg-[#202c33] text-shell-muted hover:text-shell-text'
          }`}
        >
          {overridden ? '本环境自定义' : '跟随全局'}
        </button>
      </div>
      <div className={overridden ? '' : 'pointer-events-none opacity-45'}>{children}</div>
      {hint ? <p className="mt-1 text-[11px] leading-5 text-shell-muted">{hint}</p> : null}
    </div>
  );
}

export default function EnvTranslateModal({ tab, onClose }) {
  const accountId = tab?.accountId || tab?.id || '';
  const [global, setGlobal] = useState(null);
  const [env, setEnv] = useState({});
  const [roles, setRoles] = useState([]);
  const [tabName, setTabName] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hint, setHint] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    window.shellAPI?.envTranslation
      ?.get(accountId, tab?.id)
      .then((data) => {
        if (cancelled) return;
        setGlobal(data?.global || null);
        setEnv(data?.env || {});
        setRoles(data?.roles || []);
        setTabName(data?.tabName || '');
      })
      .catch((error) => {
        console.error('[Renderer] 读取环境翻译设置失败', error);
        if (!cancelled) setHint('读取失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, tab?.id]);

  // 展示值 = 全局默认打底 + 本环境已覆盖的字段
  const form = useMemo(() => ({ ...(global || {}), ...env }), [global, env]);
  const overridden = useMemo(() => new Set(Object.keys(env || {})), [env]);
  const overrideCount = overridden.size;

  const roleOptions = useMemo(
    () => [
      { id: '', label: '不使用角色指令' },
      ...roles.map((role) => ({ id: role.id, label: `${role.title} · ${role.type}` })),
    ],
    [roles],
  );

  const toggleOverride = (key) => {
    setEnv((prev) => {
      const next = { ...prev };
      if (Object.prototype.hasOwnProperty.call(next, key)) delete next[key];
      else next[key] = form[key];
      return next;
    });
    setHint('');
  };

  const setField = (key, value) => {
    setEnv((prev) => ({ ...prev, [key]: value }));
    setHint('');
  };

  const buildPatch = (source) => {
    const patch = {};
    ENV_KEYS.forEach((key) => {
      // 显式传 null 表示「跟随全局」→ 主进程会删掉这一层里的该字段
      patch[key] = Object.prototype.hasOwnProperty.call(source, key) ? source[key] : null;
    });
    return patch;
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await window.shellAPI?.envTranslation?.save?.(accountId, buildPatch(env));
      if (result && result.ok === false) throw new Error(result.error || '保存失败');
      setEnv(result?.env || {});
      setHint(overrideCount ? '已保存，本环境所有对话立即生效' : '已保存：本环境完全跟随全局');
    } catch (error) {
      console.error('[Renderer] 保存环境翻译设置失败', error);
      setHint('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setSaving(true);
    try {
      await window.shellAPI?.envTranslation?.reset?.(accountId);
      setEnv({});
      setHint('已清空，本环境完全跟随全局设置');
    } catch (error) {
      console.error('[Renderer] 清空环境翻译设置失败', error);
      setHint('清空失败');
    } finally {
      setSaving(false);
    }
  };

  const effectiveChannel = form.channel || 'deepseek';
  const needsKey = PAID_CHANNELS.includes(effectiveChannel);

  return (
    <DraggablePanel
      title={`独立翻译设置 · ${tabName || '当前环境'}`}
      onClose={onClose}
      widthClass="w-[520px]"
    >
      <div className="space-y-4">
        <p className="rounded-lg border border-shell-line bg-[#111b21] px-3 py-2 text-[11px] leading-5 text-shell-muted">
          这里设置的是<b className="text-shell-text">本环境（本标签 / 本账号）所有对话的默认值</b>，
          优先级<b className="text-shell-text">高于全局设置</b>。
          没有打开「本环境自定义」的项会一直跟随全局；单个对话再单独设置过的话，以对话设置为准。
        </p>

        {loading ? (
          <div className="py-6 text-center text-xs text-shell-muted">加载中…</div>
        ) : (
          <>
            <div
              className={`rounded-lg border px-3 py-2 text-[11px] ${
                overrideCount
                  ? 'border-[#005c4b]/40 bg-[#005c4b]/10 text-shell-wa'
                  : 'border-shell-line bg-[#111b21] text-shell-muted'
              }`}
            >
              {overrideCount
                ? `已启用 ${overrideCount} 项本环境独立设置（覆盖全局）`
                : '当前完全跟随全局设置'}
            </div>

            <OverrideField
              label="翻译通道"
              overridden={overridden.has('channel')}
              onToggle={() => toggleOverride('channel')}
            >
              <DarkSelect
                value={effectiveChannel}
                onChange={(value) => setField('channel', value)}
                options={CHANNELS}
              />
            </OverrideField>

            {needsKey && (
              <>
                {!String(form.apiKey || '').trim() && (
                  <p className="rounded-lg bg-[#7f1d1d]/35 px-3 py-2 text-[11px] leading-5 text-[#fca5a5]">
                    这条通道还没填 API Key，翻译不会成功（消息会发不出去）。
                    把「翻译通道」换成「谷歌翻译」免密钥可用。
                  </p>
                )}
                <OverrideField
                  label="API Key"
                  overridden={overridden.has('apiKey')}
                  onToggle={() => toggleOverride('apiKey')}
                >
                  <DarkInput
                    type="password"
                    value={form.apiKey || ''}
                    onChange={(value) => setField('apiKey', value)}
                    placeholder="跟随全局时可留空"
                  />
                </OverrideField>
                <OverrideField
                  label="Base URL（可选）"
                  overridden={overridden.has('baseUrl')}
                  onToggle={() => toggleOverride('baseUrl')}
                >
                  <DarkInput
                    value={form.baseUrl || ''}
                    onChange={(value) => setField('baseUrl', value)}
                    placeholder="https://api.deepseek.com"
                  />
                </OverrideField>
              </>
            )}

            <OverrideField
              label="翻译角色"
              overridden={overridden.has('roleId')}
              onToggle={() => toggleOverride('roleId')}
            >
              <DarkSelect
                value={form.roleId || ''}
                onChange={(value) => setField('roleId', value)}
                options={roleOptions}
              />
            </OverrideField>

            <OverrideField
              label="发送消息翻译"
              overridden={overridden.has('translateOutgoing')}
              onToggle={() => toggleOverride('translateOutgoing')}
            >
              <Switch
                label="把要发出去的中文翻译成客户语言"
                checked={form.translateOutgoing !== false}
                onChange={(value) => setField('translateOutgoing', value)}
              />
            </OverrideField>

            <OverrideField
              label="接收消息翻译"
              overridden={overridden.has('translateIncoming')}
              onToggle={() => toggleOverride('translateIncoming')}
            >
              <Switch
                label="把客户发来的消息翻译成下面的语言"
                checked={form.translateIncoming !== false}
                onChange={(value) => setField('translateIncoming', value)}
              />
            </OverrideField>

            <OverrideField
              label="禁止发送中文"
              overridden={overridden.has('blockChinese')}
              onToggle={() => toggleOverride('blockChinese')}
              hint="打开后，任何含中文的内容都不会发给客户（会自动先翻译成目标语言）。"
            >
              <Switch
                label="含中文一律不允许直接发出去"
                checked={form.blockChinese !== false}
                onChange={(value) => setField('blockChinese', value)}
              />
            </OverrideField>

            <OverrideField
              label="发出翻译目标语言"
              overridden={overridden.has('outgoingLang')}
              onToggle={() => toggleOverride('outgoingLang')}
              hint="你写的中文会翻译成这个语言发给客户。"
            >
              <DarkSelect
                value={form.outgoingLang || 'he'}
                onChange={(value) => setField('outgoingLang', value)}
                options={OUTGOING_LANGUAGES}
              />
            </OverrideField>

            <OverrideField
              label="接收翻译目标语言"
              overridden={overridden.has('targetLang')}
              onToggle={() => toggleOverride('targetLang')}
              hint="客户发来的消息会翻译成这个语言给你看。"
            >
              <DarkSelect
                value={form.targetLang || 'zh-CN'}
                onChange={(value) => setField('targetLang', value)}
                options={INCOMING_LANGUAGES}
              />
            </OverrideField>

            <OverrideField
              label="回车发送模式"
              overridden={overridden.has('enterSendMode')}
              onToggle={() => toggleOverride('enterSendMode')}
            >
              <DarkSelect
                value={form.enterSendMode || 'enter'}
                onChange={(value) => setField('enterSendMode', value)}
                options={ENTER_SEND_MODES}
              />
            </OverrideField>

            <p className="text-[11px] leading-5 text-shell-muted">
              提示：本环境里已经单独设置过的对话不会被打扰；想让它跟着本环境走，
              在那个对话右侧的「独立翻译设置」里点「恢复环境默认」即可。
            </p>

            <div className="flex items-center justify-between pt-1">
              <span className="text-xs text-shell-muted">{hint}</span>
              <div className="flex gap-2">
                {overrideCount > 0 && (
                  <button
                    type="button"
                    disabled={saving}
                    className="rounded-lg px-3 py-1.5 text-sm text-[#f87171] transition hover:bg-shell-hover"
                    onClick={handleReset}
                  >
                    全部跟随全局
                  </button>
                )}
                <button
                  type="button"
                  className="rounded-lg px-3 py-1.5 text-sm text-shell-muted transition hover:bg-shell-hover hover:text-shell-text"
                  onClick={onClose}
                >
                  关闭
                </button>
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
    </DraggablePanel>
  );
}
