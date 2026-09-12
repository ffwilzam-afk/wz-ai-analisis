-- WZ MANAGE PRO — SUBSCRIPTION V1
-- SAFE MIGRATION
-- Tidak DROP, TRUNCATE, atau DELETE data tenant.

CREATE TABLE IF NOT EXISTS wz_subscriptions (
  id BIGSERIAL PRIMARY KEY,
  business_id TEXT NOT NULL UNIQUE
    REFERENCES wz_businesses(id),

  plan TEXT NOT NULL DEFAULT 'TRIAL'
    CHECK (plan IN ('TRIAL','PRO','PRO_MAX')),

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

CREATE INDEX IF NOT EXISTS wz_subscriptions_status_idx
  ON wz_subscriptions(status);

CREATE INDEX IF NOT EXISTS wz_subscriptions_period_end_idx
  ON wz_subscriptions(current_period_end);

-- Paket & batas penggunaan.
-- Nilai ini disimpan sebagai aturan terpusat agar
-- frontend dan backend nantinya menggunakan sumber aturan yang sama.

CREATE TABLE IF NOT EXISTS wz_subscription_plans (
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

-- ============================================================
-- EXISTING TENANTS
-- Membuat subscription hanya untuk business yang belum memilikinya.
-- Trial dihitung dari created_at business, bukan dari waktu migration.
-- Tidak mengubah atau menghapus data bisnis.

INSERT INTO wz_subscriptions
  (business_id,plan,status,trial_started_at,trial_ends_at,current_period_start,current_period_end)
SELECT
  b.id,
  'TRIAL',
  CASE
    WHEN b.created_at + INTERVAL '35 days' > NOW()
      THEN 'ACTIVE'
    ELSE 'EXPIRED'
  END,
  b.created_at,
  b.created_at + INTERVAL '35 days',
  b.created_at,
  b.created_at + INTERVAL '35 days'
FROM wz_businesses b
WHERE NOT EXISTS (
  SELECT 1
  FROM wz_subscriptions s
  WHERE s.business_id=b.id
);
