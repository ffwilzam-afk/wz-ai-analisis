const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

function databaseUrl(){
  return process.env.WZDATABASE||process.env.DATABASE_URL||process.env.POSTGRES_URL||process.env.POSTGRES_URL_NON_POOLING||process.env.NEON_DATABASE_URL||'';
}
async function main(){
  const url=databaseUrl();
  if(!url)throw new Error('Database URL belum tersedia di environment.');
  const migration=fs.readFileSync(path.join(__dirname,'..','ADMIN-PLATFORM-V1-MIGRATION.sql'),'utf8');
  const pool=new Pool({connectionString:url,ssl:{rejectUnauthorized:false},max:1,connectionTimeoutMillis:10000});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '120s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('wz-manage-pro-admin-platform-v1'))");
    const required=await client.query(`SELECT to_regclass('wz_businesses') AS businesses,to_regclass('wz_users') AS users,to_regclass('wz_owner_forum_messages') AS forum`);
    if(!required.rows[0].businesses||!required.rows[0].users||!required.rows[0].forum)throw new Error('Schema WZ MANAGE PRO existing tidak lengkap.');
    const unsafe=await client.query(`SELECT
      (SELECT COUNT(*)::int FROM wz_users WHERE business_id IS NULL) AS users_without_business,
      (SELECT COUNT(*)::int FROM wz_owner_forum_messages m LEFT JOIN wz_users u ON u.id=m.sender_user_id WHERE m.sender_user_id IS NOT NULL AND u.id IS NULL) AS missing_sender`);
    if(unsafe.rows[0].users_without_business>0||unsafe.rows[0].missing_sender>0)throw new Error('Preflight tenant gagal: ada user tanpa business atau pesan tanpa pengirim.');
    await client.query(migration);
    const applied=await client.query(`SELECT
      to_regclass('wz_platform_admins') AS admins,
      to_regclass('wz_platform_admin_sessions') AS sessions,
      to_regclass('wz_admin_audit_logs') AS audit_logs,
      to_regclass('wz_admin_notifications') AS notifications,
      to_regclass('wz_system_settings') AS settings,
      to_regclass('wz_admin_forum_reads') AS forum_reads,
      (SELECT COUNT(*)::int FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='wz_owner_forum_messages' AND column_name IN ('business_id','sender_admin_id','sender_role')) AS forum_columns,
      (SELECT COUNT(*)::int FROM wz_owner_forum_messages WHERE business_id IS NULL) AS unassigned_forum_messages`);
    const row=applied.rows[0];
    if(!row.admins||!row.sessions||!row.audit_logs||!row.notifications||!row.settings||!row.forum_reads||row.forum_columns!==3)throw new Error('Verifikasi schema Admin gagal.');
    await client.query('COMMIT');
    console.log(JSON.stringify({ok:true,migration:'ADMIN-PLATFORM-V1-MIGRATION.sql',transaction:'committed',forum_messages_without_business:row.unassigned_forum_messages},null,2));
  }catch(error){
    try{await client.query('ROLLBACK')}catch{}
    throw error;
  }finally{
    client.release();
    await pool.end();
  }
}
main().catch(error=>{console.error(JSON.stringify({ok:false,error:error.message||'Migration gagal.'}));process.exitCode=1});
