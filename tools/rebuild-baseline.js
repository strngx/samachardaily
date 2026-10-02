const fs = require('fs');
const { execSync } = require('child_process');
const crypto = require('crypto');
const readline = require('readline');

// Target hash before Phase 15P-I.6
const TARGET_HASH = '3a566ee5f6c4d6e9a49850c22f205810b534c94af3f7e04d8cfbc53024a22b4b';

async function main() {
  console.log('Reconstructing baseline Code.gs from origin/main commit bbff0cd3...');
  
  // 1. Get initial Code.gs from git commit bbff0cd3
  let code = execSync('git show bbff0cd3ac8dbde015c585765eeef4e03354b012:Code.gs').toString();
  console.log('Initial code length:', code.length);

  // Read transcript_full.jsonl to find all tool calls affecting Code.gs in chronological order
  const transcriptPath = 'C:/Users/Xeno/.gemini/antigravity-ide/brain/455787d5-eb7c-4fb1-b431-af99f2ee2d0e/.system_generated/logs/transcript_full.jsonl';
  const rl = readline.createInterface({
    input: fs.createReadStream(transcriptPath),
    crlfDelay: Infinity
  });

  const actions = [];
  for await (const line of rl) {
    if (line.includes('Code.gs')) {
      try {
        const obj = JSON.parse(line);
        if (obj.step_index >= 3390) continue; // Only steps before I.6
        if (obj.tool_calls && Array.isArray(obj.tool_calls)) {
          for (const tc of obj.tool_calls) {
            if ((tc.name === 'replace_file_content' || tc.name === 'multi_replace_file_content') && tc.args && tc.args.TargetFile && tc.args.TargetFile.endsWith('Code.gs')) {
              actions.push({ step: obj.step_index, type: tc.name, args: tc.args });
            } else if (tc.name === 'run_command' && tc.args && tc.args.CommandLine) {
              const cmd = tc.args.CommandLine;
              if (cmd.includes('apply-phase') || (cmd.includes('node -e') && cmd.includes('replace') && cmd.includes('Code.gs'))) {
                actions.push({ step: obj.step_index, type: 'command', cmd: cmd });
              }
            }
          }
        }
      } catch (e) {}
    }
  }

  console.log(`Found ${actions.length} actions on Code.gs in history.`);
  // Log all actions to inspect
  for (const a of actions) {
    console.log(`Step ${a.step}: ${a.type} -> ${a.args ? (a.args.Description || '') : a.cmd.slice(0, 80)}`);
  }
}

main().catch(console.error);
