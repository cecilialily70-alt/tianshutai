import { useState } from 'react';
import GlobalTranslateModal from '../components/GlobalTranslateModal.jsx';
import RoleManagerModal from '../components/RoleManagerModal.jsx';

const CARDS = [
  {
    id: 'translate',
    title: '全局翻译设置',
    desc: '通道、角色、收发翻译、语言方向、智能回复与回车发送。',
  },
  {
    id: 'roles',
    title: '角色指令管理',
    desc: '维护翻译/客服提示词，支持新增、编辑与删除。',
  },
];

export default function SettingsPage() {
  const [open, setOpen] = useState({ translate: false, roles: false });

  return (
    <section className="relative flex h-full flex-col bg-shell-bg p-6">
      <h1 className="text-lg font-medium">设置</h1>
      <p className="mt-2 max-w-xl text-sm leading-6 text-shell-muted">
        配置保存在本机 electron-store。弹窗可用标题栏拖动，也可按住窗口四边（支持右键）任意移动。
      </p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {CARDS.map((card) => (
          <button
            key={card.id}
            type="button"
            onClick={() => setOpen((prev) => ({ ...prev, [card.id]: true }))}
            className="rounded-xl border border-shell-line bg-shell-card p-5 text-left transition duration-300 ease-shell hover:-translate-y-0.5 hover:border-shell-accent"
          >
            <div className="text-sm text-shell-text">{card.title}</div>
            <div className="mt-2 text-xs leading-5 text-shell-muted">{card.desc}</div>
          </button>
        ))}
      </div>
      {open.translate && <GlobalTranslateModal onClose={() => setOpen((prev) => ({ ...prev, translate: false }))} />}
      {open.roles && <RoleManagerModal onClose={() => setOpen((prev) => ({ ...prev, roles: false }))} />}
    </section>
  );
}
