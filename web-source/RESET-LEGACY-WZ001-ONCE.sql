BEGIN;

-- Hanya menghapus tenant lama WZ001.
-- Bisnis baru dengan ID BIZ... TIDAK disentuh.

DELETE FROM wz_transactions WHERE business_id='WZ001';
DELETE FROM wz_shift_reports WHERE business_id='WZ001';
DELETE FROM wz_app_states WHERE business_id='WZ001';

DELETE FROM wz_users WHERE business_id='WZ001';
DELETE FROM wz_employees WHERE business_id='WZ001';
DELETE FROM wz_branches WHERE business_id='WZ001';

DELETE FROM wz_businesses WHERE id='WZ001';

-- Data legacy satu-tenant lama
DELETE FROM wz_app_state WHERE id=1;

COMMIT;
