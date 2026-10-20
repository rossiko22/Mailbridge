import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUserService } from '../src/modules/users/users.service.js';
import type * as repository from '../src/modules/users/users.repository.js';
import { verifyHashPassword } from '../src/security/password.js';

test('new users are stored with a password hash and responses omit that hash', async () => {
    const service = createUserService({
        findByEmail: async () => null,
        create: async (email: string, passwordHash: string) => {
            assert.equal(email, 'person@example.com');
            assert.notEqual(passwordHash, 'test-password');
            assert.equal(await verifyHashPassword(passwordHash, 'test-password'), true);
            return { id: 'u1', email, passwordHash, displayName: '', avatarUrl: null, createdAt: new Date() };
        },
    } as unknown as typeof repository);
    const user = await service.create(' person@example.com ', 'test-password', 'Person');
    assert.equal('passwordHash' in user, false);
});
test('unknown users produce an invalid-login result instead of an internal server error', async () => {
    const service = createUserService({ findByEmail: async () => null } as unknown as typeof repository);
    assert.equal(await service.validateLogin('missing@example.com', 'wrong'), null);
});
