export default function WindowEdgeDrag({ className, title = '右键拖拽移动窗口' }) {
  const startDrag = (event) => {
    if (event.button !== 2) return;
    event.preventDefault();
    event.stopPropagation();
    window.shellAPI?.window?.dragStart?.({
      screenX: event.screenX,
      screenY: event.screenY,
    });

    const onMove = (moveEvent) => {
      window.shellAPI?.window?.dragMove?.({
        screenX: moveEvent.screenX,
        screenY: moveEvent.screenY,
      });
    };
    const onUp = () => {
      window.shellAPI?.window?.dragEnd?.();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div
      title={title}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={startDrag}
      className={`z-30 bg-transparent ${className}`}
    />
  );
}
