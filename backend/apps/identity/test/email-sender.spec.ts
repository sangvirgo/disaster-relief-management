import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import nodemailer from 'nodemailer';
import { EmailSenderService } from '../src/auth/email-sender.service';

describe('EmailSenderService failure logging', () => {
  const env = { ...process.env };
  let createTransport: jest.Mock;
  let warn: jest.SpiedFunction<Logger['warn']>;

  beforeEach(() => {
    process.env.IDENTITY_EMAIL_SMTP_HOST = 'smtp.example.test';
    process.env.IDENTITY_EMAIL_FROM = 'noreply@example.test';
    process.env.IDENTITY_EMAIL_SMTP_USER = 'smtp-user-secret';
    process.env.IDENTITY_EMAIL_SMTP_PASSWORD = 'smtp-password-secret';
    process.env.IDENTITY_EMAIL_SMTP_PORT = '587';
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    createTransport = jest.fn();
    jest.spyOn(nodemailer, 'createTransport').mockImplementation(createTransport as never);
  });
  afterEach(() => { process.env = { ...env }; jest.restoreAllMocks(); });

  it('logs only the error and SMTP response codes when delivery fails', async () => {
    const failure = Object.assign(new Error('Invalid login for smtp-user-secret smtp-password-secret person@example.test'), { code: 'EAUTH', responseCode: 535 });
    createTransport.mockReturnValue({ sendMail: jest.fn().mockRejectedValue(failure as never), close: jest.fn() });
    await expect(new EmailSenderService().sendVerificationCode('person@example.test', '123456')).resolves.toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0]?.[0]);
    expect(line).toBe('EMAIL_SEND_FAILED code=EAUTH smtp_response=535');
    for (const secret of ['person@example.test', 'smtp-user-secret', 'smtp-password-secret', 'smtp.example.test', '123456']) expect(line).not.toContain(secret);
  });

  it('falls back to UNKNOWN for an error without a well-formed code', async () => {
    createTransport.mockReturnValue({ sendMail: jest.fn().mockRejectedValue(Object.assign(new Error('x'), { code: 'bad code with spaces' }) as never), close: jest.fn() });
    await new EmailSenderService().sendVerificationCode('person@example.test', '123456');
    expect(warn).toHaveBeenCalledWith('EMAIL_SEND_FAILED code=UNKNOWN');
  });

  it('reports a missing configuration without sending', async () => {
    delete process.env.IDENTITY_EMAIL_SMTP_HOST;
    await expect(new EmailSenderService().sendVerificationCode('person@example.test', '123456')).resolves.toBe(false);
    expect(warn).toHaveBeenCalledWith('EMAIL_SEND_FAILED reason=NOT_CONFIGURED');
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('returns true and logs nothing on success', async () => {
    createTransport.mockReturnValue({ sendMail: jest.fn().mockResolvedValue({} as never), close: jest.fn() });
    await expect(new EmailSenderService().sendVerificationCode('person@example.test', '123456')).resolves.toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });
});
