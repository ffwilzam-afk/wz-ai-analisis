/* WZ MANAGE PRO — FULL ONLINE BRIDGE
   Server/Neon is authoritative. No browser storage is used for business state. */
(function(){
'use strict';

async function api(path,options={}){
  const res=await fetch('/api/'+path,{
    credentials:'include',
    headers:{'Content-Type':'application/json',...(options.headers||{})},
    ...options
  });
  const text=await res.text();
  let data=null;
  try{data=text?JSON.parse(text):null}catch{}
  if(!res.ok)throw new Error(data?.error||data?.message||('HTTP '+res.status));
  return data;
}
window.WZOnlineEmployee={api};

const NON_BUSINESS_KEYS=new Set([
  'transactions','shiftReports','employees','__onlineStateLoaded','__onlineStateSaving',
  '__onlineSaveTimer','__rosterVersion','__kyongShiftImport'
]);

async function hydrateAppState(){
  if(!currentUser || !['owner','manager'].includes(currentUser.role))return false;
  try{
    const r=await api('app-state');
    const state=(r?.data&&typeof r.data==='object'&&!Array.isArray(r.data))?r.data:{};
    const hasState=Object.keys(state).length>0;
    if(hasState)Object.assign(db,state);
    db.__onlineStateLoaded=true;
    return hasState;
  }catch(e){
    console.warn('Online app-state load failed:',e.message||e);
    return false;
  }
}

let saveTimer=null;
async function persistAppState(){
  if(!currentUser || !['owner','manager'].includes(currentUser.role))return false;
  const snapshot={};
  for(const [key,value] of Object.entries(db||{})){
    if(NON_BUSINESS_KEYS.has(key))continue;
    snapshot[key]=value;
  }
  try{
    await api('app-state',{method:'PUT',body:JSON.stringify({data:snapshot})});
    const el=document.getElementById('saveState');
    if(el)el.textContent='● Tersimpan online';
    return true;
  }catch(e){
    console.warn('Online app-state save failed:',e.message||e);
    const el=document.getElementById('saveState');
    if(el)el.textContent='● Belum tersimpan ke server';
    return false;
  }
}
function queueAppStateSave(){
  if(!currentUser || !['owner','manager'].includes(currentUser.role))return;
  clearTimeout(saveTimer);
  saveTimer=setTimeout(()=>persistAppState(),250);
}
window.WZOnlineStateSave={persist:persistAppState,queue:queueAppStateSave};

function applyBusinessData(data){
  if(!data||typeof data!=='object')return;
  if(Array.isArray(data.transactions)){
    db.transactions=data.transactions.map(t=>({
      ...t,
      date:String(t.date||'').slice(0,10),
      servicePrice:Number(t.servicePrice||0),
      total:Number(t.total||0),
      discount:Number(t.discount||0)
    }));
  }
  if(Array.isArray(data.shiftReports)){
    db.shiftReports=data.shiftReports.map(r=>({
      ...r,
      date:String(r.date||'').slice(0,10),
      customers:Number(r.customers||0),
      openingCash:Number(r.openingCash||0),
      cash:Number(r.cash||0),
      qris:Number(r.qris||0),
      cashExpense:Number(r.cashExpense||0),
      physicalCash:Number(r.physicalCash||0),
      totalPayment:Number(r.totalPayment||0),
      expectedCash:Number(r.expectedCash||0),
      cashDifference:Number(r.cashDifference||0),
      serviceTotal:Number(r.serviceTotal||0),
      productTotal:Number(r.productTotal||0),
      totalOmzet:Number(r.totalOmzet||0),
      services:Array.isArray(r.services)?r.services:[],
      products:Array.isArray(r.products)?r.products:[]
    }));
  }
}

async function syncBusiness(){
  if(!currentUser)return false;
  try{
    const beforeTx=new Map((db.transactions||[]).map(x=>[String(x.id),x]));
    const beforeSh=new Map((db.shiftReports||[]).map(x=>[String(x.id),x]));
    const first=await api('business');
    const serverTx=Array.isArray(first?.transactions)?first.transactions:[];
    const serverSh=Array.isArray(first?.shiftReports)?first.shiftReports:[];
    const conflicts=[];
    const sameFields=(a,b,fields)=>fields.every(field=>{
      const left=String(a?.[field]??''),right=String(b?.[field]??'');
      return field==='date'?left.slice(0,10)===right.slice(0,10):left===right;
    });
    for(const t of serverTx){
      const local=beforeTx.get(String(t.id));
      if(local&&!sameFields(local,t,['date','customerId','serviceId','servicePrice','employeeId','total','payment','status','discount']))
        conflicts.push({type:'transaction',id:String(t.id),resolution:'server'});
    }
    for(const r of serverSh){
      const local=beforeSh.get(String(r.id));
      if(local&&!sameFields(local,r,['date','employeeId','shiftType','customers','openingCash','cash','qris','cashExpense','physicalCash','totalPayment','expectedCash','cashDifference','serviceTotal','productTotal','totalOmzet','note']))
        conflicts.push({type:'shiftReport',id:String(r.id),resolution:'server'});
    }
    applyBusinessData({transactions:serverTx,shiftReports:serverSh});
    if(conflicts.length&&typeof toast==='function')toast(`${conflicts.length} konflik data terdeteksi; versi server digunakan.`);
    if(typeof render==='function')render();
    return true;
  }catch(e){
    console.warn('Online business sync failed:',e.message||e);
    if(typeof toast==='function' && /401|Belum login/i.test(String(e.message||'')))toast('Sesi login sudah berakhir. Silakan login kembali.');
    return false;
  }
}
window.WZOnlineBusiness={sync:syncBusiness,lastConflicts:[]};

async function fullHydrate(){
  if(!currentUser)return false;
  if(['owner','manager'].includes(currentUser.role))await hydrateAppState();
  await syncEmployeesFromServer();
  return syncBusiness();
}

async function syncEmployeesFromServer(){
  if(!currentUser || !['owner','manager'].includes(currentUser.role))return false;
  try{
    const r=await api('employees');
    const server=Array.isArray(r?.employees)?r.employees:[];
    if(!Array.isArray(db.employees))db.employees=[];
    db.employees=server.map(se=>({
      id:se.id,name:se.name,role:se.role||'Barber',branchId:se.branchId||null,
      salary:Number(se.salary)||0,commission:Number(se.commission)||0,target:Number(se.target)||0,
      attendance:Number(se.attendance)||0,eval:Number(se.eval)||0,active:se.active!==false
    }));
    if(typeof render==='function')render();
    queueAppStateSave();
    return true;
  }catch(e){console.warn('Online employee sync failed:',e.message||e);return false;}
}
window.WZOnlineEmployee.syncEmployeesFromServer=syncEmployeesFromServer;

const localLogin=window.login;
window.login=async function(ev){
  ev.preventDefault();
  const u=(document.getElementById('loginUser')?.value||'').trim();
  const p=(document.getElementById('loginPass')?.value||'');
  const err=document.getElementById('loginError');
  try{
    const r=await api('auth/login',{method:'POST',body:JSON.stringify({username:u,password:p})});
    if(err)err.style.display='none';
    currentUser=r.user;
    const screen=document.getElementById('loginScreen');if(screen)screen.style.display='none';
    const badge=document.getElementById('roleBadge');if(badge)badge.textContent=r.user.name;
    await fullHydrate();
    if(typeof render==='function')render();
  }catch(e){
    if(err){err.textContent=e.message||'Login gagal.';err.style.display='block';}
    else alert(e.message||'Login gagal.');
    void localLogin; // kept only to avoid shadowing legacy code; no offline fallback.
  }
};

window.logout=async function(){
  try{await api('auth/logout',{method:'POST'})}catch{}
  currentUser=null;
  const screen=document.getElementById('loginScreen');if(screen)screen.style.display='flex';
  const u=document.getElementById('loginUser'),pw=document.getElementById('loginPass');
  if(u)u.value='';if(pw)pw.value='';
};

async function restoreSession(){
  try{
    const r=await api('auth/me');
    currentUser=r.user;
    const screen=document.getElementById('loginScreen');if(screen)screen.style.display='none';
    const badge=document.getElementById('roleBadge');if(badge)badge.textContent=r.user.name;
    await fullHydrate();
    if(typeof render==='function')render();
  }catch{}
}
restoreSession();

const legacySaveEmployee=window.saveEmployee;
window.saveEmployee=async function(id){
  if(!guard('employees'))return;
  const name=(document.getElementById('eName')?.value||'').trim();
  const role=document.getElementById('eRole')?.value||'Barber';
  const password=(document.getElementById('ePassword')?.value||'').trim();
  const branchId=document.getElementById('eBranch')?.value||'';
  const salary=Number(document.getElementById('eSalary')?.value||0);
  const target=Number(document.getElementById('eTarget')?.value||0);
  if(!name)return alert('Isi nama karyawan');
  if(!password)return alert('Isi password login');
  if(!branchId)return alert('Pilih cabang karyawan');
  let employeeId=id||'';
  if(!employeeId){
    const next=Math.max(0,...(db.employees||[]).map(x=>Number(String(x.id).replace(/\D/g,''))||0))+1;
    employeeId='E'+String(next).padStart(3,'0');
  }
  const username=(name.trim().toLowerCase().replace(/[^a-z0-9]+/g,''))||'employee';
  try{
    const result=await api('employees',{method:id?'PUT':'POST',body:JSON.stringify({id:employeeId,name,role,password,username,branchId,salary,target})});
    if(result?.employee){
      const existing=(db.employees||[]).find(e=>e.id===result.employee.id);
      if(existing)Object.assign(existing,result.employee); else db.employees.push(result.employee);
    }
    await syncEmployeesFromServer();
    toast(id?'Data karyawan & akun online diperbarui.':'Karyawan & akun login online dibuat.');
  }catch(e){alert('Gagal menyimpan ke server: '+e.message);}
  void legacySaveEmployee;
};

const legacyDeleteEmployee=window.deleteEmployee;
window.deleteEmployee=async function(id){
  if(!guard('employees'))return;
  const e=getEmployee(id);if(!e)return;
  if(!confirm('Hapus karyawan '+e.name+' beserta akun login karyawan ini?'))return;
  try{
    await api('employees?id='+encodeURIComponent(id),{method:'DELETE'});
    await syncEmployeesFromServer();
  }catch(err){alert('Gagal menghapus dari server: '+err.message);}
  void legacyDeleteEmployee;
};

const legacySaveTransaction=window.saveTransaction;
window.saveTransaction=async function(){
  const customerId=document.getElementById('fCustomer')?.value||'';
  const serviceId=document.getElementById('fService')?.value||'';
  const employeeEl=document.getElementById('fEmployee');
  const employeeId=currentUser?.role==='employee'?(currentUser.employeeId||''):(employeeEl?.value||'');
  if(currentUser?.role==='employee'&&(!employeeId||!getEmployee(employeeId))){alert('Akun karyawan tidak memiliki ID karyawan yang valid.');return;}
  if(currentUser?.role==='employee'&&employeeEl)employeeEl.value=employeeId;
  const svc=getService(serviceId),emp=getEmployee(employeeId),customer=getCustomer(customerId);
  const discount=Number(document.getElementById('fDiscount')?.value||0);
  const total=Math.max(0,Number(svc?.price||0)-discount);
  const id='TRX'+Date.now();
  const payload={id,date:dateNow(),customerId,customerName:customer?.name||null,serviceId,serviceName:svc?.name||null,servicePrice:Number(svc?.price||0),employeeId,employeeName:emp?.name||null,total,payment:document.getElementById('fPayment')?.value||'Tunai',discount,status:'SELESAI'};
  try{
    await api('transaction',{method:'POST',body:JSON.stringify(payload)});
    await syncBusiness();
    toast('Transaksi berhasil tersimpan online.');
  }catch(e){toast('Transaksi gagal disimpan: '+e.message);}
  void legacySaveTransaction;
};

const legacyVoidTx=window.voidTx;
window.voidTx=async function(id){
  try{
    await api('transaction/void',{method:'POST',body:JSON.stringify({id})});
    await syncBusiness();
  }catch(e){alert('Gagal void online: '+e.message);}
  void legacyVoidTx;
};

const legacySaveShiftReport=window.saveShiftReport;
window.saveShiftReport=async function(){
  const c=typeof calcShiftReport==='function'?calcShiftReport():null;
  if(c){
    if(Number(c.serviceTotal||0)<=0){toast('Laporan belum bisa disimpan. Isi minimal 1 layanan terlebih dahulu.');return;}
    if(Number(c.totalPayment||0)<=0){toast('Laporan belum bisa disimpan. Total pembayaran harus lebih dari Rp0.');return;}
    if(Math.abs(Number(c.difference||0))>0.001){toast('Laporan belum bisa disimpan. Selisih kasir harus Rp0.');return;}
  }
  const emp=(db.employees||[]).find(e=>e.id===currentUser?.employeeId)|| (db.employees||[]).find(e=>e.name===currentUser?.name);
  if(!emp)return alert('Karyawan tidak ditemukan.');
  const products=[...document.querySelectorAll('.shift-product')].map(row=>({
    name:row.querySelector('.sr-product-name')?.value.trim()||'',qty:Number(row.querySelector('.sr-product-qty')?.value||0),
    price:Number(row.querySelector('.sr-product-price')?.value||0)
  })).filter(x=>x.name||x.qty||x.price);
  const services=[...document.querySelectorAll('.sr-service-qty')].map(inp=>({
    serviceId:inp.dataset.service,serviceName:getService(inp.dataset.service)?.name||'Layanan',
    qty:Number(inp.value||0),price:Number(inp.dataset.price||0)
  })).filter(x=>x.qty>0);
  const stableShiftId='SHIFT'+Date.now();
  const payload={
    id:stableShiftId,date:document.getElementById('srDate')?.value||dateNow(),
    employeeId:emp.id,employeeName:emp.name,shiftType:document.getElementById('srShift')?.value||'Full Shift',
    customers:Number(document.getElementById('srCustomers')?.value||0),openingCash:Number(document.getElementById('srOpening')?.value||0),
    cash:Number(document.getElementById('srCash')?.value||0),qris:Number(document.getElementById('srQris')?.value||0),
    cashExpense:Number(document.getElementById('srExpense')?.value||0),physicalCash:Number(document.getElementById('srPhysical')?.value||0),
    totalPayment:c?.totalPayment||0,expectedCash:c?.expected||0,cashDifference:c?.difference||0,serviceTotal:c?.serviceTotal||0,
    productTotal:c?.productTotal||0,totalOmzet:c?.omzet||0,services,products,
    note:document.getElementById('srNote')?.value.trim()||'',savedAt:new Date().toISOString()
  };
  try{
    await api('shift-report',{method:'POST',body:JSON.stringify(payload)});
    await syncBusiness();
    toast('Laporan tutup shift berhasil tersimpan online.');
    if(typeof closeModal==='function')closeModal();
  }catch(e){toast('Laporan shift gagal disimpan: '+e.message);}
  void legacySaveShiftReport;
};

})();
