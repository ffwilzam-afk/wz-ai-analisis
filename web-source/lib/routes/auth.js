/* Rute autentikasi & akun: register, login, me, logout.
   Kontrak: kembalikan true bila request sudah ditangani (respons terkirim),
   false bila path/method tidak cocok dan boleh dicoba modul berikutnya.
   Dipanggil oleh api/[...path].js dengan `ctx` berisi helper server. */
const crypto = require('crypto');

module.exports = async function authRoutes(ctx, req, res, path){
  const {
    getPool, send, body, cookie,
    token, tokenHash, hashPassword, verifyPassword,
    authUser, normalizeBusinessId
  } = ctx;

  if(path==='auth/register' && req.method==='POST'){
    const b=await body(req),businessName=String(b.businessName||'').trim(),ownerName=String(b.ownerName||'').trim(),branchName=String(b.branchName||'').trim(),username=String(b.username||'').trim().toLowerCase(),password=String(b.password||'');
    if(businessName.length<2||businessName.length>100||ownerName.length<2||ownerName.length>100||branchName.length<2||branchName.length>100)return send(res,400,{ok:false,error:'Data pendaftaran tidak valid.'});
    if(!/^[a-z0-9._-]{3,50}$/.test(username)||password.length<6||password.length>128)return send(res,400,{ok:false,error:'Username/password tidak valid.'});
    const c=await getPool().connect();let tokenValue;try{await c.query('BEGIN');const businessId='BIZ'+crypto.randomBytes(5).toString('hex').toUpperCase(),branchId='B'+crypto.randomBytes(5).toString('hex').toUpperCase(),employeeId='E'+crypto.randomBytes(5).toString('hex').toUpperCase();
      await c.query('INSERT INTO wz_businesses(id,name,active) VALUES($1,$2,true)',[businessId,businessName]);
      await c.query('INSERT INTO wz_branches(id,name,active,business_id) VALUES($1,$2,true,$3)',[branchId,branchName,businessId]);
      await c.query("INSERT INTO wz_employees(id,name,role,branch_id,salary,target,active,business_id) VALUES($1,$2,'Owner',$3,2000000,4500000,true,$4)",[employeeId,ownerName,branchId,businessId]);
      const ur=await c.query("INSERT INTO wz_users(username,password_hash,role,name,employee_id,business_id) VALUES($1,$2,'owner',$3,$4,$5) RETURNING id",[username,hashPassword(password),ownerName,employeeId,businessId]);
      await c.query('INSERT INTO wz_app_states(business_id,data) VALUES($1,$2::jsonb)',[businessId,'{}']);await c.query("INSERT INTO wz_admin_notifications(type,title,message,business_id,target_type,target_id) VALUES('business_new','Business baru',$1,$2,'business',$2)",['Business baru: '+businessName,businessId]);
      await c.query(`
        INSERT INTO wz_subscriptions
          (business_id,plan,status,trial_started_at,trial_ends_at,current_period_start,current_period_end)
        VALUES
          ($1,'TRIAL','ACTIVE',NOW(),NOW()+INTERVAL '35 days',NOW(),NOW()+INTERVAL '35 days')
        ON CONFLICT (business_id) DO NOTHING
      `,[businessId]);tokenValue=token();await c.query("INSERT INTO wz_sessions(token_hash,user_id,expires_at) VALUES($1,$2,NOW()+INTERVAL '30 days')",[tokenHash(tokenValue),ur.rows[0].id]);await c.query('COMMIT');return send(res,200,{ok:true,business:{businessId,name:businessName},user:{username,role:'owner',name:ownerName,employeeId,businessId}}, {'Set-Cookie':cookie('wz_session',tokenValue,60*60*24*30)});
    }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
    return true;
  }

  if(path==='auth/login' && req.method==='POST'){
    const b=await body(req),username=String(b.username||'').trim().toLowerCase(),password=String(b.password||'');
    if(!username||!password)return send(res,400,{ok:false,error:'Username dan password wajib diisi.'});
    const businessId=normalizeBusinessId(b.businessId);
    if(b.businessId && !businessId)return send(res,400,{ok:false,error:'Kode Bisnis tidak valid.'});
    const p=getPool(); const r=await p.query(`SELECT u.*,e.branch_id FROM wz_users u LEFT JOIN wz_employees e ON e.id=u.employee_id AND e.business_id=u.business_id WHERE u.username=$1 AND u.active=true ${businessId?'AND u.business_id=$2':''} ORDER BY u.id`,businessId?[username,businessId]:[username]); if(!businessId && r.rowCount>1)return send(res,400,{ok:false,error:'Kode Bisnis wajib diisi karena username digunakan di lebih dari satu bisnis.'}); const u=r.rows[0];
    if(!u||!verifyPassword(password,u.password_hash))return send(res,401,{ok:false,error:'Username atau password salah.'});
    const t=token(); await p.query('DELETE FROM wz_sessions WHERE expires_at<=NOW()');
    await p.query('INSERT INTO wz_sessions(token_hash,user_id,expires_at) VALUES($1,$2,NOW()+INTERVAL \'30 days\')',[tokenHash(t),u.id]);
    return send(res,200,{ok:true,user:{username:u.username,role:u.role,name:u.name,employeeId:u.employee_id||null,branchId:u.branch_id||null,businessId:u.business_id||null}}, {'Set-Cookie':cookie('wz_session',t,60*60*24*30)});
  }

  if(path==='auth/me' && req.method==='GET'){
    const u=await authUser(req); if(!u)return send(res,401,{ok:false,error:'Belum login.'});
    return send(res,200,{ok:true,user:{username:u.username,role:u.role,name:u.name,employeeId:u.employee_id||null,branchId:u.branch_id||null,businessId:u.business_id||null}});
  }

  if(path==='auth/logout' && req.method==='POST'){
    const c=String(req.headers.cookie||''),m=c.match(/(?:^|;\s*)wz_session=([^;]+)/);if(m)await getPool().query('DELETE FROM wz_sessions WHERE token_hash=$1',[tokenHash(decodeURIComponent(m[1]))]);
    return send(res,200,{ok:true},{'Set-Cookie':cookie('wz_session','',0)});
  }

  return false;
};
