/* WZ MANAGE PRO — shared server helpers
   Fungsi murni/util tanpa akses database, dipakai oleh api/[...path].js.
   Modul ini sengaja diletakkan di luar folder api/ agar tidak menjadi
   serverless function tersendiri di Vercel. */
const crypto = require('crypto');

function hashPassword(password, salt=crypto.randomBytes(16).toString('hex')){
  const hash=crypto.scryptSync(String(password),salt,64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored){
  try{
    const [salt,hex]=String(stored).split(':');
    const a=Buffer.from(hex,'hex');
    const b=crypto.scryptSync(String(password),salt,64);
    return a.length===b.length && crypto.timingSafeEqual(a,b);
  }catch{return false}
}
function token(){return crypto.randomBytes(32).toString('hex')}
function tokenHash(t){return crypto.createHash('sha256').update(t).digest('hex')}
function defaultUsername(name){return String(name||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'')||'employee'}
function defaultPassword(name){return String(name||'').trim().toLowerCase().replace(/\s+/g,'')+'123'}
function normalizeBusinessId(value){
  const v=String(value||'').trim();
  if(!v)return '';
  const normalized=v.toUpperCase().replace(/[^A-Z0-9]/g,'');
  return normalized;
}
function safeServerError(error){
  const message = error && error.message ? String(error.message) : 'Server error';
  return process.env.NODE_ENV === 'production' ? 'Server sedang tidak tersedia. Silakan coba lagi nanti.' : message;
}
function xenditSafeName(name){
  const cleaned=String(name||'OWNER')
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]/g,'')
    .replace(/\s+/g,' ')
    .trim();

  return cleaned||'OWNER';
}
function cookie(name,value,maxAge){return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${process.env.NODE_ENV==='production'?'; Secure':''}`}
function send(res,status,data,headers={}){res.statusCode=status;for(const [k,v] of Object.entries(headers))res.setHeader(k,v);res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(data));}
async function body(req,maxBytes=8*1024*1024){
  let s='',size=0;
  for await(const chunk of req){
    const buf=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
    size+=buf.length;
    if(size>maxBytes){
      const error=new Error('Data request terlalu besar.');
      error.statusCode=413;
      throw error;
    }
    s+=buf.toString('utf8');
  }
  if(!s)return {};
  try{return JSON.parse(s)}
  catch{
    const error=new Error('Format JSON tidak valid.');
    error.statusCode=400;
    throw error;
  }
}

function validMoney(n){
  // Ketat: hanya menerima angka atau string numerik yang benar-benar terisi.
  // null/undefined/string kosong DITOLAK (dulu ikut lolos sebagai Rp0).
  if(n===null||n===undefined)return false;
  if(typeof n==='string'&&n.trim()==='')return false;
  const value=Number(n);
  return Number.isFinite(value)&&value>=0;
}
function validDate(value){
  const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value||''));
  if(!match)return false;
  const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);
  const date=new Date(Date.UTC(year,month-1,day));
  return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day;
}
function validTransaction(t){
  if(!t||typeof t!=='object')return false;
  const servicePrice=Number(t.servicePrice),discount=Number(t.discount),total=Number(t.total);
  return validDate(t.date)&&validMoney(t.servicePrice)&&validMoney(t.discount)&&validMoney(t.total)&&discount<=servicePrice&&Math.abs(total-Math.max(0,servicePrice-discount))<=0.001&&['SELESAI','VOID'].includes(String(t.status||'SELESAI'))&&['Tunai','QRIS','Transfer'].includes(String(t.payment||'Tunai'));
}
function validShift(r){
  const values=['openingCash','cash','qris','cashExpense','physicalCash','totalPayment','expectedCash','cashDifference','serviceTotal','productTotal','totalOmzet'];
  return validDate(r.date)&&values.every(key=>validMoney(r[key]))&&Number(r.serviceTotal||0)>0&&Number(r.totalPayment||0)>0&&Math.abs(Number(r.cashDifference||0))<=0.001&&Math.abs(Number(r.physicalCash||0)-(Number(r.openingCash||0)+Number(r.cash||0)-Number(r.cashExpense||0)))<=0.001;
}

module.exports={
  hashPassword,
  verifyPassword,
  token,
  tokenHash,
  defaultUsername,
  defaultPassword,
  normalizeBusinessId,
  safeServerError,
  xenditSafeName,
  cookie,
  send,
  body,
  validMoney,
  validDate,
  validTransaction,
  validShift
};
