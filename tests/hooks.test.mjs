import {createRequire} from 'node:module';
import {mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const {EVENTS, OWNER_MARKER, mergeOwnedHook, updateCodexHooks} = require('../electron/hooks.cjs');

test('hook update and uninstall change only RR-Island-owned entries', () => {
  const thirdParty = {type:'command', command:'other-tool hook', timeout:8};
  const original = {hooks:{PreToolUse:[{matcher:'*',hooks:[thirdParty]}], Custom:[{hooks:[thirdParty]}]}};
  const installed = mergeOwnedHook(original, '"C:\\Program Files\\RR-Island\\hook.exe" --rr-island-owned-hook=v1');
  assert.equal(installed.hooks.PreToolUse[0].hooks[0].command, thirdParty.command);
  assert.equal(installed.hooks.PreToolUse[1].hooks[0].command.includes(OWNER_MARKER), true);
  for (const event of EVENTS) assert.ok(installed.hooks[event].some(g=>g.hooks.some(h=>h.command.includes(OWNER_MARKER))));
  const removed = mergeOwnedHook(installed, '', false);
  assert.deepEqual(removed.hooks.PreToolUse, [{matcher:'*',hooks:[thirdParty]}]);
  assert.deepEqual(removed.hooks.Custom, [{hooks:[thirdParty]}]);
  for (const event of EVENTS)
    assert.equal((removed.hooks[event]||[]).some(g=>g.hooks?.some(h=>h.command?.includes(OWNER_MARKER))), false);
});

test('malformed config is not overwritten and an install creates a recoverable backup', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rr island hooks '));
  const hooksFile = join(dir, '.codex', 'hooks.json');
  try {
    mkdirSync(join(dir,'.codex'),{recursive:true});
    writeFileSync(hooksFile, '{broken', 'utf8');
    assert.throws(()=>updateCodexHooks({hooksFile,executable:'hook.exe',stateDir:dir,enabled:true}), /tidak valid/);
    assert.equal(readFileSync(hooksFile,'utf8'), '{broken');
    writeFileSync(hooksFile, JSON.stringify({hooks:{PreToolUse:[{hooks:[{type:'command',command:'keep-me'}]}]}}));
    updateCodexHooks({hooksFile,executable:'hook.exe',stateDir:dir,enabled:true});
    const current=JSON.parse(readFileSync(hooksFile,'utf8'));
    assert.ok(current.hooks.PreToolUse.some(g=>g.hooks.some(h=>h.command==='keep-me')));
    assert.equal(existsSync(join(dir,'.codex','rr-island-backups')),true);
    updateCodexHooks({hooksFile,executable:'hook.exe',stateDir:dir,enabled:false});
    const uninstalled=JSON.parse(readFileSync(hooksFile,'utf8'));
    assert.deepEqual(uninstalled.hooks.PreToolUse,[{hooks:[{type:'command',command:'keep-me'}]}]);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
