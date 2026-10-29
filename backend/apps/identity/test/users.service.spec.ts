import { describe, expect, it, jest } from '@jest/globals';
import { DataSource } from 'typeorm';
import { canonicalRequestHash, IdempotencyService } from '@c48/technical/idempotency/idempotency';
import { hashPurposeBoundSecret } from '@c48/technical/security/secret-hash';
import { AuthService } from '../src/auth/auth.service';
import { AdminRequest, IdentityAdminSupport } from '../src/admin/admin-security';
import { CreateUserDto, ResetPasswordDto } from '../src/users/users.dto';
import { UsersService } from '../src/users/users.service';

describe('Identity user password idempotency', () => {
  const actor = { auth: { userId: '00000000-0000-4000-8000-000000000001' }, idempotencyKey: '00000000-0000-4000-8000-000000000002' } as AdminRequest;
  const testPeppers = { v1: 'test-pepper-value-with-at-least-32-characters' };

  function service(query = jest.fn().mockResolvedValue([{ username: 'field-user' }])) {
    const execute = jest.fn(async (_source: DataSource, _command: { requestHash: string }) => ({
      status: 201,
      value: { id: '00000000-0000-4000-8000-000000000003' },
      replay: false,
    }));
    const auth = Object.assign(Object.create(AuthService.prototype), {
      config: { refreshPeppers: testPeppers, currentRefreshPepperVersion: 'v1' },
      hashTemporaryPassword: jest.fn().mockResolvedValue('argon2-password-hash'),
    }) as AuthService;
    return {
      users: new UsersService(
        { query } as unknown as DataSource,
        { execute } as unknown as IdempotencyService,
        {} as IdentityAdminSupport,
        auth,
      ),
      execute,
      auth,
    };
  }

  it('replaces a temporary password with a peppered binding before hashing create idempotency', async () => {
    const { users, execute } = service();
    const dto: CreateUserDto = {
      username: 'field-user',
      display_name: 'Nhân viên cứu trợ',
      temporary_password: 'A long temporary passphrase!',
    };

    await users.create(dto, actor);

    const command = execute.mock.calls[0]![1];
    const passwordBinding = hashPurposeBoundSecret(dto.temporary_password, 'identity-admin-temporary-password-idempotency', testPeppers, 'v1');
    expect(command.requestHash).toBe(canonicalRequestHash({
      username: dto.username,
      display_name: dto.display_name,
      temporary_password_binding: passwordBinding,
    }));
    expect(command.requestHash).not.toBe(canonicalRequestHash(dto));
  });

  it('replaces a reset password with a peppered binding before hashing idempotency', async () => {
    const { users, execute } = service();
    const id = 'A0000000-0000-4000-8000-000000000003';
    const dto: ResetPasswordDto = {
      expected_version: 4,
      temporary_password: 'Another long temporary passphrase!',
      reason: 'Đặt lại mật khẩu thử nghiệm',
    };

    await users.resetPassword(id, dto, actor);

    const command = execute.mock.calls[0]![1];
    const passwordBinding = hashPurposeBoundSecret(dto.temporary_password, 'identity-admin-temporary-password-idempotency', testPeppers, 'v1');
    expect(command.requestHash).toBe(canonicalRequestHash({
      id: id.toLowerCase(),
      expected_version: dto.expected_version,
      reason: dto.reason,
      temporary_password_binding: passwordBinding,
    }));
    expect(command.requestHash).not.toBe(canonicalRequestHash({ id, ...dto }));
  });
});
