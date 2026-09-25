const { Pool } = require('pg');
const crypto = require('crypto');
const { hashPassword } = require('../lib/helpers.js');

function arg(name){
  const args=process.argv.slice(2),prefix=`--${name}`;
  const inline=args.find(value=>value.startsWith(`${prefix}=`));
  if(inline)return inline.slice(prefix.length+1);
  const index=args.indexOf(prefix);
  const value=index>=0?args[index+1]:'';
  return value&&!value.startsWith('--')?value:'';
}
function flag(name){return process.argv.includes(`--${name}`)}
function hidden(question){
  if(!process.stdin.isTTY)return Promise.reject(new Error('Jalankan dari terminal interaktif atau gunakan input password yang aman.'));
  return new Promise((resolve,reject)=>{
    const input=process.stdin;
    const output=process.stdout;
    let value='';
    output.write(question);
    input.setRawMode(true);
    input.resume();
    input.setEncoding('utf8');
    const onData=chunk=>{
      if(chunk==='\u0003'){cleanup();reject(new Error('Dibatalkan.'));return;}
      if(chunk==='\r'||chunk==='\n'){cleanup();output.write('\n');resolve(value);return;}
      if(chunk==='\u007f'||chunk==='\b'){value=value.slice(0,-1);return;}
      value+=chunk;
    };
    const cleanup=()=>{input.off('data',onData);input.setRawMode(false);input.pause();};
    input.on('data',onData);
  });
}
function databaseUrl(){
  return process.env.WZDATABASE||process.env.DATABASE_URL||process.env.POSTGRES_URL||process.env.POSTGRES_URL_NON_POOLING||process.env.NEON_DATABASE_URL||'';
}
async function preflight(pool){
  const client=await pool.connect();
  try{
    await client.query("SET default_transaction_read_only = on");
    await client.query("SET statement_timeout = '15s'");
    const identity=await client.query(`SELECT current_database() AS database,current_user AS db_user,current_schema() AS schema,inet_server_addr()::text AS host,inet_server_port() AS port,current_setting('server_version') AS version`);
    const target=identity.rows[0];
    const fingerprint=crypto.createHash('sha256').update(`${target.host}:${target.port}/${target.database}`).digest('hex').slice(0,16);
    const counts=await client.query(`SELECT
      (SELECT COUNT(*)::int FROM wz_businesses) AS businesses,
      (SELECT COUNT(*)::int FROM wz_users) AS users,
      (SELECT COUNT(*)::int FROM wz_subscriptions) AS subscriptions,
      (SELECT COUNT(*)::int FROM wz_subscription_orders) AS subscription_orders,
      (SELECT COUNT(*)::int FROM wz_owner_forum_messages) AS forum_messages`);
    const snapshot=await client.query(`SELECT
      (SELECT md5(COALESCE(string_agg(json_build_object('id',id,'name',name,'active',active,'created_at',created_at,'updated_at',updated_at)::text,'|' ORDER BY id),'')) FROM wz_businesses) AS businesses,
      (SELECT md5(COALESCE(string_agg(json_build_object('id',id,'username',username,'role',role,'name',name,'employee_id',employee_id,'business_id',business_id,'active',active,'created_at',created_at,'updated_at',updated_at)::text,'|' ORDER BY id),'')) FROM wz_users) AS users,
      (SELECT md5(COALESCE(string_agg(row_to_json(t)::text,'|' ORDER BY t.id),'')) FROM wz_subscriptions t) AS subscriptions,
      (SELECT md5(COALESCE(string_agg(row_to_json(t)::text,'|' ORDER BY t.id),'')) FROM wz_subscription_orders t) AS subscription_orders,
      (SELECT md5(COALESCE(string_agg(json_build_object('id',id,'sender_user_id',sender_user_id,'message',message,'message_type',message_type,'sticker_id',sticker_id,'reply_to_id',reply_to_id,'created_at',created_at)::text,'|' ORDER BY id),'')) FROM wz_owner_forum_messages) AS forum_content`);
    const columns=await client.query(`SELECT table_name,column_name,data_type,is_nullable,column_default
      FROM information_schema.columns
      WHERE table_schema=current_schema() AND (
        (table_name='wz_users' AND column_name IN ('id','business_id','role','active')) OR
        (table_name='wz_businesses' AND column_name IN ('id','active')) OR
        (table_name='wz_owner_forum_messages' AND column_name IN ('id','sender_user_id','sender_admin_id','sender_role','business_id','created_at')) OR
        (table_name='wz_subscriptions' AND column_name IN ('business_id','plan','status')) OR
        (table_name='wz_subscription_orders' AND column_name IN ('business_id','order_id','status'))
      ) ORDER BY table_name,column_name`);
    const adminTables=await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_name=ANY($1::text[]) ORDER BY table_name`,[['wz_platform_admins','wz_platform_admin_sessions','wz_admin_audit_logs','wz_admin_notifications','wz_system_settings','wz_admin_forum_reads']]);
    const hasForumBusiness=columns.rows.some(row=>row.table_name==='wz_owner_forum_messages'&&row.column_name==='business_id');
    const forum=hasForumBusiness?await client.query(`SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE m.business_id IS NULL)::int AS missing_business,
      COUNT(*) FILTER (WHERE m.business_id IS NULL AND u.id IS NOT NULL AND u.business_id IS NULL)::int AS sender_without_business,
      COUNT(*) FILTER (WHERE m.sender_user_id IS NOT NULL AND u.id IS NULL)::int AS missing_sender
      FROM wz_owner_forum_messages m LEFT JOIN wz_users u ON u.id=m.sender_user_id`):await client.query(`SELECT
      COUNT(*)::int AS total,
      COUNT(*)::int AS missing_business,
      COUNT(*) FILTER (WHERE m.sender_user_id IS NOT NULL AND u.id IS NOT NULL AND u.business_id IS NULL)::int AS sender_without_business,
      COUNT(*) FILTER (WHERE m.sender_user_id IS NOT NULL AND u.id IS NULL)::int AS missing_sender
      FROM wz_owner_forum_messages m LEFT JOIN wz_users u ON u.id=m.sender_user_id`);
    const tenantNulls=await client.query(`SELECT
      (SELECT COUNT(*)::int FROM wz_users WHERE business_id IS NULL) AS users_without_business,
      (SELECT COUNT(*)::int FROM wz_subscriptions WHERE business_id IS NULL) AS subscriptions_without_business,
      (SELECT COUNT(*)::int FROM wz_subscription_orders WHERE business_id IS NULL) AS orders_without_business`);
    console.log(JSON.stringify({
      mode:'READ_ONLY',
      target:{database:target.database,db_user:target.db_user,schema:target.schema,server_version:target.version,endpoint_fingerprint_sha256_16:fingerprint},
      existing_data_counts:counts.rows[0],
      tenant_data_fingerprints:snapshot.rows[0],
      relevant_columns:columns.rows,
      admin_tables_existing:adminTables.rows.map(row=>row.table_name),
      forum_preflight:forum.rows[0],
      tenant_null_preflight:tenantNulls.rows[0]
    },null,2));
  }finally{client.release()}
}
async function verifyLiveLogin(username,password){
  const baseUrl=(arg('url')||'https://wz-ai-analisis-rust.vercel.app').replace(/\/+$/,'');
  const response=await fetch(`${baseUrl}/api/admin/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});
  const data=await response.json().catch(()=>({}));
  const setCookie=response.headers.get('set-cookie')||'';
  if(response.ok&&data.ok&&setCookie){
    await fetch(`${baseUrl}/api/admin/logout`,{method:'POST',headers:{Cookie:setCookie.split(';')[0]}}).catch(()=>{});
  }
  console.log(JSON.stringify({live_login_ok:response.ok&&data.ok===true,status:response.status,username,displayName:data.admin?.displayName||null},null,2));
  if(!response.ok||data.ok!==true)throw new Error('Login live production gagal. Periksa kesamaan database deployment dan credential.');
}
async function main(){
  const url=databaseUrl();
  if(!url)throw new Error('Database URL belum tersedia di environment.');
  const pool=new Pool({connectionString:url,ssl:{rejectUnauthorized:false},max:1,connectionTimeoutMillis:10000});
  try{
    if(flag('preflight'))return await preflight(pool);
    const update=flag('update'),verifyLive=flag('verify-live');
    const username=arg('username').trim().toLowerCase();
    const currentUsername=(arg('current-username')||username).trim().toLowerCase();
    const displayName=arg('name').trim();
    const email=arg('email').trim().toLowerCase();
    if(!/^[a-z0-9._-]{3,80}$/.test(username))throw new Error('Gunakan --username dengan 3-80 karakter a-z, 0-9, titik, underscore, atau strip.');
    if(!/^[a-z0-9._-]{3,80}$/.test(currentUsername))throw new Error('Username Admin existing tidak valid.');
    if(email&&(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)))throw new Error('Email tidak valid.');
    const password=process.env.WZ_ADMIN_INITIAL_PASSWORD||await hidden('Password Admin (minimal 12 karakter): ');
    if(password.length<12||password.length>256)throw new Error('Password harus 12-256 karakter.');
    delete process.env.WZ_ADMIN_INITIAL_PASSWORD;
    if(verifyLive&&!update)return await verifyLiveLogin(username,password);
    if(displayName.length<2||displayName.length>120)throw new Error('Gunakan --name berisi 2-120 karakter.');
    const schema=await pool.query(`SELECT to_regclass('wz_platform_admins') AS admins,to_regclass('wz_platform_admin_sessions') AS sessions`);
    if(!schema.rows[0].admins||!schema.rows[0].sessions)throw new Error('Schema Admin belum tersedia. Jalankan migration Admin terlebih dahulu.');
    if(update){
      const existing=await pool.query('SELECT id FROM wz_platform_admins WHERE username=$1',[currentUsername]);
      if(!existing.rowCount)throw new Error('Username Admin existing tidak ditemukan.');
      if(currentUsername!==username){
        const conflict=await pool.query('SELECT id FROM wz_platform_admins WHERE username=$1 AND id<>$2',[username,existing.rows[0].id]);
        if(conflict.rowCount)throw new Error('Username Admin baru sudah digunakan.');
      }
      await pool.query('UPDATE wz_platform_admins SET username=$1,email=$2,display_name=$3,password_hash=$4,active=true WHERE id=$5',[username,email||null,displayName,hashPassword(password),existing.rows[0].id]);
      await pool.query('DELETE FROM wz_platform_admin_sessions WHERE admin_id=$1',[existing.rows[0].id]);
      console.log(`Kredensial Admin Platform ${username} berhasil diperbarui. Password tidak dicetak atau disimpan di source.`);
    }else{
      const existing=await pool.query('SELECT id FROM wz_platform_admins WHERE username=$1',[username]);
      if(existing.rowCount)throw new Error('Username Admin sudah terdaftar. Gunakan --update untuk memperbarui credential.');
      await pool.query('INSERT INTO wz_platform_admins(username,email,display_name,password_hash) VALUES($1,$2,$3,$4)',[username,email||null,displayName,hashPassword(password)]);
      console.log(`Admin Platform ${username} berhasil dibuat. Password tidak dicetak atau disimpan di source.`);
    }
    if(verifyLive)await verifyLiveLogin(username,password);
  }finally{await pool.end()}
}
main().catch(error=>{console.error(error.message||error);process.exitCode=1});
