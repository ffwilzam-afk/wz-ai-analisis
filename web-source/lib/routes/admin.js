/* WZ MANAGE PRO V11 — Platform Admin API.
   Security boundary: this module never trusts a frontend role or business_id.
   Admin sessions are separate HttpOnly cookies backed by wz_platform_admins. */
const { URL } = require('url');

function queryOf(req){
  return new URL(req.url||'/', 'http://wz.local').searchParams;
}
function intParam(value,fallback,min,max){
  const n=Number(value);
  return Number.isInteger(n)&&n>=min&&n<=max?n:fallback;
}
function text(value,max=200){return String(value??'').trim().slice(0,max);}
function pageParams(q){
  const page=intParam(q.get('page'),1,1,100000);
  const limit=intParam(q.get('limit'),25,1,100);
  return {page,limit,offset:(page-1)*limit};
}
function cookieValue(req,name){
  const match=String(req.headers.cookie||'').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match?decodeURIComponent(match[1]):'';
}
async function adminAuth(ctx,req){
  const raw=cookieValue(req,'wz_admin_session');
  if(!raw)return null;
  const r=await ctx.getPool().query(
    `SELECT a.id,a.username,a.email,a.display_name,a.active
     FROM wz_platform_admin_sessions s
     JOIN wz_platform_admins a ON a.id=s.admin_id
     WHERE s.token_hash=$1 AND s.expires_at>NOW() AND a.active=true`,
    [ctx.tokenHash(raw)]
  );
  return r.rows[0]||null;
}
async function requireAdmin(ctx,req,res,action){
  const admin=await adminAuth(ctx,req);
  if(!admin){ctx.send(res,401,{ok:false,error:'Admin login diperlukan.'});return null}
  if(action)await audit(ctx,admin,action,{targetType:'admin_session',targetId:String(admin.id)});
  return admin;
}
async function audit(ctx,admin,action,detail={}){
  const metadata=detail.metadata&&typeof detail.metadata==='object'?detail.metadata:{};
  await ctx.getPool().query(
    `INSERT INTO wz_admin_audit_logs(admin_id,action,target_type,target_id,business_id,metadata)
     VALUES($1,$2,$3,$4,$5,$6::jsonb)`,
    [admin.id,action,detail.targetType||null,detail.targetId||null,detail.businessId||null,JSON.stringify(metadata)]
  );
}
async function adminBusiness(ctx,res,businessId){
  const r=await ctx.getPool().query('SELECT id,name,active,created_at AS "createdAt" FROM wz_businesses WHERE id=$1',[businessId]);
  if(!r.rowCount){ctx.send(res,404,{ok:false,error:'Business tidak ditemukan.'});return null}
  return r.rows[0];
}
function page(rows,total,params){
  return {ok:true,rows,total,page:params.page,limit:params.limit,pages:Math.ceil(total/params.limit)};
}
function statusFilter(value){
  const v=text(value,20).toUpperCase();
  return ['ACTIVE','TRIAL','EXPIRED','PENDING','CANCELLED','FAILED'].includes(v)?v:'';
}

async function ownerForumRoutes(ctx,req,res,path){
  const { getPool, send, body, authUser } = ctx;
  const user=await authUser(req);
  if(!user)return send(res,401,{ok:false,error:'Belum login.'}),true;
  if(user.role!=='owner')return send(res,403,{ok:false,error:'Akses hanya untuk Owner.'}),true;
  const pool=getPool();
  if(path==='owner-forum/messages'){
    if(req.method==='GET'){
      const r=await pool.query(`SELECT m.id,m.message,m.message_type AS "messageType",m.sticker_id AS "stickerId",m.reply_to_id AS "replyToId",m.created_at AS "createdAt",COALESCE(m.sender_user_id,m.sender_admin_id) AS "senderId",COALESCE(u.name,a.display_name,'Owner') AS "senderName",COALESCE(b.name,'') AS "businessName",COALESCE(p.avatar,'') AS "senderAvatar",m.sender_role AS "senderRole" FROM wz_owner_forum_messages m LEFT JOIN wz_users u ON u.id=m.sender_user_id LEFT JOIN wz_platform_admins a ON a.id=m.sender_admin_id LEFT JOIN wz_businesses b ON b.id=m.business_id LEFT JOIN wz_user_profiles p ON p.user_id=u.id WHERE m.sender_user_id IS NOT NULL OR m.sender_admin_id IS NOT NULL ORDER BY m.created_at ASC LIMIT 200`);
      return send(res,200,{ok:true,scope:'global',messages:r.rows}),true;
    }
    if(req.method==='POST'){
      const b=await body(req),message=String(b.message||'').trim(),messageType=String(b.messageType||'text'),stickerId=b.stickerId==null?null:String(b.stickerId),replyToId=b.replyToId==null?null:Number(b.replyToId);
      if(!['text','sticker'].includes(messageType))return send(res,400,{ok:false,error:'Jenis pesan tidak valid.'}),true;
      if(messageType==='text'&&!message)return send(res,400,{ok:false,error:'Pesan tidak boleh kosong.'}),true;
      if(messageType==='sticker'&&!stickerId)return send(res,400,{ok:false,error:'Sticker tidak valid.'}),true;
      if(replyToId!==null&&(!Number.isInteger(replyToId)||replyToId<1))return send(res,400,{ok:false,error:'Reply tidak valid.'}),true;
      if(replyToId!==null&&!(await pool.query('SELECT id FROM wz_owner_forum_messages WHERE id=$1',[replyToId])).rowCount)return send(res,400,{ok:false,error:'Pesan yang dibalas tidak ditemukan.'}),true;
      const r=await pool.query(`INSERT INTO wz_owner_forum_messages(sender_user_id,sender_role,business_id,message,message_type,sticker_id,reply_to_id) VALUES($1,'owner',$2,$3,$4,$5,$6) RETURNING id,message,message_type AS "messageType",sticker_id AS "stickerId",reply_to_id AS "replyToId",created_at AS "createdAt",sender_user_id AS "senderId",sender_role AS "senderRole"`,[user.id,user.business_id||null,message,messageType,stickerId,replyToId]);
      await pool.query(`INSERT INTO wz_admin_notifications(type,title,message,business_id,target_type,target_id) VALUES('owner_message','Pesan Owner baru',$1,$2,'business',$2)`,[`Owner ${user.name} mengirim pesan baru`,user.business_id||null]);
      return send(res,201,{ok:true,scope:'global',message:{...r.rows[0],senderName:user.name,senderBusinessName:'',senderAvatar:'',senderRole:'owner'}}),true;
    }
    return send(res,405,{ok:false,error:'Method tidak didukung.'}),true;
  }
  if(path==='owner-forum/reactions'&&req.method==='POST'){
    const b=await body(req),messageId=Number(b.messageId),reaction=String(b.reaction||'').trim();
    if(!Number.isInteger(messageId)||messageId<1)return send(res,400,{ok:false,error:'Pesan tidak valid.'}),true;
    if(!['👍','❤️','😂','😮','😢','🙏'].includes(reaction))return send(res,400,{ok:false,error:'Reaksi tidak valid.'}),true;
    if(!(await pool.query('SELECT id FROM wz_owner_forum_messages WHERE id=$1',[messageId])).rowCount)return send(res,404,{ok:false,error:'Pesan tidak ditemukan.'}),true;
    const existing=await pool.query('SELECT id FROM wz_owner_forum_reactions WHERE message_id=$1 AND user_id=$2 AND reaction=$3',[messageId,user.id,reaction]);
    if(existing.rowCount){await pool.query('DELETE FROM wz_owner_forum_reactions WHERE id=$1',[existing.rows[0].id]);return send(res,200,{ok:true,reacted:false}),true}
    await pool.query('INSERT INTO wz_owner_forum_reactions(message_id,user_id,reaction) VALUES($1,$2,$3) ON CONFLICT(message_id,user_id,reaction) DO NOTHING',[messageId,user.id,reaction]);
    return send(res,200,{ok:true,reacted:true}),true;
  }
  return send(res,404,{ok:false,error:'Endpoint forum tidak ditemukan.'}),true;
}

module.exports=async function adminRoutes(ctx,req,res,path){
  if(path.startsWith('owner-forum/'))return ownerForumRoutes(ctx,req,res,path);
  if(!path.startsWith('admin/'))return false;
  const q=queryOf(req);

  if(path==='admin/login' && req.method==='POST'){
    const b=await ctx.body(req),username=text(b.username||b.email,160).toLowerCase(),password=String(b.password||'');
    if(!username||password.length<1||password.length>256)return ctx.send(res,400,{ok:false,error:'Username dan password wajib diisi.'}),true;
    const p=ctx.getPool();
    const r=await p.query(
      `SELECT id,username,email,display_name,password_hash,active
       FROM wz_platform_admins
       WHERE active=true AND (LOWER(username)=$1 OR LOWER(COALESCE(email,''))=$1)`,
      [username]
    );
    const admin=r.rows[0];
    if(!admin||!ctx.verifyPassword(password,admin.password_hash)){
      await ctx.getPool().query('DELETE FROM wz_platform_admin_sessions WHERE expires_at<=NOW()');
      return ctx.send(res,401,{ok:false,error:'Username atau password Admin salah.'}),true;
    }
    const raw=ctx.token();
    await p.query('DELETE FROM wz_platform_admin_sessions WHERE expires_at<=NOW()');
    await p.query('INSERT INTO wz_platform_admin_sessions(token_hash,admin_id,expires_at) VALUES($1,$2,NOW()+INTERVAL \'8 hours\')',[ctx.tokenHash(raw),admin.id]);
    await p.query('UPDATE wz_platform_admins SET last_login_at=NOW() WHERE id=$1',[admin.id]);
    await audit(ctx,admin,'admin.login',{targetType:'admin',targetId:String(admin.id)});
    return ctx.send(res,200,{ok:true,admin:{id:admin.id,username:admin.username,email:admin.email,displayName:admin.display_name}},{'Set-Cookie':ctx.cookie('wz_admin_session',raw,60*60*8)}),true;
  }

  if(path==='admin/logout' && req.method==='POST'){
    const admin=await adminAuth(ctx,req);
    const raw=cookieValue(req,'wz_admin_session');
    if(raw)await ctx.getPool().query('DELETE FROM wz_platform_admin_sessions WHERE token_hash=$1',[ctx.tokenHash(raw)]);
    if(admin)await audit(ctx,admin,'admin.logout',{targetType:'admin',targetId:String(admin.id)});
    return ctx.send(res,200,{ok:true},{'Set-Cookie':ctx.cookie('wz_admin_session','',0)}),true;
  }

  if(path==='admin/me' && req.method==='GET'){
    const admin=await requireAdmin(ctx,req,res);if(!admin)return true;
    return ctx.send(res,200,{ok:true,admin}),true;
  }

  const admin=await requireAdmin(ctx,req,res);
  if(!admin)return true;
  const p=ctx.getPool();

  if(path==='admin/dashboard' && req.method==='GET'){
    const [counts,plans,payments,growth]=await Promise.all([
      p.query(`SELECT
        (SELECT COUNT(*)::int FROM wz_businesses) AS businesses,
        (SELECT COUNT(*)::int FROM wz_businesses b JOIN wz_subscriptions s ON s.business_id=b.id WHERE b.active=true AND s.status='ACTIVE') AS active_businesses,
        (SELECT COUNT(*)::int FROM wz_subscriptions WHERE plan='TRIAL' AND status='ACTIVE') AS trial_businesses,
        (SELECT COUNT(*)::int FROM wz_subscriptions WHERE status<>'ACTIVE' OR current_period_end<NOW()) AS expired_businesses,
        (SELECT COUNT(*)::int FROM wz_users WHERE role='owner') AS owners,
        (SELECT COUNT(*)::int FROM wz_users WHERE active=true) AS users,
        (SELECT COUNT(*)::int FROM wz_branches) AS branches,
        (SELECT COUNT(*)::int FROM wz_employees WHERE role<>'Owner') AS employees,
        (SELECT COUNT(*)::int FROM wz_subscriptions WHERE status='ACTIVE') AS active_subscriptions,
        (SELECT COUNT(*)::int FROM wz_subscriptions WHERE status='ACTIVE' AND current_period_end BETWEEN NOW() AND NOW()+INTERVAL '30 days') AS expiring_subscriptions,
        (SELECT COUNT(*)::int FROM wz_subscriptions WHERE status<>'ACTIVE' OR current_period_end<NOW()) AS expired_subscriptions,
        (SELECT COUNT(*)::int FROM wz_subscription_orders) AS payment_orders,
        (SELECT COALESCE(SUM(amount),0) FROM wz_subscription_orders WHERE status='PAID') AS subscription_revenue,
        (SELECT COUNT(*)::int FROM wz_subscription_orders WHERE status='PENDING') AS pending_payments,
        (SELECT COUNT(*)::int FROM wz_subscription_orders WHERE status='PAID') AS successful_payments,
        (SELECT COUNT(*)::int FROM wz_subscription_orders WHERE status='FAILED') AS failed_payments`),
      p.query(`SELECT plan,COUNT(*)::int AS count FROM wz_subscriptions GROUP BY plan ORDER BY plan`),
      p.query(`SELECT status,COUNT(*)::int AS count,COALESCE(SUM(amount),0) AS amount FROM wz_subscription_orders GROUP BY status ORDER BY status`),
      p.query(`SELECT to_char(date_trunc('month',created_at),'YYYY-MM') AS month,COUNT(*)::int AS count FROM wz_businesses WHERE created_at>=NOW()-INTERVAL '6 months' GROUP BY 1 ORDER BY 1`)
    ]);
    const attention=await p.query(`SELECT b.id,b.name,s.status,s.plan,s.current_period_end AS "currentPeriodEnd" FROM wz_businesses b JOIN wz_subscriptions s ON s.business_id=b.id WHERE s.status<>'ACTIVE' OR s.current_period_end<NOW() ORDER BY s.current_period_end NULLS FIRST LIMIT 20`);
    return ctx.send(res,200,{ok:true,counts:counts.rows[0],plans:plans.rows,payments:payments.rows,growth:growth.rows,attention:attention.rows}),true;
  }

  if(path==='admin/businesses' && req.method==='GET'){
    const {limit,offset,page:pageNo}=pageParams(q),search=text(q.get('search'),120),status=statusFilter(q.get('status')),plan=text(q.get('plan'),30).toUpperCase();
    const r=await p.query(`SELECT b.id,b.name,b.active,b.created_at AS "createdAt",s.plan,s.status AS "subscriptionStatus",s.current_period_start AS "currentPeriodStart",s.current_period_end AS "currentPeriodEnd",
      (SELECT COUNT(*)::int FROM wz_users u WHERE u.business_id=b.id AND u.role='owner') AS owners,
      (SELECT COUNT(*)::int FROM wz_branches br WHERE br.business_id=b.id) AS branches,
      (SELECT COUNT(*)::int FROM wz_employees e WHERE e.business_id=b.id AND e.role<>'Owner') AS employees
      FROM wz_businesses b LEFT JOIN wz_subscriptions s ON s.business_id=b.id
      WHERE ($1='' OR b.id ILIKE '%'||$1||'%' OR b.name ILIKE '%'||$1||'%' OR EXISTS(SELECT 1 FROM wz_users u WHERE u.business_id=b.id AND u.name ILIKE '%'||$1||'%'))
        AND ($2='' OR (CASE WHEN s.status='ACTIVE' AND s.current_period_end<NOW() THEN 'EXPIRED' ELSE s.status END)=$2)
        AND ($3='' OR s.plan=$3)
      ORDER BY b.created_at DESC LIMIT $4 OFFSET $5`,[search,status,plan,limit,offset]);
    const count=await p.query(`SELECT COUNT(*)::int AS total FROM wz_businesses b LEFT JOIN wz_subscriptions s ON s.business_id=b.id WHERE ($1='' OR b.id ILIKE '%'||$1||'%' OR b.name ILIKE '%'||$1||'%' OR EXISTS(SELECT 1 FROM wz_users u WHERE u.business_id=b.id AND u.name ILIKE '%'||$1||'%')) AND ($2='' OR (CASE WHEN s.status='ACTIVE' AND s.current_period_end<NOW() THEN 'EXPIRED' ELSE s.status END)=$2) AND ($3='' OR s.plan=$3)`,[search,status,plan]);
    return ctx.send(res,200,page(r.rows,count.rows[0].total,{page:pageNo,limit}),true);
  }

  const businessMatch=path.match(/^admin\/businesses\/([^/]+)$/);
  if(businessMatch && req.method==='GET'){
    const businessId=decodeURIComponent(businessMatch[1]),business=await adminBusiness(ctx,res,businessId);if(!business)return true;
    const [subscription,owners,branches,employees,orders]=await Promise.all([
      p.query('SELECT plan,status,billing_period AS "billingPeriod",trial_started_at AS "trialStartedAt",trial_ends_at AS "trialEndsAt",current_period_start AS "currentPeriodStart",current_period_end AS "currentPeriodEnd",payment_provider AS "paymentProvider" FROM wz_subscriptions WHERE business_id=$1',[businessId]),
      p.query(`SELECT u.id,u.username,u.name,u.role,u.active,u.created_at AS "createdAt",COALESCE(pr.phone,'') AS phone,''::text AS email FROM wz_users u LEFT JOIN wz_user_profiles pr ON pr.user_id=u.id WHERE u.business_id=$1 ORDER BY u.role='owner' DESC,u.name`,[businessId]),
      p.query('SELECT id,name,address,active FROM wz_branches WHERE business_id=$1 ORDER BY name',[businessId]),
      p.query(`SELECT id,name,role,branch_id AS "branchId",active FROM wz_employees WHERE business_id=$1 ORDER BY name`,[businessId]),
      p.query('SELECT order_id AS "orderId",plan,billing_period AS "billingPeriod",amount,status,payment_provider AS "paymentProvider",created_at AS "createdAt",paid_at AS "paidAt" FROM wz_subscription_orders WHERE business_id=$1 ORDER BY created_at DESC LIMIT 20',[businessId])
    ]);
    await audit(ctx,admin,'admin.business.view',{targetType:'business',targetId:businessId,businessId});
    return ctx.send(res,200,{ok:true,business,subscription:subscription.rows[0]||null,owners:owners.rows,branches:branches.rows,employees:employees.rows,orders:orders.rows}),true;
  }

  if(path==='admin/users' && req.method==='GET'){
    const {limit,offset,page:pageNo}=pageParams(q),search=text(q.get('search'),120),status=text(q.get('status'),20),role=text(q.get('role'),30);
    const r=await p.query(`SELECT u.id,u.username,u.name,u.role,u.active,u.created_at AS "createdAt",(SELECT MAX(s.created_at) FROM wz_sessions s WHERE s.user_id=u.id) AS "lastActivityAt",u.business_id AS "businessId",b.name AS "businessName",s.plan,s.status AS "subscriptionStatus",s.current_period_end AS "currentPeriodEnd" FROM wz_users u LEFT JOIN wz_businesses b ON b.id=u.business_id LEFT JOIN wz_subscriptions s ON s.business_id=u.business_id WHERE ($1='' OR u.username ILIKE '%'||$1||'%' OR u.name ILIKE '%'||$1||'%' OR b.name ILIKE '%'||$1||'%') AND ($2='' OR CASE WHEN u.active THEN 'ACTIVE' ELSE 'SUSPENDED' END=$2) AND ($3='' OR u.role=$3) ORDER BY u.created_at DESC LIMIT $4 OFFSET $5`,[search,status,role,limit,offset]);
    const count=await p.query(`SELECT COUNT(*)::int AS total FROM wz_users u LEFT JOIN wz_businesses b ON b.id=u.business_id WHERE ($1='' OR u.username ILIKE '%'||$1||'%' OR u.name ILIKE '%'||$1||'%' OR b.name ILIKE '%'||$1||'%') AND ($2='' OR CASE WHEN u.active THEN 'ACTIVE' ELSE 'SUSPENDED' END=$2) AND ($3='' OR u.role=$3)`,[search,status,role]);
    return ctx.send(res,200,page(r.rows,count.rows[0].total,{page:pageNo,limit}),true);
  }

  const userStatusMatch=path.match(/^admin\/users\/([^/]+)\/status$/);
  if(userStatusMatch && (req.method==='PATCH'||req.method==='POST')){
    const userId=Number(userStatusMatch[1]),b=await ctx.body(req);
    if(!Number.isInteger(userId)||userId<1||typeof b.active!=='boolean')return ctx.send(res,400,{ok:false,error:'Status akun tidak valid.'}),true;
    const r=await p.query('UPDATE wz_users SET active=$1 WHERE id=$2 RETURNING id,business_id AS "businessId",username,name,active',[b.active,userId]);
    if(!r.rowCount)return ctx.send(res,404,{ok:false,error:'User tidak ditemukan.'}),true;
    await audit(ctx,admin,b.active?'admin.user.activate':'admin.user.suspend',{targetType:'user',targetId:String(userId),businessId:r.rows[0].businessId,metadata:{username:r.rows[0].username}});
    return ctx.send(res,200,{ok:true,user:r.rows[0]}),true;
  }

  if(path==='admin/subscriptions' && req.method==='GET'){
    const {limit,offset,page:pageNo}=pageParams(q),status=statusFilter(q.get('status')),plan=text(q.get('plan'),30).toUpperCase(),search=text(q.get('search'),120);
    const r=await p.query(`SELECT s.business_id AS "businessId",b.name AS "businessName",u.name AS owner,s.plan,s.status,CASE WHEN s.status='ACTIVE' AND s.current_period_end<NOW() THEN 'EXPIRED' WHEN s.status<>'ACTIVE' AND o.status='PENDING' THEN 'PENDING' WHEN s.status<>'ACTIVE' AND o.status='FAILED' THEN 'FAILED' ELSE s.status END AS "subscriptionStatus",s.billing_period AS "billingPeriod",s.trial_started_at AS "trialStartedAt",s.current_period_start AS "currentPeriodStart",s.current_period_end AS "currentPeriodEnd",o.order_id AS "orderId",o.status AS "paymentStatus",o.amount,o.payment_provider AS "paymentProvider",o.external_id AS "paymentReference",o.paid_at AS "paidAt",o.created_at AS "orderCreatedAt" FROM wz_subscriptions s JOIN wz_businesses b ON b.id=s.business_id LEFT JOIN LATERAL(SELECT * FROM wz_users x WHERE x.business_id=s.business_id AND x.role='owner' ORDER BY x.id LIMIT 1)u ON true LEFT JOIN LATERAL(SELECT * FROM wz_subscription_orders x WHERE x.business_id=s.business_id ORDER BY x.created_at DESC LIMIT 1)o ON true WHERE ($1='' OR b.id ILIKE '%'||$1||'%' OR b.name ILIKE '%'||$1||'%' OR u.name ILIKE '%'||$1||'%') AND ($2='' OR (CASE WHEN s.status='ACTIVE' AND s.current_period_end<NOW() THEN 'EXPIRED' WHEN s.status<>'ACTIVE' AND o.status='PENDING' THEN 'PENDING' WHEN s.status<>'ACTIVE' AND o.status='FAILED' THEN 'FAILED' ELSE s.status END)=$2) AND ($3='' OR s.plan=$3) ORDER BY s.current_period_end NULLS FIRST LIMIT $4 OFFSET $5`,[search,status,plan,limit,offset]);
    const count=await p.query(`SELECT COUNT(*)::int AS total FROM wz_subscriptions s JOIN wz_businesses b ON b.id=s.business_id LEFT JOIN LATERAL(SELECT * FROM wz_users x WHERE x.business_id=s.business_id AND x.role='owner' ORDER BY x.id LIMIT 1)u ON true LEFT JOIN LATERAL(SELECT * FROM wz_subscription_orders x WHERE x.business_id=s.business_id ORDER BY x.created_at DESC LIMIT 1)o ON true WHERE ($1='' OR b.id ILIKE '%'||$1||'%' OR b.name ILIKE '%'||$1||'%' OR u.name ILIKE '%'||$1||'%') AND ($2='' OR (CASE WHEN s.status='ACTIVE' AND s.current_period_end<NOW() THEN 'EXPIRED' WHEN s.status<>'ACTIVE' AND o.status='PENDING' THEN 'PENDING' WHEN s.status<>'ACTIVE' AND o.status='FAILED' THEN 'FAILED' ELSE s.status END)=$2) AND ($3='' OR s.plan=$3)`,[search,status,plan]);
    return ctx.send(res,200,page(r.rows,count.rows[0].total,{page:pageNo,limit}),true);
  }

  if(path==='admin/plans' && req.method==='GET'){
    const r=await p.query('SELECT plan,duration_days AS "durationDays",max_branches AS "maxBranches",max_employees AS "maxEmployees",price_monthly AS "priceMonthly",price_yearly AS "priceYearly",active,updated_at AS "updatedAt" FROM wz_subscription_plans ORDER BY plan');
    return ctx.send(res,200,{ok:true,plans:r.rows}),true;
  }

  const planMatch=path.match(/^admin\/plans\/([A-Z_]+)$/);
  if(planMatch && (req.method==='PATCH'||req.method==='POST')){
    const plan=planMatch[1];if(!['TRIAL','PRO','PRO_MAX'].includes(plan))return ctx.send(res,400,{ok:false,error:'Paket tidak valid.'}),true;
    const b=await ctx.body(req),numbers=['durationDays','maxBranches','maxEmployees','priceMonthly','priceYearly'];
    const sets=[],values=[];for(const key of numbers){if(Object.prototype.hasOwnProperty.call(b,key)){const value=b[key]===null?null:Number(b[key]);if(value!==null&&(!Number.isFinite(value)||value<0))return ctx.send(res,400,{ok:false,error:'Nilai paket tidak valid.'}),true;sets.push(`${key==='durationDays'?'duration_days':key==='maxBranches'?'max_branches':key==='maxEmployees'?'max_employees':key==='priceMonthly'?'price_monthly':'price_yearly'}=$${values.length+1}`);values.push(value);}}
    if(typeof b.active==='boolean'){sets.push(`active=$${values.length+1}`);values.push(b.active)}
    if(!sets.length)return ctx.send(res,400,{ok:false,error:'Tidak ada perubahan paket.'}),true;
    values.push(plan);const r=await p.query(`UPDATE wz_subscription_plans SET ${sets.join(',')},updated_at=NOW() WHERE plan=$${values.length} RETURNING plan,duration_days AS "durationDays",max_branches AS "maxBranches",max_employees AS "maxEmployees",price_monthly AS "priceMonthly",price_yearly AS "priceYearly",active,updated_at AS "updatedAt"`,values);
    if(!r.rowCount)return ctx.send(res,404,{ok:false,error:'Paket tidak ditemukan.'}),true;
    await audit(ctx,admin,'admin.plan.update',{targetType:'plan',targetId:plan,metadata:{changes:b}});
    return ctx.send(res,200,{ok:true,plan:r.rows[0]}),true;
  }

  if(path==='admin/payments' && req.method==='GET'){
    const {limit,offset,page:pageNo}=pageParams(q),status=text(q.get('status'),20).toUpperCase(),search=text(q.get('search'),120);
    const r=await p.query(`SELECT o.order_id AS "orderId",o.business_id AS "businessId",b.name AS "businessName",u.name AS owner,o.plan,o.billing_period AS "billingPeriod",o.amount,o.currency,o.status,o.payment_provider AS "paymentProvider",o.external_id AS "paymentReference",o.xendit_payment_id AS "xenditPaymentId",o.created_at AS "createdAt",o.paid_at AS "paidAt" FROM wz_subscription_orders o JOIN wz_businesses b ON b.id=o.business_id LEFT JOIN wz_users u ON u.business_id=o.business_id AND u.role='owner' WHERE ($1='' OR o.order_id ILIKE '%'||$1||'%' OR b.name ILIKE '%'||$1||'%' OR b.id ILIKE '%'||$1||'%') AND ($2='' OR o.status=$2) ORDER BY o.created_at DESC LIMIT $3 OFFSET $4`,[search,status,limit,offset]);
    const count=await p.query(`SELECT COUNT(*)::int AS total FROM wz_subscription_orders o JOIN wz_businesses b ON b.id=o.business_id WHERE ($1='' OR o.order_id ILIKE '%'||$1||'%' OR b.name ILIKE '%'||$1||'%' OR b.id ILIKE '%'||$1||'%') AND ($2='' OR o.status=$2)`,[search,status]);
    return ctx.send(res,200,page(r.rows,count.rows[0].total,{page:pageNo,limit}),true);
  }

  if(path==='admin/forum/messages' && req.method==='GET'){
    const limit=intParam(q.get('limit'),200,1,200);
    const r=await p.query(`SELECT m.id,m.message,m.message_type AS "messageType",m.sticker_id AS "stickerId",m.reply_to_id AS "replyToId",m.created_at AS "createdAt",COALESCE(u.id,m.sender_admin_id) AS "senderId",COALESCE(u.name,a.display_name,'Admin Platform') AS "senderName",COALESCE(b.name,'') AS "businessName",COALESCE(pr.avatar,'') AS "senderAvatar",m.sender_role AS "senderRole" FROM wz_owner_forum_messages m LEFT JOIN wz_users u ON u.id=m.sender_user_id LEFT JOIN wz_platform_admins a ON a.id=m.sender_admin_id LEFT JOIN wz_businesses b ON b.id=m.business_id LEFT JOIN wz_user_profiles pr ON pr.user_id=u.id WHERE m.sender_user_id IS NOT NULL OR m.sender_admin_id IS NOT NULL ORDER BY m.created_at ASC LIMIT $1`,[limit]);
    return ctx.send(res,200,{ok:true,scope:'global',messages:r.rows},true);
  }
  if(path==='admin/forum/messages' && req.method==='POST'){
    const b=await ctx.body(req),message=text(b.message,4000),messageType=text(b.messageType||'text',20),stickerId=text(b.stickerId,30),replyToId=b.replyToId==null?null:Number(b.replyToId);
    if(messageType==='text'&&!message)return ctx.send(res,400,{ok:false,error:'Pesan tidak boleh kosong.'}),true;
    if(messageType==='sticker'&&!stickerId)return ctx.send(res,400,{ok:false,error:'Sticker tidak valid.'}),true;
    if(!['text','sticker'].includes(messageType))return ctx.send(res,400,{ok:false,error:'Jenis pesan tidak valid.'}),true;
    if(replyToId!==null&&(!Number.isInteger(replyToId)||replyToId<1))return ctx.send(res,400,{ok:false,error:'Reply tidak valid.'}),true;
    if(replyToId!==null&&!(await p.query('SELECT id FROM wz_owner_forum_messages WHERE id=$1',[replyToId])).rowCount)return ctx.send(res,400,{ok:false,error:'Pesan yang dibalas tidak ditemukan.'}),true;
    const r=await p.query(`INSERT INTO wz_owner_forum_messages(sender_admin_id,sender_role,business_id,message,message_type,sticker_id,reply_to_id) VALUES($1,'platform_admin',NULL,$2,$3,$4,$5) RETURNING id,message,message_type AS "messageType",sticker_id AS "stickerId",reply_to_id AS "replyToId",created_at AS "createdAt",sender_admin_id AS "senderId",sender_role AS "senderRole"`,[admin.id,message,messageType,stickerId||null,replyToId]);
    const created=r.rows[0];
    await p.query(`INSERT INTO wz_admin_notifications(type,title,message,business_id,target_type,target_id) VALUES('admin_message','Pesan Admin dikirim',$1,NULL,'forum',NULL)`,['Admin Platform mengirim pesan ke semua Owner']);
    await audit(ctx,admin,'admin.forum.send',{targetType:'forum',targetId:'global',metadata:{messageId:String(created.id)}});
    return ctx.send(res,201,{ok:true,scope:'global',message:{...created,senderName:admin.display_name,senderRole:'platform_admin'}}),true;
  }

  if(path==='admin/forum/conversations' && req.method==='GET'){
    const {limit,offset,page:pageNo}=pageParams(q),search=text(q.get('search'),120);
    const r=await p.query(`SELECT b.id AS "businessId",b.name AS "businessName",u.id AS "ownerId",u.name AS owner,u.username AS "ownerUsername",COUNT(m.id)::int AS messages,MAX(m.created_at) AS "lastMessageAt",COUNT(m.id) FILTER(WHERE m.sender_user_id IS NOT NULL AND m.created_at>COALESCE(ar.last_read_at,'epoch'::timestamptz))::int AS unread FROM wz_businesses b LEFT JOIN wz_users u ON u.business_id=b.id AND u.role='owner' AND u.active=true LEFT JOIN wz_owner_forum_messages m ON m.business_id=b.id LEFT JOIN wz_admin_forum_reads ar ON ar.business_id=b.id AND ar.admin_id=$1 WHERE ($2='' OR b.id ILIKE '%'||$2||'%' OR b.name ILIKE '%'||$2||'%' OR u.name ILIKE '%'||$2||'%') GROUP BY b.id,b.name,u.id,u.name,u.username,ar.last_read_at ORDER BY "lastMessageAt" DESC NULLS LAST LIMIT $3 OFFSET $4`,[admin.id,search,limit,offset]);
    const count=await p.query(`SELECT COUNT(*)::int AS total FROM wz_businesses b LEFT JOIN wz_users u ON u.business_id=b.id AND u.role='owner' WHERE ($1='' OR b.id ILIKE '%'||$1||'%' OR b.name ILIKE '%'||$1||'%' OR u.name ILIKE '%'||$1||'%')`,[search]);
    return ctx.send(res,200,page(r.rows,count.rows[0].total,{page:pageNo,limit}),true);
  }

  const forumMatch=path.match(/^admin\/forum\/([^/]+)\/(messages|read)$/);
  if(forumMatch){
    const businessId=decodeURIComponent(forumMatch[1]),kind=forumMatch[2],business=await adminBusiness(ctx,res,businessId);if(!business)return true;
    if(kind==='read' && req.method==='POST'){
      await p.query(`INSERT INTO wz_admin_forum_reads(admin_id,business_id,last_read_at) VALUES($1,$2,NOW()) ON CONFLICT(admin_id,business_id) DO UPDATE SET last_read_at=EXCLUDED.last_read_at`,[admin.id,businessId]);
      await audit(ctx,admin,'admin.forum.read',{targetType:'business',targetId:businessId,businessId});
      return ctx.send(res,200,{ok:true}),true;
    }
    if(kind==='messages' && req.method==='GET'){
      const r=await p.query(`SELECT m.id,m.message,m.message_type AS "messageType",m.sticker_id AS "stickerId",m.reply_to_id AS "replyToId",m.created_at AS "createdAt",COALESCE(u.id,m.sender_admin_id) AS "senderId",COALESCE(u.name,a.display_name,'Admin Platform') AS "senderName",COALESCE(pr.avatar,'') AS "senderAvatar",m.sender_role AS "senderRole" FROM wz_owner_forum_messages m LEFT JOIN wz_users u ON u.id=m.sender_user_id LEFT JOIN wz_platform_admins a ON a.id=m.sender_admin_id LEFT JOIN wz_user_profiles pr ON pr.user_id=u.id WHERE m.business_id=$1 ORDER BY m.created_at ASC LIMIT 200`,[businessId]);
      return ctx.send(res,200,{ok:true,business,messages:r.rows}),true;
    }
    if(kind==='messages' && req.method==='POST'){
      const b=await ctx.body(req),message=text(b.message,4000),messageType=text(b.messageType||'text',20),stickerId=text(b.stickerId,30);
      if(messageType==='text'&&!message)return ctx.send(res,400,{ok:false,error:'Pesan tidak boleh kosong.'}),true;
      if(messageType==='sticker'&&!stickerId)return ctx.send(res,400,{ok:false,error:'Sticker tidak valid.'}),true;
      if(!['text','sticker'].includes(messageType))return ctx.send(res,400,{ok:false,error:'Jenis pesan tidak valid.'}),true;
      const r=await p.query(`INSERT INTO wz_owner_forum_messages(sender_admin_id,sender_role,business_id,message,message_type,sticker_id) VALUES($1,'platform_admin',$2,$3,$4,$5) RETURNING id,message,message_type AS "messageType",sticker_id AS "stickerId",created_at AS "createdAt",sender_admin_id AS "senderId",sender_role AS "senderRole"`,[admin.id,businessId,message,messageType,stickerId||null]);
      const created=r.rows[0];
      await p.query(`INSERT INTO wz_admin_notifications(type,title,message,business_id,target_type,target_id) VALUES('admin_message','Pesan Admin dikirim',$1,$2,'business',$2)`,[`Admin Platform mengirim pesan ke Owner`,businessId]);
      await audit(ctx,admin,'admin.forum.send',{targetType:'business',targetId:businessId,businessId,metadata:{messageId:String(created.id)}});
      if(ctx.sendBusinessForumPush)await ctx.sendBusinessForumPush({businessId,title:'WZ MANAGE PRO',body:'Ada pesan baru dari Admin Platform',data:{type:'owner_forum',businessId}}).catch(()=>{});
      return ctx.send(res,201,{ok:true,message:{...created,senderName:admin.display_name,senderRole:'platform_admin'}}),true;
    }
  }

  if(path==='admin/notifications' && req.method==='GET'){
    const {limit,offset,page:pageNo}=pageParams(q),unread=q.get('unread')==='1';
    const r=await p.query(`SELECT id,type,title,message,business_id AS "businessId",target_type AS "targetType",target_id AS "targetId",read_at AS "readAt",created_at AS "createdAt" FROM wz_admin_notifications ${unread?'WHERE read_at IS NULL':''} ORDER BY created_at DESC LIMIT $1 OFFSET $2`,[limit,offset]);
    const count=await p.query(`SELECT COUNT(*)::int AS total FROM wz_admin_notifications ${unread?'WHERE read_at IS NULL':''}`);
    return ctx.send(res,200,page(r.rows,count.rows[0].total,{page:pageNo,limit}),true);
  }

  const notificationMatch=path.match(/^admin\/notifications\/(\d+)\/read$/);
  if(notificationMatch && req.method==='POST'){
    const r=await p.query('UPDATE wz_admin_notifications SET read_at=COALESCE(read_at,NOW()) WHERE id=$1 RETURNING id,read_at AS "readAt"',[Number(notificationMatch[1])]);
    if(!r.rowCount)return ctx.send(res,404,{ok:false,error:'Notifikasi tidak ditemukan.'}),true;
    return ctx.send(res,200,{ok:true,notification:r.rows[0]}),true;
  }

  if(path==='admin/audit-logs' && req.method==='GET'){
    const {limit,offset,page:pageNo}=pageParams(q),search=text(q.get('search'),120),businessId=text(q.get('businessId'),80);
    const r=await p.query(`SELECT l.id,l.action,l.target_type AS "targetType",l.target_id AS "targetId",l.business_id AS "businessId",l.metadata,l.created_at AS "createdAt",a.username AS admin,a.display_name AS "adminName" FROM wz_admin_audit_logs l LEFT JOIN wz_platform_admins a ON a.id=l.admin_id WHERE ($1='' OR l.action ILIKE '%'||$1||'%' OR l.target_id ILIKE '%'||$1||'%' OR a.username ILIKE '%'||$1||'%') AND ($2='' OR l.business_id=$2) ORDER BY l.created_at DESC LIMIT $3 OFFSET $4`,[search,businessId,limit,offset]);
    const count=await p.query(`SELECT COUNT(*)::int AS total FROM wz_admin_audit_logs l LEFT JOIN wz_platform_admins a ON a.id=l.admin_id WHERE ($1='' OR l.action ILIKE '%'||$1||'%' OR l.target_id ILIKE '%'||$1||'%' OR a.username ILIKE '%'||$1||'%') AND ($2='' OR l.business_id=$2)`,[search,businessId]);
    return ctx.send(res,200,page(r.rows,count.rows[0].total,{page:pageNo,limit}),true);
  }

  if(path==='admin/settings' && req.method==='GET'){
    const r=await p.query('SELECT key,value,updated_at AS "updatedAt" FROM wz_system_settings ORDER BY key');
    return ctx.send(res,200,{ok:true,settings:Object.fromEntries(r.rows.map(row=>[row.key,row.value]))}),true;
  }

  if(path==='admin/settings' && req.method==='PUT'){
    const b=await ctx.body(req),settings=b.settings&&typeof b.settings==='object'&&!Array.isArray(b.settings)?b.settings:null;
    if(!settings)return ctx.send(res,400,{ok:false,error:'Settings tidak valid.'}),true;
    const allowed=['platform_name','maintenance_mode','notification_settings','subscription_settings'];
    for(const [key,value] of Object.entries(settings)){if(!allowed.includes(key))return ctx.send(res,400,{ok:false,error:`Setting tidak diizinkan: ${key}`}),true;if(JSON.stringify(value).length>20000)return ctx.send(res,400,{ok:false,error:`Setting terlalu besar: ${key}`}),true;}
    for(const key of allowed.filter(key=>Object.prototype.hasOwnProperty.call(settings,key))){await p.query(`INSERT INTO wz_system_settings(key,value,updated_by,updated_at) VALUES($1,$2::jsonb,$3,NOW()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_by=EXCLUDED.updated_by,updated_at=NOW()`,[key,JSON.stringify(settings[key]),admin.id]);}
    await audit(ctx,admin,'admin.settings.update',{targetType:'settings',metadata:{keys:Object.keys(settings)}});
    return ctx.send(res,200,{ok:true}),true;
  }

  return false;
};
