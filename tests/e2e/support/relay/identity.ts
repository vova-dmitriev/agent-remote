import { initData } from '../../../helpers/relay/telegram.js';

export async function identity(
  page: import('@playwright/test').Page,
  id: string,
  languageCode = 'ru',
  data = initData(id),
) {
  await page.route('https://telegram.org/js/telegram-web-app.js**', (route) =>
    route.fulfill({ body: '', contentType: 'application/javascript' }),
  );

  await page.addInitScript(
    (value) => {
      Object.defineProperty(window, 'Telegram', {
        configurable: true,
        value: {
          WebApp: {
            initData: value.data,
            initDataUnsafe: { user: { language_code: value.languageCode } },
            themeParams: {},
            ready() {},
            expand() {},
            onEvent() {},
            offEvent() {},
          },
        },
      });
    },
    { data, languageCode },
  );
}
