const path = require('path');
const fs = require('fs');

function makeId(accountId, chatId) {
  return `${accountId}::${chatId}`;
}

// 对话级「翻译」字段（昵称/备注属于身份信息，不算翻译覆盖）
const TRANSLATION_FIELDS = [
  'channel',
  'roleId',
  'translateOutgoing',
  'translateIncoming',
  'outgoingLang',
  'targetLang',
  'blockChinese',
];

// 兼容旧字段：早期版本用 sourceLang 表示「发出翻译的目标语言」
const LEGACY_TRANSLATION_FIELDS = { sourceLang: 'outgoingLang' };

function isTranslationField(key) {
  return TRANSLATION_FIELDS.includes(key) || Object.prototype.hasOwnProperty.call(LEGACY_TRANSLATION_FIELDS, key);
}

/**
 * 只保留「显式设置过」的翻译字段（null / undefined / 空串都算没设置）。
 * 这样对话配置是一份「差异补丁」，环境或全局改默认值时不会被历史快照挡住。
 */
function pickTranslationPatch(row) {
  const out = {};
  if (!row) return out;
  TRANSLATION_FIELDS.forEach((key) => {
    const value = row[key];
    if (value == null || value === '') return;
    out[key] = value;
  });
  if (out.outgoingLang == null && row.sourceLang && row.sourceLang !== 'auto') {
    out.outgoingLang = row.sourceLang;
  }
  return out;
}

function hasTranslationOverride(row) {
  return Object.keys(pickTranslationPatch(row)).length > 0;
}

/** 去掉值为 null 的键，保持 JSON 文件干净 */
function compact(obj) {
  const out = {};
  Object.keys(obj || {}).forEach((key) => {
    const value = obj[key];
    if (value == null || value === '') return;
    out[key] = value;
  });
  return out;
}

function createFileChatConfig(userData) {
  const file = path.join(userData, 'chat-config.json');
  /** @type {{ rows: Record<string, any> }} */
  let db = { rows: {} };
  try {
    db = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!db.rows || typeof db.rows !== 'object') db = { rows: {} };
  } catch {
    db = { rows: {} };
  }

  let timer = null;
  const persist = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        fs.writeFileSync(file, JSON.stringify(db));
      } catch (error) {
        console.error('[Main] 独立配置落盘失败', error);
      }
    }, 360);
  };

  return {
    get(accountId, chatId) {
      const row = db.rows[makeId(accountId, chatId)];
      if (!row) return null;
      const config = { ...row };
      config.hasTranslationOverride = hasTranslationOverride(config);
      return config;
    },
    /** 补丁式保存：只覆盖传入的字段，其余保持原值 */
    set(accountId, chatId, patch) {
      const key = makeId(accountId, chatId);
      const current = db.rows[key] || { accountId, chatId };
      const next = { ...current, ...compact(patch) };
      // 显式传 null 表示清除该字段
      Object.keys(patch || {}).forEach((field) => {
        if (patch[field] == null) delete next[field];
      });
      db.rows[key] = { ...next, updatedAt: Date.now() };
      persist();
    },
    /** 只清掉翻译覆盖，保留昵称/备注 */
    resetTranslate(accountId, chatId) {
      const key = makeId(accountId, chatId);
      const current = db.rows[key];
      if (!current) return;
      TRANSLATION_FIELDS.forEach((field) => delete current[field]);
      delete current.sourceLang;
      db.rows[key] = { ...current, updatedAt: Date.now() };
      persist();
    },
    remove(accountId, chatId) {
      if (db.rows[makeId(accountId, chatId)]) {
        delete db.rows[makeId(accountId, chatId)];
        persist();
      }
    },
    getAllIdentity(accountId) {
      const list = [];
      Object.keys(db.rows).forEach((key) => {
        const row = db.rows[key];
        if (row.accountId !== accountId) return;
        if (!row.nickname && !row.remark) return;
        list.push({ chatId: row.chatId, nickname: row.nickname || '', remark: row.remark || '' });
      });
      return list;
    },
    /**
     * 一次性迁移：老版本会把「当时的全局配置」整份快照写进每个对话，
     * 导致之后改全局/环境默认值时这些对话纹丝不动。
     * 这里把与全局默认值完全相同的字段清掉（视为「用户没改过」），
     * 真正被单独改过的字段（与全局不同）保留。
     */
    cleanupLegacyOverrides(globalDefaults) {
      let touched = 0;
      Object.keys(db.rows).forEach((key) => {
        const row = db.rows[key];
        if (!row) return;
        const patch = pickTranslationPatch(row);
        let changed = false;
        Object.keys(patch).forEach((field) => {
          const fallback = globalDefaults?.[field];
          if (fallback == null) return;
          if (String(patch[field]) === String(fallback)) {
            delete row[field];
            changed = true;
          }
        });
        // 旧字段 source_lang 一律清掉，统一走 outgoingLang
        if (row.sourceLang && !patch.outgoingLang) {
          delete row.sourceLang;
          changed = true;
        }
        if (changed) touched += 1;
      });
      if (touched) persist();
      return touched;
    },
  };
}

function createSqliteChatConfig(userData) {
  const Database = require('better-sqlite3');
  const file = path.join(userData, 'chat-config.sqlite');
  const db = new Database(file);
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_configs (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      channel TEXT,
      role_id TEXT,
      translate_outgoing INTEGER,
      translate_incoming INTEGER,
      source_lang TEXT,
      target_lang TEXT,
      outgoing_lang TEXT,
      nickname TEXT,
      remark TEXT,
      block_chinese INTEGER,
      updated_at INTEGER
    )
  `);
  // 兼容旧表结构：缺少的列补齐
  const cols = db.prepare(`PRAGMA table_info(chat_configs)`).all().map((c) => c.name);
  if (!cols.includes('nickname')) db.exec(`ALTER TABLE chat_configs ADD COLUMN nickname TEXT`);
  if (!cols.includes('remark')) db.exec(`ALTER TABLE chat_configs ADD COLUMN remark TEXT`);
  if (!cols.includes('block_chinese')) db.exec(`ALTER TABLE chat_configs ADD COLUMN block_chinese INTEGER`);
  if (!cols.includes('outgoing_lang')) db.exec(`ALTER TABLE chat_configs ADD COLUMN outgoing_lang TEXT`);

  const select = db.prepare(
    'SELECT account_id, chat_id, channel, role_id, translate_outgoing, translate_incoming, source_lang, target_lang, outgoing_lang, nickname, remark, block_chinese, updated_at FROM chat_configs WHERE id = ?',
  );
  const upsert = db.prepare(`
    INSERT INTO chat_configs
      (id, account_id, chat_id, channel, role_id, translate_outgoing, translate_incoming, source_lang, target_lang, outgoing_lang, nickname, remark, block_chinese, updated_at)
    VALUES
      (@id, @account_id, @chat_id, @channel, @role_id, @translate_outgoing, @translate_incoming, @source_lang, @target_lang, @outgoing_lang, @nickname, @remark, @block_chinese, @updated_at)
    ON CONFLICT(id) DO UPDATE SET
      channel=@channel,
      role_id=@role_id,
      translate_outgoing=@translate_outgoing,
      translate_incoming=@translate_incoming,
      source_lang=@source_lang,
      target_lang=@target_lang,
      outgoing_lang=@outgoing_lang,
      nickname=@nickname,
      remark=@remark,
      block_chinese=@block_chinese,
      updated_at=@updated_at
  `);
  const remove = db.prepare('DELETE FROM chat_configs WHERE id = ?');
  const selectAll = db.prepare(
    'SELECT chat_id, channel, role_id, translate_outgoing, translate_incoming, source_lang, target_lang, outgoing_lang, nickname, remark, block_chinese FROM chat_configs WHERE account_id = ?',
  );
  const clearTranslate = db.prepare(
    'UPDATE chat_configs SET channel = NULL, role_id = NULL, translate_outgoing = NULL, translate_incoming = NULL, source_lang = NULL, target_lang = NULL, outgoing_lang = NULL, block_chinese = NULL, updated_at = ? WHERE id = ?',
  );

  /** 数据库行 → 只包含「显式设置过」的字段，其余交给环境/全局 */
  const toConfig = (row) => {
    if (!row) return null;
    const outgoingLang = row.outgoing_lang || (row.source_lang && row.source_lang !== 'auto' ? row.source_lang : '');
    const out = {
      accountId: row.account_id,
      chatId: row.chat_id,
      nickname: row.nickname || '',
      remark: row.remark || '',
      updatedAt: row.updated_at,
    };
    if (row.channel) out.channel = row.channel;
    if (row.role_id) out.roleId = row.role_id;
    if (row.translate_outgoing != null) out.translateOutgoing = !!row.translate_outgoing;
    if (row.translate_incoming != null) out.translateIncoming = !!row.translate_incoming;
    if (outgoingLang) out.outgoingLang = outgoingLang;
    if (row.target_lang) out.targetLang = row.target_lang;
    if (row.block_chinese != null) out.blockChinese = !!row.block_chinese;
    out.hasTranslationOverride = hasTranslationOverride(out);
    return out;
  };

  /** 现有一行 → upsert 参数（保持未提交的列不变） */
  const toRow = (accountId, chatId, patch) => {
    const id = makeId(accountId, chatId);
    const current = select.get(id);
    const has = (key) => Object.prototype.hasOwnProperty.call(patch || {}, key);
    const currentOutgoing =
      current?.outgoing_lang || (current?.source_lang && current.source_lang !== 'auto' ? current.source_lang : null);
    const outgoingLang = has('outgoingLang') ? patch.outgoingLang || null : currentOutgoing;
    const bool = (key, column) => {
      if (!has(key)) return current?.[column] ?? null;
      return patch[key] == null ? null : patch[key] ? 1 : 0;
    };
    return {
      id,
      account_id: accountId,
      chat_id: chatId,
      channel: has('channel') ? patch.channel || null : current?.channel || null,
      role_id: has('roleId') ? patch.roleId || null : current?.role_id || null,
      translate_outgoing: bool('translateOutgoing', 'translate_outgoing'),
      translate_incoming: bool('translateIncoming', 'translate_incoming'),
      // 旧列只在旧数据迁移时读取，新数据一律写 outgoing_lang
      source_lang: null,
      target_lang: has('targetLang') ? patch.targetLang || null : current?.target_lang || null,
      outgoing_lang: outgoingLang,
      nickname: has('nickname') ? String(patch.nickname || '').trim() || null : current?.nickname || null,
      remark: has('remark') ? String(patch.remark || '').trim() || null : current?.remark || null,
      block_chinese: bool('blockChinese', 'block_chinese'),
      updated_at: Date.now(),
    };
  };

  return {
    get(accountId, chatId) {
      return toConfig(select.get(makeId(accountId, chatId)));
    },
    /** 补丁式保存：只覆盖传入的字段，其余保持原值 */
    set(accountId, chatId, patch) {
      upsert.run(toRow(accountId, chatId, patch));
    },
    /** 只清掉翻译覆盖，保留昵称/备注 */
    resetTranslate(accountId, chatId) {
      clearTranslate.run(Date.now(), makeId(accountId, chatId));
    },
    remove(accountId, chatId) {
      remove.run(makeId(accountId, chatId));
    },
    getAllIdentity(accountId) {
      const rows = db
        .prepare(
          'SELECT chat_id, nickname, remark FROM chat_configs WHERE account_id = ? AND ((nickname IS NOT NULL AND nickname != \'\') OR (remark IS NOT NULL AND remark != \'\'))',
        )
        .all(accountId);
      return rows.map((row) => ({
        chatId: row.chat_id,
        nickname: row.nickname || '',
        remark: row.remark || '',
      }));
    },
    /** 见 file 版本注释：把整份全局快照里的「没改过」字段清掉 */
    cleanupLegacyOverrides(globalDefaults) {
      let touched = 0;
      const accounts = db.prepare('SELECT DISTINCT account_id FROM chat_configs').all();
      accounts.forEach(({ account_id: accountId }) => {
        selectAll.all(accountId).forEach((row) => {
          const config = toConfig({ ...row, account_id: accountId });
          if (!config) return;
          // 与全局默认值相同的字段，视为「用户没动过」→ 清成继承
          const same = {};
          TRANSLATION_FIELDS.forEach((field) => {
            const fallback = globalDefaults?.[field];
            if (fallback == null || config[field] == null) return;
            if (String(config[field]) === String(fallback)) same[field] = null;
          });
          if (Object.keys(same).length === 0) return;
          upsert.run(toRow(accountId, config.chatId, same));
          touched += 1;
        });
      });
      return touched;
    },
  };
}

function createChatConfig(userData) {
  try {
    const store = createSqliteChatConfig(userData);
    console.log('[Main] 独立翻译配置使用 SQLite');
    return store;
  } catch (error) {
    console.warn('[Main] SQLite 不可用，回退 JSON 独立配置', error.message || error);
    return createFileChatConfig(userData);
  }
}

module.exports = { createChatConfig, TRANSLATION_FIELDS, pickTranslationPatch, hasTranslationOverride, isTranslationField };
