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
/* --- laporan tutup shift -------------------------------------------------
   Seluruh aturan bentuk dan angka laporan tutup shift dikumpulkan di satu
   tempat: `normalizeShiftReport()`. Endpoint `shift-report` (dipakai form
   karyawan) dan `sync-business` memakai fungsi yang sama, jadi data yang
   sampai ke database selalu bentuknya sama.

   Yang paling penting di sini: SEMUA angka turunan -- totalPayment,
   expectedCash, cashDifference, serviceTotal, productTotal, totalOmzet --
   dihitung ulang dari angka mentah, bukan diambil dari klaim klien. Sebelumnya
   angka turunan itu ditulis apa adanya, sehingga laporan dengan isi Rp300.000
   bisa menyimpan omzet Rp999.999.999, dan angka itulah yang dibaca Owner,
   mesin payroll, serta laporan pajak. Klien tetap mengirim nilainya, tapi
   nilainya hanya jadi klaim yang harus cocok; kalau beda, laporan ditolak
   dengan pesan yang menyebut angkanya. */
const SHIFT_TYPES=['Full Shift','Pagi','Siang','Sore'];
const SHIFT_LIMITS={note:2000,customers:100000,rows:200,itemName:200,serviceId:100,category:40};
// Satu rupiah. Cukup untuk menoleransi derau floating point, dan tetap jauh
// di bawah nilai apa pun yang dipakai untuk berbohong.
const SHIFT_TOLERANCE=1;
const SHIFT_MAX_PAST_DAYS=366;
const SHIFT_MAX_FUTURE_DAYS=1;
const SHIFT_MONEY_LABELS={
  totalPayment:'total pembayaran',expectedCash:'kas akhir seharusnya',
  cashDifference:'selisih kasir',serviceTotal:'total layanan',
  productTotal:'total produk',totalOmzet:'total omzet shift'
};
const SHIFT_CASH_LABELS={
  openingCash:'kas awal shift',cash:'dibayar tunai',qris:'dibayar QRIS',
  cashExpense:'pengeluaran kas shift',physicalCash:'uang fisik akhir di kasir'
};

function shiftIDR(n){
  const v=Math.round(Number(n)||0);
  return (v<0?'-':'')+'Rp'+String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g,'.');
}
function shiftRound(n){
  return Math.round((Number(n)+Number.EPSILON)*100)/100;
}
function shiftDayNumber(value){
  const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value||''));
  if(!m)return NaN;
  const year=Number(m[1]),month=Number(m[2]),day=Number(m[3]);
  const t=Date.UTC(year,month-1,day);
  const back=new Date(t);
  if(back.getUTCFullYear()!==year||back.getUTCMonth()!==month-1||back.getUTCDate()!==day)return NaN;
  return t;
}
function shiftTodayNumber(){
  const now=new Date();
  return Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate());
}
function shiftRowTotal(claimed,qty,price,label){
  const total=shiftRound(qty*price);
  if(claimed!==undefined&&claimed!==null&&claimed!==''){
    const n=Number(claimed);
    if(!Number.isFinite(n))return {error:'Total "'+label+'" harus angka rupiah.'};
    if(Math.abs(n-total)>SHIFT_TOLERANCE)
      return {error:'Total "'+label+'" tidak cocok dengan jumlah x harga ('+shiftIDR(n)+' vs '+shiftIDR(total)+').'};
  }
  return {total};
}

// Mengembalikan {ok:true, report:{...}} dengan hanya field yang diizinkan,
// atau {ok:false, error:'...'}. Tidak ada nilai yang diteruskan apa adanya.
function normalizeShiftReport(input){
  const fail=error=>({ok:false,error});
  if(!input||typeof input!=='object'||Array.isArray(input))return fail('Laporan shift harus berupa objek.');

  const id=String(input.id||'').trim();
  if(!id||id.length>120)return fail('ID laporan shift tidak valid.');

  const date=String(input.date||'');
  if(!validDate(date))return fail('Tanggal laporan shift harus format YYYY-MM-DD dan tanggalnya harus benar-benar ada di kalender.');
  const day=shiftDayNumber(date),today=shiftTodayNumber();
  if(day>today+SHIFT_MAX_FUTURE_DAYS*86400000)return fail('Tanggal laporan shift tidak boleh di masa depan.');
  if(day<today-SHIFT_MAX_PAST_DAYS*86400000)return fail('Tanggal laporan shift terlalu lama (maksimal '+SHIFT_MAX_PAST_DAYS+' hari ke belakang).');

  const employeeId=String(input.employeeId||'').trim();
  if(!employeeId||employeeId.length>64)return fail('Laporan shift harus punya ID karyawan.');

  const shiftType=String(input.shiftType||'').trim();
  if(!SHIFT_TYPES.includes(shiftType))return fail('Jenis shift tidak dikenal. Pilih salah satu: '+SHIFT_TYPES.join(', ')+'.');

  // Angka kas. validMoney sudah menolak null, string kosong, dan negatif.
  const money={};
  for(const key of Object.keys(SHIFT_CASH_LABELS)){
    if(!validMoney(input[key]))return fail('Nilai '+SHIFT_CASH_LABELS[key]+' harus angka rupiah yang tidak negatif.');
    const n=Number(input[key]);
    if(!Number.isSafeInteger(n)||n>1e12)return fail('Nilai '+SHIFT_CASH_LABELS[key]+' harus angka rupiah bulat yang wajar.');
    money[key]=n;
  }

  const customersRaw=input.customers;
  if(!(customersRaw===undefined||customersRaw===null||customersRaw==='')){
    if(!validMoney(customersRaw))return fail('Jumlah pelanggan harus angka rupiah yang tidak negatif.');
  }
  const customers=Number(customersRaw);
  if(!Number.isInteger(customers)||customers<0)return fail('Jumlah pelanggan harus angka bulat dan tidak boleh negatif.');
  if(customers>SHIFT_LIMITS.customers)return fail('Jumlah pelanggan tidak wajar (maksimal '+SHIFT_LIMITS.customers+').');

  if(!Array.isArray(input.services))return fail('Daftar layanan laporan shift harus berupa array.');
  if(input.services.length>SHIFT_LIMITS.rows)return fail('Jumlah baris layanan melebihi batas ('+SHIFT_LIMITS.rows+').');
  const services=[];
  for(const row of input.services){
    if(!row||typeof row!=='object'||Array.isArray(row))return fail('Ada baris layanan yang tidak valid.');
    const serviceId=String(row.serviceId||'').trim();
    if(!serviceId||serviceId.length>SHIFT_LIMITS.serviceId)return fail('Ada baris layanan tanpa ID layanan yang dikenal.');
    const serviceName=String(row.serviceName||'').trim().slice(0,SHIFT_LIMITS.itemName);
    const label=serviceName||serviceId;
    const qty=Number(row.qty),price=Number(row.price);
    if(!Number.isInteger(qty)||qty<=0)return fail('Jumlah "'+label+'" harus angka bulat lebih dari 0.');
    if(!Number.isFinite(price)||price<0||price>1e12)return fail('Harga "'+label+'" harus angka rupiah yang tidak negatif.');
    const checked=shiftRowTotal(row.total,qty,price,label);
    if(checked.error)return fail(checked.error);
    services.push({
      serviceId,
      serviceName,
      // Kategori gaji ikut disimpan sebagai snapshot, sama seperti app-state.
      payrollCategory:String(row.payrollCategory||'').trim().slice(0,SHIFT_LIMITS.category),
      qty,price,total:checked.total
    });
  }

  if(!Array.isArray(input.products))return fail('Daftar produk laporan shift harus berupa array.');
  if(input.products.length>SHIFT_LIMITS.rows)return fail('Jumlah baris produk melebihi batas ('+SHIFT_LIMITS.rows+').');
  const products=[];
  for(const row of input.products){
    if(!row||typeof row!=='object'||Array.isArray(row))return fail('Ada baris produk yang tidak valid.');
    const name=String(row.name||'').trim();
    if(!name)return fail('Ada baris produk tanpa nama.');
    if(name.length>SHIFT_LIMITS.itemName)return fail('Nama produk lebih dari '+SHIFT_LIMITS.itemName+' karakter.');
    const qty=Number(row.qty),price=Number(row.price);
    if(!Number.isInteger(qty)||qty<0)return fail('Jumlah "'+name+'" harus angka bulat dan tidak boleh negatif.');
    if(!Number.isFinite(price)||price<0||price>1e12)return fail('Harga "'+name+'" harus angka rupiah yang tidak negatif.');
    const checked=shiftRowTotal(row.total,qty,price,name);
    if(checked.error)return fail(checked.error);
    products.push({name,qty,price,total:checked.total});
  }

  const serviceTotal=shiftRound(services.reduce((a,x)=>a+x.total,0));
  const productTotal=shiftRound(products.reduce((a,x)=>a+x.total,0));
  const totalOmzet=shiftRound(serviceTotal+productTotal);
  const totalPayment=shiftRound(money.cash+money.qris);
  const expectedCash=shiftRound(money.openingCash+money.cash-money.cashExpense);
  const cashDifference=shiftRound(money.physicalCash-expectedCash);

  if(services.length===0||serviceTotal<=0)return fail('Laporan shift wajib memiliki minimal 1 layanan.');
  if(totalPayment<=0)return fail('Total pembayaran laporan shift harus lebih dari Rp0.');
  if(Math.abs(cashDifference)>SHIFT_TOLERANCE)
    return fail('Selisih kasir harus Rp 0. Uang fisik '+shiftIDR(money.physicalCash)+' tidak sama dengan kas akhir seharusnya '+shiftIDR(expectedCash)+' (selisih '+shiftIDR(cashDifference)+').');

  // Klaim klien harus cocok dengan hitungan ulang. Selisih kecil (sampai Rp1)
  // ditoleransi karena derau floating point.
  const derived={totalPayment,expectedCash,cashDifference,serviceTotal,productTotal,totalOmzet};
  for(const key of Object.keys(SHIFT_MONEY_LABELS)){
    const claimed=input[key];
    if(claimed===undefined||claimed===null||claimed==='')continue;
    const n=Number(claimed);
    if(!Number.isFinite(n))return fail('Nilai '+SHIFT_MONEY_LABELS[key]+' harus angka.');
    if(Math.abs(n-derived[key])>SHIFT_TOLERANCE)
      return fail('Angka '+SHIFT_MONEY_LABELS[key]+' tidak cocok dengan isi laporan ('+shiftIDR(n)+' dikirim, '+shiftIDR(derived[key])+' hasil hitung ulang). Hitung ulang di aplikasi lalu simpan ulang.');
  }

  let note='';
  if(input.note!==undefined&&input.note!==null){
    if(typeof input.note!=='string')return fail('Catatan shift harus berupa teks.');
    note=input.note.trim();
    if(note.length>SHIFT_LIMITS.note)return fail('Catatan shift terlalu panjang (maksimal '+SHIFT_LIMITS.note+' karakter, sekarang '+note.length+').');
  }

  let savedAt=new Date().toISOString();
  if(typeof input.savedAt==='string'&&input.savedAt&&Number.isFinite(Date.parse(input.savedAt)))savedAt=new Date(input.savedAt).toISOString();

  return {
    ok:true,
    report:{
      id,date,employeeId,shiftType,customers,
      openingCash:money.openingCash,cash:money.cash,qris:money.qris,
      cashExpense:money.cashExpense,physicalCash:money.physicalCash,
      totalPayment,expectedCash,cashDifference,
      serviceTotal,productTotal,totalOmzet,
      services,products,note,savedAt
    }
  };
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
  validShift,
  normalizeShiftReport,
  SHIFT_TYPES,
  SHIFT_LIMITS
};
