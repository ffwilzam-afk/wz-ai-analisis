/* Rute notifikasi push: kunci VAPID, langganan web push, dan token FCM.
   Kontrak: kembalikan true bila request sudah ditangani (respons terkirim),
   false bila path/method tidak cocok dan boleh dicoba modul berikutnya. */
module.exports = async function pushRoutes(ctx, req, res, path){
  const { getPool, send, body, authUser, pushConfigured } = ctx;

  if(path==='push/vapid-public-key' && req.method==='GET'){
    const u=await authUser(req);if(!u)return send(res,401,{ok:false,error:'Belum login.'});
    if(!['owner','manager'].includes(u.role))return send(res,403,{ok:false,error:'Notifikasi hanya tersedia untuk Owner/Manager.'});
    if(!pushConfigured())return send(res,503,{ok:false,error:'Web Push belum dikonfigurasi di server.'});
    return send(res,200,{ok:true,publicKey:process.env.VAPID_PUBLIC_KEY});
  }

  if(path==='push/subscribe' && req.method==='POST'){
    const u=await authUser(req);if(!u)return send(res,401,{ok:false,error:'Belum login.'});
    if(!['owner','manager'].includes(u.role))return send(res,403,{ok:false,error:'Notifikasi hanya tersedia untuk Owner/Manager.'});
    const b=await body(req),endpoint=String(b.endpoint||''),keys=b.keys||{},p256dh=String(keys.p256dh||''),auth=String(keys.auth||'');
    if(!endpoint||!p256dh||!auth)return send(res,400,{ok:false,error:'Subscription push tidak valid.'});
    await getPool().query('INSERT INTO wz_push_subscriptions(user_id,endpoint,p256dh,auth,business_id,updated_at) VALUES($1,$2,$3,$4,$5,NOW()) ON CONFLICT (business_id,endpoint) DO UPDATE SET user_id=EXCLUDED.user_id,p256dh=EXCLUDED.p256dh,auth=EXCLUDED.auth,updated_at=NOW()',[u.id,endpoint,p256dh,auth,u.business_id]);
    return send(res,200,{ok:true});
  }

  if(path==='push/fcm-token' && req.method==='POST'){
    const u=await authUser(req);
    if(!u)return send(res,401,{ok:false,error:'Belum login.'});

    const b=await body(req);
    const fcmToken=String(b.token||'').trim();
    if(!['owner','manager'].includes(u.role)){
      if(fcmToken)await getPool().query('DELETE FROM wz_fcm_tokens WHERE token=$1',[fcmToken]);
      return send(res,200,{ok:true,removed:Boolean(fcmToken)});
    }

    if(!fcmToken)return send(res,400,{ok:false,error:'FCM token wajib diisi.'});
    if(fcmToken.length>4096)return send(res,400,{ok:false,error:'FCM token tidak valid.'});

    const p=getPool();

    // Satu token perangkat hanya boleh aktif pada akun/tenant yang sedang login.
    // Ini hanya membersihkan data token FCM, bukan data bisnis/tenant.
    await p.query(
      `DELETE FROM wz_fcm_tokens
       WHERE token=$1
         AND NOT (business_id=$2 AND user_id=$3)`,
      [fcmToken,u.business_id,u.id]
    );

    await p.query(
      `INSERT INTO wz_fcm_tokens(user_id,business_id,token,updated_at)
       VALUES($1,$2,$3,NOW())
       ON CONFLICT (business_id,token)
       DO UPDATE SET user_id=EXCLUDED.user_id,updated_at=NOW()`,
      [u.id,u.business_id,fcmToken]
    );

    return send(res,200,{ok:true});
  }

  if(path==='push/unsubscribe' && req.method==='POST'){
    const u=await authUser(req);if(!u)return send(res,401,{ok:false,error:'Belum login.'});
    const b=await body(req);
    if(b.endpoint)await getPool().query('DELETE FROM wz_push_subscriptions WHERE business_id=$1 AND endpoint=$2',[u.business_id,String(b.endpoint)]);
    return send(res,200,{ok:true});
  }

  return false;
};
