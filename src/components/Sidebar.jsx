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

export default function Sidebar({ active, onChange }) {
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
    </aside>
  );
}
