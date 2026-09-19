import { useEffect, useState } from 'react';

export default function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const api = window.shellAPI?.window;
    if (!api?.onMaximizedChange) return undefined;
    const unsub = api.onMaximizedChange(setMaximized);
    return () => {
      unsub?.();
    };
  }, []);

  return (
    <div className="no-drag flex h-full shrink-0">
      <button
        type="button"
        className="flex h-10 w-11 items-center justify-center text-shell-muted transition-colors hover:bg-shell-hover hover:text-shell-text"
        title="最小化"
        onClick={() => window.shellAPI?.window.minimize()}
      >
        <svg viewBox="0 0 12 12" className="h-3 w-3" fill="currentColor">
          <rect x="1" y="5.25" width="10" height="1.5" rx="0.4" />
        </svg>
      </button>
      <button
        type="button"
        className="flex h-10 w-11 items-center justify-center text-shell-muted transition-colors hover:bg-shell-hover hover:text-shell-text"
        title={maximized ? '还原' : '最大化'}
        onClick={() => window.shellAPI?.window.maximize()}
      >
        {maximized ? (
          <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.2">
            <rect x="3.2" y="1.8" width="7" height="7" />
            <path d="M1.8 3.8h7v7h-7z" />
          </svg>
        ) : (
          <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.2">
            <rect x="2" y="2" width="8" height="8" />
          </svg>
        )}
      </button>
      <button
        type="button"
        className="flex h-10 w-11 items-center justify-center text-shell-muted transition-colors hover:bg-[#e81123] hover:text-white"
        title="关闭"
        onClick={() => window.shellAPI?.window.close()}
      >
        <svg viewBox="0 0 12 12" className="h-3 w-3" stroke="currentColor" strokeWidth="1.4">
          <path d="M2.5 2.5 9.5 9.5M9.5 2.5 2.5 9.5" />
        </svg>
      </button>
    </div>
  );
}
