const fs = require('fs');
const readline = require('readline');
const crypto = require('crypto');

const transcriptPath = 'C:/Users/Xeno/.gemini/antigravity-ide/brain/455787d5-eb7c-4fb1-b431-af99f2ee2d0e/.system_generated/logs/transcript_full.jsonl';
const rl = readline.createInterface({
  input: fs.createReadStream(transcriptPath),
  crlfDelay: Infinity
});

const targetHash = '3a566ee5f6c4d6e9a49850c22f205810b534c94af3f7e04d8cfbc53024a22b4b';
let found = false;

rl.on('line', line => {
  if (line.includes('Code.gs') && line.includes('CodeContent')) {
    try {
      const obj = JSON.parse(line);
      if (obj.tool_calls) {
        for (const tc of obj.tool_calls) {
          if (tc.name === 'write_to_file' && tc.args && tc.args.TargetFile && tc.args.TargetFile.endsWith('Code.gs')) {
            const content = tc.args.CodeContent;
            const hash = crypto.createHash('sha256').update(content).digest('hex');
            console.log(`Step ${obj.step_index}: Target=${tc.args.TargetFile} length=${content.length} hash=${hash}`);
            if (hash === targetHash) {
              console.log('EXACT HASH MATCH FOUND! Writing to Code.gs...');
              fs.writeFileSync('Code.gs', content, 'utf8');
              found = true;
            }
          }
        }
      }
    } catch (e) {
      // ignore parse error
    }
  }
});

rl.on('close', () => {
  if (!found) {
    console.log('Exact hash not matched among write_to_file calls. Searching replace_file_content or other steps...');
  } else {
    console.log('Restoration complete!');
  }
});
