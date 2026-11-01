import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,chmod,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
test('AI discovery only suggests executable files in explicit installation directories', {skip:process.platform!=='darwin'}, async()=>{
 const root=await mkdtemp(join(tmpdir(),'maricode-discovery-'));
 try {
  await mkdir(join(root,'bin'));await mkdir(join(root,'bin','claude'));
  await writeFile(join(root,'bin','codex'),'#!/bin/sh\nexit 99\n');
  await writeFile(join(root,'main.swift'),`import Foundation\nlet roots = [CommandLine.arguments[1]]\nprint(installedAgentCandidates("codex", directories: roots).count)\nprint(installedAgentCandidates("claude", directories: roots).count)\nprint(installedAgentCandidates("../codex", directories: roots).count)\n`);
  execFileSync('/usr/bin/swiftc',[resolve('apps/mac-launcher/AgentDiscovery.swift'),join(root,'main.swift'),'-o',join(root,'check')]);
  const run=()=>execFileSync(join(root,'check'),[join(root,'bin')],{encoding:'utf8'}).trim();
  assert.equal(run(),'0\n0\n0');await chmod(join(root,'bin','codex'),0o755);assert.equal(run(),'1\n0\n0');
 } finally {await rm(root,{recursive:true,force:true});}
});
