# Optional offline Chromium integration test: pip install playwright; python tests/autosave.test.py
# Run from the repository root. Set CHROMIUM_PATH if Chromium is installed elsewhere.
import os
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),headless=True,args=['--no-sandbox','--disable-dev-shm-usage'],timeout=8000)
 page=b.new_page();page.set_content('<main></main><pre id="results"></pre>');page.add_script_tag(path='lib/kapsul-core.js');page.add_script_tag(path='lib/conversation-capture.js');page.add_script_tag(path='tests/capture-fixtures.js');print(page.locator('#results').inner_text(timeout=3000)); assert page.locator('body').get_attribute('data-result')=='pass'
 # A simulated location drives the real capture engine; no AI requests are sent.
 page=b.new_page();page.set_content('<main></main>')
 page.evaluate("window.fakeLocation=new URL('https://chatgpt.com/c/first')")
 page.evaluate('''()=>{window.records={};window.writes=[];window.chrome={runtime:{sendMessage(m,cb){if(m.action==='kapsul:upsert'){writes.push(m.conv);records[m.conv.id]=m.conv;cb({ok:true,messages:m.conv.messages.length})}else cb({ok:true,conv:null})}}};}''')
 page.evaluate("code=>new Function('location', code)(window.fakeLocation)",open('lib/kapsul-core.js').read());page.add_script_tag(path='lib/conversation-capture.js')
 page.evaluate('''()=>Kapsul.startAutoSave({source:'chatgpt',scrape:()=>KapsulCapture.scrape('chatgpt')})''')
 page.wait_for_timeout(300)
 page.evaluate('''()=>document.querySelector('main').innerHTML='<article data-turn="user"><div data-message-id="u1">First question</div></article><article data-turn="assistant"><div data-message-id="a1">First answer</div></article>' ''')
 page.wait_for_function("Object.keys(records).length===1",timeout=4000)
 page.evaluate("fakeLocation.pathname='/c/second'")
 page.wait_for_timeout(1100)
 assert page.evaluate('Object.keys(records).length')==1, 'stale first chat saved into second'
 page.evaluate('''()=>document.querySelector('main').innerHTML='<article data-turn="user"><div data-message-id="u2">Second question</div></article><article data-turn="assistant"><div data-message-id="a2">Second answer</div></article>' ''')
 page.wait_for_function("Object.keys(records).length===2",timeout=4000)
 assert page.evaluate("records['chatgpt_https://chatgpt.com/c/second'].messages[0].content")=='Second question'
 page.evaluate('''()=>document.querySelector('main').insertAdjacentHTML('beforeend','<article data-turn="user">Follow up</article><article data-turn="assistant">Follow up answer</article>')''')
 page.wait_for_function("records['chatgpt_https://chatgpt.com/c/second'].messages.length===4",timeout=4000)
 print('PASS delayed rendering, route switch stale-DOM isolation, subsequent turns')
 # Earlier messages appear when a simulated transcript reaches its top.
 page=b.new_page();page.set_content('<main style="height:180px;overflow-y:auto"><article data-turn="user" style="height:120px">Recent question</article><article data-turn="assistant" style="height:120px">Recent answer</article></main>')
 page.evaluate("window.fakeLocation=new URL('https://claude.ai/chat/history')")
 page.evaluate("""()=>{window.records={};window.chrome={runtime:{sendMessage(m,cb){if(m.action==='kapsul:upsert'){records[m.conv.id]=m.conv;cb({ok:true,messages:m.conv.messages.length})}else cb({ok:true,conv:null})}}};const box=document.querySelector('main');box.scrollTop=box.scrollHeight;box.addEventListener('scroll',()=>{if(box.scrollTop<=1&&!box.dataset.loaded){box.dataset.loaded='yes';box.insertAdjacentHTML('afterbegin','<article data-role="user" style="height:60px">Earlier question</article><article data-role="assistant" style="height:60px">Earlier answer</article>');}});box.querySelector('[data-turn="user"]').setAttribute('data-role','user');box.querySelector('[data-turn="assistant"]').setAttribute('data-role','assistant');}""")
 page.evaluate("code=>new Function('location', code)(window.fakeLocation)",open('lib/kapsul-core.js').read());page.add_script_tag(path='lib/conversation-capture.js')
 page.evaluate("()=>Kapsul.startAutoSave({source:'claude',scrape:()=>KapsulCapture.scrape('claude')})")
 page.wait_for_function("records['claude_https://claude.ai/chat/history']?.messages.length===4",timeout=9000)
 assert page.evaluate("records['claude_https://claude.ai/chat/history'].messages.map(m=>m.content).join('|')")=='Earlier question|Earlier answer|Recent question|Recent answer'
 print('PASS bounded automatic history loading and ordered merge')
 b.close()
