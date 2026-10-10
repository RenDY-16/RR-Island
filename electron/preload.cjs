const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('island', Object.freeze({
  request:(op,params)=>ipcRenderer.invoke('bridge:request',op,params||{}),
  getSettings:()=>ipcRenderer.invoke('settings:get'),
  saveSettings:settings=>ipcRenderer.invoke('settings:set',settings),
  getStatus:()=>ipcRenderer.invoke('status:get'),
  setHooks:enabled=>ipcRenderer.invoke('hooks:set',enabled),
  chooseFolder:()=>ipcRenderer.invoke('folder:choose'),
  version:()=>ipcRenderer.invoke('app:version'),
  onEvent:callback=>{const listener=(_event,value)=>callback(value);ipcRenderer.on('island:event',listener);return()=>ipcRenderer.removeListener('island:event',listener);},
  onStatus:callback=>{const listener=(_event,value)=>callback(value);ipcRenderer.on('island:status',listener);return()=>ipcRenderer.removeListener('island:status',listener);},
}));
