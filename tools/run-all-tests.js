const { execSync } = require('child_process');

const suites = [
  'tools/test-phase-15p-h.js',
  'tools/test-multi-source.js',
  'tools/test-phase-15p-i.js',
  'tools/test-phase-15p-i3.js',
  'tools/test-phase-15p-i4.js',
  'tools/test-phase-15p-i5.js',
  'tools/test-phase-15p-i6.js',
  'tools/test-phase-15p-i7.js',
  'tools/test-phase-15p-i8.js',
  'tools/test-phase-15p-i9.js'
];

let totalPassed = 0;
let totalFailed = 0;

console.log('========================================================');
console.log('RUNNING COMPLETE PIPELINE REGRESSION & I.6 TEST SUITE');
console.log('========================================================\n');

for (const suite of suites) {
  try {
    const out = execSync(`node ${suite}`, { encoding: 'utf8' });
    console.log(`[PASS] ${suite}`);
    // Extract passed count if possible
    const match = out.match(/(\d+)\s*\/\s*(\d+)\s*PASSED/i) || out.match(/TEST RESULTS:\s*(\d+)\s*\/\s*(\d+)/i);
    if (match) {
      console.log(`       Assertions: ${match[1]} / ${match[2]}`);
    }
  } catch (err) {
    console.error(`[FAIL] ${suite}`);
    console.error(err.stdout || err.message);
    totalFailed++;
  }
}

console.log('\n========================================================');
if (totalFailed === 0) {
  console.log('ALL TEST SUITES PASSED CLEANLY (100%)');
} else {
  console.error(`${totalFailed} SUITES FAILED`);
  process.exit(1);
}
console.log('========================================================');
