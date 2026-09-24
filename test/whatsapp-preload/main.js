/**
 * preload-whatsapp.js 回归测试台。
 *
 * 覆盖两条最容易出事的链路：
 *  A. 历史翻译：真实 WhatsApp 新版 DOM（data-id 是纯十六进制、无 true_/false_ 前缀）
 *     下，打开对话时已加载的历史消息必须全部补翻。
 *  B. 发送拦截 + 翻译发送：输入中文按回车后，输入框必须被真正替换成外文，
 *     发出去的内容绝不能含中文（真实环境里 execCommand 换不掉 3 字以上的内容，
 *     曾导致中文被原样发出去）。
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const PRELOAD = path.join(__dirname, '..', '..', 'electron', 'preload-whatsapp.js');
const MOCK = path.join(__dirname, 'mock.html');

// 模拟翻译服务：返回希伯来语，绝不含中文
const HE_MAP = {
  测试: 'בדיקה',
  测试成功: 'הבדיקה הצליחה',
  修复需要重新打包: 'התיקון דורש אריזה מחדש',
};
const translateCalls = [];
const fakeTranslate = (text) => {
  translateCalls.push(text);
  return HE_MAP[text] || `תרגום-${text.length}`;
};

ipcMain.handle('translate-msg', (_event, payload = {}) => {
  const text = String(payload.text || '');
  return { ok: true, text: fakeTranslate(text), cached: false, channel: 'mock' };
});
ipcMain.handle('translate:run', (_event, payload = {}) => {
  const text = String(payload.text || '');
  return { ok: true, text: fakeTranslate(text), cached: false, channel: 'mock' };
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HAS_CHINESE = /[\u4e00-\u9fff]/;
const failures = [];
const check = (ok, message) => {
  if (!ok) failures.push(message);
  return ok;
};

async function run() {
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    show: false,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  await win.loadFile(MOCK);
  await sleep(5000); // 等 boot + 历史批量补翻两遍跑完

  // ───────────────── A. 历史翻译 ─────────────────
  const history = await win.webContents.executeJavaScript(`(() => {
    const rows = Array.from(document.querySelectorAll('[data-id]'));
    return {
      rowCount: rows.length,
      bubbleCount: document.querySelectorAll('.hyt-translate-container').length,
      rows: rows.map(r => ({
        id: r.getAttribute('data-id'),
        text: (r.querySelector('[data-testid="selectable-text"]')?.innerText || '').trim(),
        bubble: (r.querySelector('.hyt-translate-container')?.shadowRoot?.querySelector('.hyt-txt-x8A9P')?.textContent || '').trim(),
        host: r.querySelector('.hyt-translate-container')?.parentElement?.getAttribute('data-testid') || '(other)',
      })),
    };
  })()`);

  console.log('\n───── A. 历史翻译 ─────');
  history.rows.forEach((r) => {
    console.log(`  ${r.bubble ? '有译文' : '× 无译文'}  [${r.text.slice(0, 24)}]  →  ${r.bubble.slice(0, 26)}`);
  });
  check(history.rowCount === 7, `消息行应为 7，实际 ${history.rowCount}`);
  check(history.bubbleCount === 5, `译文气泡应为 5（纯中文 + 系统提示不翻），实际 ${history.bubbleCount}`);

  const needTranslate = ['שלום אחד', 'מה שלומך היום', 'אני בסדר תודה', 'תודה רבה לך', 'יום טוב'];
  needTranslate.forEach((text) => {
    const row = history.rows.find((r) => r.text === text);
    if (!check(!!row, `找不到消息：${text}`)) return;
    if (!check(!!row.bubble, `历史消息没被翻译：${text}`)) return;
    check(row.bubble === fakeTranslate(text), `译文内容不对：${text} → ${row.bubble}`);
  });
  const chineseRow = history.rows.find((r) => r.text.includes('你好'));
  if (chineseRow) check(!chineseRow.bubble, '纯中文消息不应该被翻译');
  const sysRow = history.rows.find((r) => r.text.includes('端到端加密'));
  if (sysRow) check(!sysRow.bubble, 'WhatsApp 系统提示不应该被翻译');

  // ───────────────── B. 发送拦截 + 翻译发送 ─────────────────
  console.log('\n───── B. 发送拦截 + 翻译发送 ─────');
  const cases = ['测试', '测试成功', '修复需要重新打包', '你还好吗？我在等你回复这是比较长的一句'];

  for (const source of cases) {
    await win.webContents.executeJavaScript(`window.__reset(); window.__type(${JSON.stringify(source)});`);
    await sleep(200);
    const before = await win.webContents.executeJavaScript('window.__editorText()');
    check(before === source, `打字后输入框内容应为「${source}」，实际「${before}」`);

    await win.webContents.executeJavaScript('window.__pressEnter()');
    // 等翻译 + 写入 + 发送（写入要等编辑器重渲染）
    await sleep(2500);

    const sent = await win.webContents.executeJavaScript('window.__sent()');
    const expect = fakeTranslate(source);
    console.log(
      `  ${sent.length === 1 && sent[0] === expect ? '✓' : '✗'} 输入「${source}」(${source.length}字) → 实际发出 ${JSON.stringify(sent)}`,
    );
    check(sent.length === 1, `「${source}」应恰好发出 1 条，实际 ${sent.length} 条`);
    if (sent.length) {
      check(sent[0] === expect, `发出的内容应为译文「${expect}」，实际「${sent[0]}」`);
      check(!HAS_CHINESE.test(sent[0]), `发出去的内容含中文！「${sent[0]}」`);
    }
    await win.webContents.executeJavaScript('window.__reset()');
  }

  // 禁止发送中文关闭时，应该原样发出（不拦截）
  console.log('\n───── C. 关闭「禁止发送中文」后应原样发送 ─────');
  await win.webContents.executeJavaScript(`window.__reset(); window.__type('不要翻译');`);
  await sleep(150);
  win.webContents.send('wa:settings', { blockChinese: false, translateOutgoing: false });
  await sleep(400);
  await win.webContents.executeJavaScript('window.__pressEnter()');
  await sleep(800);
  const sentRaw = await win.webContents.executeJavaScript('window.__sent()');
  console.log(`  实际发出 ${JSON.stringify(sentRaw)}`);
  check(sentRaw.length === 1 && sentRaw[0] === '不要翻译', '关闭拦截 + 关闭翻译后应原样发出中文');

  // 关闭翻译但保留「禁止发送中文」时，中文必须被直接拦下、发不出去
  console.log('\n───── D. 关闭翻译 + 开启禁止中文：中文必须被拦下 ─────');
  await win.webContents.executeJavaScript(`window.__reset(); window.__type('这段中文不许发出去');`);
  await sleep(150);
  win.webContents.send('wa:settings', { blockChinese: true, translateOutgoing: false });
  await sleep(400);
  await win.webContents.executeJavaScript('window.__pressEnter()');
  await sleep(1500);
  const sentBlocked = await win.webContents.executeJavaScript('window.__sent()');
  const boxAfter = await win.webContents.executeJavaScript('window.__editorText()');
  console.log(`  实际发出 ${JSON.stringify(sentBlocked)}；输入框仍保留「${boxAfter}」`);
  check(sentBlocked.length === 0, '关闭翻译时应把中文拦下，不能发出去');
  check(boxAfter === '这段中文不许发出去', '被拦下后原文应保留在输入框里，方便用户改');

  console.log('\n═════ 结论 ═════');
  if (failures.length) {
    failures.forEach((f) => console.log('  ✗ ' + f));
    console.log(`\n结果：失败（${failures.length} 项）`);
  } else {
    console.log('  ✓ 历史翻译、发送拦截、翻译发送、开关关闭后的放行，全部符合预期');
    console.log('\n结果：通过');
  }
  console.log(`\n（翻译请求共 ${translateCalls.length} 次）`);

  win.destroy();
  app.exit(failures.length ? 1 : 0);
}

app.whenReady().then(() =>
  run().catch((error) => {
    console.error('测试台异常', error);
    app.exit(2);
  }),
);
