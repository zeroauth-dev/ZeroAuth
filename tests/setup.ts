// Runs via jest.config.js `setupFiles` — i.e. BEFORE any module under
// test is imported. Test-only env defaults belong here so they land
// before src/config/index.ts captures them at module load.
//
// ADMIN_API_KEY in particular is read once into `config.admin.apiKey`
// when the config module loads; setting it later via beforeAll() is
// too late and the admin auth middleware will 403 every request.
process.env.ADMIN_API_KEY = process.env.ADMIN_API_KEY ?? 'test-admin-key';
