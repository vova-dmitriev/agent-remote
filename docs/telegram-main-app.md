# Telegram Main Mini App

Configure the Main App in BotFather: Open → your bot → Mini Apps → Main App.
Enter your public HTTPS origin (for example, `https://agent.example.com`), save it,
and confirm that Main App shows Enabled. Keep Same-Origin Restriction enabled.

This is separate from the in-chat Menu Button configured by `setChatMenuButton`.
The companion updates the menu URL; the ordinary Bot API cannot update the Main
App URL in BotFather. When the public origin changes, update the Main App URL
manually. A named tunnel avoids the hostname changes of a temporary Quick Tunnel.
See [permanent-domain.md](permanent-domain.md).

Verify the public origin's health endpoint and the Main App setting in BotFather.
The Bot API `getMe` response can report `has_main_web_app`, but does not expose
the configured Main App URL. Check the chat-list launch button on the target
Telegram clients separately; do not publish verification screenshots with real
account or session data.

Reference: [Telegram Main Mini Apps](https://core.telegram.org/bots/webapps#launching-the-main-mini-app).
