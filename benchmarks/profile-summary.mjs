import fs from 'node:fs';
const profile = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const self = new Map();
profile.samples.forEach((id, index) => self.set(id, (self.get(id) ?? 0) + (profile.timeDeltas[index] ?? 0)));
const byFile = new Map();
for (const node of profile.nodes) {
  const url = node.callFrame.url;
  byFile.set(url, (byFile.get(url) ?? 0) + (self.get(node.id) ?? 0));
}
console.log('Self samples by file (ms):');
console.log([...byFile].map(([file, us]) => ({ file, ms: Math.round(us / 1000) })).sort((a,b) => b.ms - a.ms).slice(0,30));
console.log('Self samples by function (ms):');
console.log(profile.nodes.map((node) => ({ name: node.callFrame.functionName, file: node.callFrame.url, ms: Math.round((self.get(node.id) ?? 0)/1000) })).sort((a,b) => b.ms - a.ms).slice(0,20));
