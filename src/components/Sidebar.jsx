const NAV_ITEMS = [
  {
    id: 'home',
    label: '首页',
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: 'inbox',
    label: '消息聚合',
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M4 6h16v12H4z" />
        <path d="m4 7 8 6 8-6" />
      </svg>
    ),
  },
  {
    id: 'settings',
    label: '设置',
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="12" cy="12" r="3" />
        <path d="M12 3.5v2.2M12 18.3V20.5M4.7 6.5l1.6 1.6M17.7 15.9l1.6 1.6M3.5 12h2.2M18.3 12H20.5M4.7 17.5l1.6-1.6M17.7 8.1l1.6-1.6" />
      </svg>
    ),
  },
];

// 作者信息：点击进入 Telegram 支持
const AUTHOR_NAME = '你说的对';
const TELEGRAM_USER = '@nsdd88';
const TELEGRAM_URL = 'https://t.me/nsdd88';

export default function Sidebar({ active, onChange }) {
  const openSupport = () => {
    // 主进程只放行 t.me，避免任意 URL 被外部浏览器打开
    window.shellAPI?.app?.openExternal?.(TELEGRAM_URL);
  };

  return (
    <aside className="flex w-14 shrink-0 flex-col items-center gap-2 border-r border-shell-line bg-[#0b141a] py-3">
      {NAV_ITEMS.map((item) => {
        const selected = active === item.id;
        return (
          <button
            key={item.id}
            type="button"
            title={item.label}
            onClick={() => onChange(item.id)}
            className={`flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-200 ease-shell ${
              selected
                ? 'bg-shell-accent text-white shadow-lg shadow-black/20'
                : 'text-shell-muted hover:bg-shell-card hover:text-shell-text'
            }`}
          >
            {item.icon}
          </button>
        );
      })}

      <button
        type="button"
        onClick={openSupport}
        title={`作者：${AUTHOR_NAME}\nTelegram 用户名：${TELEGRAM_USER}\n点击支持作者（打开 Telegram）`}
        className="mt-auto flex flex-col items-center gap-1 rounded-xl px-1 py-2 text-shell-muted transition-all duration-200 ease-shell hover:bg-shell-card hover:text-shell-wa"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
          <path d="M21.7 3.3a1 1 0 0 0-1.05-.16L2.9 10.02a1 1 0 0 0 .05 1.87l4.2 1.32 1.6 5.05a1 1 0 0 0 1.65.41l2.3-2.2 4.15 3.05a1 1 0 0 0 1.57-.6l3.4-14.5a1 1 0 0 0-.12-1.1zM9.6 13.3l-.5 3.1-1.1-3.5 8.9-5.6-7.3 6z" />
        </svg>
        <span className="text-[9px] leading-[11px] text-center">作者</span>
        <span className="text-[9px] leading-[11px] text-center text-shell-text">{AUTHOR_NAME}</span>
        <span className="text-[9px] leading-[11px] text-center">{TELEGRAM_USER}</span>
      </button>
    </aside>
  );
}
