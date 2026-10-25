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
    } catch {
      return false;
    } finally {
      transport?.close();
    }
  }
}
