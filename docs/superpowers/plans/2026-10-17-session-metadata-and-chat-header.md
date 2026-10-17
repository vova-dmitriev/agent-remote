# Compact session header, real models and formatted notifications

User-authorized implementation; no commits or paid services.

1. Remove the application header only inside selected sessions. Keep navigation,
   title, source, actions and a small green/red availability button in one toolbar.
   Availability includes app connection, Mac heartbeat, source binding and state.
   Show localized details on hover/focus/tap; preserve keyboard and touch dismissal.
2. Replace both warm palettes with cool neutral backgrounds and blue accents,
   including selected menu items and focus. Auto still follows Telegram/system
   light/dark mode. Preserve semantic danger/status colors.
3. Carry optional per-session native model metadata through protocol, persistence,
   snapshots and compact cards. Prefer exact thread settings/transcript metadata;
   never substitute global account defaults. Explicitly show unknown when absent.
4. Render bounded CommonMark notification previews into escaped Telegram HTML.
   Preserve paragraphs, lists and code, exact owned-session deep links and existing
   delivery/error/permission semantics. Do not send test notifications to real chats.
5. Verify regression tests, source architecture gates, Storybook, all mobile E2E,
   production build/package and independent review. Publish the local service and
   keep Telegram Main Mini App URL synchronized if the free tunnel changes.
