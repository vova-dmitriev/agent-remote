import { contextBridge, ipcRenderer } from 'electron';
import { exposeDesktopPreloadBridge } from './bridge.js';

exposeDesktopPreloadBridge(contextBridge, ipcRenderer, document);
