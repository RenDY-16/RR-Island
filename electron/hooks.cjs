const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');

const EVENTS = [
  'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse',
  'PostToolUseFailure', 'Stop', 'StopFailure', 'SessionEnd',
];
const OWNER_MARKER = '--rr-island-owned-hook=v1';

function quoteArg(value, platform = process.platform) {
  const text = String(value);
  if (platform === 'win32') return `"${text.replaceAll('"', '\\"')}"`;
  return `'${text.replaceAll("'", "'\\''")}'`;
}

function makeHookCommand(executable, stateDir, platform = process.platform, extraArgs = []) {
  return [executable, ...extraArgs, OWNER_MARKER, '--state-dir', stateDir]
    .map(value => quoteArg(value, platform)).join(' ');
}

function isOwned(hook) {
  return hook?.type === 'command' && typeof hook.command === 'string'
    && hook.command.includes(OWNER_MARKER);
}

function normalizeHooks(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Codex hooks.json harus berisi objek JSON.');
  const data = structuredClone(input);
  if (data.hooks === undefined) data.hooks = {};
  if (!data.hooks || typeof data.hooks !== 'object' || Array.isArray(data.hooks))
    throw new Error('Properti hooks di hooks.json harus berupa objek.');
  for (const [event, groups] of Object.entries(data.hooks)) {
    if (!Array.isArray(groups)) throw new Error(`Hooks untuk ${event} harus berupa daftar.`);
  }
  return data;
}

function mergeOwnedHook(input, command, enabled = true) {
  const data = normalizeHooks(input);
  for (const [event, groups] of Object.entries(data.hooks)) {
    data.hooks[event] = groups.map(group => {
      if (!group || typeof group !== 'object' || Array.isArray(group))
        throw new Error(`Grup hook ${event} tidak valid.`);
      if (group.hooks !== undefined && !Array.isArray(group.hooks))
        throw new Error(`Daftar hook ${event} tidak valid.`);
      return {...group, hooks: (group.hooks || []).filter(hook => !isOwned(hook))};
    }).filter(group => (group.hooks || []).length || !Object.hasOwn(group, 'hooks'));
    if (!data.hooks[event].length) delete data.hooks[event];
  }
  if (enabled) {
    for (const event of EVENTS) {
      data.hooks[event] ||= [];
      data.hooks[event].push({hooks:[{
        type: 'command', command, timeout: 2,
        ...(event === 'SessionEnd' ? {} : {async:true}),
      }]});
    }
  }
  return data;
}

function atomicWrite(file, text) {
  const folder = path.dirname(file);
  fs.mkdirSync(folder, {recursive:true});
  const temp = path.join(folder, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  let fd;
  try {
    fd = fs.openSync(temp, 'wx', 0o600);
    fs.writeFileSync(fd, text, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd); fd = undefined;
    fs.renameSync(temp, file);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

function updateCodexHooks({hooksFile, executable, stateDir, enabled, command}) {
  let original = {};
  if (fs.existsSync(hooksFile)) {
    try { original = JSON.parse(fs.readFileSync(hooksFile, 'utf8')); }
    catch { throw new Error('hooks.json tidak valid; RR-Island tidak mengubahnya. Perbaiki atau pulihkan file itu dahulu.'); }
  }
  const updated = mergeOwnedHook(original, command || makeHookCommand(executable, stateDir), enabled);
  const serialized = JSON.stringify(updated, null, 2) + '\n';
  if (JSON.stringify(original) === JSON.stringify(updated)) return {changed:false};
  if (fs.existsSync(hooksFile)) {
    const backups = path.join(path.dirname(hooksFile), 'rr-island-backups');
    fs.mkdirSync(backups, {recursive:true});
    const backup = path.join(backups, `hooks-${new Date().toISOString().replaceAll(':','-')}-${randomUUID()}.json`);
    fs.copyFileSync(hooksFile, backup, fs.constants.COPYFILE_EXCL);
  }
  atomicWrite(hooksFile, serialized);
  return {changed:true, enabled, hooksFile};
}

module.exports = {EVENTS, OWNER_MARKER, isOwned, makeHookCommand, mergeOwnedHook, updateCodexHooks};
