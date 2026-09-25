/* Unit test untuk helper server (web-source/lib/helpers.js).
   Jalankan: node --test tests/  (atau: npm test) */
const test = require('node:test');
const assert = require('node:assert');

const {
  hashPassword, verifyPassword, token, tokenHash,
  defaultUsername, defaultPassword, normalizeBusinessId, safeServerError,
  xenditSafeName, cookie, body, validMoney, validDate, validTransaction, validShift
} = require('../lib/helpers.js');
const { Readable } = require('node:stream');

test('hashPassword/verifyPassword: cocok dengan password benar', () => {
  const stored = hashPassword('rahasia123');
  assert.match(stored, /^[0-9a-f]{32}:[0-9a-f]{128}$/);
  assert.equal(verifyPassword('rahasia123', stored), true);
});

test('hashPassword/verifyPassword: tolak password salah', () => {
  const stored = hashPassword('rahasia123');
  assert.equal(verifyPassword('rahasia124', stored), false);
});

test('verifyPassword: hash rusak tidak melempar error', () => {
  assert.equal(verifyPassword('apa saja', 'bukan-hash'), false);
  assert.equal(verifyPassword('apa saja', ''), false);
  assert.equal(verifyPassword('apa saja', null), false);
});

test('token/tokenHash: token acak 64 hex, hash sha256 64 hex', () => {
  const a = token(), b = token();
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, b);
  assert.match(tokenHash(a), /^[0-9a-f]{64}$/);
  assert.equal(tokenHash(a), tokenHash(a));
});

test('defaultUsername/defaultPassword dari nama karyawan', () => {
  assert.equal(defaultUsername('Budi Santoso'), 'budisantoso');
  assert.equal(defaultUsername('  Kyong  '), 'kyong');
  assert.equal(defaultUsername(''), 'employee');
  assert.equal(defaultPassword('Budi Santoso'), 'budisantoso123');
});

test('normalizeBusinessId: hanya huruf/angka kapital', () => {
  assert.equal(normalizeBusinessId(' wz-001 '), 'WZ001');
  assert.equal(normalizeBusinessId(''), '');
  assert.equal(normalizeBusinessId(null), '');
});

test('xenditSafeName: hanya karakter aman, ada fallback', () => {
  assert.equal(xenditSafeName('WZ Manage Pro!'), 'WZManagePro');
  assert.equal(xenditSafeName(''), 'OWNER');
  assert.equal(xenditSafeName(null), 'OWNER');
});

test('cookie: HttpOnly + SameSite, Secure hanya di production', () => {
  const before = process.env.NODE_ENV;
  delete process.env.NODE_ENV;
  const dev = cookie('wz_session', 'abc', 60);
  assert.match(dev, /^wz_session=abc; Path=\/; HttpOnly; SameSite=Lax; Max-Age=60$/);
  process.env.NODE_ENV = 'production';
  assert.match(cookie('wz_session', 'abc', 60), /; Secure$/);
  if (before === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = before;
});

test('validDate: format YYYY-MM-DD saja', () => {
  assert.equal(validDate('2026-09-24'), true);
  assert.equal(validDate('24-09-2026'), false);
  assert.equal(validDate(''), false);
});

test('validDate: menolak tanggal yang tidak nyata', () => {
  assert.equal(validDate('2024-02-29'), true);
  assert.equal(validDate('2026-02-29'), false);
  assert.equal(validDate('2026-99-99'), false);
  assert.equal(validDate('2025-02-29'), false);
});

test('body: JSON invalid dan request terlalu besar memiliki status yang jelas', async () => {
  await assert.rejects(
    body(Readable.from(['{invalid'])),
    error => error.statusCode === 400
  );
  await assert.rejects(
    body(Readable.from(['123456789']), 5),
    error => error.statusCode === 413
  );
});

test('validMoney: hanya angka atau string numerik yang terisi', () => {
  assert.equal(validMoney(0), true);
  assert.equal(validMoney(15000), true);
  assert.equal(validMoney('15000'), true);
  assert.equal(validMoney('0'), true);
  assert.equal(validMoney(-1), false);
  assert.equal(validMoney('abc'), false);
  assert.equal(validMoney(Infinity), false);
  assert.equal(validMoney(NaN), false);
});

test('validMoney: nilai kosong ditolak (bukan dianggap Rp0)', () => {
  assert.equal(validMoney(null), false);
  assert.equal(validMoney(undefined), false);
  assert.equal(validMoney(''), false);
  assert.equal(validMoney('   '), false);
});

test('validShift: menolak laporan dengan nilai kosong', () => {
  const base = {
    date: '2026-09-24', openingCash: 100000, cash: 300000, qris: 50000, cashExpense: 20000,
    physicalCash: 380000, totalPayment: 350000, expectedCash: 380000, cashDifference: 0,
    serviceTotal: 320000, productTotal: 30000, totalOmzet: 350000
  };
  assert.equal(validShift(base), true);
  assert.equal(validShift({ ...base, productTotal: null }), false);
  assert.equal(validShift({ ...base, qris: '' }), false);
  assert.equal(validShift({ ...base, totalOmzet: undefined }), false);
});

test('validTransaction: total harus sama dengan harga - diskon', () => {
  const base = { date: '2026-09-24', servicePrice: 50000, discount: 10000, total: 40000, status: 'SELESAI', payment: 'Tunai' };
  assert.equal(validTransaction(base), true);
  assert.equal(validTransaction({ ...base, total: 45000 }), false);
  assert.equal(validTransaction({ ...base, discount: 60000 }), false);
  assert.equal(validTransaction({ ...base, payment: 'Bitcoin' }), false);
  assert.equal(validTransaction({ ...base, status: 'BATAL' }), false);
  assert.equal(validTransaction({ ...base, date: '2026/09/24' }), false);
});

test('validTransaction: menolak nominal kosong dan tanggal tidak nyata', () => {
  const base = { date: '2026-09-24', servicePrice: 50000, discount: 10000, total: 40000, status: 'SELESAI', payment: 'Tunai' };
  assert.equal(validTransaction({ ...base, servicePrice: '', discount: '', total: '' }), false);
  assert.equal(validTransaction({ ...base, date: '2026-99-99' }), false);
});

test('validShift: selisih kasir harus nol dan kas fisik konsisten', () => {
  const base = {
    date: '2026-09-24', openingCash: 100000, cash: 300000, qris: 50000, cashExpense: 20000,
    physicalCash: 380000, totalPayment: 350000, expectedCash: 380000, cashDifference: 0,
    serviceTotal: 320000, productTotal: 30000, totalOmzet: 350000
  };
  assert.equal(validShift(base), true);
  assert.equal(validShift({ ...base, cashDifference: 5000 }), false);
  assert.equal(validShift({ ...base, physicalCash: 300000 }), false);
  assert.equal(validShift({ ...base, serviceTotal: 0 }), false);
  assert.equal(validShift({ ...base, totalPayment: 0 }), false);
});

test('safeServerError: pesan teknis disembunyikan di production', () => {
  const before = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  assert.equal(safeServerError(new Error('relation "wz_users" does not exist')), 'Server sedang tidak tersedia. Silakan coba lagi nanti.');
  delete process.env.NODE_ENV;
  assert.equal(safeServerError(new Error('boom')), 'boom');
  assert.equal(safeServerError(null), 'Server error');
  if (before === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = before;
});
