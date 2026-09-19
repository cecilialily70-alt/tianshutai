import { useEffect, useMemo, useState } from 'react';
import DraggablePanel from './DraggablePanel.jsx';
import Switch from './ui/Switch.jsx';
import Field, { DarkInput, DarkSelect } from './ui/Field.jsx';
import { CHANNELS, ENTER_SEND_MODES, LANGUAGES } from '../lib/translation.js';

const EMPTY = {
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

export default function GlobalTranslateModal({ onClose }) {
  const [form, setForm] = useState(EMPTY);
  const [roles, setRoles] = useState([]);
  const [saving, setSaving] = useState(false);
  const [hint, setHint] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [settings, roleList] = await Promise.all([
          window.shellAPI.settings.get(),
          window.shellAPI.roles.list(),
        ]);
        if (cancelled) return;
        setForm({ ...EMPTY, ...(settings || {}) });
        setRoles(roleList || []);
      } catch (error) {
        console.error('[Renderer] 读取翻译设置失败', error);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const roleOptions = useMemo(
    () => [
      { id: '', label: '不使用角色指令' },
      ...roles.map((role) => ({ id: role.id, label: `${role.title} · ${role.type}` })),
    ],
    [roles],
  );

  const setField = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setHint('');
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await window.shellAPI.settings.save(form);
      setHint('已保存到本地');
    } catch (error) {
      console.error('[Renderer] 保存翻译设置失败', error);
      setHint('保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <DraggablePanel title="全局翻译设置" onClose={onClose} widthClass="w-[520px]">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
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
        </div>

        {(form.channel === 'deepseek' || form.channel === 'openai' || form.channel === 'claude') && (
          <div className="grid grid-cols-1 gap-3">
            <Field label="API Key">
              <DarkInput
                type="password"
                value={form.apiKey}
                onChange={(value) => setField('apiKey', value)}
                placeholder="仅保存在本机 electron-store"
              />
            </Field>
            <Field label="Base URL（可选）">
              <DarkInput
                value={form.baseUrl}
                onChange={(value) => setField('baseUrl', value)}
                placeholder="https://api.deepseek.com"
              />
            </Field>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Switch
            label="发送消息翻译"
            checked={form.translateOutgoing}
            onChange={(value) => setField('translateOutgoing', value)}
          />
          <Switch
            label="接收消息翻译"
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

        <Switch
          label="智能回复"
          checked={form.smartReply}
          onChange={(value) => setField('smartReply', value)}
        />

        <Field label="回车发送模式">
          <DarkSelect
            value={form.enterSendMode}
            onChange={(value) => setField('enterSendMode', value)}
            options={ENTER_SEND_MODES}
          />
        </Field>

        <div className="flex items-center justify-between pt-1">
          <span className="text-xs text-shell-muted">{hint}</span>
          <div className="flex gap-2">
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
      </div>
    </DraggablePanel>
  );
}
