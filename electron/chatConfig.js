const path = require('path');
const fs = require('fs');

function makeId(accountId, chatId) {
  return `${accountId}::${chatId}`;
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
      return { ...row };
    },
    set(accountId, chatId, config) {
      db.rows[makeId(accountId, chatId)] = {
        accountId,
        chatId,
        ...config,
        updatedAt: Date.now(),
      };
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
      nickname TEXT,
      remark TEXT,
      updated_at INTEGER
    )
  `);
  // 兼容旧表结构：若 nickname / remark 列不存在则补齐
  const cols = db.prepare(`PRAGMA table_info(chat_configs)`).all().map((c) => c.name);
  if (!cols.includes('nickname')) {
    db.exec(`ALTER TABLE chat_configs ADD COLUMN nickname TEXT`);
  }
  if (!cols.includes('remark')) {
    db.exec(`ALTER TABLE chat_configs ADD COLUMN remark TEXT`);
  }
  const select = db.prepare(
    'SELECT account_id, chat_id, channel, role_id, translate_outgoing, translate_incoming, source_lang, target_lang, nickname, remark, updated_at FROM chat_configs WHERE id = ?',
  );
  const upsert = db.prepare(`
    INSERT INTO chat_configs
      (id, account_id, chat_id, channel, role_id, translate_outgoing, translate_incoming, source_lang, target_lang, nickname, remark, updated_at)
    VALUES
      (@id, @account_id, @chat_id, @channel, @role_id, @translate_outgoing, @translate_incoming, @source_lang, @target_lang, @nickname, @remark, @updated_at)
    ON CONFLICT(id) DO UPDATE SET
      channel=@channel,
      role_id=@role_id,
      translate_outgoing=@translate_outgoing,
      translate_incoming=@translate_incoming,
      source_lang=@source_lang,
      target_lang=@target_lang,
      nickname=@nickname,
      remark=@remark,
      updated_at=@updated_at
  `);
  const remove = db.prepare('DELETE FROM chat_configs WHERE id = ?');

  const toConfig = (row) =>
    row
      ? {
          accountId: row.account_id,
          chatId: row.chat_id,
          channel: row.channel || '',
          roleId: row.role_id || '',
          translateOutgoing: row.translate_outgoing == null ? true : !!row.translate_outgoing,
          translateIncoming: row.translate_incoming == null ? true : !!row.translate_incoming,
          sourceLang: row.source_lang || 'auto',
          targetLang: row.target_lang || 'zh-CN',
          nickname: row.nickname || '',
          remark: row.remark || '',
          updatedAt: row.updated_at,
        }
      : null;

  return {
    get(accountId, chatId) {
      return toConfig(select.get(makeId(accountId, chatId)));
    },
    set(accountId, chatId, config) {
      upsert.run({
        id: makeId(accountId, chatId),
        account_id: accountId,
        chat_id: chatId,
        channel: config.channel || null,
        role_id: config.roleId || null,
        translate_outgoing: config.translateOutgoing == null ? null : config.translateOutgoing ? 1 : 0,
        translate_incoming: config.translateIncoming == null ? null : config.translateIncoming ? 1 : 0,
        source_lang: config.sourceLang || null,
        target_lang: config.targetLang || null,
        nickname: config.nickname || null,
        remark: config.remark || null,
        updated_at: Date.now(),
      });
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

module.exports = { createChatConfig };
