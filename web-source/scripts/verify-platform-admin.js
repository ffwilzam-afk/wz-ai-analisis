const { Pool } = require('pg');
const { token, tokenHash } = require('../lib/helpers.js');
const handler = require('../api/[...path].js');

function databaseUrl(){
  return process.env.WZDATABASE||process.env.DATABASE_URL||process.env.POSTGRES_URL||process.env.POSTGRES_URL_NON_POOLING||process.env.NEON_DATABASE_URL||'';
}
function makeRes(){
  return {
    statusCode:0,
    headers:{},
    body:null,
    writableEnded:false,
    setHeader(key,value){this.headers[key]=value},
    end(payload){this.writableEnded=true;this.body=payload?JSON.parse(payload):null}
  };
}
function makeReq(url,method='GET',cookie=''){
  return {url,method,headers:cookie?{cookie}:{},async *[Symbol.asyncIterator](){}};
}
async function invoke(url,{method='GET',cookie='',expected=200}={}){
  const res=makeRes();
  await handler(makeReq(url,method,cookie),res);
  if(res.statusCode!==expected)throw new Error(`${method} ${url}: expected ${expected}, got ${res.statusCode}`);
  return res.body;
}
async function main(){
  const url=databaseUrl();
  if(!url)throw new Error('Database URL belum tersedia di environment.');
  const pool=new Pool({connectionString:url,ssl:{rejectUnauthorized:false},max:1,connectionTimeoutMillis:10000});
  const temporaryHashes=[];
  try{
    const admin=await pool.query(`SELECT id,username,email,display_name,active,password_hash FROM wz_platform_admins WHERE username='admin_wzmanage'`);
    if(admin.rowCount!==1)throw new Error('Akun admin_wzmanage tidak ditemukan.');
    const account=admin.rows[0];
    if(!account.active||!/^.+:.+$/.test(account.password_hash))throw new Error('Akun Admin tidak aktif atau hash password tidak valid.');
    const adminToken=token();
    const adminHash=tokenHash(adminToken);
    temporaryHashes.push(adminHash);
    await pool.query('INSERT INTO wz_platform_admin_sessions(token_hash,admin_id,expires_at) VALUES($1,$2,NOW()+INTERVAL \'15 minutes\')',[adminHash,account.id]);
    const adminCookie=`wz_admin_session=${adminToken}`;
    await invoke('/api/admin/dashboard',{cookie:adminCookie});
    const featureEndpoints=[
      '/api/admin/dashboard','/api/admin/businesses?limit=5','/api/admin/users?limit=5',
      '/api/admin/subscriptions?limit=5','/api/admin/plans','/api/admin/payments?limit=5',
      '/api/admin/forum/conversations?limit=50','/api/admin/notifications?limit=5',
      '/api/admin/audit-logs?limit=5','/api/admin/settings'
    ];
    const features={};
    for(const endpoint of featureEndpoints){
      const body=await invoke(endpoint,{cookie:adminCookie});
      features[endpoint]={ok:true,rows:Array.isArray(body.rows)?body.rows.length:Array.isArray(body.plans)?body.plans.length:Array.isArray(body.settings)?Object.keys(body.settings).length:null};
    }
    await invoke('/api/admin/dashboard',{expected:401});
    const roles=await pool.query(`SELECT DISTINCT role FROM wz_users WHERE role IN ('owner','manager','employee','kasir') ORDER BY role`);
    const roleChecks={};
    for(const {role} of roles.rows){
      const user=await pool.query(`SELECT id FROM wz_users WHERE role=$1 ORDER BY id LIMIT 1`,[role]);
      if(!user.rowCount)continue;
      const ownerToken=token(),ownerHash=tokenHash(ownerToken);
      temporaryHashes.push(ownerHash);
      await pool.query('INSERT INTO wz_sessions(token_hash,user_id,expires_at) VALUES($1,$2,NOW()+INTERVAL \'15 minutes\')',[ownerHash,user.rows[0].id]);
      await invoke('/api/admin/dashboard',{cookie:`wz_session=${ownerToken}`,expected:401});
      roleChecks[role]={session_rejected:true};
    }
    const owners=await pool.query(`SELECT u.id,u.business_id FROM wz_users u WHERE u.active=true AND u.role='owner' AND u.business_id IS NOT NULL GROUP BY u.id,u.business_id ORDER BY EXISTS(SELECT 1 FROM wz_owner_forum_messages m WHERE m.business_id=u.business_id) DESC,u.business_id LIMIT 2`);
    let forumIsolation=null;
    if(owners.rowCount===2){
      const results=[];
      for(const owner of owners.rows){
        const ownerToken=token(),ownerHash=tokenHash(ownerToken);
        temporaryHashes.push(ownerHash);
        await pool.query('INSERT INTO wz_sessions(token_hash,user_id,expires_at) VALUES($1,$2,NOW()+INTERVAL \'15 minutes\')',[ownerHash,owner.id]);
        const body=await invoke('/api/owner-forum/messages',{cookie:`wz_session=${ownerToken}`});
        if(body.businessId!==owner.business_id||body.messages.some(message=>message.businessId&&message.businessId!==owner.business_id))throw new Error('Isolasi forum Owner gagal.');
        results.push({businessId:body.businessId,messages:body.messages.length});
      }
      forumIsolation={owners_tested:results.length,results};
    }
    await pool.query('DELETE FROM wz_platform_admin_sessions WHERE token_hash=ANY($1::text[])',[temporaryHashes]);
    await pool.query('DELETE FROM wz_sessions WHERE token_hash=ANY($1::text[])',[temporaryHashes]);
    temporaryHashes.length=0;
    console.log(JSON.stringify({ok:true,account:{username:account.username,displayName:account.display_name,email:account.email,active:account.active},server_side_protection:{anonymous_admin_denied:true,tenant_sessions_denied:true,role_checks:roleChecks},features,forum_isolation:forumIsolation,temporary_sessions_cleaned:true},null,2));
  }finally{
    if(temporaryHashes.length)await pool.query('DELETE FROM wz_platform_admin_sessions WHERE token_hash=ANY($1::text[])',[temporaryHashes]);
    if(temporaryHashes.length)await pool.query('DELETE FROM wz_sessions WHERE token_hash=ANY($1::text[])',[temporaryHashes]);
    await pool.end();
  }
}
main().catch(error=>{console.error(JSON.stringify({ok:false,error:error.message||'Verifikasi Admin gagal.'}));process.exitCode=1});
