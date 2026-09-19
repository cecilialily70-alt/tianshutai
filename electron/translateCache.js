const path = require('path');
const fs = require('fs');

const TTL_MS = 48 * 60 * 60 * 1000;

function createFileCache(userData) {
  const file = path.join(userData, 'translate-cache.json');
  const tmpFile = file + '.tmp';
  /** @type {{ rows: Record<string, { text: string, translated: string, ts: number, channel: string }> }} */
  let db = { rows: {} };
  try {
    db = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!db.rows || typeof db.rows !== 'object') db = { rows: {} };
  } catch {
    db = { rows: {} };
  }

  let timer = null;
  // 原子写入：先写临时文件再 rename，避免进程被强杀/崩溃时产生截断或损坏的 JSON
  const writeNow = () => {
    try {
      fs.writeFileSync(tmpFile, JSON.stringify(db));
      fs.renameSync(tmpFile, file);
    } catch (error) {
      console.error('[Main] 翻译缓存落盘失败', error.message || error);
      try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch (e) {}
    }
  };
  const persist = () => {
    clearTimeout(timer);
    timer = setTimeout(writeNow, 200);
  };

  return {
    get(msgId) {
      const row = db.rows[msgId];
      if (!row) return null;
      if (Date.now() - Number(row.ts || 0) > TTL_MS) {
        delete db.rows[msgId];
        persist();
        return null;
      }
      return row;
    },
    set(msgId, record) {
      db.rows[msgId] = {
        text: record.text,
        translated: record.translated,
        channel: record.channel,
        ts: Date.now(),
      };
      persist();
    },
    delete(msgId) {
      if (db.rows[msgId]) {
        delete db.rows[msgId];
        persist();
      }
    },
    // 退出前强制落盘，避免历史翻译在 debounce 窗口内丢失
    flush() {
      clearTimeout(timer);
      writeNow();
    },
  };
}

function createSqliteCache(userData) {
  const Database = require('better-sqlite3');
  const file = path.join(userData, 'translate-cache.sqlite');
  const db = new Database(file);
  db.exec(`
    CREATE TABLE IF NOT EXISTS translations (
      msg_id TEXT PRIMARY KEY,
      text TEXT,
      translated TEXT,
      channel TEXT,
      ts INTEGER
    )
  `);
  const select = db.prepare('SELECT text, translated, channel, ts FROM translations WHERE msg_id = ?');
  const upsert = db.prepare(
    'INSERT INTO translations (msg_id, text, translated, channel, ts) VALUES (@msg_id, @text, @translated, @channel, @ts) ON CONFLICT(msg_id) DO UPDATE SET text=@text, translated=@translated, channel=@channel, ts=@ts',
  );
  const remove = db.prepare('DELETE FROM translations WHERE msg_id = ?');
  const purge = db.prepare('DELETE FROM translations WHERE ts < ?');
  purge.run(Date.now() - TTL_MS);

  return {
    get(msgId) {
      const row = select.get(msgId);
      if (!row) return null;
      if (Date.now() - Number(row.ts || 0) > TTL_MS) {
        remove.run(msgId);
        return null;
      }
      return row;
    },
    set(msgId, record) {
      upsert.run({
        msg_id: msgId,
        text: record.text,
        translated: record.translated,
        channel: record.channel,
        ts: Date.now(),
      });
    },
    delete(msgId) {
      remove.run(msgId);
    },
    flush() {
      // SQLite 同步写入，无需额外落盘；这里做一次 checkpoint 保证 WAL 持久化
      try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch (e) {}
    },
  };
}

function createTranslateCache(userData) {
  try {
    const cache = createSqliteCache(userData);
    console.log('[Main] 翻译缓存使用 SQLite');
    return cache;
  } catch (error) {
    console.warn('[Main] SQLite 不可用，回退 JSON 缓存', error.message || error);
    return createFileCache(userData);
  }
}

module.exports = { createTranslateCache, TTL_MS };
