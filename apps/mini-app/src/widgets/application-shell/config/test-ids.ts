export const SHELL_IDS = {
  root: "application-shell",
  header: "application-shell-header",
  home: "application-shell-home",
  connection: "application-shell-connection",
  logout: "application-shell-logout",
  logoutConfirm: {
    root: "application-shell-logout-dialog",
    confirm: "application-shell-logout-confirm",
    cancel: "application-shell-logout-cancel",
  },
  receipt: "application-shell-receipt",
  openTab: "application-shell-open-tab",
  sidebarToggle: "application-shell-sidebar-toggle",
  settings: "application-shell-settings",
  settingsMenu: "application-shell-settings-menu",
  settingsSeparator: "application-shell-settings-separator",
  accounts: "application-shell-accounts",
  usage: "application-shell-usage",
  rules: "application-shell-rules",
} as const

export const LINK_EXTENSION_IDS = {
  open: "link-extension-open",
  dialog: "link-extension-dialog",
  code: "link-extension-code",
  expires: "link-extension-expires",
  copy: "link-extension-copy",
  renew: "link-extension-renew",
  done: "link-extension-done",
  failed: "link-extension-failed",
} as const
