const { Pool } = require('pg');
const crypto = require('crypto');
const webpush = require('web-push');
const { getApps, initializeApp, cert } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');
const {
  hashPassword, verifyPassword, token, tokenHash,
  defaultUsername, defaultPassword, normalizeBusinessId, safeServerError,
  xenditSafeName, cookie, send, body,
  validMoney, validDate, validTransaction, validShift
} = require('../lib/helpers.js');

// Modul rute per domain. Setiap modul menerima (ctx, req, res, path), mengirim
// responsnya sendiri, dan handler berhenti begitu res.writableEnded bernilai true.
const routeModules = [
  require('../lib/routes/auth.js'),
  require('../lib/routes/push.js'),
  require('../lib/routes/admin.js')
];

// Helper yang dibagikan ke modul rute.
function routeContext(){
  return {
    getPool, send, body, cookie,
    token, tokenHash, hashPassword, verifyPassword,
    authUser, normalizeBusinessId, pushConfigured, sendBusinessForumPush,
    sendOwnerForumPush
  };
}

let pool;
function databaseUrl(){
  return process.env.WZDATABASE||process.env.DATABASE_URL||process.env.POSTGRES_URL||process.env.POSTGRES_URL_NON_POOLING||process.env.NEON_DATABASE_URL;
}
function getPool(){
  const url=databaseUrl();
  if(!url) throw new Error('Environment variable database belum dikonfigurasi di Vercel. Gunakan WZDATABASE, DATABASE_URL, atau POSTGRES_URL.');
  if(!pool) pool=new Pool({connectionString:url,ssl:{rejectUnauthorized:false},max:5,connectionTimeoutMillis:10000,idleTimeoutMillis:30000});
  return pool;
}

function firebaseConfigured(){
  return !!(
    process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_CLIENT_EMAIL &&
    process.env.FIREBASE_PRIVATE_KEY
  );
}

function getFirebaseMessaging(){
  if(!firebaseConfigured())return null;

  const app=getApps().length
    ? getApps()[0]
    : initializeApp({
        credential:cert({
          projectId:process.env.FIREBASE_PROJECT_ID,
          clientEmail:process.env.FIREBASE_CLIENT_EMAIL,
          privateKey:process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g,'\n')
        })
      });

  return getMessaging(app);
}

function pushConfigured(){return !!(process.env.VAPID_PUBLIC_KEY&&process.env.VAPID_PRIVATE_KEY&&process.env.VAPID_SUBJECT)}
async function sendFcmNotification({businessId,senderId,title,body,data={}}){
  let messaging;
  try{
    messaging=getFirebaseMessaging();
  }catch(error){
    return;
  }
  if(!messaging || !businessId){
    return;
  }

  const p=getPool();
  const recipients=await p.query(
    `SELECT id,token
     FROM wz_fcm_tokens
     WHERE business_id=$1
       AND user_id<>$2
       AND EXISTS (SELECT 1 FROM wz_users u WHERE u.id=wz_fcm_tokens.user_id AND u.business_id=wz_fcm_tokens.business_id AND u.role='owner' AND u.active=true)`,
    [businessId,senderId]
  );


  await Promise.all(recipients.rows.map(async row=>{
    try{
      await messaging.send({
        token:row.token,
        notification:{title,body},
        data:Object.fromEntries(
          Object.entries(data).map(([k,v])=>[String(k),String(v)])
        ),
        android:{
          priority:'high',
          notification:{
            channelId:'wz_manage_pro',
            sound:'default'
          }
        }
      });
    }catch(error){
      const code=String(error?.code||'');
      if(
        code==='messaging/registration-token-not-registered' ||
        code==='messaging/invalid-registration-token'
      ){
        await p.query(
          'DELETE FROM wz_fcm_tokens WHERE id=$1 AND business_id=$2',
          [row.id,businessId]
        );
      }
    }
  }));
}

async function sendBusinessForumPush({businessId,title,body,data={}}){
  let messaging;
  try{messaging=getFirebaseMessaging()}catch{return}
  if(!messaging||!businessId)return;
  const p=getPool();
  const recipients=await p.query(
    `SELECT t.id,t.token
     FROM wz_fcm_tokens t
     JOIN wz_users u ON u.id=t.user_id
     WHERE t.business_id=$1 AND u.business_id=$1 AND u.role='owner' AND u.active=true`,
    [businessId]
  );
  await Promise.all(recipients.rows.map(async row=>{
    try{
      await messaging.send({
        token:row.token,
        notification:{title,body},
        data:Object.fromEntries(Object.entries(data).map(([k,v])=>[String(k),String(v)])),
        android:{priority:'high',notification:{channelId:'wz_manage_pro',sound:'default'}}
      });
    }catch(error){
      const code=String(error?.code||'');
      if(code==='messaging/registration-token-not-registered'||code==='messaging/invalid-registration-token')
        await p.query('DELETE FROM wz_fcm_tokens WHERE id=$1 AND business_id=$2',[row.id,businessId]);
    }
  }));
}

// Obrolan Owner adalah satu forum bersama lintas tenant, jadi notifikasi pesan
// forum dikirim ke SEMUA Owner aktif (tanpa filter business_id). Inilah yang
// sebelumnya hilang: pesan Admin tersimpan tapi tidak pernah memanggil FCM.
// excludeUserId dipakai untuk pesan Owner agar pengirim tidak diberi notifikasi
// atas pesannya sendiri (aturan existing).
async function sendOwnerForumPush({title,body,data={},excludeUserId=null}){
  let messaging;
  try{messaging=getFirebaseMessaging()}catch{return}
  if(!messaging)return;
  const p=getPool();
  const recipients=await p.query(
    `SELECT t.id,t.token
     FROM wz_fcm_tokens t
     JOIN wz_users u ON u.id=t.user_id
     WHERE u.role='owner' AND u.active=true
       AND ($1::bigint IS NULL OR t.user_id<>$1)`,
    [excludeUserId==null?null:Number(excludeUserId)]
  );
  await Promise.all(recipients.rows.map(async row=>{
    try{
      await messaging.send({
        token:row.token,
        notification:{title,body},
        data:Object.fromEntries(Object.entries(data).map(([k,v])=>[String(k),String(v)])),
        android:{priority:'high',notification:{channelId:'wz_manage_pro',sound:'default'}}
      });
    }catch(error){
      const code=String(error?.code||'');
      if(code==='messaging/registration-token-not-registered'||code==='messaging/invalid-registration-token')
        await p.query('DELETE FROM wz_fcm_tokens WHERE id=$1',[row.id]);
    }
  }));
}

async function sendShiftPushes(report,senderId){
  if(!pushConfigured())return;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT,process.env.VAPID_PUBLIC_KEY,process.env.VAPID_PRIVATE_KEY);
  const p=getPool(),recipients=await p.query(`SELECT s.id,s.endpoint,s.p256dh,s.auth FROM wz_push_subscriptions s JOIN wz_users u ON u.id=s.user_id WHERE u.active=true AND u.role='owner' AND s.business_id=$2 AND s.user_id<>$1`,[senderId,report.businessId]);
  const payload=JSON.stringify({title:'WZ MANAGE PRO',body:`Laporan shift ${report.employeeName||report.employeeId||''} tersedia.`,icon:'/icons/icon-192.png',badge:'/icons/icon-192.png',tag:`wz-shift-${report.id}`,url:'/'});
  await Promise.all(recipients.rows.map(async subscription=>{
    try{await webpush.sendNotification({endpoint:subscription.endpoint,keys:{p256dh:subscription.p256dh,auth:subscription.auth}},payload,{TTL:86400});}
    catch(error){if(error.statusCode===404||error.statusCode===410)await p.query('DELETE FROM wz_push_subscriptions WHERE id=$1',[subscription.id]);}
  }));
}

let schemaPromise;
async function schema(){
  const p=getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS wz_businesses(id TEXT PRIMARY KEY,name TEXT NOT NULL,active BOOLEAN NOT NULL DEFAULT TRUE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS wz_branches(
      id TEXT PRIMARY KEY,name TEXT NOT NULL,active BOOLEAN NOT NULL DEFAULT TRUE,business_id TEXT REFERENCES wz_businesses(id)
    );
    CREATE TABLE IF NOT EXISTS wz_employees(
      id TEXT PRIMARY KEY,name TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'Barber',branch_id TEXT REFERENCES wz_branches(id),business_id TEXT REFERENCES wz_businesses(id),
      salary NUMERIC NOT NULL DEFAULT 0,commission NUMERIC NOT NULL DEFAULT 0,target NUMERIC NOT NULL DEFAULT 0,
      attendance NUMERIC NOT NULL DEFAULT 0,eval NUMERIC NOT NULL DEFAULT 0,active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS wz_users(
      id BIGSERIAL PRIMARY KEY,username TEXT NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL,
      name TEXT NOT NULL,employee_id TEXT REFERENCES wz_employees(id) ON DELETE SET NULL,business_id TEXT REFERENCES wz_businesses(id),active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS wz_sessions(
      token_hash TEXT PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES wz_users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS wz_sessions_exp_idx ON wz_sessions(expires_at);
    CREATE TABLE IF NOT EXISTS wz_transactions(
      id TEXT PRIMARY KEY,date DATE NOT NULL,customer_id TEXT,customer_name TEXT,service_id TEXT,service_name TEXT,business_id TEXT REFERENCES wz_businesses(id),
      service_price NUMERIC NOT NULL DEFAULT 0,employee_id TEXT,employee_name TEXT,total NUMERIC NOT NULL DEFAULT 0,
      payment TEXT NOT NULL,status TEXT NOT NULL,discount NUMERIC NOT NULL DEFAULT 0,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS wz_transactions_date_idx ON wz_transactions(date);
    CREATE INDEX IF NOT EXISTS wz_transactions_employee_idx ON wz_transactions(employee_id);
    CREATE TABLE IF NOT EXISTS wz_shift_reports(
      id TEXT PRIMARY KEY,date DATE NOT NULL,employee_id TEXT,employee_name TEXT,shift_type TEXT,customers INTEGER NOT NULL DEFAULT 0,business_id TEXT REFERENCES wz_businesses(id),
      opening_cash NUMERIC NOT NULL DEFAULT 0,cash NUMERIC NOT NULL DEFAULT 0,qris NUMERIC NOT NULL DEFAULT 0,cash_expense NUMERIC NOT NULL DEFAULT 0,
      physical_cash NUMERIC NOT NULL DEFAULT 0,total_payment NUMERIC NOT NULL DEFAULT 0,expected_cash NUMERIC NOT NULL DEFAULT 0,cash_difference NUMERIC NOT NULL DEFAULT 0,
      service_total NUMERIC NOT NULL DEFAULT 0,product_total NUMERIC NOT NULL DEFAULT 0,total_omzet NUMERIC NOT NULL DEFAULT 0,
      services JSONB NOT NULL DEFAULT '[]'::jsonb,products JSONB NOT NULL DEFAULT '[]'::jsonb,note TEXT,saved_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS wz_shift_reports_date_idx ON wz_shift_reports(date);
    CREATE INDEX IF NOT EXISTS wz_shift_reports_employee_idx ON wz_shift_reports(employee_id);
    CREATE TABLE IF NOT EXISTS wz_subscriptions(
      id BIGSERIAL PRIMARY KEY,
      business_id TEXT NOT NULL UNIQUE REFERENCES wz_businesses(id),
      plan TEXT NOT NULL DEFAULT 'TRIAL'
        CHECK (plan IN ('TRIAL','PRO','PRO_MAX')),
      billing_period TEXT
        CHECK (billing_period IS NULL OR billing_period IN ('MONTH','YEAR')),
      status TEXT NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE','EXPIRED','CANCELLED','SUSPENDED')),
      trial_started_at TIMESTAMPTZ,
      trial_ends_at TIMESTAMPTZ,
      current_period_start TIMESTAMPTZ,
      current_period_end TIMESTAMPTZ,
      payment_provider TEXT,
      payment_customer_id TEXT,
      payment_subscription_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE wz_subscriptions
      ADD COLUMN IF NOT EXISTS billing_period TEXT;

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'wz_subscriptions_billing_period_check'
      ) THEN
        ALTER TABLE wz_subscriptions
          ADD CONSTRAINT wz_subscriptions_billing_period_check
          CHECK (
            billing_period IS NULL
            OR billing_period IN ('MONTH','YEAR')
          );
      END IF;
    END $$;

    CREATE INDEX IF NOT EXISTS wz_subscriptions_status_idx
      ON wz_subscriptions(status);
    CREATE INDEX IF NOT EXISTS wz_subscriptions_period_end_idx
      ON wz_subscriptions(current_period_end);

    CREATE TABLE IF NOT EXISTS wz_subscription_orders(
      id BIGSERIAL PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES wz_businesses(id),
      order_id TEXT NOT NULL UNIQUE,
      plan TEXT NOT NULL
        CHECK (plan IN ('PRO','PRO_MAX')),
      billing_period TEXT NOT NULL
        CHECK (billing_period IN ('MONTH','YEAR')),
      amount NUMERIC NOT NULL CHECK (amount >= 0),
      currency TEXT NOT NULL DEFAULT 'IDR',
      status TEXT NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING','PAID','FAILED','EXPIRED','CANCELLED')),
      payment_provider TEXT,
      external_id TEXT,
      payment_session_id TEXT,
      payment_url TEXT,
      xendit_customer_id TEXT,
      xendit_payment_token_id TEXT,
      xendit_payment_id TEXT,
      xendit_recurring_plan_id TEXT,
      paid_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS wz_subscription_orders_business_idx
      ON wz_subscription_orders(business_id);

    CREATE INDEX IF NOT EXISTS wz_subscription_orders_status_idx
      ON wz_subscription_orders(status);

    CREATE INDEX IF NOT EXISTS wz_subscription_orders_external_idx
      ON wz_subscription_orders(external_id);

    ALTER TABLE wz_subscription_orders
      ADD COLUMN IF NOT EXISTS xendit_customer_id TEXT;
    ALTER TABLE wz_subscription_orders
      ADD COLUMN IF NOT EXISTS xendit_payment_token_id TEXT;
    ALTER TABLE wz_subscription_orders
      ADD COLUMN IF NOT EXISTS xendit_payment_id TEXT;
    ALTER TABLE wz_subscription_orders
      ADD COLUMN IF NOT EXISTS xendit_recurring_plan_id TEXT;

    ALTER TABLE wz_subscriptions
      ADD COLUMN IF NOT EXISTS last_recurring_cycle_number INTEGER NOT NULL DEFAULT 0;


    CREATE TABLE IF NOT EXISTS wz_subscription_plans(
      plan TEXT PRIMARY KEY
        CHECK (plan IN ('TRIAL','PRO','PRO_MAX')),
      duration_days INTEGER,
      max_branches INTEGER,
      max_employees INTEGER,
      price_monthly NUMERIC NOT NULL DEFAULT 0,
      price_yearly NUMERIC NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    INSERT INTO wz_subscription_plans
      (plan,duration_days,max_branches,max_employees,price_monthly,price_yearly)
    VALUES
      ('TRIAL',35,1,10,0,0),
      ('PRO',30,3,21,49000,490000),
      ('PRO_MAX',30,NULL,NULL,149000,1490000)
    ON CONFLICT (plan) DO UPDATE SET
      duration_days=EXCLUDED.duration_days,
      max_branches=EXCLUDED.max_branches,
      max_employees=EXCLUDED.max_employees,
      price_monthly=EXCLUDED.price_monthly,
      price_yearly=EXCLUDED.price_yearly,
      updated_at=NOW();

    CREATE TABLE IF NOT EXISTS wz_push_subscriptions(
      id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES wz_users(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL,business_id TEXT REFERENCES wz_businesses(id),p256dh TEXT NOT NULL,auth TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS wz_push_subscriptions_user_idx ON wz_push_subscriptions(user_id);
    CREATE TABLE IF NOT EXISTS wz_app_state(
      id INTEGER PRIMARY KEY CHECK (id=1),
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS wz_user_profiles(
      user_id BIGINT PRIMARY KEY REFERENCES wz_users(id) ON DELETE CASCADE,
      phone TEXT NOT NULL DEFAULT '',
      avatar TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS wz_platform_admins(
      id BIGSERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      email TEXT,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_login_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS wz_platform_admin_sessions(
      token_hash TEXT PRIMARY KEY,
      admin_id BIGINT NOT NULL REFERENCES wz_platform_admins(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS wz_platform_admin_sessions_exp_idx ON wz_platform_admin_sessions(expires_at);
    CREATE TABLE IF NOT EXISTS wz_admin_audit_logs(
      id BIGSERIAL PRIMARY KEY,
      admin_id BIGINT REFERENCES wz_platform_admins(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      business_id TEXT REFERENCES wz_businesses(id) ON DELETE SET NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS wz_admin_audit_logs_created_idx ON wz_admin_audit_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS wz_admin_audit_logs_business_idx ON wz_admin_audit_logs(business_id,created_at DESC);
    CREATE TABLE IF NOT EXISTS wz_admin_notifications(
      id BIGSERIAL PRIMARY KEY,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      business_id TEXT REFERENCES wz_businesses(id) ON DELETE CASCADE,
      target_type TEXT,
      target_id TEXT,
      read_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS wz_admin_notifications_created_idx ON wz_admin_notifications(created_at DESC);
    CREATE INDEX IF NOT EXISTS wz_admin_notifications_business_idx ON wz_admin_notifications(business_id,created_at DESC);
    CREATE TABLE IF NOT EXISTS wz_system_settings(
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_by BIGINT REFERENCES wz_platform_admins(id) ON DELETE SET NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS wz_admin_forum_reads(
      admin_id BIGINT NOT NULL REFERENCES wz_platform_admins(id) ON DELETE CASCADE,
      business_id TEXT NOT NULL REFERENCES wz_businesses(id) ON DELETE CASCADE,
      last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(admin_id,business_id)
    );
    CREATE TABLE IF NOT EXISTS wz_owner_forum_messages(
      id BIGSERIAL PRIMARY KEY,
      sender_user_id BIGINT REFERENCES wz_users(id) ON DELETE CASCADE,
      sender_admin_id BIGINT REFERENCES wz_platform_admins(id) ON DELETE SET NULL,
      sender_role TEXT NOT NULL DEFAULT 'owner',
      business_id TEXT REFERENCES wz_businesses(id),
      message TEXT NOT NULL DEFAULT '',
      message_type TEXT NOT NULL DEFAULT 'text'
        CHECK (message_type IN ('text','sticker')),
      sticker_id TEXT,
      reply_to_id BIGINT REFERENCES wz_owner_forum_messages(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE wz_owner_forum_messages ADD COLUMN IF NOT EXISTS sender_admin_id BIGINT REFERENCES wz_platform_admins(id) ON DELETE SET NULL;
    ALTER TABLE wz_owner_forum_messages ADD COLUMN IF NOT EXISTS sender_role TEXT NOT NULL DEFAULT 'owner';
    ALTER TABLE wz_owner_forum_messages ADD COLUMN IF NOT EXISTS business_id TEXT REFERENCES wz_businesses(id);
    -- Edit & soft delete pesan forum. Nullable, jadi aman untuk pesan lama.
    ALTER TABLE wz_owner_forum_messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
    ALTER TABLE wz_owner_forum_messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
    ALTER TABLE wz_owner_forum_messages ALTER COLUMN sender_user_id DROP NOT NULL;
    UPDATE wz_owner_forum_messages m SET business_id=u.business_id FROM wz_users u WHERE m.business_id IS NULL AND m.sender_user_id=u.id;

    CREATE INDEX IF NOT EXISTS wz_owner_forum_messages_created_idx
      ON wz_owner_forum_messages(created_at);
    CREATE INDEX IF NOT EXISTS wz_owner_forum_messages_business_created_idx
      ON wz_owner_forum_messages(business_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS wz_owner_forum_messages_sender_idx
      ON wz_owner_forum_messages(sender_user_id);

    CREATE TABLE IF NOT EXISTS wz_owner_forum_reactions(
      id BIGSERIAL PRIMARY KEY,
      message_id BIGINT NOT NULL REFERENCES wz_owner_forum_messages(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES wz_users(id) ON DELETE CASCADE,
      reaction TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(message_id,user_id,reaction)
    );

    CREATE INDEX IF NOT EXISTS wz_owner_forum_reactions_message_idx
      ON wz_owner_forum_reactions(message_id);

    -- ---- Polling (jenis pesan baru di Obrolan Owner) --------------------
    -- Polling butuh message_type baru ('poll') + tiga tabel. DDL di sini
    -- idempotent dan mengikuti pola ensureSchema() yang sudah dipakai fitur
    -- lain (sender_admin_id/edited_at/deleted_at), jadi aman dijalankan ulang.
    --
    -- Batasan message_type yang ada dibuang lebih dulu (nama constraint bisa
    -- berbeda antar database), lalu diganti dengan yang memuat 'poll'.
    DO $$
    DECLARE cname TEXT;
    BEGIN
      SELECT conname INTO cname
      FROM pg_constraint
      WHERE conrelid='wz_owner_forum_messages'::regclass
        AND contype='c'
        AND pg_get_constraintdef(oid) ILIKE '%message_type%';
      IF cname IS NOT NULL THEN
        EXECUTE format('ALTER TABLE wz_owner_forum_messages DROP CONSTRAINT %I', cname);
      END IF;
    END $$;
    ALTER TABLE wz_owner_forum_messages
      ADD CONSTRAINT wz_owner_forum_messages_message_type_check
      CHECK (message_type IN ('text','sticker','poll'));

    CREATE TABLE IF NOT EXISTS wz_owner_forum_polls(
      id BIGSERIAL PRIMARY KEY,
      message_id BIGINT NOT NULL UNIQUE REFERENCES wz_owner_forum_messages(id) ON DELETE CASCADE,
      business_id TEXT REFERENCES wz_businesses(id),
      creator_user_id BIGINT REFERENCES wz_users(id) ON DELETE SET NULL,
      question TEXT NOT NULL,
      allow_multiple BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS wz_owner_forum_poll_options(
      id BIGSERIAL PRIMARY KEY,
      poll_id BIGINT NOT NULL REFERENCES wz_owner_forum_polls(id) ON DELETE CASCADE,
      position INT NOT NULL,
      label TEXT NOT NULL,
      UNIQUE(poll_id,position)
    );
    CREATE TABLE IF NOT EXISTS wz_owner_forum_poll_votes(
      id BIGSERIAL PRIMARY KEY,
      poll_id BIGINT NOT NULL REFERENCES wz_owner_forum_polls(id) ON DELETE CASCADE,
      option_id BIGINT NOT NULL REFERENCES wz_owner_forum_poll_options(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES wz_users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(poll_id,user_id,option_id)
    );
    CREATE INDEX IF NOT EXISTS wz_owner_forum_polls_message_idx
      ON wz_owner_forum_polls(message_id);
    CREATE INDEX IF NOT EXISTS wz_owner_forum_poll_options_poll_idx
      ON wz_owner_forum_poll_options(poll_id);
    CREATE INDEX IF NOT EXISTS wz_owner_forum_poll_votes_poll_idx
      ON wz_owner_forum_poll_votes(poll_id);
  `);
  await p.query(`
    ALTER TABLE wz_branches ADD COLUMN IF NOT EXISTS address TEXT NOT NULL DEFAULT '';\n    ALTER TABLE wz_branches ADD COLUMN IF NOT EXISTS business_id TEXT REFERENCES wz_businesses(id);
    ALTER TABLE wz_employees ADD COLUMN IF NOT EXISTS salary NUMERIC NOT NULL DEFAULT 0;
    ALTER TABLE wz_employees ADD COLUMN IF NOT EXISTS commission NUMERIC NOT NULL DEFAULT 0;
    ALTER TABLE wz_employees ADD COLUMN IF NOT EXISTS target NUMERIC NOT NULL DEFAULT 0;
    ALTER TABLE wz_employees ADD COLUMN IF NOT EXISTS attendance NUMERIC NOT NULL DEFAULT 0;
    ALTER TABLE wz_employees ADD COLUMN IF NOT EXISTS eval NUMERIC NOT NULL DEFAULT 0;
    ALTER TABLE wz_employees ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE wz_employees ADD COLUMN IF NOT EXISTS business_id TEXT REFERENCES wz_businesses(id);
    ALTER TABLE wz_users ADD COLUMN IF NOT EXISTS business_id TEXT REFERENCES wz_businesses(id);
    ALTER TABLE wz_transactions ADD COLUMN IF NOT EXISTS business_id TEXT REFERENCES wz_businesses(id);
    ALTER TABLE wz_shift_reports ADD COLUMN IF NOT EXISTS business_id TEXT REFERENCES wz_businesses(id);
    ALTER TABLE wz_push_subscriptions ADD COLUMN IF NOT EXISTS business_id TEXT REFERENCES wz_businesses(id);
    UPDATE wz_push_subscriptions s SET business_id=u.business_id FROM wz_users u WHERE u.id=s.user_id AND s.business_id IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS wz_users_business_username_uq ON wz_users(business_id,username);
    CREATE UNIQUE INDEX IF NOT EXISTS wz_users_business_employee_uq ON wz_users(business_id,employee_id) WHERE employee_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS wz_push_business_endpoint_uq ON wz_push_subscriptions(business_id,endpoint);
    CREATE INDEX IF NOT EXISTS wz_users_business_idx ON wz_users(business_id);
    CREATE INDEX IF NOT EXISTS wz_employees_business_idx ON wz_employees(business_id);
    CREATE INDEX IF NOT EXISTS wz_transactions_business_idx ON wz_transactions(business_id);
    CREATE INDEX IF NOT EXISTS wz_shift_reports_business_idx ON wz_shift_reports(business_id);
    CREATE TABLE IF NOT EXISTS wz_fcm_tokens(
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES wz_users(id) ON DELETE CASCADE,
      business_id TEXT NOT NULL REFERENCES wz_businesses(id) ON DELETE CASCADE,
      token TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS wz_fcm_business_token_uq ON wz_fcm_tokens(business_id,token);
    CREATE INDEX IF NOT EXISTS wz_fcm_user_idx ON wz_fcm_tokens(user_id);
    CREATE INDEX IF NOT EXISTS wz_fcm_business_idx ON wz_fcm_tokens(business_id);
    CREATE TABLE IF NOT EXISTS wz_app_states(business_id TEXT PRIMARY KEY REFERENCES wz_businesses(id) ON DELETE CASCADE,data JSONB NOT NULL DEFAULT '{}'::jsonb,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());

    CREATE TABLE IF NOT EXISTS wz_payroll_settings(
      id BIGSERIAL PRIMARY KEY,
      business_id TEXT NOT NULL UNIQUE REFERENCES wz_businesses(id) ON DELETE CASCADE,
      payroll_type TEXT NOT NULL DEFAULT 'BASE_PLUS_SERVICE_BONUS',
      base_salary NUMERIC NOT NULL DEFAULT 0,
      target_amount NUMERIC NOT NULL DEFAULT 0,
      period_start_day INTEGER NOT NULL DEFAULT 1 CHECK (period_start_day BETWEEN 1 AND 31),
      period_end_day INTEGER NOT NULL DEFAULT 31 CHECK (period_end_day BETWEEN 1 AND 31),
      service_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS wz_payroll_settings_business_idx
      ON wz_payroll_settings(business_id);
  `);
  // NO DEFAULT WZ TENANT DATA. Semua bisnis dimulai dari data miliknya sendiri.

}

async function ensureSchema(){ if(!schemaPromise) schemaPromise=schema().catch(e=>{schemaPromise=null;throw e}); return schemaPromise; }

async function authUser(req){
  const cookie=String(req.headers.cookie||'');
  const m=cookie.match(/(?:^|;\s*)wz_session=([^;]+)/); if(!m)return null;
  const p=getPool();
  const r=await p.query(`SELECT u.id,u.username,u.role,u.name,u.employee_id,u.business_id,e.branch_id FROM wz_sessions s JOIN wz_users u ON u.id=s.user_id LEFT JOIN wz_employees e ON e.id=u.employee_id AND e.business_id=u.business_id WHERE s.token_hash=$1 AND s.expires_at>NOW() AND u.active=true`,[tokenHash(decodeURIComponent(m[1]))]);
  return r.rows[0]||null;
}
async function xenditRequest(path,payload){
  const secret=String(process.env.XENDIT_SECRET_KEY||'').trim();
  if(!secret)throw new Error('XENDIT_SECRET_KEY belum dikonfigurasi di server.');

  const auth=Buffer.from(`${secret}:`).toString('base64');

  const response=await fetch(`https://api.xendit.co${path}`,{
    method:'POST',
    headers:{
      'Authorization':`Basic ${auth}`,
      'Content-Type':'application/json',
      'api-version':'2026-01-01'
    },
    body:JSON.stringify(payload)
  });

  const text=await response.text();
  let data=null;
  try{data=text?JSON.parse(text):null}catch{}

  if(!response.ok){
    const message=data?.message||data?.error_code||`HTTP ${response.status}`;
    throw new Error(`Xendit: ${message}`);
  }

  return data||{};
}

function xenditWebhookValid(req){
  const expected=String(process.env.XENDIT_WEBHOOK_TOKEN||'').trim();
  const received=String(req.headers['x-callback-token']||'').trim();

  if(!expected||!received)return false;

  const a=Buffer.from(expected);
  const b=Buffer.from(received);

  return a.length===b.length && crypto.timingSafeEqual(a,b);
}

function publicAppUrl(){
  const custom=String(process.env.WZ_PUBLIC_URL||'').trim().replace(/\/+$/,'');
  if(custom)return custom;

  const production=String(process.env.VERCEL_PROJECT_PRODUCTION_URL||'').trim();
  if(production)return `https://${production}`;

  return 'https://wz-ai-analisis-rust.vercel.app';
}

async function employeeFor(id,businessId){
  if(!id||!businessId)return null;
  const r=await getPool().query('SELECT id,name,branch_id AS "branchId",active FROM wz_employees WHERE id=$1 AND business_id=$2',[String(id),String(businessId)]);
  return r.rows[0]||null;
}
// Status read notifikasi bersifat MONOTONIK di sisi server. Begitu sebuah
// notifikasi tercatat read, tidak ada penulisan berikutnya yang boleh
// mengembalikannya menjadi unread - termasuk autosave `app-state` yang mungkin
// membawa daftar notifikasi lokal milik klien. Tanpa aturan ini, satu payload
// yang terlambat tiba bisa memunculkan kembali badge notifikasi lama yang
// sebenarnya sudah dibaca user.
function mergeNotificationsMonotonic(current,incoming){
  const prior=Array.isArray(current)?current:[];
  if(!Array.isArray(incoming))return Array.isArray(current)?current:undefined;
  const priorById=new Map(prior.map(x=>[String((x&&x.id)??''),x]));
  const merged=incoming.map(item=>{
    const prev=priorById.get(String((item&&item.id)??''));
    if(!prev)return {...item};
    const wasRead=Boolean(prev.readAt||prev.read);
    if(!wasRead)return {...item};
    return {...item,read:true,readAt:item.readAt||prev.readAt||null};
  });
  // Notifikasi yang hanya ada di server tidak boleh hilang, dan yang sudah
  // read tetap dipertahankan sebagai read.
  const incomingIds=new Set(merged.map(x=>String((x&&x.id)??'')));
  for(const prev of prior){
    const id=String((prev&&prev.id)??'');
    if(incomingIds.has(id))continue;
    merged.push(prev.readAt||prev.read?{...prev,read:true}:prev);
  }
  return merged;
}

async function getSubscriptionAccess(businessId){
  const p=getPool();

  const r=await p.query(`
    SELECT
      s.business_id AS "businessId",
      s.plan,
      s.billing_period AS "billingPeriod",
      CASE
        WHEN s.status IN ('CANCELLED','SUSPENDED') THEN s.status
        WHEN s.plan='TRIAL'
          AND s.trial_ends_at IS NOT NULL
          AND s.trial_ends_at <= NOW()
        THEN 'EXPIRED'
        WHEN s.current_period_end IS NOT NULL
          AND s.current_period_end <= NOW()
        THEN 'EXPIRED'
        ELSE s.status
      END AS status,
      s.trial_started_at AS "trialStartedAt",
      s.trial_ends_at AS "trialEndsAt",
      s.current_period_start AS "currentPeriodStart",
      s.current_period_end AS "currentPeriodEnd",
      p.duration_days AS "durationDays",
      p.max_branches AS "maxBranches",
      p.max_employees AS "maxEmployees",
      p.price_monthly AS "priceMonthly",
      p.price_yearly AS "priceYearly"
    FROM wz_subscriptions s
    LEFT JOIN wz_subscription_plans p ON p.plan=s.plan
    WHERE s.business_id=$1
    LIMIT 1
  `,[businessId]);

  if(!r.rowCount){
    return {
      plan:null,
      status:'EXPIRED',
      maxBranches:0,
      maxEmployees:0,
      activeBranches:0,
      activeEmployees:0,
      canCreateBranch:false,
      canCreateEmployee:false,
      isReadOnly:true
    };
  }

  const sub=r.rows[0];

  const usage=await p.query(`
    SELECT
      (SELECT COUNT(*)::int
         FROM wz_branches
        WHERE business_id=$1
          AND active=true) AS "activeBranches",
      (SELECT COUNT(*)::int
         FROM wz_employees
        WHERE business_id=$1
          AND active=true) AS "activeEmployees"
  `,[businessId]);

  const u=usage.rows[0];
  const activeBranches=Number(u.activeBranches||0);
  const activeEmployees=Number(u.activeEmployees||0);

  const maxBranches=sub.maxBranches===null ? null : Number(sub.maxBranches);
  const maxEmployees=sub.maxEmployees===null ? null : Number(sub.maxEmployees);

  const isActive=sub.status==='ACTIVE';

  return {
    ...sub,
    maxBranches,
    maxEmployees,
    activeBranches,
    activeEmployees,
    canCreateBranch:isActive && (maxBranches===null || activeBranches<maxBranches),
    canCreateEmployee:isActive && (maxEmployees===null || activeEmployees<maxEmployees),
    isReadOnly:!isActive
  };
}

async function handler(req,res){
  try{
    await ensureSchema();
    const path=req.url.split('?')[0].replace(/^\/api\/?/,'').replace(/\/$/,'');
    if(path==='ready')return send(res,200,{ok:true,service:'WZ MANAGE PRO API',database:true});
    const ctx=routeContext();
    for(const routeModule of routeModules){
      await routeModule(ctx,req,res,path);
      if(res.writableEnded)return;
    }
    if(path==='subscription/webhook' && req.method==='POST'){
      if(!xenditWebhookValid(req))
        return send(res,401,{ok:false,error:'Webhook Xendit tidak terverifikasi.'});

      const b=await body(req);
      const event=String(b.event||'').trim();
      const d=b.data||{};
      const referenceId=String(d.reference_id||'').trim();

      if(!referenceId)
        return send(res,400,{ok:false,error:'reference_id webhook tidak ditemukan.'});

      const p=getPool();

      if(event==='payment_session.completed'){
        const r=await p.query(`
          UPDATE wz_subscription_orders
          SET
            status='PAID',
            payment_session_id=COALESCE($1,payment_session_id),
            xendit_customer_id=COALESCE($2,xendit_customer_id),
            xendit_payment_token_id=COALESCE($3,xendit_payment_token_id),
            xendit_payment_id=COALESCE($4,xendit_payment_id),
            xendit_recurring_plan_id=COALESCE($5,xendit_recurring_plan_id),
            paid_at=COALESCE(paid_at,NOW()),
            updated_at=NOW()
          WHERE order_id=$6
          RETURNING business_id,plan,billing_period
        `,[
          d.payment_session_id||null,
          d.customer_id||null,
          d.payment_token_id||null,
          d.payment_id||null,
          d.recurring_plan_id||null,
          referenceId
        ]);

        if(r.rowCount){
          await p.query(
            `INSERT INTO wz_admin_notifications(type,title,message,business_id,target_type,target_id)
             VALUES('payment_paid','Pembayaran subscription berhasil',$1,$2,'business',$2)`,
            [`Order ${referenceId} berhasil dibayar`,r.rows[0].business_id]
          );
        }

        if(r.rowCount && r.rows[0].billing_period==='YEAR'){
          await p.query(`
            UPDATE wz_subscriptions
            SET
              plan=$1,
              billing_period='YEAR',
              status='ACTIVE',
              current_period_start=NOW(),
              current_period_end=NOW()+INTERVAL '365 days',
              payment_provider='XENDIT',
              payment_customer_id=$2,
              payment_subscription_id=NULL,
              updated_at=NOW()
            WHERE business_id=$3
          `,[
            r.rows[0].plan,
            d.customer_id||null,
            r.rows[0].business_id
          ]);
        }
      }

      if(event==='payment_session.expired'){
        await p.query(`
          UPDATE wz_subscription_orders
          SET status='EXPIRED',updated_at=NOW()
          WHERE order_id=$1 AND status='PENDING'
        `,[referenceId]);
      }

      if(event==='payment.capture'){
        const paymentReference=String(
          d.reference_id||d.external_id||referenceId
        ).trim();

        if(paymentReference){
          await p.query(`
            UPDATE wz_subscription_orders
            SET
              status='PAID',
              xendit_payment_id=COALESCE($1,xendit_payment_id),
              paid_at=COALESCE(paid_at,NOW()),
              updated_at=NOW()
            WHERE order_id=$2
          `,[
            d.id||d.payment_id||null,
            paymentReference
          ]);
        }
      }

      if(event==='recurring.plan.activated'){
        const r=await p.query(`
          UPDATE wz_subscription_orders
          SET
            status='PAID',
            xendit_customer_id=COALESCE($1,xendit_customer_id),
            xendit_recurring_plan_id=COALESCE($2,xendit_recurring_plan_id),
            updated_at=NOW()
          WHERE order_id=$3
          RETURNING business_id,plan,billing_period
        `,[
          d.customer_id||null,
          d.id||null,
          referenceId
        ]);

        if(r.rowCount){
          await p.query(`
            UPDATE wz_subscriptions
            SET
              plan=$1,
              billing_period='MONTH',
              status='ACTIVE',
              current_period_start=NOW(),
              current_period_end=NOW()+INTERVAL '30 days',
              payment_provider='XENDIT',
              payment_customer_id=$2,
              payment_subscription_id=$3,
              last_recurring_cycle_number=0,
              updated_at=NOW()
            WHERE business_id=$4
          `,[
            r.rows[0].plan,
            d.customer_id||null,
            d.id||null,
            r.rows[0].business_id
          ]);
        }
      }

      if(event==='recurring.plan.inactivated'){
        const r=await p.query(`
          SELECT business_id
          FROM wz_subscription_orders
          WHERE order_id=$1
          LIMIT 1
        `,[referenceId]);

        if(r.rowCount){
          await p.query(`
            UPDATE wz_subscriptions
            SET status='EXPIRED',updated_at=NOW()
            WHERE business_id=$1
              AND payment_subscription_id=$2
          `,[r.rows[0].business_id,d.id||null]);
        }
      }

      if(event==='recurring.cycle.succeeded'){
        const cycleNumber=Number(d.cycle_number||0);

        if(cycleNumber>0){
          const r=await p.query(`
            SELECT business_id
            FROM wz_subscription_orders
            WHERE order_id=$1
            LIMIT 1
          `,[referenceId]);

          if(r.rowCount){
            await p.query(`
              UPDATE wz_subscriptions
              SET
                status='ACTIVE',
                current_period_start=GREATEST(COALESCE(current_period_end,NOW()),NOW()),
                current_period_end=GREATEST(COALESCE(current_period_end,NOW()),NOW())+INTERVAL '30 days',
                last_recurring_cycle_number=$2,
                updated_at=NOW()
              WHERE business_id=$1
                AND plan IN ('PRO','PRO_MAX')
                AND billing_period='MONTH'
                AND last_recurring_cycle_number < $2
            `,[r.rows[0].business_id,cycleNumber]);
          }
        }
      }


      if(event==='payment.failure'){
        console.warn(
          'Xendit payment.failure:',
          d.id||d.payment_id||'unknown'
        );
      }

      if(event==='recurring.cycle.failed'){
        const r=await p.query(`
          SELECT business_id
          FROM wz_subscription_orders
          WHERE order_id=$1
          LIMIT 1
        `,[referenceId]);

        if(r.rowCount){
          await p.query(`
            UPDATE wz_subscriptions
            SET status='EXPIRED',updated_at=NOW()
            WHERE business_id=$1
              AND billing_period='MONTH'
          `,[r.rows[0].business_id]);
        }
      }

      return send(res,200,{ok:true});
    }

    if(path==='subscription/order' && req.method==='POST'){
      const u=await authUser(req);
      if(!u)return send(res,401,{ok:false,error:'Belum login.'});

      if(!['owner','manager'].includes(u.role))
        return send(res,403,{ok:false,error:'Hanya Owner/Manager yang dapat membuat order subscription.'});

      const b=await body(req);
      const plan=String(b.plan||'').trim().toUpperCase();
      const billingPeriod=String(b.billingPeriod||'').trim().toUpperCase();

      if(!['PRO','PRO_MAX'].includes(plan))
        return send(res,400,{ok:false,error:'Paket subscription tidak valid.'});

      if(!['MONTH','YEAR'].includes(billingPeriod))
        return send(res,400,{ok:false,error:'Periode subscription tidak valid.'});

      const p=getPool();

      const planRow=await p.query(`
        SELECT
          plan,
          price_monthly AS "priceMonthly",
          price_yearly AS "priceYearly",
          active
        FROM wz_subscription_plans
        WHERE plan=$1
        LIMIT 1
      `,[plan]);

      if(!planRow.rowCount||!planRow.rows[0].active)
        return send(res,400,{ok:false,error:'Paket subscription tidak tersedia.'});

      const selected=planRow.rows[0];

      const amount=Number(
        billingPeriod==='YEAR'
          ? selected.priceYearly
          : selected.priceMonthly
      );

      if(!Number.isFinite(amount)||amount<=0)
        return send(res,400,{ok:false,error:'Harga subscription tidak valid.'});

      const orderId=
        'WZ-'+
        Date.now().toString(36).toUpperCase()+
        '-'+
        crypto.randomBytes(4).toString('hex').toUpperCase();

      const expiresAt=new Date(Date.now()+30*60*1000);
      const appUrl=publicAppUrl();
      const safeName=xenditSafeName(u.name);

      const order=await p.query(`
        INSERT INTO wz_subscription_orders
          (business_id,order_id,plan,billing_period,amount,currency,status,payment_provider,expires_at)
        VALUES
          ($1,$2,$3,$4,$5,'IDR','PENDING','XENDIT',$6)
        RETURNING
          id,
          order_id AS "orderId",
          business_id AS "businessId",
          plan,
          billing_period AS "billingPeriod",
          amount,
          currency,
          status,
          payment_provider AS "paymentProvider",
          expires_at AS "expiresAt",
          created_at AS "createdAt"
      `,[
        u.business_id,
        orderId,
        plan,
        billingPeriod,
        amount,
        expiresAt
      ]);

      await p.query(
        `INSERT INTO wz_admin_notifications(type,title,message,business_id,target_type,target_id)
         VALUES('subscription_order','Order subscription baru',$1,$2,'business',$2)`,
        [`Order ${orderId} menunggu pembayaran Xendit`,u.business_id]
      );

      const customer={
        reference_id:String(`${u.business_id}${orderId}`).replace(/[^A-Za-z0-9]/g,''),
        type:'INDIVIDUAL',
        individual_detail:{
          given_names:safeName
        }
      };

      let sessionPayload;

      if(billingPeriod==='MONTH'){
        const now=new Date();
        const day=Math.min(now.getUTCDate(),28);

        sessionPayload={
          reference_id:orderId,
          session_type:'SUBSCRIPTION',
          mode:'PAYMENT_LINK',
          amount,
          currency:'IDR',
          country:'ID',
          customer,
          locale:'id',
          description:`WZ MANAGE PRO ${plan} - 30 Hari`,
          subscription:{
            schedule:{
              interval:'MONTH',
              interval_count:1,
              anchor_date:new Date(Date.UTC(
                now.getUTCFullYear(),
                now.getUTCMonth()+1,
                day,
                0,0,0
              )).toISOString(),
              retry_interval:'DAY',
              retry_interval_count:1,
              total_retry:3,
              failed_attempt_notifications:[1,2,3]
            },
            failed_cycle_action:'RESUME'
          },
          success_return_url:`${appUrl}/#subscription`,
          cancel_return_url:`${appUrl}/#subscription`
        };
      }else{
        sessionPayload={
          reference_id:orderId,
          session_type:'PAY',
          mode:'PAYMENT_LINK',
          amount,
          currency:'IDR',
          country:'ID',
          customer,
          locale:'id',
          description:`WZ MANAGE PRO ${plan} - 12 Bulan`,
          items:[
            {
              reference_id:orderId,
              type:'DIGITAL_SERVICE',
              name:`WZ MANAGE PRO ${plan}`,
              description:'Langganan WZ MANAGE PRO selama 12 bulan',
              category:'SOFTWARE',
              net_unit_amount:amount,
              quantity:1,
              currency:'IDR'
            }
          ],
          success_return_url:`${appUrl}/#subscription`,
          cancel_return_url:`${appUrl}/#subscription`
        };
      }

      try{
        const session=await xenditRequest('/sessions',sessionPayload);

        const saved=await p.query(`
          UPDATE wz_subscription_orders
          SET
            payment_session_id=$1,
            payment_url=$2,
            xendit_customer_id=$3,
            xendit_payment_token_id=$4,
            xendit_payment_id=$5,
            xendit_recurring_plan_id=$6,
            updated_at=NOW()
          WHERE order_id=$7 AND business_id=$8
          RETURNING
            id,
            order_id AS "orderId",
            business_id AS "businessId",
            plan,
            billing_period AS "billingPeriod",
            amount,
            currency,
            status,
            payment_provider AS "paymentProvider",
            payment_session_id AS "paymentSessionId",
            payment_url AS "paymentUrl",
            expires_at AS "expiresAt",
            created_at AS "createdAt"
        `,[
          session.payment_session_id||null,
          session.payment_link_url||null,
          session.customer_id||null,
          session.payment_token_id||null,
          session.payment_id||null,
          session.recurring_plan_id||null,
          orderId,
          u.business_id
        ]);

        return send(res,201,{
          ok:true,
          order:saved.rows[0]||order.rows[0],
          paymentUrl:session.payment_link_url||null,
          message:'Order berhasil dibuat. Silakan lanjutkan pembayaran melalui Xendit.'
        });
      }catch(error){
        await p.query(`
          UPDATE wz_subscription_orders
          SET status='FAILED',updated_at=NOW()
          WHERE order_id=$1 AND business_id=$2
        `,[orderId,u.business_id]);

        return send(res,502,{
          ok:false,
          error:safeServerError(error)
        });
      }
    }


    if(path==='subscription' && req.method==='GET'){
      const u=await authUser(req);
      if(!u)return send(res,401,{ok:false,error:'Unauthorized'});

      const r=await getPool().query(`
        SELECT
          s.business_id AS "businessId",
          s.plan,
          s.billing_period AS "billingPeriod",
          CASE
            WHEN s.plan='TRIAL'
              AND s.trial_ends_at IS NOT NULL
              AND s.trial_ends_at <= NOW()
              AND s.status='ACTIVE'
            THEN 'EXPIRED'
            WHEN s.current_period_end IS NOT NULL
              AND s.current_period_end <= NOW()
              AND s.status='ACTIVE'
            THEN 'EXPIRED'
            ELSE s.status
          END AS status,
          s.trial_started_at AS "trialStartedAt",
          s.trial_ends_at AS "trialEndsAt",
          s.current_period_start AS "currentPeriodStart",
          s.current_period_end AS "currentPeriodEnd",
          p.duration_days AS "durationDays",
          p.max_branches AS "maxBranches",
          p.max_employees AS "maxEmployees",
          p.price_monthly AS "priceMonthly",
          p.price_yearly AS "priceYearly"
        FROM wz_subscriptions s
        LEFT JOIN wz_subscription_plans p ON p.plan=s.plan
        WHERE s.business_id=$1
        LIMIT 1
      `,[u.business_id]);

      if(!r.rowCount){
        return send(res,404,{ok:false,error:'Subscription bisnis belum tersedia.'});
      }

      const sub=r.rows[0];

      const counts=await getPool().query(`
        SELECT
          (SELECT COUNT(*)::int
             FROM wz_branches
            WHERE business_id=$1
              AND active=true) AS "activeBranches",
          (SELECT COUNT(*)::int
             FROM wz_employees
            WHERE business_id=$1
              AND active=true) AS "activeEmployees"
      `,[u.business_id]);

      const usage=counts.rows[0];

      return send(res,200,{
        ok:true,
        subscription:{
          ...sub,
          usage:{
            activeBranches:usage.activeBranches,
            activeEmployees:usage.activeEmployees
          }
        }
      });
    }

    if(path==='business' && req.method==='GET'){
      const u=await authUser(req);if(!u)return send(res,401,{ok:false,error:'Belum login.'});
      const p=getPool();
      const txSql='SELECT id,date,customer_id AS "customerId",customer_name AS "customerName",service_id AS "serviceId",service_name AS "serviceName",service_price AS "servicePrice",employee_id AS "employeeId",employee_name AS "employeeName",total,payment,status,discount,updated_at AS "updatedAt" FROM wz_transactions WHERE business_id=$1 '+(u.role==='employee'?'AND employee_id=$2 ':'')+'ORDER BY date,id';
      const shSql='SELECT id,date,employee_id AS "employeeId",employee_name AS "employeeName",shift_type AS "shiftType",customers,opening_cash AS "openingCash",cash,qris,cash_expense AS "cashExpense",physical_cash AS "physicalCash",total_payment AS "totalPayment",expected_cash AS "expectedCash",cash_difference AS "cashDifference",service_total AS "serviceTotal",product_total AS "productTotal",CASE WHEN total_omzet > 0 THEN total_omzet ELSE total_payment END AS "totalOmzet",services,products,note,saved_at AS "savedAt",updated_at AS "updatedAt" FROM wz_shift_reports WHERE business_id=$1 '+(u.role==='employee'?'AND employee_id=$2 ':'')+'ORDER BY date,id';
      const params=u.role==='employee'?[u.business_id,u.employee_id]:[u.business_id];
      const tx=await p.query(txSql,params);
      const sh=await p.query(shSql,params);
      const branches=await p.query(
        'SELECT id,name,active FROM wz_branches WHERE business_id=$1 ORDER BY id',
        [u.business_id]
      );
      const state=await p.query(
        'SELECT data FROM wz_app_states WHERE business_id=$1',
        [u.business_id]
      );
      const notifications=state.rowCount&&state.rows[0]?.data&&Array.isArray(state.rows[0].data.notifications)
        ? state.rows[0].data.notifications
        : [];
      return send(res,200,{
        ok:true,
        transactions:tx.rows,
        shiftReports:sh.rows,
        branches:branches.rows,
        notifications:['owner','manager'].includes(u.role)?notifications:[]
      });
    }

    if(path==='branches' && req.method==='GET'){
      const u=await authUser(req);
      if(!u||!['owner','manager'].includes(u.role))
        return send(res,403,{ok:false,error:'Akses ditolak.'});

      const r=await getPool().query(
        'SELECT id,name,address,active FROM wz_branches WHERE business_id=$1 ORDER BY id',
        [u.business_id]
      );

      return send(res,200,{ok:true,branches:r.rows});
    }

    if(path==='branches' && req.method==='POST'){
      const u=await authUser(req);
      if(!u||!['owner','manager'].includes(u.role))
        return send(res,403,{ok:false,error:'Hanya Owner/Manager yang dapat mengelola cabang.'});

      const b=await body(req);
      const name=String(b.name||'').trim();
      const address=String(b.address||'').trim();

      if(name.length<2)
        return send(res,400,{ok:false,error:'Nama cabang wajib diisi.'});

      if(name.length>100)
        return send(res,400,{ok:false,error:'Nama cabang terlalu panjang.'});

      const access=await getSubscriptionAccess(u.business_id);

      if(access.isReadOnly)
        return send(res,403,{
          ok:false,
          code:'SUBSCRIPTION_REQUIRED',
          error:'Subscription bisnis sudah tidak aktif. Silakan pilih paket untuk melanjutkan.'
        });

      if(!access.canCreateBranch)
        return send(res,403,{
          ok:false,
          code:'BRANCH_LIMIT_REACHED',
          plan:access.plan,
          limit:access.maxBranches,
          usage:access.activeBranches,
          error:access.maxBranches===null
            ?'Tidak dapat menambah cabang saat ini.'
            :`Batas cabang paket ${access.plan} adalah ${access.maxBranches}. Silakan upgrade paket untuk menambah cabang.`
        });

      const id='B'+crypto.randomBytes(5).toString('hex').toUpperCase();

      const r=await getPool().query(
        `INSERT INTO wz_branches(id,name,address,active,business_id)
         VALUES($1,$2,$3,true,$4)
         RETURNING id,name,address,active`,
        [id,name,address,u.business_id]
      );

      return send(res,201,{ok:true,branch:r.rows[0]});
    }

    if(path==='branches' && req.method==='PUT'){
      const u=await authUser(req);
      if(!u||!['owner','manager'].includes(u.role))
        return send(res,403,{ok:false,error:'Hanya Owner/Manager yang dapat mengelola cabang.'});
      const access=await getSubscriptionAccess(u.business_id);
      if(access.isReadOnly)return send(res,403,{ok:false,code:'SUBSCRIPTION_REQUIRED',error:'Subscription bisnis sudah tidak aktif. Silakan pilih paket untuk melanjutkan.'});

      const b=await body(req);
      const id=String(b.id||'').trim();
      const name=String(b.name||'').trim();
      const address=String(b.address||'').trim();
      const active=b.active!==false;

      if(!id)
        return send(res,400,{ok:false,error:'ID cabang wajib diisi.'});

      if(name.length<2)
        return send(res,400,{ok:false,error:'Nama cabang wajib diisi.'});

      const r=await getPool().query(
        `UPDATE wz_branches
         SET name=$1,address=$2,active=$3
         WHERE id=$4 AND business_id=$5
         RETURNING id,name,address,active`,
        [name,address,active,id,u.business_id]
      );

      if(!r.rowCount)
        return send(res,404,{ok:false,error:'Cabang tidak ditemukan pada bisnis ini.'});

      return send(res,200,{ok:true,branch:r.rows[0]});
    }

    if(path==='branches' && req.method==='DELETE'){
      const u=await authUser(req);
      if(!u||!['owner','manager'].includes(u.role))
        return send(res,403,{ok:false,error:'Hanya Owner/Manager yang dapat mengelola cabang.'});
      const access=await getSubscriptionAccess(u.business_id);
      if(access.isReadOnly)return send(res,403,{ok:false,code:'SUBSCRIPTION_REQUIRED',error:'Subscription bisnis sudah tidak aktif. Silakan pilih paket untuk melanjutkan.'});

      const id=new URL(req.url,'http://localhost').searchParams.get('id');
      if(!id)
        return send(res,400,{ok:false,error:'ID cabang wajib diisi.'});

      const emp=await getPool().query(
        'SELECT COUNT(*)::int AS count FROM wz_employees WHERE branch_id=$1 AND business_id=$2',
        [id,u.business_id]
      );

      if(Number(emp.rows[0]?.count||0)>0)
        return send(res,400,{ok:false,error:'Cabang masih memiliki karyawan. Pindahkan atau hapus karyawan terlebih dahulu.'});

      const r=await getPool().query(
        'DELETE FROM wz_branches WHERE id=$1 AND business_id=$2 RETURNING id',
        [id,u.business_id]
      );

      if(!r.rowCount)
        return send(res,404,{ok:false,error:'Cabang tidak ditemukan pada bisnis ini.'});

      return send(res,200,{ok:true});
    }

    if(path==='notifications/read' && req.method==='POST'){
      const u=await authUser(req);
      if(!u)return send(res,401,{ok:false,error:'Belum login.'});
      if(!['owner','manager'].includes(u.role))
        return send(res,403,{ok:false,error:'Hanya Owner/Manager yang dapat mengubah notifikasi.'});

      const b=await body(req);
      const now=new Date().toISOString();

      // Status read harus benar-benar persisten. Baris app_state dikunci
      // (FOR UPDATE) selama read-modify-write supaya penyimpanan app-state yang
      // berjalan bersamaan tidak menimpa penanda "sudah dibaca" ini, dan
      // sebaliknya. Tanpa kunci, autosave yang sedang berjalan bisa menulis
      // ulang data lama dan unread muncul lagi setelah refresh.
      const c=await getPool().connect();
      let notifications=[];
      try{
        await c.query('BEGIN');
        const state=await c.query(
          'SELECT data FROM wz_app_states WHERE business_id=$1 FOR UPDATE',
          [u.business_id]
        );

        if(!state.rowCount){
          await c.query('ROLLBACK');
          return send(res,404,{ok:false,error:'Data aplikasi bisnis tidak ditemukan.'});
        }

        const data=state.rows[0].data&&typeof state.rows[0].data==='object'
          ? {...state.rows[0].data}
          : {};

        notifications=Array.isArray(data.notifications)
          ? data.notifications.map(item=>({...item}))
          : [];

        if(b?.all===true){
          notifications.forEach(item=>{
            if(item.read&&item.readAt)return;
            item.read=true;
            item.readAt=item.readAt||now;
          });
        }else{
          const id=String(b?.id||'');
          if(!id){
            await c.query('ROLLBACK');
            return send(res,400,{ok:false,error:'ID notifikasi wajib diisi.'});
          }

          const item=notifications.find(x=>String(x.id)===id);
          if(!item){
            await c.query('ROLLBACK');
            return send(res,404,{ok:false,error:'Notifikasi tidak ditemukan.'});
          }

          item.read=true;
          item.readAt=item.readAt||now;
        }

        data.notifications=notifications;

        const saved=await c.query(
          `UPDATE wz_app_states
           SET data=$2::jsonb,updated_at=NOW()
           WHERE business_id=$1
           RETURNING updated_at AS "updatedAt"`,
          [u.business_id,JSON.stringify(data)]
        );

        await c.query('COMMIT');
        return send(res,200,{
          ok:true,
          notifications,
          updatedAt:saved.rows[0]?.updatedAt||null
        });
      }catch(e){
        await c.query('ROLLBACK').catch(()=>{});
        throw e;
      }finally{c.release()}
    }

    if(path==='app-state' && req.method==='GET'){
      const u=await authUser(req);if(!u)return send(res,401,{ok:false,error:'Belum login.'});
      const r=await getPool().query('SELECT data,updated_at AS "updatedAt" FROM wz_app_states WHERE business_id=$1',[u.business_id]);
      let data=r.rowCount?r.rows[0].data:{};
      if(u.role==='employee'){
        // Employee tidak menerima notifikasi bisnis dari server.
        data={customers:Array.isArray(data?.customers)?data.customers:[],services:Array.isArray(data?.services)?data.services:[],branches:Array.isArray(data?.branches)?data.branches:[]};
      }else if(!['owner','manager'].includes(u.role))return send(res,403,{ok:false,error:'Akses ditolak.'});
      return send(res,200,{ok:true,data,updatedAt:r.rowCount?r.rows[0].updatedAt:null});
    }
    if(path==='app-state' && req.method==='PUT'){
      const u=await authUser(req);if(!u)return send(res,401,{ok:false,error:'Belum login.'});
      const access=await getSubscriptionAccess(u.business_id);
      if(access.isReadOnly)return send(res,403,{ok:false,code:'SUBSCRIPTION_REQUIRED',error:'Subscription bisnis sudah tidak aktif. Silakan pilih paket untuk melanjutkan.'});
      const b=await body(req);const data=b?.data;
      if(!data||typeof data!=='object'||Array.isArray(data))return send(res,400,{ok:false,error:'Data aplikasi tidak valid.'});
      const expectedUpdatedAt=b?.expectedUpdatedAt?new Date(b.expectedUpdatedAt):null;
      if(b?.expectedUpdatedAt&&(!expectedUpdatedAt||Number.isNaN(expectedUpdatedAt.getTime())))
        return send(res,400,{ok:false,error:'Timestamp konflik tidak valid.'});
      const current=await getPool().query('SELECT data,updated_at AS "updatedAt" FROM wz_app_states WHERE business_id=$1',[u.business_id]);
      if(expectedUpdatedAt&&current.rowCount&&new Date(current.rows[0].updatedAt).getTime()!==expectedUpdatedAt.getTime())
        return send(res,409,{ok:false,code:'STATE_CONFLICT',error:'Data server sudah berubah. Muat ulang sebelum menyimpan.'});
      const currentData=current.rowCount&&current.rows[0].data&&typeof current.rows[0].data==='object'?current.rows[0].data:{};
      if(u.role==='employee'){
        const customers=Array.isArray(data.customers)?data.customers:[];
        if(JSON.stringify(customers).length>4*1024*1024)return send(res,413,{ok:false,error:'Data pelanggan terlalu besar.'});
        const payload=JSON.stringify({...currentData,customers});
        const saved=expectedUpdatedAt
          ?await getPool().query(`UPDATE wz_app_states SET data=$2::jsonb,updated_at=NOW() WHERE business_id=$1 AND updated_at=$3 RETURNING updated_at AS "updatedAt"`,[u.business_id,payload,expectedUpdatedAt])
          :await getPool().query(`INSERT INTO wz_app_states(business_id,data,updated_at) VALUES($1,$2::jsonb,NOW()) ON CONFLICT(business_id) DO UPDATE SET data=EXCLUDED.data,updated_at=NOW() RETURNING updated_at AS "updatedAt"`,[u.business_id,payload]);
        if(expectedUpdatedAt&&!saved.rowCount)return send(res,409,{ok:false,code:'STATE_CONFLICT',error:'Data server sudah berubah. Muat ulang sebelum menyimpan.'});
        return send(res,200,{ok:true,updatedAt:saved.rows[0]?.updatedAt||null});
      }
      if(!['owner','manager'].includes(u.role))return send(res,403,{ok:false,error:'Hanya Owner/Manager yang dapat menyimpan data online.'});
      // Notifikasi tidak pernah diturunkan statusnya oleh penulisan state biasa.
      const mergedNotifications=mergeNotificationsMonotonic(
        currentData.notifications,
        Object.prototype.hasOwnProperty.call(data,'notifications')?data.notifications:undefined
      );
      const mergedData={
        ...data,
        ...(mergedNotifications!==undefined?{notifications:mergedNotifications}:{})
      };
      const payload=JSON.stringify(mergedData);
      if(payload.length>8*1024*1024)return send(res,413,{ok:false,error:'Data aplikasi terlalu besar.'});
      const saved=expectedUpdatedAt
        ?await getPool().query(`UPDATE wz_app_states SET data=$2::jsonb,updated_at=NOW() WHERE business_id=$1 AND updated_at=$3 RETURNING updated_at AS "updatedAt"`,[u.business_id,payload,expectedUpdatedAt])
        :await getPool().query(`INSERT INTO wz_app_states(business_id,data,updated_at) VALUES($1,$2::jsonb,NOW()) ON CONFLICT(business_id) DO UPDATE SET data=EXCLUDED.data,updated_at=NOW() RETURNING updated_at AS "updatedAt"`,[u.business_id,payload]);
      if(expectedUpdatedAt&&!saved.rowCount)return send(res,409,{ok:false,code:'STATE_CONFLICT',error:'Data server sudah berubah. Muat ulang sebelum menyimpan.'});
      return send(res,200,{ok:true,updatedAt:saved.rows[0]?.updatedAt||null});
    }
    if(path==='profile' && req.method==='GET'){
      const u=await authUser(req);if(!u)return send(res,401,{ok:false,error:'Belum login.'});
      const r=await getPool().query('SELECT phone,avatar FROM wz_user_profiles WHERE user_id=$1',[u.id]);
      return send(res,200,{ok:true,user:{...u},profile:r.rowCount?r.rows[0]:{phone:'',avatar:''}});
    }
    if(path==='profile' && req.method==='PUT'){
      const u=await authUser(req);if(!u)return send(res,401,{ok:false,error:'Belum login.'});
      const b=await body(req),phone=String(b.phone||'').trim(),avatar=String(b.avatar||'');
      if(avatar.length>3*1024*1024)return send(res,413,{ok:false,error:'Foto profil terlalu besar.'});
      const name=u.role==='employee'?u.name:String(b.name||u.name).trim();
      if(!name)return send(res,400,{ok:false,error:'Nama wajib diisi.'});
      await getPool().query('UPDATE wz_users SET name=$1,updated_at=NOW() WHERE id=$2',[name,u.id]);
      await getPool().query(`INSERT INTO wz_user_profiles(user_id,phone,avatar,updated_at) VALUES($1,$2,$3,NOW()) ON CONFLICT(user_id) DO UPDATE SET phone=EXCLUDED.phone,avatar=EXCLUDED.avatar,updated_at=NOW()`,[u.id,phone,avatar]);
      const er=await getPool().query('SELECT id,username,role,name,employee_id AS "employeeId",(SELECT branch_id FROM wz_employees WHERE id=wz_users.employee_id AND business_id=wz_users.business_id) AS "branchId" FROM wz_users WHERE id=$1',[u.id]);
      return send(res,200,{ok:true,user:er.rows[0],profile:{phone,avatar}});
    }
    if(path==='password' && req.method==='POST'){
      const u=await authUser(req);if(!u)return send(res,401,{ok:false,error:'Belum login.'});
      const b=await body(req),oldPassword=String(b.oldPassword||''),newPassword=String(b.newPassword||'');
      if(newPassword.length<4)return send(res,400,{ok:false,error:'Password baru minimal 4 karakter.'});
      const r=await getPool().query('SELECT password_hash FROM wz_users WHERE id=$1 AND active=true',[u.id]);
      if(!r.rowCount||!verifyPassword(oldPassword,r.rows[0].password_hash))return send(res,400,{ok:false,error:'Password lama salah.'});
      await getPool().query('UPDATE wz_users SET password_hash=$1,updated_at=NOW() WHERE id=$2',[hashPassword(newPassword),u.id]);
      return send(res,200,{ok:true});
    }

    if(path==='reset-business' && req.method==='POST'){
      const u=await authUser(req);if(!u)return send(res,401,{ok:false,error:'Belum login.'});
      if(!['owner','manager'].includes(u.role))return send(res,403,{ok:false,error:'Hanya Owner/Manager yang dapat mereset data bisnis.'});
      const access=await getSubscriptionAccess(u.business_id);
      if(access.isReadOnly)return send(res,403,{ok:false,code:'SUBSCRIPTION_REQUIRED',error:'Subscription bisnis sudah tidak aktif. Silakan pilih paket untuk melanjutkan.'});
      const client=await getPool().connect();
      try{
        await client.query('BEGIN');
        const tx=await client.query('DELETE FROM wz_transactions WHERE business_id=$1 RETURNING id',[u.business_id]);
        const shifts=await client.query('DELETE FROM wz_shift_reports WHERE business_id=$1 RETURNING id',[u.business_id]);
        await client.query('COMMIT');
        return send(res,200,{ok:true,transactions:tx.rowCount,shiftReports:shifts.rowCount,total:tx.rowCount+shifts.rowCount});
      }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
    }
    if(path==='sync-business' && req.method==='POST'){
      const u=await authUser(req);if(!u)return send(res,401,{ok:false,error:'Belum login.'});
      const access=await getSubscriptionAccess(u.business_id);
      if(access.isReadOnly)
        return send(res,403,{
          ok:false,
          code:'SUBSCRIPTION_REQUIRED',
          error:'Subscription bisnis sudah tidak aktif. Silakan pilih paket untuk melanjutkan.'
        });
      const b=await body(req),txs=Array.isArray(b.transactions)?b.transactions:[],shifts=Array.isArray(b.shiftReports)?b.shiftReports:[];
      if(u.role==='employee'){
        if(!u.employee_id)return send(res,403,{ok:false,error:'Akun karyawan tidak terhubung ke ID karyawan.'});
        if(txs.some(t=>String(t.employeeId)!==String(u.employee_id)))return send(res,403,{ok:false,error:'Karyawan hanya boleh sinkronkan transaksi miliknya.'});
        if(shifts.some(r=>String(r.employeeId)!==String(u.employee_id)))return send(res,403,{ok:false,error:'Karyawan hanya boleh sinkronkan laporan shift miliknya.'});
      }
      if(txs.some(t=>!t.id||!t.employeeId||!validTransaction(t)))return send(res,400,{ok:false,error:'Data transaksi tidak valid.'});
      if(shifts.some(r=>!r.id||!r.employeeId||!validShift(r)))return send(res,400,{ok:false,error:'Data laporan shift tidak valid.'});
      const employeeIds=[...new Set([...txs.map(t=>t.employeeId),...shifts.map(r=>r.employeeId)].filter(Boolean).map(String))];
      if(employeeIds.length){
        const er=await getPool().query('SELECT id,active FROM wz_employees WHERE business_id=$2 AND id = ANY($1::text[])',[employeeIds,u.business_id]);
        const valid=new Map(er.rows.map(x=>[String(x.id),x]));
        for(const id of employeeIds){if(!valid.has(id))return send(res,400,{ok:false,error:'ID karyawan tidak terdaftar: '+id});}
        if(txs.some(t=>t.employeeId&&valid.get(String(t.employeeId))?.active===false)||shifts.some(r=>r.employeeId&&valid.get(String(r.employeeId))?.active===false))return send(res,400,{ok:false,error:'Karyawan nonaktif tidak dapat menyimpan data baru.'});
      }
      const client=await getPool().connect();
      try{
        await client.query('BEGIN');
        for(const t of txs){
          await client.query(`INSERT INTO wz_transactions(id,date,customer_id,customer_name,service_id,service_name,service_price,employee_id,employee_name,total,payment,status,discount,business_id,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW()) ON CONFLICT(id) DO UPDATE SET date=EXCLUDED.date,customer_id=EXCLUDED.customer_id,customer_name=EXCLUDED.customer_name,service_id=EXCLUDED.service_id,service_name=EXCLUDED.service_name,service_price=EXCLUDED.service_price,employee_id=EXCLUDED.employee_id,employee_name=EXCLUDED.employee_name,total=EXCLUDED.total,payment=EXCLUDED.payment,status=EXCLUDED.status,discount=EXCLUDED.discount,updated_at=NOW() WHERE wz_transactions.business_id=EXCLUDED.business_id`,[t.id,t.date,t.customerId||null,t.customerName||null,t.serviceId||null,t.serviceName||null,Number(t.servicePrice||0),t.employeeId||null,t.employeeName||null,Number(t.total||0),t.payment||'Tunai',t.status||'SELESAI',Number(t.discount||0),u.business_id]);
        }
        for(const r of shifts){
          await client.query(`INSERT INTO wz_shift_reports(id,date,employee_id,employee_name,shift_type,customers,opening_cash,cash,qris,cash_expense,physical_cash,total_payment,expected_cash,cash_difference,service_total,product_total,total_omzet,services,products,note,saved_at,business_id,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19::jsonb,$20,$21,$22,NOW()) ON CONFLICT(id) DO UPDATE SET date=EXCLUDED.date,employee_id=EXCLUDED.employee_id,employee_name=EXCLUDED.employee_name,shift_type=EXCLUDED.shift_type,customers=EXCLUDED.customers,opening_cash=EXCLUDED.opening_cash,cash=EXCLUDED.cash,qris=EXCLUDED.qris,cash_expense=EXCLUDED.cash_expense,physical_cash=EXCLUDED.physical_cash,total_payment=EXCLUDED.total_payment,expected_cash=EXCLUDED.expected_cash,cash_difference=EXCLUDED.cash_difference,service_total=EXCLUDED.service_total,product_total=EXCLUDED.product_total,total_omzet=EXCLUDED.total_omzet,services=EXCLUDED.services,products=EXCLUDED.products,note=EXCLUDED.note,saved_at=EXCLUDED.saved_at,updated_at=NOW() WHERE wz_shift_reports.business_id=EXCLUDED.business_id`,[r.id,r.date,r.employeeId||null,r.employeeName||null,r.shiftType||null,Number(r.customers||0),Number(r.openingCash||0),Number(r.cash||0),Number(r.qris||0),Number(r.cashExpense||0),Number(r.physicalCash||0),Number(r.totalPayment||0),Number(r.expectedCash||0),Number(r.cashDifference||0),Number(r.serviceTotal||0),Number(r.productTotal||0),Number(r.totalOmzet||0),JSON.stringify(r.services||[]),JSON.stringify(r.products||[]),r.note||null,r.savedAt||null,u.business_id]);
        }
        await client.query('COMMIT');
      }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
      await Promise.all(shifts.map(shift=>sendShiftPushes({...shift,businessId:u.business_id},u.id).catch(()=>{})));
      await Promise.all(shifts.map(shift=>sendFcmNotification({
        businessId:u.business_id,
        senderId:u.id,
        title:'WZ MANAGE PRO',
        body:`Laporan shift ${shift.employeeName||shift.employeeId||''} tersedia.`,
        data:{type:'shift_report',reportId:shift.id}
      }).catch(e=>{
      })));
      return send(res,200,{ok:true,transactions:txs.length,shiftReports:shifts.length});
    }
    if(path==='transaction' && req.method==='POST'){
      const u=await authUser(req);if(!u)return send(res,401,{ok:false,error:'Belum login.'});
      const access=await getSubscriptionAccess(u.business_id);
      if(access.isReadOnly)
        return send(res,403,{
          ok:false,
          code:'SUBSCRIPTION_REQUIRED',
          error:'Subscription bisnis sudah tidak aktif. Silakan pilih paket untuk melanjutkan.'
        });
      const t=await body(req);if(!t.id||!t.date||!t.employeeId)return send(res,400,{ok:false,error:'Data transaksi tidak lengkap.'});
      if(!validTransaction(t))return send(res,400,{ok:false,error:'Nilai transaksi tidak valid.'});
      if(u.role==='employee'&&String(t.employeeId)!==String(u.employee_id))return send(res,403,{ok:false,error:'Karyawan hanya boleh membuat transaksi atas namanya sendiri.'});
      const te=await employeeFor(t.employeeId,u.business_id);if(!te)return send(res,400,{ok:false,error:'Karyawan tidak terdaftar.'});
      if(te.active===false)return send(res,400,{ok:false,error:'Karyawan sudah nonaktif.'});
      const servicePrice=Number(t.servicePrice||0),discount=Number(t.discount||0),total=Number(t.total||0);
      const c=await getPool().connect();try{await c.query('BEGIN');await c.query(`INSERT INTO wz_transactions(id,date,customer_id,customer_name,service_id,service_name,service_price,employee_id,employee_name,total,payment,status,discount,business_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,total=EXCLUDED.total,updated_at=NOW() WHERE wz_transactions.business_id=EXCLUDED.business_id`,[t.id,t.date,t.customerId||null,t.customerName||null,t.serviceId||null,t.serviceName||null,servicePrice,t.employeeId,te.name,total,t.payment||'Tunai',t.status||'SELESAI',discount,u.business_id]);await c.query('COMMIT');return send(res,200,{ok:true,id:t.id});}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
    }
    if(path==='transaction/void' && req.method==='POST'){
      const u=await authUser(req);if(!u)return send(res,401,{ok:false,error:'Belum login.'});
      const access=await getSubscriptionAccess(u.business_id);
      if(access.isReadOnly)return send(res,403,{ok:false,code:'SUBSCRIPTION_REQUIRED',error:'Subscription bisnis sudah tidak aktif. Silakan pilih paket untuk melanjutkan.'});
      const b=await body(req);
      const r=await getPool().query("UPDATE wz_transactions SET status='VOID',updated_at=NOW() WHERE id=$1 AND business_id=$4 AND ($2<>'employee' OR employee_id=$3) RETURNING id",[b.id,u.role,u.employee_id,u.business_id]);
      if(!r.rowCount)return send(res,404,{ok:false,error:'Transaksi tidak ditemukan atau tidak boleh diubah.'});
      return send(res,200,{ok:true});
    }
    if(path==='shift-report' && req.method==='POST'){
      const u=await authUser(req);if(!u)return send(res,401,{ok:false,error:'Belum login.'});
      const access=await getSubscriptionAccess(u.business_id);
      if(access.isReadOnly)
        return send(res,403,{
          ok:false,
          code:'SUBSCRIPTION_REQUIRED',
          error:'Subscription bisnis sudah tidak aktif. Silakan pilih paket untuk melanjutkan.'
        });
      const r=await body(req);if(!r.id||!r.date||!r.employeeId)return send(res,400,{ok:false,error:'Data shift tidak lengkap.'});
      if(Number(r.serviceTotal||0)<=0)return send(res,400,{ok:false,error:'Laporan shift wajib memiliki minimal 1 layanan.'});
      if(Number(r.totalPayment||0)<=0)return send(res,400,{ok:false,error:'Total pembayaran laporan shift harus lebih dari Rp0.'});if(u.role==='employee'&&String(r.employeeId)!==String(u.employee_id))return send(res,403,{ok:false,error:'Karyawan hanya boleh menyimpan shift miliknya.'});const re=await employeeFor(r.employeeId,u.business_id);if(!re)return send(res,400,{ok:false,error:'Karyawan tidak terdaftar.'});if(re.active===false)return send(res,400,{ok:false,error:'Karyawan sudah nonaktif.'});const cash=Number(r.cash||0),qris=Number(r.qris||0),opening=Number(r.openingCash||0),expense=Number(r.cashExpense||0),physical=Number(r.physicalCash||0);if([cash,qris,opening,expense,physical].some(n=>!validMoney(n)))return send(res,400,{ok:false,error:'Nilai kas shift tidak valid.'});const expected=opening+cash-expense,difference=physical-expected;if(Math.abs(difference)>0.001)return send(res,400,{ok:false,error:'Selisih kasir harus Rp 0.'});
      await getPool().query(`INSERT INTO wz_shift_reports(id,date,employee_id,employee_name,shift_type,customers,opening_cash,cash,qris,cash_expense,physical_cash,total_payment,expected_cash,cash_difference,service_total,product_total,total_omzet,services,products,note,saved_at,business_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19::jsonb,$20,$21,$22) ON CONFLICT(id) DO UPDATE SET customers=EXCLUDED.customers,opening_cash=EXCLUDED.opening_cash,cash=EXCLUDED.cash,qris=EXCLUDED.qris,cash_expense=EXCLUDED.cash_expense,physical_cash=EXCLUDED.physical_cash,total_payment=EXCLUDED.total_payment,expected_cash=EXCLUDED.expected_cash,cash_difference=EXCLUDED.cash_difference,service_total=EXCLUDED.service_total,product_total=EXCLUDED.product_total,total_omzet=EXCLUDED.total_omzet,services=EXCLUDED.services,products=EXCLUDED.products,note=EXCLUDED.note,saved_at=EXCLUDED.saved_at,updated_at=NOW() WHERE wz_shift_reports.business_id=EXCLUDED.business_id`,[r.id,r.date,r.employeeId,r.employeeName||u.name,r.shiftType||null,Number(r.customers||0),Number(r.openingCash||0),Number(r.cash||0),Number(r.qris||0),Number(r.cashExpense||0),Number(r.physicalCash||0),Number(r.totalPayment||0),Number(r.expectedCash||0),Number(r.cashDifference||0),Number(r.serviceTotal||0),Number(r.productTotal||0),Number(r.totalOmzet||0),JSON.stringify(r.services||[]),JSON.stringify(r.products||[]),r.note||null,r.savedAt||new Date().toISOString(),u.business_id]);
      await getPool().query(
        `UPDATE wz_app_states
         SET data=jsonb_set(
           COALESCE(data,'{}'::jsonb),
           '{notifications}',
           COALESCE(data->'notifications','[]'::jsonb) || $2::jsonb,
           true
         ),
         updated_at=NOW()
         WHERE business_id=$1`,
        [
          u.business_id,
          JSON.stringify([{
            id:`SHIFT_NOTIFY_${r.id}`,
            date:r.date,
            createdAt:new Date().toISOString(),
            title:'Laporan shift tersimpan',
            message:`${r.employeeName||r.employeeId||u.name} menyimpan laporan shift ${r.date}`,
            read:false
          }])
        ]
      );
      await sendShiftPushes({...r,businessId:u.business_id},u.id).catch(()=>{});
      await sendFcmNotification({
        businessId:u.business_id,
        senderId:u.id,
        title:'WZ MANAGE PRO',
        body:`Laporan shift ${r.employeeName||r.employeeId||''} tersedia.`,
        data:{type:'shift_report',reportId:r.id}
      }).catch(e=>{
      });
      return send(res,200,{ok:true,id:r.id});
    }
    if(path==='employees/me' && req.method==='GET'){
      const u=await authUser(req);
      if(!u)return send(res,401,{ok:false,error:'Belum login.'});
      if(!u.employee_id)return send(res,404,{ok:false,error:'Akun belum terhubung ke data karyawan.'});

      const r=await getPool().query(
        `SELECT id,name,role,branch_id AS "branchId",salary,commission,target,attendance,eval,active
         FROM wz_employees
         WHERE id=$1 AND business_id=$2`,
        [u.employee_id,u.business_id]
      );

      if(!r.rowCount)return send(res,404,{ok:false,error:'Data karyawan tidak ditemukan.'});
      return send(res,200,{ok:true,employee:r.rows[0]});
    }

    if(path==='employees' && req.method==='GET'){
      const u=await authUser(req);if(!u||!['owner','manager'].includes(u.role))return send(res,403,{ok:false,error:'Akses ditolak.'});
      const r=await getPool().query(`SELECT e.id,e.name,e.role,e.branch_id AS "branchId",e.salary,e.commission,e.target,e.attendance,e.eval,e.active,(SELECT wu.username FROM wz_users wu WHERE wu.employee_id=e.id AND wu.business_id=e.business_id AND wu.active=true ORDER BY wu.id LIMIT 1) AS username FROM wz_employees e WHERE e.business_id=$1 ORDER BY e.id`,[u.business_id]);
      return send(res,200,{ok:true,employees:r.rows});
    }
    if(path==='employees' && (req.method==='POST'||req.method==='PUT')){
      const u=await authUser(req);if(!u||!['owner','manager'].includes(u.role))return send(res,403,{ok:false,error:'Hanya Owner/Manager yang dapat mengelola karyawan.'});
      const access=await getSubscriptionAccess(u.business_id);
      if(access.isReadOnly)return send(res,403,{ok:false,code:'SUBSCRIPTION_REQUIRED',error:'Subscription bisnis sudah tidak aktif. Silakan pilih paket untuk melanjutkan.'});
      const b=await body(req);const p=getPool();
      const requestedId=String(b.id||'').trim();
      if(req.method==='PUT' && requestedId){
        const ownEmployee=await p.query(
          'SELECT id FROM wz_employees WHERE id=$1 AND business_id=$2',
          [requestedId,u.business_id]
        );
        if(!ownEmployee.rowCount)
          return send(res,404,{ok:false,error:'Karyawan tidak ditemukan pada bisnis ini.'});
      }
      const name=String(b.name||'').trim(),branchId=String(b.branchId||'').trim(),password=String(b.password||'').trim();
      if(!name)return send(res,400,{ok:false,error:'Nama karyawan wajib diisi.'});
      if(!branchId)return send(res,400,{ok:false,error:'Cabang wajib dipilih.'});
      const branchOk=await p.query('SELECT id FROM wz_branches WHERE id=$1 AND business_id=$2 AND active=true',[branchId,u.business_id]);if(!branchOk.rowCount)return send(res,400,{ok:false,error:'Cabang tidak ditemukan pada bisnis ini.'});
      if(!password)return send(res,400,{ok:false,error:'Password login wajib diisi.'});

      if(req.method==='POST'){
        const access=await getSubscriptionAccess(u.business_id);

        if(access.isReadOnly)
          return send(res,403,{
            ok:false,
            code:'SUBSCRIPTION_REQUIRED',
            error:'Subscription bisnis sudah tidak aktif. Silakan pilih paket untuk melanjutkan.'
          });

        if(!access.canCreateEmployee)
          return send(res,403,{
            ok:false,
            code:'EMPLOYEE_LIMIT_REACHED',
            plan:access.plan,
            limit:access.maxEmployees,
            usage:access.activeEmployees,
            error:access.maxEmployees===null
              ?'Tidak dapat menambah karyawan saat ini.'
              :`Batas karyawan paket ${access.plan} adalah ${access.maxEmployees}. Silakan upgrade paket untuk menambah karyawan.`
          });
      }

      const id=String(b.id||'').trim() || `E${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
      const role=String(b.role||'Barber'),salary=Number(b.salary)||0,target=Number(b.target)||0,username=String(b.username||defaultUsername(name)).trim();
      const client=await p.connect();
      try{
        await client.query('BEGIN');
        await client.query(`INSERT INTO wz_employees(id,name,role,branch_id,salary,commission,target,active,business_id,updated_at) VALUES($1,$2,$3,$4,$5,0,$6,true,$7,NOW()) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,role=EXCLUDED.role,branch_id=EXCLUDED.branch_id,salary=EXCLUDED.salary,target=EXCLUDED.target,updated_at=NOW() WHERE wz_employees.business_id=EXCLUDED.business_id`,[id,name,role,branchId,salary,target,u.business_id]);
        const existing=await client.query('SELECT id FROM wz_users WHERE employee_id=$1 AND business_id=$2',[id,u.business_id]);
        const ph=hashPassword(password);
        if(existing.rowCount) await client.query('UPDATE wz_users SET username=$1,password_hash=$2,name=$3,role=\'employee\',active=true,updated_at=NOW() WHERE employee_id=$4 AND business_id=$5',[username,ph,name,id,u.business_id]);
        else await client.query('INSERT INTO wz_users(username,password_hash,role,name,employee_id,business_id) VALUES($1,$2,\'employee\',$3,$4,$5)',[username,ph,name,id,u.business_id]);
        await client.query('COMMIT');
      }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
      const r=await p.query(`SELECT id,name,role,branch_id AS "branchId",salary,commission,target,attendance,eval,active FROM wz_employees WHERE id=$1 AND business_id=$2`,[id,u.business_id]);
      return send(res,200,{ok:true,employee:r.rows[0],username});
    }
    if(path==='employees' && req.method==='DELETE'){
      const u=await authUser(req);if(!u||!['owner','manager'].includes(u.role))return send(res,403,{ok:false,error:'Akses ditolak.'});
      const access=await getSubscriptionAccess(u.business_id);
      if(access.isReadOnly)return send(res,403,{ok:false,code:'SUBSCRIPTION_REQUIRED',error:'Subscription bisnis sudah tidak aktif. Silakan pilih paket untuk melanjutkan.'});
      const id=new URL(req.url,'http://localhost').searchParams.get('id');if(!id)return send(res,400,{ok:false,error:'ID karyawan wajib diisi.'});
      const client=await getPool().connect();try{await client.query('BEGIN');await client.query('DELETE FROM wz_users WHERE employee_id=$1 AND business_id=$2',[id,u.business_id]);const r=await client.query('DELETE FROM wz_employees WHERE id=$1 AND business_id=$2 RETURNING id',[id,u.business_id]);if(!r.rowCount){await client.query('ROLLBACK');return send(res,404,{ok:false,error:'Karyawan tidak ditemukan.'});}await client.query('COMMIT');return send(res,200,{ok:true});}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()};
    }
    if(path==='payroll/settings' && req.method==='GET'){
      const u=await authUser(req);
      if(!u)return send(res,401,{ok:false,error:'Belum login.'});
      if(!['owner','manager'].includes(u.role))
        return send(res,403,{ok:false,error:'Hanya Owner/Manager yang dapat mengatur sistem upah.'});

      const p=getPool();
      let r=await p.query(
        `SELECT id,business_id AS "businessId",payroll_type AS "payrollType",
                base_salary AS "baseSalary",target_amount AS "targetAmount",
                period_start_day AS "periodStartDay",period_end_day AS "periodEndDay",
                service_rules AS "serviceRules"
         FROM wz_payroll_settings
         WHERE business_id=$1`,
        [u.business_id]
      );

      if(!r.rowCount){
        r=await p.query(
          `INSERT INTO wz_payroll_settings
             (business_id,payroll_type,base_salary,target_amount,period_start_day,period_end_day,service_rules)
           VALUES($1,'BASE_PLUS_SERVICE_BONUS',0,0,1,31,'{}'::jsonb)
           RETURNING id,business_id AS "businessId",payroll_type AS "payrollType",
                     base_salary AS "baseSalary",target_amount AS "targetAmount",
                     period_start_day AS "periodStartDay",period_end_day AS "periodEndDay",
                     service_rules AS "serviceRules"`,
          [u.business_id]
        );
      }

      return send(res,200,{ok:true,settings:r.rows[0]});
    }

    if(path==='payroll/settings' && req.method==='POST'){
      const u=await authUser(req);
      if(!u)return send(res,401,{ok:false,error:'Belum login.'});
      if(!['owner','manager'].includes(u.role))
        return send(res,403,{ok:false,error:'Hanya Owner/Manager yang dapat mengatur sistem upah.'});
      const access=await getSubscriptionAccess(u.business_id);
      if(access.isReadOnly)return send(res,403,{ok:false,code:'SUBSCRIPTION_REQUIRED',error:'Subscription bisnis sudah tidak aktif. Silakan pilih paket untuk melanjutkan.'});

      const b=await body(req);
      const payrollType=String(b.payrollType||'BASE_PLUS_SERVICE_BONUS').trim();
      const baseSalary=Number(b.baseSalary);
      const targetAmount=Number(b.targetAmount);
      const periodStartDay=Number(b.periodStartDay);
      const periodEndDay=Number(b.periodEndDay);
      const serviceRules=b.serviceRules && typeof b.serviceRules==='object' && !Array.isArray(b.serviceRules)
        ? b.serviceRules
        : {};

      if(!Number.isFinite(baseSalary)||baseSalary<0)
        return send(res,400,{ok:false,error:'Gaji pokok tidak valid.'});
      if(!Number.isFinite(targetAmount)||targetAmount<0)
        return send(res,400,{ok:false,error:'Target tidak valid.'});
      if(!Number.isInteger(periodStartDay)||periodStartDay<1||periodStartDay>31)
        return send(res,400,{ok:false,error:'Tanggal mulai periode tidak valid.'});
      if(!Number.isInteger(periodEndDay)||periodEndDay<1||periodEndDay>31)
        return send(res,400,{ok:false,error:'Tanggal akhir periode tidak valid.'});

      const p=getPool();
      const r=await p.query(
        `INSERT INTO wz_payroll_settings
           (business_id,payroll_type,base_salary,target_amount,period_start_day,period_end_day,service_rules,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,NOW())
         ON CONFLICT(business_id)
         DO UPDATE SET
           payroll_type=EXCLUDED.payroll_type,
           base_salary=EXCLUDED.base_salary,
           target_amount=EXCLUDED.target_amount,
           period_start_day=EXCLUDED.period_start_day,
           period_end_day=EXCLUDED.period_end_day,
           service_rules=EXCLUDED.service_rules,
           updated_at=NOW()
         RETURNING id,business_id AS "businessId",payroll_type AS "payrollType",
                   base_salary AS "baseSalary",target_amount AS "targetAmount",
                   period_start_day AS "periodStartDay",period_end_day AS "periodEndDay",
                   service_rules AS "serviceRules"`,
        [
          u.business_id,
          payrollType,
          baseSalary,
          targetAmount,
          periodStartDay,
          periodEndDay,
          JSON.stringify(serviceRules)
        ]
      );

      return send(res,200,{ok:true,settings:r.rows[0]});
    }

    if(path==='owner-forum/messages'){
      const u=await authUser(req);
      if(!u)return send(res,401,{ok:false,error:'Belum login.'});
      if(u.role!=='owner')return send(res,403,{ok:false,error:'Akses hanya untuk Owner.'});
      if(!u.business_id)return send(res,403,{ok:false,error:'Business tidak tersedia.'});

      const pool=getPool();

      if(req.method==='GET'){
        const r=await pool.query(`
          SELECT
            m.id,
            m.message,
            m.message_type AS "messageType",
            m.sticker_id AS "stickerId",
            m.reply_to_id AS "replyToId",
            m.created_at AS "createdAt",
            COALESCE(m.sender_user_id,m.sender_admin_id) AS "senderId",
            COALESCE(u.name,a.display_name,'Owner') AS "senderName",
            COALESCE(p.avatar,'') AS "senderAvatar",
            m.sender_role AS "senderRole"
          FROM wz_owner_forum_messages m
          LEFT JOIN wz_users u ON u.id=m.sender_user_id
          LEFT JOIN wz_platform_admins a ON a.id=m.sender_admin_id
          LEFT JOIN wz_user_profiles p ON p.user_id=u.id
          WHERE m.business_id=$1
            AND (m.sender_user_id IS NOT NULL OR m.sender_admin_id IS NOT NULL)
          ORDER BY m.created_at ASC
          LIMIT 200
        `,[u.business_id]);

        return send(res,200,{ok:true,businessId:u.business_id,messages:r.rows});
      }

      if(req.method==='POST'){
        const b=await body(req);
        const message=String(b.message||'').trim();
        const messageType=String(b.messageType||'text');
        const stickerId=b.stickerId==null?null:String(b.stickerId);
        const replyToId=b.replyToId==null?null:Number(b.replyToId);

        if(!['text','sticker'].includes(messageType))
          return send(res,400,{ok:false,error:'Jenis pesan tidak valid.'});
        if(messageType==='text' && !message)
          return send(res,400,{ok:false,error:'Pesan tidak boleh kosong.'});
        if(messageType==='sticker' && !stickerId)
          return send(res,400,{ok:false,error:'Sticker tidak valid.'});
        if(replyToId!==null && (!Number.isInteger(replyToId)||replyToId<1))
          return send(res,400,{ok:false,error:'Reply tidak valid.'});

        if(replyToId!==null){
          const replyCheck=await pool.query(
            'SELECT id FROM wz_owner_forum_messages WHERE id=$1 AND business_id=$2',
            [replyToId,u.business_id]
          );
          if(!replyCheck.rowCount)
            return send(res,400,{ok:false,error:'Pesan yang dibalas tidak ditemukan.'});
        }

        const r=await pool.query(`
          INSERT INTO wz_owner_forum_messages
            (sender_user_id,sender_role,business_id,message,message_type,sticker_id,reply_to_id)
          VALUES
            ($1,'owner',$2,$3,$4,$5,$6)
          RETURNING
            id,
            message,
            message_type AS "messageType",
            sticker_id AS "stickerId",
            reply_to_id AS "replyToId",
            created_at AS "createdAt",
            sender_user_id AS "senderId",
            sender_role AS "senderRole"
        `,[u.id,u.business_id,message,messageType,stickerId,replyToId]);

        await pool.query(
          `INSERT INTO wz_admin_notifications(type,title,message,business_id,target_type,target_id)
           VALUES('owner_message','Pesan Owner baru',$1,$2,'business',$2)`,
          [`Owner ${u.name} mengirim pesan baru`,u.business_id]
        );

        return send(res,201,{
          ok:true,
          message:{...r.rows[0],senderName:u.name,senderAvatar:'',senderRole:'owner'}
        });
      }

      return send(res,405,{ok:false,error:'Method tidak didukung.'});
    }

    if(path==='owner-forum/reactions'){
      const u=await authUser(req);
      if(!u)return send(res,401,{ok:false,error:'Belum login.'});
      if(u.role!=='owner')return send(res,403,{ok:false,error:'Akses hanya untuk Owner.'});

      if(req.method!=='POST')
        return send(res,405,{ok:false,error:'Method tidak didukung.'});

      const b=await body(req);
      const messageId=Number(b.messageId);
      const reaction=String(b.reaction||'').trim();

      if(!Number.isInteger(messageId)||messageId<1)
        return send(res,400,{ok:false,error:'Pesan tidak valid.'});

      if(!reaction)
        return send(res,400,{ok:false,error:'Reaksi tidak valid.'});

      const allowedReactions=['👍','❤️','😂','😮','😢','🙏'];

      if(!allowedReactions.includes(reaction))
        return send(res,400,{ok:false,error:'Reaksi tidak didukung.'});

      const pool=getPool();

      const messageCheck=await pool.query(
        'SELECT m.id FROM wz_owner_forum_messages m WHERE m.id=$1 AND m.business_id=$2',
        [messageId,u.business_id]
      );

      if(!messageCheck.rowCount)
        return send(res,404,{ok:false,error:'Pesan tidak ditemukan.'});

      const existing=await pool.query(`
        SELECT id
        FROM wz_owner_forum_reactions
        WHERE message_id=$1 AND user_id=$2 AND reaction=$3
      `,[messageId,u.id,reaction]);

      if(existing.rowCount){
        await pool.query(
          `DELETE FROM wz_owner_forum_reactions WHERE id=$1`,
          [existing.rows[0].id]
        );
        return send(res,200,{ok:true,reacted:false});
      }

      await pool.query(`
        INSERT INTO wz_owner_forum_reactions(message_id,user_id,reaction)
        VALUES($1,$2,$3)
        ON CONFLICT(message_id,user_id,reaction) DO NOTHING
      `,[messageId,u.id,reaction]);

      return send(res,200,{ok:true,reacted:true});
    }

    return send(res,404,{ok:false,error:'Endpoint tidak ditemukan.'});
  }catch(e){
    console.error(e);
    const status=Number(e?.statusCode);
    return send(res,status>=400&&status<600?status:500,{ok:false,error:safeServerError(e)});
  }
}
module.exports=handler;
