import { expect } from '@playwright/test';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TranscriptSources } from '@daemon/monitor/history.js';
import { SESSION_CARD_IDS } from '@/entities/session/config/test-ids.js';
import { SESSIONS_PAGE_IDS } from '@/pages/sessions/config/test-ids.js';
import { test,deviceFixture } from './support/relay-fixture.js';
import { sessionSnapshot } from './support/session-fixtures.js';
import { identity } from './support/identity.js';

test('a recent message beyond a large native history promotes the session without opening it or replaying its history',async({page})=>{
 const root=await mkdtemp(join(tmpdir(),'native-order-'));

 try{
  const f=deviceFixture(),snapshot=sessionSnapshot(f.deviceId),source=snapshot.sessions[0]!;

  source.lastMessageAt=100;source.status='running';
  const other={...source,id:'recent-short-history',title:'Synthetic recent short history',target:{...source.target,connectorId:'other'},lastMessageAt:200,status:'unknown' as const};

  snapshot.sessions.push(other);
  f.sockets[0]!.send(JSON.stringify({type:'snapshot',snapshot,connectors:[]}));
  await identity(page,'801','en');await page.goto('/');
  await page.getByTestId(SESSIONS_PAGE_IDS.filterClaude).click();
  const cards=page.getByTestId(SESSION_CARD_IDS.root);

  await expect(cards.first()).toHaveAttribute('data-session-id',other.id);
  const file=join(root,'source.jsonl');

  await writeFile(file,JSON.stringify({type:'assistant',sessionId:source.claudeSessionId,uuid:'old',timestamp:new Date(100).toISOString(),message:{content:'Synthetic old message'}})+'\n'+JSON.stringify({type:'api-request-blob',data:'x'.repeat(3*1024*1024)})+'\n'+JSON.stringify({type:'user',sessionId:source.claudeSessionId,uuid:'latest',timestamp:new Date(300).toISOString(),message:{content:'Synthetic latest message'}})+'\n');

  const sources=new TranscriptSources(root,undefined,(id,generation,time)=>{
   if(id!==source.id||generation!==source.generation)throw new Error('SYNTHETIC_SOURCE_CHANGED');
   source.lastMessageAt=time;
   f.sockets[0]!.send(JSON.stringify({type:'snapshot',snapshot,connectors:[]}));
  });

  sources.open(source.id,source.generation,file,source.claudeSessionId!);
  await sources.refreshActivity();
  await expect(cards.first()).toHaveAttribute('data-session-id',source.id);
  await page.reload();await page.getByTestId(SESSIONS_PAGE_IDS.filterClaude).click();
  await expect(cards.first()).toHaveAttribute('data-session-id',source.id);
 }finally{await rm(root,{recursive:true,force:true});}
});
