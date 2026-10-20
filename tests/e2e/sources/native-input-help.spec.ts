import { expect } from '@playwright/test';
import { test, deviceFixture, delivered, setCommandOutcome, publishMessages } from '../support/relay/relay-fixture.js';
import { identity } from '../support/relay/identity.js';
import { byTestId } from '../support/ui/testid.js';
import { jumpNear } from '../support/ui/rail.js';
import { sessionSnapshot } from '../support/fixtures/session-fixtures.js';
import { SESSION_CARD_IDS } from '@/entities/session/config/test-ids.js';
import { SESSION_FEED_IDS } from '@/pages/session/config/test-ids.js';
import { SHELL_IDS } from '@/widgets/application-shell/config/test-ids.js';
import { COMMAND_IDS } from '@/features/send-command/config/test-ids.js';

test('restarts the original native conversation on Mac and enables its input with one click', async ({ page }) => {
  const f=deviceFixture(),snapshot=sessionSnapshot(f.deviceId),source=snapshot.sessions[0]!;

  source.target={kind:'claude-code-cli',deviceId:f.deviceId,connectorId:'native',claudeSessionId:source.claudeSessionId!};
  source.binding='unverified';source.integrationState='needs_restart';
  source.capabilities={...source.capabilities,prompt:false,restartSession:true,terminalSnapshot:false};
  snapshot.permissions=[];snapshot.terminal=null;
  f.sockets[0]!.send(JSON.stringify({type:'snapshot',snapshot,connectors:[]}));
  await expect.poll(async()=> (await f.relay.db.pool.query("SELECT data->'capabilities'->>'restartSession' AS flag FROM sessions WHERE id='terminal-session'")).rows[0]?.flag).toBe('true');
  await publishMessages(Array.from({length:80},(_,index)=>({id:'restart-read-'+index,role:'assistant' as const,text:'Synthetic restart reading line '+index+'\n\n'+('Paragraph '+index+'. ').repeat(4),occurredAt:1700000000000+index})));
  await page.emulateMedia({reducedMotion:'reduce'});
  await identity(page,'801','ru');
  await page.goto('/');
  await byTestId(page,SESSION_CARD_IDS.root,{'session-id':'terminal-session'}).click();
  await expect(page.getByTestId(COMMAND_IDS.prompt)).toBeDisabled();
  const target=await jumpNear(page,'restart-read-25');
  const message=byTestId(page,SESSION_FEED_IDS.message,{'message-id':target});

  await expect(message).toBeVisible();
  const before=await message.evaluate(node=>node.getBoundingClientRect().top);

  const positions=message.evaluate(node=>new Promise<number[]>(resolve=>{const samples:number[]=[];

const sample=()=>{samples.push(node.isConnected?node.getBoundingClientRect().top:-9999);if(samples.length===90)resolve(samples);else requestAnimationFrame(sample);};

requestAnimationFrame(sample);}));

  setCommandOutcome('held');
  let historyLoads=0;

  page.on('request',request=>{if(request.url().includes('/events'))historyLoads++;});
  await page.getByTestId(COMMAND_IDS.restartSession).click();
  await expect.poll(()=>delivered.length).toBe(1);
  expect(delivered[0]!.action.type).toBe('restart_session');
  await expect(page.getByTestId(COMMAND_IDS.restartSession)).toBeDisabled();
  const resumed=structuredClone(snapshot);

  resumed.sessions[0]={...source,generation:'resumed',target:{kind:'cmux',deviceId:f.deviceId,connectorId:'owned-wrapper',windowId:'11111111-1111-4111-8111-111111111111',workspaceId:'22222222-2222-4222-8222-222222222222',surfaceId:'33333333-3333-4333-8333-333333333333'},binding:'verified',integrationState:'ready',capabilities:{...source.capabilities,prompt:true,restartSession:false,terminalSnapshot:true}};
  resumed.permissions=resumed.permissions.filter(item=>item.sessionId!==source.id);
  if(resumed.terminal) resumed.terminal.generation='resumed';
  f.sockets[0]!.send(JSON.stringify({type:'snapshot',snapshot:resumed,connectors:[]}));
  await expect.poll(async()=> (await f.relay.db.pool.query("SELECT data->>'generation' AS generation FROM sessions WHERE id='terminal-session'")).rows[0]?.generation).toBe('resumed');
  f.sockets[0]!.send(JSON.stringify({type:'command_result',result:{commandId:delivered[0]!.commandId,status:'dispatched',sessionId:'terminal-session'}}));
  await expect(page.getByTestId(COMMAND_IDS.prompt)).toBeEnabled();
  await expect(page.getByTestId(COMMAND_IDS.restartSession)).toHaveCount(0);
  await expect(page.getByTestId(SHELL_IDS.receipt)).toHaveText('Доставлено в сессию');
  expect(historyLoads).toBe(0);
  const samples=await positions;

  expect(Math.max(...samples.map(top=>Math.abs(top-before)))).toBeLessThan(3);
});
