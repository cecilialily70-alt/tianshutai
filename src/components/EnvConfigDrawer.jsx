import { useEffect, useState } from 'react';
import DraggablePanel from './DraggablePanel.jsx';
import { DEFAULT_ENV } from '../lib/accountTab.js';

export default function EnvConfigDrawer({ tab, onClose, onSave }) {
  const [form, setForm] = useState({ ...DEFAULT_ENV, ...(tab.env || {}) });
  const [storagePath, setStoragePath] = useState('读取中…');
  const [geoInfo, setGeoInfo] = useState(null);
  const [detecting, setDetecting] = useState(false);
  const [systemTz] = useState(() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; }
  });

  useEffect(() => {
    setForm({ ...DEFAULT_ENV, ...(tab.env || {}) });
  }, [tab]);

  useEffect(() => {
    const unsub = window.shellAPI?.view?.onGeo?.((payload) => {
      if (payload?.tabId === tab.id) {
        setGeoInfo(payload.geo || payload);
        setForm((prev) => ({
          ...prev,
          timezone: payload.timezone ?? prev.timezone,
          language: payload.language ?? prev.language,
        }));
      }
    });
    return () => { if (typeof unsub === 'function') unsub(); };
  }, [tab.id]);

  useEffect(() => {
    let cancelled = false;
    window.shellAPI?.view
      ?.getPartitionInfo(tab.accountId)
      .then((info) => {
        if (!cancelled) setStoragePath(info?.storagePath || '独立持久化分区');
      })
      .catch((error) => {
        console.error('[Renderer] 读取分区路径失败', error);
        if (!cancelled) setStoragePath('读取失败');
      });
    return () => {
      cancelled = true;
    };
  }, [tab.accountId]);

  const setField = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleDetect = async () => {
    setDetecting(true);
    try {
      const res = await window.shellAPI?.view?.detectGeo?.(tab.id);
      if (res?.ok) {
        setGeoInfo({ timezone: res.timezone, language: res.language });
        setForm((prev) => ({
          ...prev,
          timezone: res.timezone ?? prev.timezone,
          language: res.language ?? prev.language,
        }));
      }
    } catch (error) {
      console.error('[Renderer] 地理探测失败', error);
    } finally {
      setDetecting(false);
    }
  };

  return (
    <DraggablePanel title={`环境配置 · ${tab.name}`} onClose={onClose} widthClass="w-[460px]">
      <div className="space-y-3 text-sm">
        <label className="block">
          <span className="text-xs text-shell-muted">隔离分区</span>
          <input
            readOnly
            value={`persist:${tab.accountId}`}
            className="mt-1 w-full rounded-lg border border-shell-line bg-[#111b21] px-3 py-2 text-xs text-shell-muted outline-none"
          />
        </label>
        <label className="block">
          <span className="text-xs text-shell-muted">独立缓存目录</span>
          <input
            readOnly
            value={storagePath}
            className="mt-1 w-full rounded-lg border border-shell-line bg-[#111b21] px-3 py-2 text-xs text-shell-muted outline-none"
          />
        </label>
        <label className="block">
          <span className="text-xs text-shell-muted">入口地址</span>
          <input
            value={form.homepage}
            onChange={(event) => setField('homepage', event.target.value)}
            className="mt-1 w-full rounded-lg border border-shell-line bg-[#111b21] px-3 py-2 text-shell-text outline-none focus:border-shell-accent"
          />
        </label>
        <label className="block">
          <span className="text-xs text-shell-muted">代理模式</span>
          <select
            value={form.proxyMode}
            onChange={(event) => setField('proxyMode', event.target.value)}
            className="mt-1 w-full rounded-lg border border-shell-line bg-[#111b21] px-3 py-2 text-shell-text outline-none focus:border-shell-accent"
          >
            <option value="direct">直连（不使用代理）</option>
            <option value="http">HTTP / HTTPS</option>
            <option value="socks5">SOCKS5</option>
          </select>
        </label>
        {form.proxyMode !== 'direct' && (
          <div className="grid grid-cols-3 gap-2">
            <input
              placeholder="主机"
              value={form.proxyHost}
              onChange={(event) => setField('proxyHost', event.target.value)}
              className="col-span-2 rounded-lg border border-shell-line bg-[#111b21] px-3 py-2 text-shell-text outline-none focus:border-shell-accent"
            />
            <input
              placeholder="端口"
              value={form.proxyPort}
              onChange={(event) => setField('proxyPort', event.target.value)}
              className="rounded-lg border border-shell-line bg-[#111b21] px-3 py-2 text-shell-text outline-none focus:border-shell-accent"
            />
            <input
              placeholder="用户名（可选）"
              value={form.proxyUser}
              onChange={(event) => setField('proxyUser', event.target.value)}
              className="col-span-3 rounded-lg border border-shell-line bg-[#111b21] px-3 py-2 text-shell-text outline-none focus:border-shell-accent"
            />
            <input
              type="password"
              placeholder="密码（可选）"
              value={form.proxyPass}
              onChange={(event) => setField('proxyPass', event.target.value)}
              className="col-span-3 rounded-lg border border-shell-line bg-[#111b21] px-3 py-2 text-shell-text outline-none focus:border-shell-accent"
            />
          </div>
        )}
        <label className="block">
          <span className="text-xs text-shell-muted">User-Agent（留空则使用 Chrome UA）</span>
          <textarea
            rows={3}
            value={form.userAgent}
            onChange={(event) => setField('userAgent', event.target.value)}
            className="mt-1 w-full resize-none rounded-lg border border-shell-line bg-[#111b21] px-3 py-2 text-xs text-shell-text outline-none focus:border-shell-accent"
          />
        </label>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-shell-muted">时区 / 语言跟随出口 IP 自动适配</div>
            <div className="text-[11px] text-shell-muted/70">保存或重载时自动探测 IP 归属地并同步</div>
          </div>
          <button
            type="button"
            onClick={() => setField('autoGeo', !form.autoGeo)}
            className={`relative h-5 w-9 shrink-0 rounded-full transition ${form.autoGeo ? 'bg-shell-accent' : 'bg-shell-line'}`}
          >
            <span
              className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${form.autoGeo ? 'left-[18px]' : 'left-0.5'}`}
            />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-xs text-shell-muted">时区（自动跟随 IP）</span>
            <input
              list="tz-list"
              value={form.timezone}
              placeholder={systemTz ? `跟随系统 (${systemTz})` : '如 Asia/Hong_Kong'}
              disabled={form.autoGeo}
              onChange={(event) => setField('timezone', event.target.value)}
              className="mt-1 w-full rounded-lg border border-shell-line bg-[#111b21] px-3 py-2 text-shell-text outline-none focus:border-shell-accent disabled:opacity-50"
            />
            <datalist id="tz-list">
              <option value="Asia/Hong_Kong" />
              <option value="Asia/Shanghai" />
              <option value="Asia/Taipei" />
              <option value="Asia/Singapore" />
              <option value="Asia/Tokyo" />
              <option value="Asia/Dubai" />
              <option value="Europe/London" />
              <option value="Europe/Moscow" />
              <option value="America/New_York" />
              <option value="America/Los_Angeles" />
              <option value="UTC" />
            </datalist>
          </label>
          <label className="block">
            <span className="text-xs text-shell-muted">语言（自动跟随 IP）</span>
            <input
              list="lang-list"
              value={form.language}
              placeholder="zh-CN"
              disabled={form.autoGeo}
              onChange={(event) => setField('language', event.target.value)}
              className="mt-1 w-full rounded-lg border border-shell-line bg-[#111b21] px-3 py-2 text-shell-text outline-none focus:border-shell-accent disabled:opacity-50"
            />
            <datalist id="lang-list">
              <option value="zh-CN" />
              <option value="zh-HK" />
              <option value="zh-TW" />
              <option value="en-US" />
              <option value="en-GB" />
              <option value="he-IL" />
              <option value="ar-SA" />
              <option value="ru-RU" />
            </datalist>
          </label>
        </div>
        <div className="flex items-center justify-between rounded-lg border border-shell-line bg-[#111b21] px-3 py-2">
          <div className="text-xs">
            {geoInfo ? (
              <span className="text-shell-text">
                出口 IP：<span className="text-shell-accent">{geoInfo.ip || '—'}</span>
                <span className="text-shell-muted"> · 时区 {geoInfo.timezone || '—'} · 语言 {geoInfo.language || '—'}</span>
              </span>
            ) : (
              <span className="text-shell-muted">尚未探测出口 IP（保存或重载后自动探测）</span>
            )}
          </div>
          <button
            type="button"
            onClick={handleDetect}
            disabled={detecting}
            className="shrink-0 rounded-lg border border-shell-line px-2 py-1 text-xs text-shell-muted transition hover:bg-shell-hover hover:text-shell-text disabled:opacity-50"
          >
            {detecting ? '探测中…' : '立即探测'}
          </button>
        </div>
        <p className="text-xs leading-5 text-shell-muted">
          保存后仅重载当前标签对应的隔离会话，不会影响其他账户的 Cookie 与缓存。
          开启自动适配后，时区/语言会跟随代理出口 IP 自动更新，无需手动填写。
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            className="rounded-lg px-3 py-1.5 text-shell-muted transition hover:bg-shell-hover hover:text-shell-text"
            onClick={onClose}
          >
            取消
          </button>
          <button
            type="button"
            className="rounded-lg bg-shell-accent px-3 py-1.5 text-white transition hover:brightness-110"
            onClick={() => onSave(tab.id, form)}
          >
            保存并重载
          </button>
        </div>
      </div>
    </DraggablePanel>
  );
}
