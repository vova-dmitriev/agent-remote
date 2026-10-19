import { expect,type Page } from '@playwright/test';
import { HistoryDirection } from '@protocol';
import { SESSION_FEED_IDS } from '../../../apps/mini-app/src/pages/session/config/test-ids.js';
import { byTestId } from './testid.js';

/** Loads earlier pages through the rail's "more history" cap until `total` messages are loaded. */
export async function loadEarlierMessages(page:Page,total:number){
 const rail=page.getByTestId(SESSION_FEED_IDS.rail);
 const loaded=async()=>Number(await rail.getAttribute('data-message-count'));

 while(await loaded()<total){
  const previous=await loaded();

  await byTestId(page,SESSION_FEED_IDS.railCap,{direction:HistoryDirection.Before}).click();
  await expect.poll(loaded).toBeGreaterThan(previous);
 }
}
