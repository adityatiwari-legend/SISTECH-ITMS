-- Migration 010: Ensure demo driver and admin password hashes are valid scrypt format
-- Password: password123
UPDATE drivers
SET password_hash = 'scrypt:a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6:19849e5e7d426f9385a1c37cad9e47aa384a72aee5fa641f00b6c67f23965222b1b092948cdf3e6dce59afeac67048ec01da11dfe9cd3f1f5686c80c6255eb6f'
WHERE email IN ('driver@sistec.demo', 'admin@sistec.demo');
