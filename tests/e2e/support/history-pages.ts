import { expect,type Page } from '@playwright/test';
import { SESSION_FEED_IDS } from '../../../apps/mini-app/src/pages/session/config/test-ids.js';

export async function loadEarlierMessages(page:Page,total:number){
 const markers=page.getByTestId(SESSION_FEED_IDS.marker);

 while(await markers.count()<total){
  const previous=await markers.count();

  await markers.first().click();
  await expect.poll(()=>markers.count()).toBeGreaterThan(previous);
 }
}
