const fs=require('fs');
const p='app/index.html';
let s=fs.readFileSync(p,'utf8');
if(!s.includes('WZ MANAGE PRO — FULL ONLINE BRIDGE')){
  const addon=fs.readFileSync('tools/online-bridge.js','utf8');
  s=s.replace('</body>','<script>\n'+addon+'\n</script>\n</body>');
  fs.writeFileSync(p,s);
}
