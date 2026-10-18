export const extensionEN = {
  extensionOpenFullTab: "Open in a tab",
  extensionInstallCompanion: "Install the Agent Remote companion on this Mac, then reopen the extension.",
  extensionApproveBrowser: "Approve this browser on your Mac with remote browser authorize, then reopen the extension.",
  extensionGrantRevoked: "Access for this browser was revoked. Approve it again on your Mac to reconnect.",
  extensionVersionMismatch: "The extension and companion versions do not match. Update them together when your sessions are idle.",
  extensionRevisionConflict: "This item changed in another window. Reload it before editing again.",
  extensionTransferExpired: "The transfer expired. Select the file again.",
  extensionPayloadTooLarge: "This item exceeds the supported size. Open a smaller section or file.",
  extensionConnectHint: "Connect this browser to the Agent Remote companion on your Mac.",
  desktopBridgeUnavailable: "The desktop bridge is unavailable. Reopen Agent Remote from the desktop app.",
}

export const extensionRU: Record<keyof typeof extensionEN, string> = {
  extensionOpenFullTab: "Открыть во вкладке",
  extensionInstallCompanion: "Установи companion Agent Remote на этом Mac и заново открой расширение.",
  extensionApproveBrowser: "Разреши доступ браузеру на Mac командой remote browser authorize и заново открой расширение.",
  extensionGrantRevoked: "Доступ браузера отозван. Разреши его повторно на Mac для подключения.",
  extensionVersionMismatch: "Версии расширения и companion несовместимы. Обнови их вместе, когда сессии завершат работу.",
  extensionRevisionConflict: "Данные изменились в другом окне. Загрузи актуальную версию перед редактированием.",
  extensionTransferExpired: "Время передачи истекло. Выбери файл заново.",
  extensionPayloadTooLarge: "Размер превышает ограничение. Открой меньший участок переписки или файл.",
  extensionConnectHint: "Подключи браузер к companion Agent Remote на своём Mac.",
  desktopBridgeUnavailable: "Мост desktop-приложения недоступен. Перезапусти Agent Remote из desktop-приложения.",
}
