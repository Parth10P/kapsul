// Dependency-free service-worker contract tests: node --test tests/background.test.cjs
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'..');
function worker() {
  const area=()=>{const data={};return {data,async get(keys){return Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(k=>k in data).map(k=>[k,structuredClone(data[k])]));},async set(x){Object.assign(data,structuredClone(x));},async remove(k){delete data[k];}};};
  const local=area(),session=area();let listener,active={id:10,url:'https://chatgpt.com/c/abc'},reply={ok:false,reason:'no messages'},next=20;
  const tabUrls={};const event=()=>({addListener(){}});
  const chrome={storage:{local,session},runtime:{onMessage:{addListener(fn){listener=fn;}},onInstalled:event()},tabs:{onRemoved:event(),async query(){return [active];},async sendMessage(){return reply;},async create({url}){const id=next++;tabUrls[id]=url;return {id};},async update(id,{url}){tabUrls[id]=url;},async remove(id){delete tabUrls[id];}},action:{setIcon(){}}};
  const ctx=vm.createContext({chrome,URL,crypto:require('node:crypto').webcrypto,console});
  ctx.importScripts=(file)=>vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),ctx);
  vm.runInContext(fs.readFileSync(path.join(root,'background.js'),'utf8'),ctx);
  const call=(message,sender={})=>new Promise(resolve=>listener(message,sender,resolve));
  return {call,local,session,tabUrls,active:(a)=>{active=a;},reply:(r)=>{reply=r;}};
}
const conv=(url,source,content)=>({url,source,id:'old-random',title:content,messages:[{type:'user',content},{type:'assistant',content:'answer '+content}],savedAt:new Date().toISOString()});
test('storage serialization, source isolation, canonical aliases and tombstones',async()=>{
 const w=worker();const a=conv('https://chatgpt.com/c/abc','chatgpt','one'),b=conv('https://claude.ai/chat/abc','claude','two');
 await Promise.all([w.call({action:'kapsul:upsert',conv:a}),w.call({action:'kapsul:upsert',conv:b})]);
 await w.call({action:'kapsul:upsert',conv:{...a,url:'https://chat.openai.com/c/abc?x=1'}});
 assert.equal(w.local.data.claude_conversations.length,2);
 const id=w.local.data.claude_conversations.find(c=>c.source==='chatgpt').id;
 await w.call({action:'kapsul:delete',id});assert.equal((await w.call({action:'kapsul:upsert',conv:a})).ok,false);assert.equal(w.local.data.claude_conversations.length,1);
});
test('popup receives the actual capture result, not a false success wrapper',async()=>{
 const w=worker();assert.equal((await w.call({action:'scrapeActiveTab'})).ok,false);w.reply({ok:true,messages:5});assert.equal((await w.call({action:'scrapeActiveTab'})).messages,5);w.active({id:1,url:'https://evil.example/?q=chatgpt.com'});assert.equal((await w.call({action:'scrapeActiveTab'})).ok,false);
});
test('concurrent handoffs are isolated to the intended new tab and one-time token',async()=>{
 const w=worker();const a=await w.call({action:'openAIWithContext',target:'claude',context:'private A'});const b=await w.call({action:'openAIWithContext',target:'claude',context:'private B'});
 const sender=id=>({tab:{id},frameId:0,url:'https://claude.ai/new'});const req={action:'kapsul:pending',source:'claude'};
 assert.equal((await w.call(req,sender(99))).pending,null);const pa=(await w.call(req,sender(a.tabId))).pending;assert.equal(pa.context,'private A');assert.equal((await w.call(req,sender(b.tabId))).pending.context,'private B');assert.equal((await w.call({...req,action:'kapsul:pendingDone',token:'bad'},sender(a.tabId))).ok,false);await w.call({...req,action:'kapsul:pendingDone',token:pa.token},sender(a.tabId));assert.equal((await w.call(req,sender(a.tabId))).pending,null);assert.equal((await w.call(req,{...sender(b.tabId),url:'https://claude.ai/chat/abc'})).ok,false);
});
