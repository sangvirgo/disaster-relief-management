import { Injectable } from '@nestjs/common';
import nodemailer from 'nodemailer';

@Injectable()
export class EmailSenderService {
  async sendVerificationCode(email: string, code: string): Promise<boolean> {
    const host = process.env.IDENTITY_EMAIL_SMTP_HOST;
    const from = process.env.IDENTITY_EMAIL_FROM;
    if (!host || !from) return false;
    const port = Number(process.env.IDENTITY_EMAIL_SMTP_PORT ?? 587);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return false;
    let transport: ReturnType<typeof nodemailer.createTransport> | undefined;
    try {
      transport = nodemailer.createTransport({
        host,
        port,
        secure: process.env.IDENTITY_EMAIL_SMTP_SECURE === 'true',
        ...(process.env.IDENTITY_EMAIL_SMTP_USER ? {
          auth: {
            user: process.env.IDENTITY_EMAIL_SMTP_USER,
            pass: process.env.IDENTITY_EMAIL_SMTP_PASSWORD ?? '',
          },
        } : {}),
      });
      await transport.sendMail({
        from,
        to: email,
        subject: 'Mã xác thực tài khoản C48',
        text: `Mã xác thực của bạn là ${code}. Mã có hiệu lực trong 5 phút. Nếu bạn không yêu cầu mã này, hãy bỏ qua email.`,
      });
      return true;
    } catch {
      return false;
    } finally {
      transport?.close();
    }
  }
}
