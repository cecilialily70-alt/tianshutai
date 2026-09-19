export default function Switch({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-4 rounded-xl border border-shell-line bg-[#111b21] px-3 py-3 text-left transition hover:border-[#3b4a54]"
    >
      <span className="text-sm text-shell-text">{label}</span>
      <span
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 ease-shell ${
          checked ? 'bg-shell-wa' : 'bg-[#3b4a54]'
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ease-shell ${
            checked ? 'translate-x-[22px]' : 'translate-x-0.5'
          }`}
        />
      </span>
    </button>
  );
}
