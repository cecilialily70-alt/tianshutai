try {
  const { ipcRenderer } = require('electron');

  const HOST_ATTR = 'data-hyt-host-x8A9P';
  const BUBBLE_HOST = 'data-hyt-bubble-x8A9P';
  const CONTAINER_CLASS = 'hyt-translate-container';
  const HAS_CHINESE = /[\u4e00-\u9fff]/;
  const HAS_FOREIGN = /[\u0590-\u05FF\u0600-\u06FF\u0400-\u04FF\u3040-\u30FF\uAC00-\uD7AF]|[A-Za-z]{3,}/;

  const state = {
    settings: {
      translationVisible: true,
      enterSendMode: 'enter',
      translateOutgoing: true,
      translateIncoming: true,
      channelLabel: 'GPT',
      outgoingLangLabel: '希伯来语',
    },
    busy: false,
    destroyed: false,
    observer: null,
    msgObserver: null,
    io: null,
    obsTimer: null,
    pollTimer: null,
    chatObserver: null,
    chatTimer: null,
    remarkObserver: null,
    sidebarObserver: null,
    convoKey: '',
    bootstrapped: false,
    historyIds: new Set(),
    queued: new Map(),
    active: 0,
    lastLoggedIn: null,
    chatId: '',
    chatTitle: '',
    customId: '',
    customNickname: '',
    customRemark: '',
  };

  // 发送锁：拦截翻译发送期间置 true，防止事件穿透/重复触发导致双发
  let isTranslatingAndSending = false;
  // 编辑消息锁：拦截“编辑消息”翻译期间置 true，防止填回译文时二次触发
  let isEditingAndTranslating = false;

  // 全局联系人映射表：{ 纯ID: 自定义昵称 }，用于左侧列表持续劫持
  window.globalContactMap = {};
  let sidebarRaf = null;

  const applyVisible = (visible) => {
    try {
      window.__TST_TRANS_VISIBLE = !!visible;
      document.documentElement.setAttribute('data-tst-trans', visible ? '1' : '0');
      const host = document.querySelector(`[${HOST_ATTR}]`);
      if (host) host.style.display = visible && isDualMode() ? 'block' : 'none';
      document.querySelectorAll(`.${CONTAINER_CLASS}`).forEach((node) => {
        node.style.display = visible ? '' : 'none';
      });
      console.log('[Preload-WhatsApp] 译文显隐', visible);
    } catch (error) {
      console.error('[Preload-WhatsApp] 应用译文显隐失败', error);
    }
  };

  function isDualMode() {
    return state.settings.enterSendMode === 'dualInput';
  }

  function mergeSettings(payload = {}) {
    state.settings = { ...state.settings, ...payload };
    applyVisible(state.settings.translationVisible !== false);
    syncDualBox();
  }

  function qsFirst(root, selectors) {
    for (const selector of selectors) {
      try {
        const found = (root || document).querySelector(selector);
        if (found) return found;
      } catch {
        /* 选择器不兼容时跳过 */
      }
    }
    return null;
  }

  function findFooter() {
    return qsFirst(document, [
      'footer',
      '[data-testid="conversation-compose"]',
      '[data-testid="compose-box"]',
      '#main footer',
    ]);
  }

  function findComposeBox() {
    const footer = findFooter() || document;
    return qsFirst(footer, [
      '[data-testid="conversation-compose-box-input"]',
      '[data-testid="compose-box-input"]',
      'div[contenteditable="true"][data-tab="10"]',
      'div[contenteditable="true"][role="textbox"]',
      '[contenteditable="true"][aria-label*="消息"]',
      '[contenteditable="true"][title*="消息"]',
      '[contenteditable="true"][aria-label*="message" i]',
      '[contenteditable="true"][title*="Type" i]',
      '[contenteditable="true"][title*="输入"]',
    ]);
  }

  function findActiveCompose(event) {
    try {
      // 最可靠：事件目标 / 当前焦点所在的 contenteditable，避免被同页其它输入框干扰
      const target = event?.target;
      if (target instanceof Element) {
        const editable = target.closest?.('[contenteditable="true"]');
        if (editable) return editable;
      }
      const active = document.activeElement;
      if (active instanceof Element && active !== document.body && active !== document.documentElement) {
        const editable = active.closest?.('[contenteditable="true"]');
        if (editable) return editable;
      }
    } catch (error) {
      /* 忽略，回退到选择器 */
    }
    return findComposeBox();
  }

  function findSendButton() {
    const footer = findFooter() || document;
    const direct = qsFirst(footer, [
      '[data-testid="send"]',
      'button[aria-label="发送"]',
      'button[aria-label="Send"]',
      'button[aria-label*="发送"]',
      'button[aria-label*="Send"]',
    ]);
    if (direct) return direct;
    const icon = qsFirst(footer, ['span[data-icon="send"]', 'span[data-icon="wds-ic-send-filled"]']);
    return icon ? icon.closest('button') || icon.parentElement : null;
  }

  function isEditingMode() {
    try {
      const footer = findFooter();
      if (!footer) return false;
      // 编辑消息时，输入区上方会出现“编辑消息”提示或对勾/叉号控制
      const marker = qsFirst(footer, [
        '[data-testid="edit-message"]',
        '[aria-label*="编辑消息" i]',
        '[aria-label*="编辑" i]',
        'span[data-icon="checkmark"]',
      ]);
      return !!marker;
    } catch (error) {
      return false;
    }
  }

  function findEditConfirmButton() {
    const footer = findFooter() || document;
    const check = qsFirst(footer, [
      'span[data-icon="checkmark"]',
      '[data-testid="checkmark"]',
      'button[aria-label*="确认编辑" i]',
    ]);
    if (check) return check.closest?.('button') || check.parentElement || check;
    return findSendButton();
  }

  async function confirmEdit(compose, translated) {
    setComposeText(compose, translated);
    await wait(40);
    const btn = findEditConfirmButton();
    if (btn && typeof btn.click === 'function') {
      btn.click();
    } else if (btn) {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    }
  }

  async function handleEditSend(compose, source) {
    if (isEditingAndTranslating) return;
    isEditingAndTranslating = true;
    const original = source;
    try {
      const translated = await requestTranslate(original, 'out');
      await confirmEdit(compose, translated);
      console.log('[Preload-WhatsApp] 编辑消息翻译完成', { chars: original.length });
    } catch (error) {
      console.error('[Preload-WhatsApp] 编辑翻译失败', error);
      setComposeText(compose, original);
    } finally {
      setTimeout(() => {
        isEditingAndTranslating = false;
      }, 300);
    }
  }

  function onEditKeydown(event) {
    try {
      if (!isEditingMode()) return;
      if (isEditingAndTranslating || isTranslatingAndSending) return;
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
      const compose = findActiveCompose(event);
      if (!compose) return;
      const source = getComposeText(compose);
      if (!source) return;
      if (!HAS_CHINESE.test(source)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      void handleEditSend(compose, source);
    } catch (error) {
      console.error('[Preload-WhatsApp] 编辑框回车拦截失败', error);
    }
  }

  function onEditConfirmClick(event) {
    try {
      if (!isEditingMode()) return;
      if (isEditingAndTranslating || isTranslatingAndSending) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const btn = target.closest?.('button');
      const confirmBtn = findEditConfirmButton();
      if (!btn || !confirmBtn) return;
      if (btn !== confirmBtn && !confirmBtn.contains(btn) && !btn.contains(confirmBtn)) return;
      const compose = findActiveCompose(event);
      if (!compose) return;
      const source = getComposeText(compose);
      if (!source) return;
      if (!HAS_CHINESE.test(source)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      void handleEditSend(compose, source);
    } catch (error) {
      console.error('[Preload-WhatsApp] 编辑确认拦截失败', error);
    }
  }

  function getComposeText(el) {
    if (!el) return '';
    return (el.innerText || el.textContent || '').replace(/\u200b/g, '').trim();
  }

  function setComposeText(el, text) {
    if (!el) return false;
    el.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    selection.removeAllRanges();
    selection.addRange(range);

    const inserted = document.execCommand('insertText', false, text);
    if (!inserted) {
      el.textContent = text;
      el.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: text,
        }),
      );
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return getComposeText(el).length > 0 || !text;
  }

  function dispatchEnter(el) {
    if (!el) return;
    const opts = {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
      composed: true,
    };
    // 只派发一次 keydown，禁止 keydown/keypress/keyup 三重派发导致重复发送
    el.dispatchEvent(new KeyboardEvent('keydown', opts));
  }

  function clickSend() {
    const btn = findSendButton();
    if (!btn) return false;
    // 只用原生 click() 一次，避免 dispatchEvent(click) 与 click() 叠加造成双重发送
    if (typeof btn.click === 'function') {
      btn.click();
      return true;
    }
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return true;
  }

  async function sendFilled(el, translated, preferEnter) {
    setComposeText(el, translated);
    await wait(40);
    if (preferEnter) {
      dispatchEnter(el);
      await wait(80);
      if (getComposeText(el)) clickSend();
      return;
    }
    if (!clickSend()) dispatchEnter(el);
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function ensureDualHost() {
    const footer = findFooter();
    if (!footer) return null;
    let host = document.querySelector(`[${HOST_ATTR}]`);
    if (!host) {
      host = document.createElement('div');
      host.setAttribute(HOST_ATTR, '1');
      host.style.cssText = 'display:block;margin:0;padding:0;';
      footer.appendChild(host);
      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = `
        <style>
          :host { all: initial; }
          .wrap {
            font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
            background: #111b21;
            border-top: 1px solid #2a3942;
            padding: 8px 12px 10px;
          }
          .hint {
            color: #8696a0;
            font-size: 11px;
            margin-bottom: 6px;
          }
          .box {
            display: flex;
            gap: 8px;
            align-items: flex-end;
          }
          textarea {
            flex: 1;
            min-height: 40px;
            max-height: 120px;
            resize: none;
            border: 1px solid #2a3942;
            border-radius: 10px;
            background: #202c33;
            color: #e9edef;
            padding: 8px 10px;
            font-size: 13px;
            line-height: 1.45;
            outline: none;
          }
          textarea:focus { border-color: #005c4b; }
          button {
            height: 36px;
            padding: 0 12px;
            border: 0;
            border-radius: 8px;
            background: #005c4b;
            color: #fff;
            cursor: pointer;
            font-size: 12px;
          }
          button[disabled] { opacity: .55; cursor: wait; }
        </style>
        <div class="wrap">
          <div class="hint"></div>
          <div class="box">
            <textarea rows="1" spellcheck="false"></textarea>
            <button type="button">发送</button>
          </div>
        </div>
      `;
      const textarea = shadow.querySelector('textarea');
      const button = shadow.querySelector('button');
      textarea.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' || event.shiftKey) return;
        event.preventDefault();
        event.stopPropagation();
        void submitDual(textarea, button);
      });
      button.addEventListener('click', () => {
        void submitDual(textarea, button);
      });
    } else if (host.parentElement !== footer) {
      footer.appendChild(host);
    }
    return host;
  }

  function syncDualBox() {
    try {
      const show = isDualMode() && state.settings.translationVisible !== false;
      if (!show) {
        const existing = document.querySelector(`[${HOST_ATTR}]`);
        if (existing) existing.style.display = 'none';
        return;
      }
      const host = ensureDualHost();
      if (!host || !host.shadowRoot) return;
      host.style.display = 'block';
      const hint = host.shadowRoot.querySelector('.hint');
      const channel = state.settings.channelLabel || 'GPT';
      const lang = state.settings.outgoingLangLabel || '希伯来语';
      hint.textContent = `发送消息 [${channel}翻译] => ${lang}`;
    } catch (error) {
      console.error('[Preload-WhatsApp] 同步双输入框失败', error);
    }
  }

  async function submitDual(textarea, button) {
    if (state.busy) return;
    const source = String(textarea.value || '').trim();
    if (!source) return;
    const compose = findComposeBox();
    if (!compose) {
      console.warn('[Preload-WhatsApp] 未找到 WhatsApp 输入框');
      return;
    }
    state.busy = true;
    const prevHint = textarea.placeholder;
    textarea.disabled = true;
    button.disabled = true;
    textarea.placeholder = '翻译中…';
    try {
      const translated = await requestTranslate(source, 'out');
      textarea.value = '';
      await sendFilled(compose, translated, true);
      console.log('[Preload-WhatsApp] 双输入框已翻译发送', { chars: source.length });
    } catch (error) {
      console.error('[Preload-WhatsApp] 双输入框翻译失败', error);
      textarea.placeholder = error.message || '翻译失败';
    } finally {
      textarea.disabled = false;
      button.disabled = false;
      textarea.placeholder = prevHint || '';
      state.busy = false;
      textarea.focus();
    }
  }

  async function requestTranslate(text, direction) {
    const shouldSkip =
      (direction === 'out' && state.settings.translateOutgoing === false) ||
      (direction === 'in' && state.settings.translateIncoming === false);
    if (shouldSkip) return text;
    const result = await ipcRenderer.invoke('translate:run', { text, direction, chatId: state.chatId });
    if (!result?.ok) throw new Error(result?.error || '翻译失败');
    return String(result.text || '').trim() || text;
  }

  function shouldInterceptEnter(event) {
    if (isDualMode()) return false;
    if (state.settings.translateOutgoing === false) return false;
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return false;
    if (state.settings.enterSendMode === 'ctrlEnter') return event.ctrlKey || event.metaKey;
    return !event.ctrlKey && !event.metaKey;
  }

  function onDocumentKeydown(event) {
    try {
      // 编辑消息模式走独立的 onEditKeydown，避免与普通发送拦截互相干扰
      if (isEditingMode()) return;
      if (isDualMode() || isTranslatingAndSending) return;
      if (!shouldInterceptEnter(event)) return;
      const compose = findActiveCompose(event);
      if (!compose) return;
      const source = getComposeText(compose);
      if (!source) return;
      if (state.settings.enterSendMode !== 'ctrlEnter' && !HAS_CHINESE.test(source)) return;
      // 彻底阻断原生发送：在进入异步翻译前立即拦截，阻止 WhatsApp 的 React 处理器收到此事件
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      void interceptAndSend(compose, source);
    } catch (error) {
      console.error('[Preload-WhatsApp] 拦截回车失败', error);
    }
  }

  async function interceptAndSend(compose, source) {
    if (isTranslatingAndSending) return;
    isTranslatingAndSending = true;
    const original = source;
    try {
      // 不再把“翻译中…”写入原输入框，输入框保留原文，仅靠锁阻止重复发送
      const translated = await requestTranslate(original, 'out');
      await sendFilled(compose, translated, false);
      console.log('[Preload-WhatsApp] 原输入框拦截翻译发送', { chars: original.length });
    } catch (error) {
      console.error('[Preload-WhatsApp] 拦截翻译失败', error);
      setComposeText(compose, original);
    } finally {
      // 发送彻底完成后延迟释放锁，避免残留事件再次触发发送
      setTimeout(() => {
        isTranslatingAndSending = false;
      }, 300);
    }
  }

  function isSendButton(btn) {
    const send = findSendButton();
    if (!send || !btn) return false;
    return btn === send || send.contains(btn) || btn.contains(send);
  }

  function onDocumentClickCapture(event) {
    try {
      // 兜底：阻止用户直接点击“发送”按钮把中文发出去
      if (isEditingMode()) return;
      if (isDualMode() || isTranslatingAndSending) return;
      if (state.settings.translateOutgoing === false) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const btn = target.closest?.('button');
      if (!btn || !isSendButton(btn)) return;
      const compose = findActiveCompose(event);
      if (!compose) return;
      const source = getComposeText(compose);
      if (!source) return;
      if (!HAS_CHINESE.test(source)) return;
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
      void interceptAndSend(compose, source);
    } catch (error) {
      console.error('[Preload-WhatsApp] 拦截发送按钮失败', error);
    }
  }

  function findMessagePanel() {
    return qsFirst(document, [
      '[data-testid="conversation-panel-messages"]',
      '[data-testid="conversation-panel-wrapper"]',
      '#main div[role="application"]',
      '#main',
    ]);
  }

  function findScrollRoot(panel) {
    let node = panel;
    while (node && node !== document.body) {
      const style = window.getComputedStyle(node);
      if (/(auto|scroll)/.test(style.overflowY)) return node;
      node = node.parentElement;
    }
    return panel;
  }

  const HEADER_BLACKLIST = ['个人主页详情', 'Profile details', 'Search', '搜索', '搜索或开始新对话'];

  function findMainRegion() {
    return qsFirst(document, ['div#main', '#main']);
  }

  function findConversationHeader() {
    // 严格限定在右侧主聊天区域 #main 内搜索，绝不触碰左侧列表
    const main = findMainRegion() || document;
    return qsFirst(main, [
      '[data-testid="conversation-header"]',
      '#main header',
      'header',
      '[data-testid="conversation-info-header"]',
      '[data-testid="conversation-info"]',
    ]);
  }

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

  function findAvatarContainer(header) {
    if (!header) return null;
    const img = qsFirst(header, ['img', 'img[src]']);
    if (img) return img.closest('div') || img.parentElement;
    return null;
  }

  function findHeaderTitleNode(header) {
    // 头像容器 → 下一个兄弟节点（多行文本容器）→ 第一个带可见文本的 span（通常 dir="auto"）
    const avatar = findAvatarContainer(header);
    if (avatar) {
      let sibling = avatar.nextElementSibling;
      while (sibling) {
        const span = qsFirst(sibling, ['span[dir="auto"]', 'span[title]']);
        const text = (span?.innerText || span?.textContent || '').trim();
        if (text) return span;
        sibling = sibling.nextElementSibling;
      }
    }
    // 兜底：header 内第一个 dir="auto" 可见 span
    return qsFirst(header, ['span[dir="auto"]', 'span[title]']);
  }

  function extractHeaderTitle(header) {
    const node = findHeaderTitleNode(header);
    const raw = (node?.innerText || node?.textContent || node?.getAttribute?.('title') || '').replace(/\u200b/g, '').trim();
    if (raw && !HEADER_BLACKLIST.includes(raw)) return raw;
    return '';
  }

  function extractPhoneDigits(raw) {
    // 只提取纯数字手机号（如 +44 7934 711861 -> 447934711861）；纯文字名称（如中文昵称）返回空
    if (!raw) return '';
    const digits = String(raw).replace(/\D/g, '');
    return digits.length >= 6 ? digits : '';
  }

  function findHeaderSubtitleNode(header) {
    const title = findHeaderTitleNode(header);
    if (!title) return null;
    const container = title.closest('div') || title.parentElement || header;
    const spans = Array.from((container || header).querySelectorAll('span')).filter(isVisible);
    const idx = spans.indexOf(title);
    if (idx >= 0 && spans[idx + 1]) return spans[idx + 1];
    // 兜底：父容器下除标题外的第一个 span
    const others = Array.from((container || header).querySelectorAll('span')).filter(
      (s) => s !== title && isVisible(s),
    );
    return others[0] || null;
  }

  function getConversationJid() {
    // 从消息气泡 data-id（形如 false_972501234567@c.us_xxx / true_972501234567@c.us_xxx）提取 JID
    const panel = findMessagePanel();
    if (panel) {
      const nodes = panel.querySelectorAll('[data-id]');
      for (const node of nodes) {
        const id = String(node.getAttribute('data-id') || '').trim();
        const m = id.match(/(\d{6,}(?:-\d+)?)@(c\.us|g\.us|broadcast)/);
        if (m) return m[0];
      }
    }
    return '';
  }

  // 兜底：全局扫描常见属性，兼容 data-id 只存消息 ID（无 JID）的新版 DOM
  function findPeerJid() {
    const attrs = ['data-id', 'data-jid', 'data-peer', 'data-chat-jid', 'data-contact-id', 'data-chat-id'];
    for (const attr of attrs) {
      try {
        const nodes = document.querySelectorAll(`[${attr}]`);
        for (const node of nodes) {
          const v = (node.getAttribute(attr) || '').trim();
          const m = v.match(/(\d{6,}(?:-\d+)?)@(c\.us|g\.us|broadcast)/);
          if (m) return m[0];
        }
      } catch {
        /* 属性名不兼容时跳过 */
      }
    }
    return '';
  }

  function jidToPhone(jid) {
    // 447934711861@c.us -> 447934711861；群组 972501234567-1630000000@g.us -> 972501234567
    if (!jid) return '';
    const before = String(jid).split('@')[0] || '';
    return before.split('-')[0].replace(/\D/g, '');
  }

  function getConversationInfo() {
    const header = findConversationHeader();
    const rawTitle = extractHeaderTitle(header);
    const jid = getConversationJid() || findPeerJid();
    const phoneFromJid = jidToPhone(jid);
    const phoneFromTitle = extractPhoneDigits(rawTitle);
    // JID 真实号码最可靠；标题仅在显示为手机号（纯数字）时兜底，名字绝不当作 ID
    const phoneOrId = phoneFromJid || phoneFromTitle || '';
    if (jid) {
      console.log('[Preload-WhatsApp] 捕获对方号码(JID)', { jid, phone: phoneFromJid, title: rawTitle.slice(0, 20) });
    }
    return { chatId: phoneOrId, chatTitle: rawTitle || phoneOrId, phoneOrId };
  }

  function reportActiveChat() {
    try {
      const info = getConversationInfo();
      if (!info.chatId) return;
      if (state.chatId === info.chatId && state.chatTitle === info.chatTitle) return;
      state.chatId = info.chatId;
      state.chatTitle = info.chatTitle;
      ipcRenderer.send('active-chat-changed', { phoneOrId: info.phoneOrId, chatTitle: info.chatTitle });
      console.log('[Preload-WhatsApp] 激活对话', info.phoneOrId.slice(0, 32));
    } catch (error) {
      console.error('[Preload-WhatsApp] 上报激活对话失败', error);
    }
  }

  // 专门观察右侧聊天头部，精准捕获对话对象（手机号/ID）
  function bindChatStateObserver() {
    try {
      if (state.chatObserver) {
        state.chatObserver.disconnect();
        state.chatObserver = null;
      }
      const main = qsFirst(document, ['div#main']);
      if (!main) return;
      let headerNode = findConversationHeader();
      state.chatObserver = new MutationObserver(() => {
        try {
          if (state.destroyed) return;
          if (state.chatTimer) return;
          state.chatTimer = window.setTimeout(() => {
            state.chatTimer = null;
            const next = findConversationHeader();
            if (next !== headerNode) {
              headerNode = next;
            }
            reportActiveChat();
          }, 120);
        } catch (error) {
          console.error('[Preload-WhatsApp] 聊天状态观察失败', error);
        }
      });
      state.chatObserver.observe(main, { childList: true, subtree: true, characterData: true });
      reportActiveChat();
    } catch (error) {
      console.error('[Preload-WhatsApp] 绑定聊天状态观察器失败', error);
    }
  }

  function replaceRemarkText(el, remark) {
    if (!el) return;
    const title = el.getAttribute && el.getAttribute('title');
    if (title === state.customId && title !== remark) {
      el.setAttribute('title', remark);
    }
    if (el.children.length === 0) {
      const txt = (el.textContent || '').trim();
      if (txt === state.customId && el.textContent !== remark) {
        el.textContent = remark;
      }
    }
  }

  function applyHeaderInjection() {
    try {
      const header = findConversationHeader();
      if (!header) return;
      const nickname = state.customNickname;
      const remark = state.customRemark;

      if (nickname) {
        const title = findHeaderTitleNode(header);
        if (title && title.textContent !== nickname) {
          title.textContent = nickname;
          if (title.getAttribute('title')) title.setAttribute('title', nickname);
        }
      }

      if (remark) {
        const subtitle = findHeaderSubtitleNode(header);
        if (subtitle) {
          if (subtitle.textContent !== remark) subtitle.textContent = remark;
          // 仅当样式不同才设置，避免每次注入都改动 style 属性从而反向触发观察器造成死循环
          if (subtitle.style.getPropertyValue('color') !== '#00a884') {
            subtitle.style.setProperty('color', '#00a884', 'important');
          }
          if (subtitle.style.getPropertyValue('font-size') !== '13px') {
            subtitle.style.setProperty('font-size', '13px', 'important');
          }
        }
      }
    } catch (error) {
      console.error('[Preload-WhatsApp] 头部注入失败', error);
    }
  }

  function bindRemarkObserver() {
    try {
      if (state.remarkObserver) {
        state.remarkObserver.disconnect();
        state.remarkObserver = null;
      }
      if (!state.customNickname && !state.customRemark) return;
      state.remarkObserver = new MutationObserver(() => {
        try {
          if (state.destroyed) return;
          applyHeaderInjection();
        } catch (error) {
          console.error('[Preload-WhatsApp] 头部重绘观察失败', error);
        }
      });
      // 死死盯住 Header 区域，重绘后几毫秒内重新注入，防闪烁
      // 注意：不要监听 attributes，否则我们注入的内联样式（style 属性变化）会反过来触发观察器，形成「消失-出现」死循环
      const header = findConversationHeader();
      const target = header || findMainRegion() || document.body;
      state.remarkObserver.observe(target, { childList: true, subtree: true, characterData: true });
    } catch (error) {
      console.error('[Preload-WhatsApp] 绑定备注观察器失败', error);
    }
  }

  // 左侧联系人列表容器
  function findSidebarList() {
    return qsFirst(document, [
      'div#pane-side',
      'div#side',
      '[data-testid="chat-list"]',
      '[aria-label="聊天列表"]',
    ]);
  }

  // 左侧列表名称节点原始标识属性（哈希前缀，防风控/样式污染）
  const SIDEBAR_ORIG_ATTR = 'data-hyt-orig-x8A9P';

  // 遍历左侧列表名称节点，按全局映射表替换为自定义昵称
  function applySidebarRemarks() {
    try {
      const map = window.globalContactMap;
      const keys = Object.keys(map);
      if (!keys.length) return;
      const list = findSidebarList();
      if (!list) return;
      list.querySelectorAll('span[dir="auto"]').forEach((node) => {
        if (!isVisible(node)) return;
        const text = (node.textContent || '').replace(/\u200b/g, '').trim();
        const title = (node.getAttribute('title') || '').replace(/\u200b/g, '').trim();
        // 用自定义属性记住原始名称，避免把昵称写进 title 后丢失原始 key 导致无法再次匹配
        const original = (node.getAttribute(SIDEBAR_ORIG_ATTR) || title || text || '').replace(/\u200b/g, '').trim();
        if (!original) return;
        const cleaned = original.replace(/[^\p{L}\p{N}]/gu, '');
        const custom = map[cleaned] || map[original];
        if (!custom) return;
        if (node.getAttribute(SIDEBAR_ORIG_ATTR) !== original) {
          node.setAttribute(SIDEBAR_ORIG_ATTR, original);
        }
        // 严格相等性判断：不同才赋值，防止 React 无限重绘死循环
        if (text !== custom) {
          node.textContent = custom;
        }
      });
    } catch (error) {
      console.error('[Preload-WhatsApp] 应用侧栏备注失败', error);
    }
  }

  // requestAnimationFrame 节流，保证滚动流畅
  function scheduleSidebarApply() {
    if (sidebarRaf) return;
    sidebarRaf = window.requestAnimationFrame(() => {
      sidebarRaf = null;
      if (state.destroyed) return;
      applySidebarRemarks();
    });
  }

  function bindSidebarObserver() {
    try {
      if (state.sidebarObserver) {
        state.sidebarObserver.disconnect();
        state.sidebarObserver = null;
      }
      const list = findSidebarList();
      if (!list) return;
      state.sidebarObserver = new MutationObserver(() => {
        try {
          if (state.destroyed) return;
          scheduleSidebarApply();
        } catch (error) {
          console.error('[Preload-WhatsApp] 侧栏观察失败', error);
        }
      });
      state.sidebarObserver.observe(list, { childList: true, subtree: true, characterData: true });
      applySidebarRemarks();
    } catch (error) {
      console.error('[Preload-WhatsApp] 绑定侧栏观察器失败', error);
    }
  }

  function listMessageNodes(panel) {
    if (!panel) return [];
    const nodes = panel.querySelectorAll('[data-id], [data-testid="msg-container"]');
    return Array.from(nodes).filter((node) => {
      const id = getMsgId(node);
      return id.startsWith('true') || id.startsWith('false');
    });
  }

  function getMsgId(node) {
    return node.getAttribute('data-id') || node.closest('[data-id]')?.getAttribute('data-id') || '';
  }

  function isOutgoingMessage(node) {
    const id = getMsgId(node);
    if (id.startsWith('false')) return true;
    if (id.startsWith('true')) return false;
    if (node.querySelector('[data-testid="tail-out"]') || node.querySelector('span[data-icon="tail-out"]')) {
      return true;
    }
    return false;
  }

  function extractMessageText(node) {
    const clone = node.cloneNode(true);
    clone.querySelectorAll(`.${CONTAINER_CLASS}`).forEach((el) => el.remove());
    const textNode = qsFirst(clone, [
      '[data-testid="conversation-text"]',
      'span[data-testid="text-content"]',
      '[data-testid="msg-text"]',
      'span[dir="ltr"]',
      'span[dir="rtl"]',
      'span[dir="auto"]',
    ]);
    return (textNode?.innerText || textNode?.textContent || '').replace(/\u200b/g, '').trim();
  }

  function needsBubbleTranslate(text, outgoing) {
    if (!text || text === '翻译中…') return false;
    if (outgoing && state.settings.translateOutgoing === false) return false;
    if (!outgoing && state.settings.translateIncoming === false) return false;
    if (state.settings.translationVisible === false) return false;
    if (HAS_CHINESE.test(text) && !HAS_FOREIGN.test(text)) return false;
    return HAS_FOREIGN.test(text) || (!HAS_CHINESE.test(text) && text.length > 1);
  }

  function ensureBubbleHost(node) {
    let host = node.querySelector(`.${CONTAINER_CLASS}`);
    if (host) return host;
    host = document.createElement('div');
    host.className = CONTAINER_CLASS;
    host.setAttribute(BUBBLE_HOST, '1');
    host.style.cssText = 'display:block;margin:4px 0 2px;max-width:100%;';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host { all: initial; display: block; }
        .hyt-tc-inner-x8A9P {
          display: flex;
          align-items: flex-start;
          gap: 6px;
          font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
        }
        .hyt-txt-x8A9P {
          flex: 1;
          min-width: 0;
          font-size: 12.5px;
          line-height: 1.45;
          color: #e9edef;
          background: #202c33;
          border-left: 2px solid #25D366;
          border-radius: 0 8px 8px 0;
          padding: 6px 8px;
          white-space: pre-wrap;
          word-break: break-word;
        }
        .hyt-txt-x8A9P.is-loading {
          color: #8696a0;
          background: linear-gradient(90deg, #202c33 25%, #2a3942 50%, #202c33 75%);
          background-size: 200% 100%;
          animation: hyt-skel-x8A9P 1.2s ease-in-out infinite;
        }
        @keyframes hyt-skel-x8A9P {
          0% { background-position: 100% 0; }
          100% { background-position: -100% 0; }
        }
        .hyt-refresh-btn-x8A9P {
          flex: none;
          width: 22px;
          height: 22px;
          border: 0;
          border-radius: 6px;
          background: transparent;
          color: #8696a0;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .hyt-refresh-btn-x8A9P:hover { color: #25D366; background: #111b21; }
      </style>
      <div class="hyt-tc-inner-x8A9P">
        <div class="hyt-txt-x8A9P is-loading">翻译中…</div>
        <button type="button" class="hyt-refresh-btn-x8A9P" title="重译" aria-label="重译">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6">
            <path d="M3 8a5 5 0 0 1 8.5-3.5L13 6" />
            <path d="M13 3v3h-3" />
            <path d="M13 8a5 5 0 0 1-8.5 3.5L3 10" />
            <path d="M3 13v-3h3" />
          </svg>
        </button>
      </div>
    `;
    shadow.querySelector('.hyt-refresh-btn-x8A9P').addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void refreshBubble(node, host);
    });
    const textRoot =
      qsFirst(node, ['[data-testid="conversation-text"]', '[data-testid="msg-text"]', 'span[dir="ltr"]', 'span[dir="rtl"]']) ||
      node;
    textRoot.parentElement ? textRoot.parentElement.appendChild(host) : node.appendChild(host);
    return host;
  }

  function setBubbleText(host, text, loading) {
    const slot = host?.shadowRoot?.querySelector('hyt-txt-x8A9P, .hyt-txt-x8A9P');
    if (!slot) return;
    slot.textContent = text;
    slot.classList.toggle('is-loading', !!loading);
  }

  function isHistoryMessage(id, node, panel) {
    if (!state.bootstrapped) return true;
    if (state.historyIds.has(id)) return true;
    const rows = listMessageNodes(panel);
    const index = rows.indexOf(node);
    if (index < 0) return true;
    return index < Math.max(0, rows.length - 2);
  }

  function snapshotHistory(panel) {
    listMessageNodes(panel).forEach((node) => {
      const id = getMsgId(node);
      if (id) state.historyIds.add(id);
    });
    state.bootstrapped = true;
    console.log('[Preload-WhatsApp] 历史快照', state.historyIds.size);
  }

  const MAX_IPC = 2;

  function enqueueBubble(node, options = {}) {
    try {
      const id = getMsgId(node);
      const text = extractMessageText(node);
      if (!id || !needsBubbleTranslate(text, isOutgoingMessage(node))) return;
      if (!options.forcePremium) {
        const slot = node.querySelector(`.${CONTAINER_CLASS}`)?.shadowRoot?.querySelector('.hyt-txt-x8A9P');
        if (slot && !slot.classList.contains('is-loading') && slot.textContent && !/失败/.test(slot.textContent)) {
          return;
        }
      }
      if (state.queued.has(id) && !options.forcePremium) return;
      const panel = findMessagePanel();
      const isHistory = options.forcePremium ? false : isHistoryMessage(id, node, panel);
      const job = { node, id, text, isHistory, forcePremium: !!options.forcePremium };
      state.queued.set(id, job);
      pumpBubbleQueue();
    } catch (error) {
      console.error('[Preload-WhatsApp] 入队失败', error);
    }
  }

  function pumpBubbleQueue() {
    if (state.destroyed || state.active >= MAX_IPC) return;
    const next = [...state.queued.values()].find((job) => !job.running);
    if (!next) return;
    next.running = true;
    state.active += 1;
    void runBubbleJob(next).finally(() => {
      state.queued.delete(next.id);
      state.active -= 1;
      pumpBubbleQueue();
    });
  }

  async function runBubbleJob(job) {
    const host = ensureBubbleHost(job.node);
    if (state.settings.translationVisible === false) {
      host.style.display = 'none';
      return;
    }
    host.style.display = '';
    setBubbleText(host, '翻译中…', true);
    try {
      const result = await ipcRenderer.invoke('translate-msg', {
        text: job.text,
        msgId: job.id,
        isHistory: job.isHistory,
        forcePremium: job.forcePremium,
        skipCache: job.forcePremium,
        direction: 'in',
        chatId: state.chatId,
      });
      if (!result?.ok) throw new Error(result?.error || '翻译失败');
      setBubbleText(host, result.text, false);
      console.log('[Preload-WhatsApp] 气泡已译', {
        history: job.isHistory,
        cached: !!result.cached,
        chars: job.text.length,
      });
    } catch (error) {
      console.error('[Preload-WhatsApp] 气泡翻译失败', error);
      setBubbleText(host, error.message || '翻译失败', false);
    }
  }

  async function refreshBubble(node, host) {
    try {
      setBubbleText(host, '重译中…', true);
      const id = getMsgId(node);
      const text = extractMessageText(node);
      state.queued.delete(id);
      const result = await ipcRenderer.invoke('translate-msg', {
        text,
        msgId: id,
        isHistory: false,
        forcePremium: true,
        skipCache: true,
        direction: 'in',
        chatId: state.chatId,
      });
      if (!result?.ok) throw new Error(result?.error || '重译失败');
      setBubbleText(host, result.text, false);
    } catch (error) {
      console.error('[Preload-WhatsApp] 重译失败', error);
      setBubbleText(host, error.message || '重译失败', false);
    }
  }

  function observeBubble(node) {
    if (!state.io || node.getAttribute('data-hyt-io-x8A9P') === '1') return;
    node.setAttribute('data-hyt-io-x8A9P', '1');
    state.io.observe(node);
  }

  function bindIntersection(panel) {
    if (state.io) {
      state.io.disconnect();
      state.io = null;
    }
    const root = findScrollRoot(panel);
    state.io = new IntersectionObserver(
      (entries) => {
        try {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            enqueueBubble(entry.target);
          });
        } catch (error) {
          console.error('[Preload-WhatsApp] IntersectionObserver 失败', error);
        }
      },
      { root: root && root !== document.body ? root : null, rootMargin: '64px 0px', threshold: 0.12 },
    );
    listMessageNodes(panel).forEach((node) => observeBubble(node));
  }

  function onMessagesMutated(mutations, panel) {
    try {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof Element)) return;
          const rows = node.matches?.('[data-id], [data-testid="msg-container"]')
            ? [node]
            : Array.from(node.querySelectorAll?.('[data-id], [data-testid="msg-container"]') || []);
          rows.forEach((row) => {
            const id = getMsgId(row);
            if (!id) return;
            const rowsNow = listMessageNodes(panel);
            const index = rowsNow.indexOf(row);
            const appendedBottom = index >= rowsNow.length - 2;
            if (state.bootstrapped && appendedBottom) {
              /* 底部实时消息 */
            } else {
              state.historyIds.add(id);
            }
            observeBubble(row);
          });
        });
      });
    } catch (error) {
      console.error('[Preload-WhatsApp] 消息 Mutation 处理失败', error);
    }
  }

  function attachMessagePipeline() {
    const panel = findMessagePanel();
    const convo = getConversationInfo().chatId;
    reportActiveChat();
    if (!panel) return;
    if (convo && convo !== state.convoKey) {
      state.convoKey = convo;
      state.bootstrapped = false;
      state.historyIds = new Set();
      if (state.msgObserver) {
        state.msgObserver.disconnect();
        state.msgObserver = null;
      }
      snapshotHistory(panel);
      bindIntersection(panel);
      state.msgObserver = new MutationObserver((mutations) => onMessagesMutated(mutations, panel));
      state.msgObserver.observe(panel, { childList: true, subtree: true });
      return;
    }
    if (!state.msgObserver) {
      snapshotHistory(panel);
      bindIntersection(panel);
      state.msgObserver = new MutationObserver((mutations) => onMessagesMutated(mutations, panel));
      state.msgObserver.observe(panel, { childList: true, subtree: true });
    }
  }

  function detectLoginState() {
    try {
      const hasQR = !!qsFirst(document, [
        'canvas[aria-label*="Scan" i]',
        '[data-testid="qrcode"]',
        'div[data-testid="qrcode"]',
      ]);
      const hasPane = !!qsFirst(document, [
        'div#pane-side',
        'div#side',
        '[data-testid="chat-list"]',
        'div[data-testid="conversation-panel-wrapper"]',
      ]);
      return { loggedIn: hasPane && !hasQR };
    } catch (error) {
      return { loggedIn: false };
    }
  }

  function reportLoginState() {
    try {
      const { loggedIn } = detectLoginState();
      if (state.lastLoggedIn !== loggedIn) {
        state.lastLoggedIn = loggedIn;
        ipcRenderer.send('wa:login-state', { loggedIn });
        console.log('[Preload-WhatsApp] 登录状态', loggedIn);
      }
    } catch (error) {
      console.error('[Preload-WhatsApp] 上报登录状态失败', error);
    }
  }

  function startObserver() {
    if (state.observer) {
      state.observer.disconnect();
      state.observer = null;
    }
    state.observer = new MutationObserver(() => {
      try {
        if (state.obsTimer) return;
        state.obsTimer = window.setTimeout(() => {
          state.obsTimer = null;
          if (state.destroyed) return;
          syncDualBox();
          attachMessagePipeline();
          reportLoginState();
        }, 180);
      } catch (error) {
        console.error('[Preload-WhatsApp] MutationObserver 处理失败', error);
      }
    });
    state.observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function destroy() {
    state.destroyed = true;
    try {
      if (state.observer) state.observer.disconnect();
      if (state.msgObserver) state.msgObserver.disconnect();
      if (state.chatObserver) state.chatObserver.disconnect();
      if (state.remarkObserver) state.remarkObserver.disconnect();
      if (state.sidebarObserver) state.sidebarObserver.disconnect();
      if (state.io) state.io.disconnect();
      if (sidebarRaf) window.cancelAnimationFrame(sidebarRaf);
      if (state.obsTimer) window.clearTimeout(state.obsTimer);
      if (state.pollTimer) window.clearInterval(state.pollTimer);
      if (state.chatTimer) window.clearTimeout(state.chatTimer);
      document.removeEventListener('keydown', onDocumentKeydown, true);
      document.removeEventListener('click', onDocumentClickCapture, true);
      document.removeEventListener('keydown', onEditKeydown, true);
      document.removeEventListener('click', onEditConfirmClick, true);
      document.querySelector(`[${HOST_ATTR}]`)?.remove();
    } catch (error) {
      console.error('[Preload-WhatsApp] 销毁失败', error);
    }
  }

  ipcRenderer.on('wa:translation-visible', (_event, visible) => {
    mergeSettings({ translationVisible: visible !== false });
  });

  ipcRenderer.on('wa:custom-remark', (_event, payload) => {
    try {
      state.customId = String(payload?.id || '').trim();
      state.customNickname = String(payload?.nickname || '').trim();
      state.customRemark = String(payload?.remark || '').trim();
      applyHeaderInjection();
      bindRemarkObserver();
      console.log('[Preload-WhatsApp] 自定义昵称/备注', {
        id: state.customId.slice(0, 24),
        nickname: state.customNickname,
        remark: state.customRemark,
      });
    } catch (error) {
      console.error('[Preload-WhatsApp] 应用自定义昵称/备注失败', error);
    }
  });

  ipcRenderer.on('wa:contact-map', (_event, payload) => {
    try {
      window.globalContactMap = payload?.map && typeof payload.map === 'object' ? payload.map : {};
      applySidebarRemarks();
      bindSidebarObserver();
      console.log('[Preload-WhatsApp] 已同步全局联系人映射表', Object.keys(window.globalContactMap).length);
    } catch (error) {
      console.error('[Preload-WhatsApp] 同步联系人映射表失败', error);
    }
  });

  ipcRenderer.on('wa:bootstrap', (_event, payload) => {
    try {
      mergeSettings(payload || {});
      attachMessagePipeline();
      console.log('[Preload-WhatsApp] bootstrap', {
        mode: state.settings.enterSendMode,
        outgoing: state.settings.translateOutgoing,
      });
    } catch (error) {
      console.error('[Preload-WhatsApp] bootstrap 失败', error);
    }
  });

  ipcRenderer.on('wa:settings', (_event, payload) => {
    try {
      mergeSettings(payload || {});
    } catch (error) {
      console.error('[Preload-WhatsApp] 同步设置失败', error);
    }
  });

  const boot = () => {
    try {
      startObserver();
      document.addEventListener('keydown', onDocumentKeydown, true);
      document.addEventListener('click', onDocumentClickCapture, true);
      document.addEventListener('keydown', onEditKeydown, true);
      document.addEventListener('click', onEditConfirmClick, true);
      syncDualBox();
      attachMessagePipeline();
      bindChatStateObserver();
      bindRemarkObserver();
      bindSidebarObserver();
      reportLoginState();
      state.pollTimer = window.setInterval(() => {
        if (state.destroyed) return;
        syncDualBox();
        attachMessagePipeline();
        reportLoginState();
      }, 1600);
      window.addEventListener('beforeunload', destroy);
      console.log('[Preload-WhatsApp] 注入已启动');
    } catch (error) {
      console.error('[Preload-WhatsApp] 启动失败', error);
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
} catch (error) {
  console.error('[Preload-WhatsApp] 脚本初始化失败', error);
}

