// Read rendered conversation turns only. No network interception, private APIs,
// sidebar scraping or collection of unsent composer text.
(function () {
  if (globalThis.KapsulCapture) return;
  const rules = {
    claude: {
      user: '[data-testid="user-message"], [data-message-author-role="user"], [data-testid="human-message"], [data-testid="user-message-content"], [data-role="user"], [data-message-role="user"], .font-user-message',
      assistant: '[data-testid="assistant-message"], [data-testid="claude-message"], [data-message-author-role="assistant"], .font-claude-response, .font-claude-message, [data-is-streaming] .standard-markdown, [data-role="assistant"], [data-message-role="assistant"], [data-testid="assistant-message-content"], [data-testid="assistant-response"]',
      fallback: '.standard-markdown, .markdown',
      turn: '[data-test-render-count]',
    },
    chatgpt: {
      user: '[data-message-author-role="user"], [data-message-role="user"], [data-role="user"], [data-author-role="user"], [data-author="user"], [data-testid="user-message"]',
      assistant: '[data-message-author-role="assistant"], [data-message-role="assistant"], [data-role="assistant"], [data-author-role="assistant"], [data-author="assistant"], [data-testid="assistant-message"]',
      turn: '[data-testid^="conversation-turn-"], [data-turn], [data-turn-id], article, [role="article"], [data-message-id]'
    },
    gemini: {
      user: 'user-query, user-query-content, [data-message-author="user"], [data-message-author-role="user"], .user-query-bubble-with-background, .query-text, [data-test-id="user-query"]',
      assistant: 'model-response, [data-message-author="assistant"], [data-message-author-role="assistant"], [data-message-author="model"], .model-response-text, [data-test-id="model-response"]',
    },
    deepseek: {
      user: '[data-message-author-role="user"], [data-role="user"], [class*="user-message"], .fbb737a4',
      assistant: '[data-message-author-role="assistant"], [data-role="assistant"], [class*="assistant-message"], .ds-markdown, .f9bf7997',
    },
  };
  const excluded = 'nav, aside, header, footer, form, [role="navigation"], [role="toolbar"], [role="dialog"], [contenteditable="true"], [hidden], #cc-ask-ai-panel, #cc-ask-ai-btn, #cc-banner, #cc-toast';
  function visible(el) {
    if (el.closest(excluded)) return false;
    // Some sites mark the entire application aria-hidden while an overlay is
    // open. Ignore that ancestor flag, but never capture a locally hidden turn.
    if (el.matches('[aria-hidden="true"]')) return false;
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const css = getComputedStyle(n);
      if (css.display === 'none' || css.visibility === 'hidden') return false;
      if (n.matches('[aria-hidden="true"]') && n.matches('article, [role="article"], [data-turn], [data-testid^="conversation-turn-"], [data-message-id]')) return false;
    }
    return true; // off-screen rendered turns are still part of the conversation
  }
  function ordered(items) {
    return items.sort((a,b) => a.el === b.el ? 0 : a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
  }
  // Recognize accessibility headings/labels only on bounded turn containers.
  function roleOf(el, source) {
    for (const attr of ['data-turn','data-message-author-role','data-message-role','data-role','data-author-role','data-author','data-message-author']) {
      const v = el.getAttribute(attr)?.toLowerCase();
      if (['user','human'].includes(v)) return 'user';
      if (['assistant','model','bot'].includes(v)) return 'assistant';
    }
    const label = [el.getAttribute('aria-label'), el.getAttribute('data-testid'), el.getAttribute('data-test-id'),
      el.querySelector(':scope > h2, :scope > h3, :scope > [role="heading"], :scope > .sr-only, :scope > div > h2, :scope > div > h3, :scope > div > [role="heading"]')?.textContent]
      .filter(Boolean).map(s=>s.trim().toLowerCase());
    if (label.some(v=>/^(you said|you asked|your message|user message|human message)\s*:?$/.test(v) || /^(user|human)-(message|turn|query)(-content)?$/.test(v))) return 'user';
    if (label.some(v=>/^(chatgpt|claude|gemini|deepseek|assistant|model) (said|replied|response|message)\s*:?$/.test(v) || /^(assistant|model|bot)-(message|turn|response)(-content)?$/.test(v))) return 'assistant';
    return null;
  }
  function anchors(source) {
    const rule=rules[source];
    if (!rule || !document.body) return [];
    const scope=document.body, items=[];
    const add=(el,type)=>{
      if (!el || !visible(el)) return;
      if (type==='assistant' && (el.closest(rule.user) || el.querySelector(rule.user))) return;
      if (type==='user' && el.querySelector(rule.assistant) && !el.matches(rule.user)) return;
      if (el.querySelector('[contenteditable="true"], textarea, form')) return;
      items.push({el,type});
    };
    for (const el of scope.querySelectorAll(rule.user)) add(el,'user');
    for (const el of scope.querySelectorAll(rule.assistant)) add(el,'assistant');
    const turns = (rule.turn || '') + (rule.turn ? ', ' : '') + '[data-message-role], [data-message-author-role], [data-role], [data-author-role], [data-message-author], [data-testid*="message"], [data-testid*="turn"], [data-test-id*="message"], [role="article"], article, [aria-label="You said"], [aria-label="ChatGPT said"], [aria-label="Claude said"]';
    for (const el of scope.querySelectorAll(turns)) {
      const role=roleOf(el,source);
      if (!role || el.querySelector(rule[role])) continue;
      add(el,role);
    }
    if (source==='claude') {
      // Some builds use a plain render-count wrapper with markdown or prose
      // but do not put a role on the reply. Use adjacent explicit user turns.
      const users=items.filter(x=>x.type==='user').map(x=>x.el);
      for (const el of scope.querySelectorAll('[data-test-render-count], .standard-markdown')) {
        if (!users.length || el.closest(rule.user) || el.querySelector(rule.user) || el.closest(rule.assistant)) continue;
        if (!el.matches('.standard-markdown') && !el.querySelector('.standard-markdown, .markdown, .prose, p, pre')) continue;
        if (!el.closest(rule.turn) && !users.some(u=>u.parentElement?.parentElement?.contains(el))) continue;
        if (users.some(u=>u.compareDocumentPosition(el)&Node.DOCUMENT_POSITION_FOLLOWING)) add(el.closest(rule.turn)||el,'assistant');
      }
      for (const item of items) {
        if(item.type!=='assistant') continue;
        const turn=item.el.closest(rule.turn);
        if(turn && !turn.querySelector(rule.user) && !turn.closest(rule.user) && visible(turn)) item.el=turn;
      }
    }
    if(source==='chatgpt') for(const item of items) {
      const turn=item.el.closest('[data-turn], [data-testid^="conversation-turn-"], article, [role="article"]');
      const other=item.type==='user'?'assistant':'user';
      if(turn&&roleOf(turn,source)===item.type&&!turn.querySelector(rule[other])&&visible(turn))item.el=turn;
    }
    // A hidden alternative branch is normally a locally aria-hidden wrapper.
    // Do not treat aria-hidden on a whole application root as a hidden turn.
    const unique=items.filter((x,i)=>!items.slice(0,i).some(y=>y.el===x.el&&y.type===x.type));
    const outer=unique.filter(x=>!unique.some(y=>y!==x&&y.type===x.type&&y.el.contains(x.el)&&y.el!==x.el));
    return ordered(outer.filter(x=>!outer.some(y=>y!==x&&y.type!==x.type&&x.el.contains(y.el))));
  }
  function snapshot(source) {
    const entries=anchors(source), now=new Date().toISOString(), messages=[], elements=[];
    for (const {el,type} of entries) {
      // If an explicit turn has multiple content blocks, keep all of them.
      // Only remove role headings when they are actual accessibility labels.
      let content=Kapsul.elementToText(el,{preserveWhitespace:type==='user'});
      if (!content) content=Kapsul.safeRenderedText(el);
      content=content.replace(/^(?:#{1,6}\s+)?(?:you said|you asked|your message|(?:chatgpt|claude|gemini|deepseek|assistant|model) (?:said|replied|response))\s*:\s*\n+/i,'');
      if (!content) continue;
      const idNode=el.closest('[data-message-id]')||el.querySelector('[data-message-id]');
      const id=idNode?.getAttribute('data-message-id');
      messages.push({type,content,format:'text',timestamp:now,...(id?{messageId:id}:{})});elements.push(el);
    }
    return {messages,elements, matched:entries.length};
  }
  function scrape(source) {return snapshot(source).messages;}
  // Scroll only the transcript's actual scrolling ancestor, never the sidebar.
  function scroller(elements) {
    if (!elements.length) return null;
    for (let n=elements[0].parentElement;n&&n!==document.body;n=n.parentElement) {
      if (!elements.every(el=>n.contains(el))) continue;
      if (/(auto|scroll|overlay)/.test(getComputedStyle(n).overflowY)&&n.clientHeight>80&&n.scrollHeight>n.clientHeight+5) return n;
    }
    const root=document.scrollingElement;
    return root&&root.scrollHeight>root.clientHeight+5 ? root:null;
  }
  // Stitch only overlapping ordered windows. Never guess the order of two
  // disjoint virtualized windows or discard a previously captured turn.
  function joinWindows(a,b) {
    if (!a.length) return b;
    if (!b.length) return a;
    const same=(x,y)=>x.type===y.type&&(x.messageId&&y.messageId?x.messageId===y.messageId:x.content===y.content);
    let best=null;
    for(let offset=1-b.length;offset<a.length;offset++) {
      const lo=Math.max(0,offset),hi=Math.min(a.length,offset+b.length);
      let count=0, valid=true;
      for(let i=lo;i<hi;i++) {if(!same(a[i],b[i-offset])){valid=false;break;}count++;}
      if(valid&&count&&(!best||count>best.count))best={offset,count};
    }
    if(!best)return null;
    const out=[];for(let i=Math.min(0,best.offset);i<Math.max(a.length,best.offset+b.length);i++)out.push(b[i-best.offset]||a[i]);
    return out;
  }
  globalThis.KapsulCapture = {scrape,snapshot,scroller,joinWindows};
})();
