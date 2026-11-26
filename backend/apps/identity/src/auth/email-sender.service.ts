import { Injectable, Logger } from '@nestjs/common';
import nodemailer from 'nodemailer';
import { recordEmailDelivery } from './email-metrics';

@Injectable()
export class EmailSenderService {
  private readonly logger = new Logger(EmailSenderService.name);

  /** True when Identity has what it needs to send email: SMTP host and sender address. */
  isConfigured(): boolean {
    return Boolean(process.env.IDENTITY_EMAIL_SMTP_HOST && process.env.IDENTITY_EMAIL_FROM);
  }

  async sendVerificationCode(email: string, code: string): Promise<boolean> {
    const sent = await this.deliverVerificationCode(email, code);
    recordEmailDelivery('registration', sent ? 'sent' : 'failed');
    return sent;
  }

  async sendPasswordResetCode(email: string, code: string): Promise<boolean> {
    const sent = await this.deliverPasswordResetCode(email, code);
    recordEmailDelivery('password_reset', sent ? 'sent' : 'failed');
    return sent;
  }

  private async deliverVerificationCode(email: string, code: string): Promise<boolean> {
    const host = process.env.IDENTITY_EMAIL_SMTP_HOST;
    const from = process.env.IDENTITY_EMAIL_FROM;
    if (!host || !from) {
      this.logger.warn('EMAIL_SEND_FAILED reason=NOT_CONFIGURED');
      return false;
    }
    const port = Number(process.env.IDENTITY_EMAIL_SMTP_PORT ?? 587);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      this.logger.warn('EMAIL_SEND_FAILED reason=INVALID_PORT');
      return false;
    }
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
        from: { name: 'Reliva', address: from },
        to: email,
        subject: 'Mã xác thực tài khoản Reliva',
        text: [
          'Mã xác thực tài khoản Reliva',
          '',
          'Bạn vừa yêu cầu xác thực địa chỉ email cho tài khoản Reliva.',
          `Mã xác thực: ${code}`,
          '',
          'Mã có hiệu lực trong 5 phút. Vui lòng không chia sẻ mã này với bất kỳ ai.',
          'Nếu bạn không yêu cầu mã này, hãy bỏ qua email.',
          '',
          'Đội ngũ Reliva',
        ].join('\n'),
        html: `<!doctype html>
<html lang="vi">
  <body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Mã xác thực tài khoản Reliva. Mã có hiệu lực trong 5 phút.</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f1f5f9;">
      <tr>
        <td align="center" style="padding:36px 16px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="padding:24px 32px;background:#1d4ed8;color:#ffffff;">
                <div style="font-size:24px;font-weight:700;letter-spacing:1px;">RELIVA</div>
                <div style="margin-top:4px;font-size:12px;letter-spacing:1.2px;color:#dbeafe;">CHUNG TAY CỨU TRỢ</div>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <div style="margin-bottom:10px;color:#2563eb;font-size:12px;font-weight:700;letter-spacing:1px;">BẢO MẬT TÀI KHOẢN</div>
                <h1 style="margin:0 0 12px;font-size:24px;line-height:1.3;color:#0f172a;">Xác thực địa chỉ email</h1>
                <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#475569;">Bạn vừa yêu cầu xác thực email để tiếp tục tạo tài khoản Reliva. Nhập mã bên dưới vào màn hình đăng ký:</p>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:22px;">
                  <tr>
                    <td align="center" style="padding:20px 12px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;color:#1d4ed8;font-family:Consolas,Monaco,monospace;font-size:32px;font-weight:700;letter-spacing:8px;">${code}</td>
                  </tr>
                </table>
                <p style="margin:0 0 18px;font-size:14px;line-height:1.6;color:#334155;">Mã có hiệu lực trong <strong>5 phút</strong>. Vì sự an toàn của bạn, đừng chia sẻ mã này với bất kỳ ai.</p>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f8fafc;border-radius:10px;">
                  <tr>
                    <td style="padding:14px 16px;font-size:13px;line-height:1.6;color:#475569;"><strong style="color:#0f172a;">Không phải bạn?</strong> Bạn có thể bỏ qua email này; tài khoản sẽ không được xác thực nếu không nhập mã.</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px;border-top:1px solid #e2e8f0;font-size:12px;line-height:1.6;color:#64748b;">Email tự động từ Reliva. Vui lòng không trả lời thư này.</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`,
      });
      return true;
    } catch (error) {
      this.logger.warn(`EMAIL_SEND_FAILED ${EmailSenderService.failureReason(error)}`);
      return false;
    } finally {
      transport?.close();
    }
  }

  private async deliverPasswordResetCode(email: string, code: string): Promise<boolean> {
    const host = process.env.IDENTITY_EMAIL_SMTP_HOST;
    const from = process.env.IDENTITY_EMAIL_FROM;
    if (!host || !from) {
      this.logger.warn('EMAIL_SEND_FAILED reason=NOT_CONFIGURED');
      return false;
    }
    const port = Number(process.env.IDENTITY_EMAIL_SMTP_PORT ?? 587);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      this.logger.warn('EMAIL_SEND_FAILED reason=INVALID_PORT');
      return false;
    }
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
        from: { name: 'Reliva', address: from },
        to: email,
        subject: 'Mã đặt lại mật khẩu Reliva',
        text: [
          'Đặt lại mật khẩu Reliva',
          '',
          'Bạn vừa yêu cầu đặt lại mật khẩu cho tài khoản Reliva.',
          `Mã xác nhận: ${code}`,
          '',
          'Mã chỉ có hiệu lực trong 5 phút và chỉ được sử dụng một lần. Vui lòng không chia sẻ mã này với bất kỳ ai.',
          'Nếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua email này. Mật khẩu hiện tại của bạn vẫn được giữ nguyên.',
          '',
          'Đội ngũ Reliva',
        ].join('\n'),
        html: `<!doctype html>
<html lang="vi"><body style="margin:0;padding:28px;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
  <main style="max-width:520px;margin:auto;padding:28px;background:#fff;border:1px solid #e2e8f0;border-radius:14px;">
    <p style="margin:0 0 8px;color:#1d4ed8;font-weight:700;letter-spacing:1px;">RELIVA · BẢO MẬT TÀI KHOẢN</p>
    <h1 style="font-size:22px;margin:0 0 12px;">Đặt lại mật khẩu</h1>
    <p style="line-height:1.6;color:#475569;">Bạn vừa yêu cầu đặt lại mật khẩu. Nhập mã xác nhận bên dưới để tiếp tục:</p>
    <p style="padding:18px;text-align:center;background:#eff6ff;border-radius:10px;color:#1d4ed8;font-family:Consolas,monospace;font-size:30px;font-weight:700;letter-spacing:8px;">${code}</p>
    <p style="line-height:1.6;color:#475569;">Mã có hiệu lực trong <strong>5 phút</strong> và chỉ dùng được một lần. Không chia sẻ mã này với bất kỳ ai.</p>
    <p style="padding:12px;background:#f8fafc;border-radius:8px;line-height:1.6;color:#475569;">Nếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua email này. Mật khẩu hiện tại vẫn được giữ nguyên.</p>
    <p style="margin:20px 0 0;color:#64748b;font-size:12px;">Email tự động từ Reliva. Vui lòng không trả lời thư này.</p>
  </main>
</body></html>`,
      });
      return true;
    } catch (error) {
      this.logger.warn(`EMAIL_SEND_FAILED ${EmailSenderService.failureReason(error)}`);
      return false;
    } finally {
      transport?.close();
    }
  }

  /**
   * Stable, secret-free description of a transport failure: only the nodemailer/Node error code and the SMTP
   * response code, each checked against a strict pattern. Never the message, address, host or credentials.
   */
  private static failureReason(error: unknown): string {
    const source = (typeof error === 'object' && error !== null ? error : {}) as { code?: unknown; responseCode?: unknown };
    const code = typeof source.code === 'string' && /^[A-Z0-9_]{1,40}$/.test(source.code) ? source.code : 'UNKNOWN';
    const response = typeof source.responseCode === 'number' && Number.isInteger(source.responseCode)
      && source.responseCode >= 100 && source.responseCode <= 599 ? ` smtp_response=${source.responseCode}` : '';
    return `code=${code}${response}`;
  }
}
