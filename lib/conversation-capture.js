// Read rendered conversation turns only. No network interception, private APIs,
// sidebar scraping or collection of unsent composer text.
(function () {
  if (globalThis.KapsulCapture) return;
  const rules = {
    claude: {
      user: '[data-testid="user-message"], [data-message-author-role="user"], [data-testid="human-message"]',
      assistant: '[data-testid="assistant-message"], [data-testid="claude-message"], [data-message-author-role="assistant"], .font-claude-response, .font-claude-message, [data-is-streaming] .standard-markdown',
      fallback: '.standard-markdown, .markdown',
      turn: '[data-test-render-count]',
    },
    chatgpt: {
      user: '[data-message-author-role="user"], [data-message-role="user"], [data-role="user"][data-message-id], [data-testid="user-message"]',
      assistant: '[data-message-author-role="assistant"], [data-message-role="assistant"], [data-role="assistant"][data-message-id], [data-testid="assistant-message"]',
      turn: '[data-testid^="conversation-turn-"], [data-turn], [data-turn-id], article[data-testid]'
    },
    gemini: {
      user: 'user-query, user-query-content, [data-message-author="user"], [data-message-author-role="user"], .user-query-bubble-with-background',
      assistant: 'model-response, [data-message-author="assistant"], [data-message-author-role="assistant"], [data-message-author="model"], .model-response-text',
    },
    deepseek: {
      user: '[data-message-author-role="user"], [data-role="user"], [class*="user-message"], .fbb737a4',
      assistant: '[data-message-author-role="assistant"], [data-role="assistant"], [class*="assistant-message"], .ds-markdown, .f9bf7997',
    },
  };
  const excluded = 'nav, aside, header, footer, form, [role="navigation"], [role="toolbar"], [role="dialog"], [contenteditable="true"], [hidden], [aria-hidden="true"], #cc-ask-ai-panel, #cc-ask-ai-btn, #cc-banner, #cc-toast';
  function visible(el) {
    if (el.closest(excluded)) return false;
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const css = getComputedStyle(n);
      if (css.display === 'none' || css.visibility === 'hidden') return false;
    }
    return true; // off-screen rendered turns are still part of the conversation
  }
  function ordered(items) {
    return items.sort((a,b) => a.el === b.el ? 0 : a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
  }
  function scrape(source) {
    const rule = rules[source];
    if (!rule) return [];
    // Use main when it contains turns; some providers put the transcript outside main.
    const scope = [...document.querySelectorAll('main, [role="main"]')].find(el => el.querySelector(rule.user + ', ' + rule.assistant)) || document.body;
    if (!scope) return [];
    const items = [];
    const add = (el, type) => {
      if (!el || !visible(el)) return;
      const other = type === 'user' ? rule.assistant : rule.user;
      // A conversation/turn wrapper with both roles is not itself a message.
      if (type === 'assistant' && (el.closest(rule.user) || el.querySelector(rule.user))) return;
      if (type === 'user' && el.matches(other) && !el.matches(rule.user)) return;
      items.push({el, type});
    };
    for (const el of scope.querySelectorAll(rule.user)) add(el, 'user');
    for (const el of scope.querySelectorAll(rule.assistant)) add(el, 'assistant');
    // Newer ChatGPT markup may expose the role on the turn rather than its content.
    if (source === 'chatgpt') {
      for (const el of scope.querySelectorAll(rule.turn)) {
        const role = el.getAttribute('data-turn') || el.getAttribute('data-message-author-role');
        if ((role === 'user' || role === 'assistant') && !el.querySelector(rule[role])) add(el, role);
      }
    }
    // Claude's markdown fallback is restricted to a reply turn after a user message.
    // It is evaluated per turn, so one recognized reply does not hide other replies.
    if (source === 'claude' && items.some(x => x.type === 'user')) {
      const users = items.filter(x => x.type === 'user').map(x => x.el);
      for (const el of scope.querySelectorAll(rule.fallback)) {
        if (el.closest(rule.user) || el.closest(rule.assistant)) continue;
        const turn = el.closest(rule.turn);
        if (turn && !turn.querySelector(rule.user) && users.some(u => u.compareDocumentPosition(turn) & Node.DOCUMENT_POSITION_FOLLOWING)) add(turn, 'assistant');
      }
    }
    // Group Claude response fragments under their explicit render-turn wrapper.
    if (source === 'claude') for (const item of items) {
      if (item.type !== 'assistant') continue;
      const turn = item.el.closest(rule.turn);
      if (turn && turn !== scope && !turn.querySelector(rule.user) && !turn.closest(rule.user) && visible(turn)) item.el = turn;
    }
    const unique = items.filter((x,i) => !items.slice(0,i).some(y => y.el === x.el && y.type === x.type));
    const outer = ordered(unique.filter(x => !unique.some(y => y !== x && y.type === x.type && y.el.contains(x.el) && y.el !== x.el)));
    const now = new Date().toISOString();
    return outer.map(({el,type}) => {
      // Do not choose just the first .markdown block: a response can contain many.
      const content = Kapsul.elementToText(el, { preserveWhitespace: type === 'user' });
      const idNode = el.closest('[data-message-id]') || el.querySelector('[data-message-id]');
      const id = idNode?.getAttribute('data-message-id');
      return {type, content, format: 'text', timestamp: now, ...(id ? {messageId: id} : {})};
    }).filter(m => m.content);
  }
  globalThis.KapsulCapture = { scrape };
})();
