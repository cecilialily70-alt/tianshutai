export default function InboxPage() {
  return (
    <section className="flex h-full flex-col bg-shell-bg p-6">
      <h1 className="text-lg font-medium">消息聚合</h1>
      <p className="mt-2 max-w-xl text-sm leading-6 text-shell-muted">
        阶段一仅预留入口。后续会在此汇总各隔离会话中的未读会话，而不共享默认 Session。
      </p>
      <div className="mt-6 rounded-xl border border-shell-line bg-shell-card p-5 text-sm text-shell-muted transition duration-300 ease-shell">
        暂无聚合消息
      </div>
    </section>
  );
}
