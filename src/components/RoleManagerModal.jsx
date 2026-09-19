import { useEffect, useState } from 'react';
import DraggablePanel from './DraggablePanel.jsx';
import Field, { DarkInput, DarkSelect } from './ui/Field.jsx';
import { ROLE_TYPES } from '../lib/translation.js';

function emptyDraft() {
  return { id: '', title: '', type: '翻译', prompt: '' };
}

export default function RoleManagerModal({ onClose }) {
  const [roles, setRoles] = useState([]);
  const [editing, setEditing] = useState(null);
  const [hint, setHint] = useState('');

  const refresh = async () => {
    try {
      const list = await window.shellAPI.roles.list();
      setRoles(list || []);
    } catch (error) {
      console.error('[Renderer] 读取角色列表失败', error);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const handleSaveRole = async () => {
    const title = editing.title.trim();
    const prompt = editing.prompt.trim();
    if (!title || !prompt) {
      setHint('标题和角色指令不能为空');
      return;
    }
    try {
      if (editing.id) {
        await window.shellAPI.roles.update(editing);
      } else {
        await window.shellAPI.roles.create(editing);
      }
      setEditing(null);
      setHint('已保存');
      await refresh();
    } catch (error) {
      console.error('[Renderer] 保存角色失败', error);
      setHint('保存失败');
    }
  };

  const handleDelete = async (role) => {
    const ok = window.confirm(`确定删除角色「${role.title}」？`);
    if (!ok) return;
    try {
      await window.shellAPI.roles.remove(role.id);
      if (editing?.id === role.id) setEditing(null);
      await refresh();
    } catch (error) {
      console.error('[Renderer] 删除角色失败', error);
    }
  };

  return (
    <DraggablePanel title="角色指令管理" onClose={onClose} widthClass="w-[760px]">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs text-shell-muted">本地存储，可被全局翻译设置中的「翻译角色」引用。</p>
        <button
          type="button"
          className="rounded-lg bg-shell-accent px-3 py-1.5 text-xs text-white transition hover:brightness-110"
          onClick={() => {
            setHint('');
            setEditing(emptyDraft());
          }}
        >
          新增角色
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-shell-line">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-[#1a242b] text-[11px] uppercase tracking-wider text-shell-muted">
            <tr>
              <th className="px-3 py-2 font-medium">标题</th>
              <th className="w-24 px-3 py-2 font-medium">类型</th>
              <th className="px-3 py-2 font-medium">角色指令</th>
              <th className="w-28 px-3 py-2 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {roles.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-shell-muted">
                  暂无角色，请点击新增
                </td>
              </tr>
            )}
            {roles.map((role) => (
              <tr key={role.id} className="border-t border-shell-line bg-[#111b21] align-top hover:bg-[#1c282f]">
                <td className="px-3 py-3 text-shell-text">{role.title}</td>
                <td className="px-3 py-3">
                  <span className="rounded-md bg-shell-card px-2 py-0.5 text-[11px] text-shell-wa">
                    {role.type}
                  </span>
                </td>
                <td className="px-3 py-3 text-xs leading-5 text-shell-muted">
                  <div className="line-clamp-3 whitespace-pre-wrap">{role.prompt}</div>
                </td>
                <td className="px-3 py-3">
                  <div className="flex flex-col gap-1">
                    <button
                      type="button"
                      className="rounded-md px-2 py-1 text-xs text-shell-text transition hover:bg-shell-hover"
                      onClick={() => {
                        setHint('');
                        setEditing({ ...role });
                      }}
                    >
                      编辑
                    </button>
                    <button
                      type="button"
                      className="rounded-md px-2 py-1 text-xs text-[#f87171] transition hover:bg-shell-hover"
                      onClick={() => handleDelete(role)}
                    >
                      删除
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="mt-4 space-y-3 rounded-xl border border-shell-line bg-[#111b21] p-4">
          <div className="text-sm text-shell-text">{editing.id ? '编辑角色' : '新增角色'}</div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="标题">
              <DarkInput
                value={editing.title}
                onChange={(value) => setEditing((prev) => ({ ...prev, title: value }))}
                placeholder="例如：中希女性翻译专家"
              />
            </Field>
            <Field label="类型">
              <DarkSelect
                value={editing.type}
                onChange={(value) => setEditing((prev) => ({ ...prev, type: value }))}
                options={ROLE_TYPES.map((type) => ({ id: type, label: type }))}
              />
            </Field>
          </div>
          <Field label="角色指令">
            <textarea
              rows={7}
              value={editing.prompt}
              onChange={(event) => setEditing((prev) => ({ ...prev, prompt: event.target.value }))}
              placeholder="你是一名精通中文和现代希伯来语的女性翻译专家..."
              className="w-full resize-y rounded-xl border border-shell-line bg-shell-card px-3 py-2 text-sm leading-6 text-shell-text outline-none transition focus:border-shell-accent"
            />
          </Field>
          <div className="flex items-center justify-between">
            <span className="text-xs text-shell-muted">{hint}</span>
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded-lg px-3 py-1.5 text-sm text-shell-muted transition hover:bg-shell-hover"
                onClick={() => setEditing(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="rounded-lg bg-[#005c4b] px-4 py-1.5 text-sm text-white transition hover:brightness-110"
                onClick={handleSaveRole}
              >
                保存角色
              </button>
            </div>
          </div>
        </div>
      )}
    </DraggablePanel>
  );
}
