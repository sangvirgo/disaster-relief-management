import { apiClient } from './client';
import {
  DonationDrive,
  DonationDeclarationPayload,
  DonationTrackingDetail,
  ReviseDonationDeclarationPayload,
  PublicDonationReportSummary,
  EvidenceDownload,
  CollectionPage,
} from '../types/api';
import { generateUUID } from '../utils/secureStore';

export const LogisticsApi = {
  // Lấy danh sách các đợt tiếp nhận quyên góp cứu trợ đang mở
  async getPublicDonationDrives(limit = 50, cursor?: string): Promise<CollectionPage<DonationDrive>> {
    const response = await apiClient.get<CollectionPage<DonationDrive>>(
      '/logistics/public/donation-drives',
      { params: { limit, ...(cursor ? { cursor } : {}) } }
    );
    return response.data;
  },

  // Chi tiết đợt quyên góp
  async getDonationDriveDetail(driveId: string): Promise<DonationDrive> {
    const response = await apiClient.get<DonationDrive>(`/logistics/public/donation-drives/${driveId}`);
    return response.data;
  },

  // Người hảo tâm khai báo hàng cứu trợ đã bàn giao (Hỗ trợ Khách hoặc Đã đăng nhập)
  async declareDonation(
    driveId: string,
    payload: DonationDeclarationPayload,
    donationSecret: string,
    idempotencyKey: string
  ): Promise<{ id: string; public_code: string; status: string }> {
    const headers: Record<string, string> = {
      'Idempotency-Key': idempotencyKey,
    };
    headers['X-Donation-Secret'] = donationSecret;

    const response = await apiClient.post(`/logistics/public/donation-drives/${driveId}/deliveries`, payload, {
      headers,
    });
    return response.data;
  },

  // Tra cứu tiến độ tiếp nhận và kiểm đếm biên nhận hàng cứu trợ
  async trackDonation(donationIdOrCode: string, donationSecret?: string): Promise<DonationTrackingDetail> {
    const headers: Record<string, string> = {};
    if (donationSecret) {
      headers['X-Donation-Secret'] = donationSecret;
    }

    const response = await apiClient.get<DonationTrackingDetail>(`/logistics/public/donations/${encodeURIComponent(donationIdOrCode)}`, {
      headers,
    });
    return response.data;
  },

  // Tải ảnh kiện hàng hoặc biên lai bàn giao quyên góp (POST /logistics/public/donations/:id/evidence)
  async uploadDonationEvidence(
    donationId: string,
    file: { uri: string; name: string; type: string },
    donationSecret?: string,
    disputeId?: string
  ): Promise<any> {
    const formData = new FormData();
    formData.append('file', file as any);

    const headers: Record<string, string> = {
      'Content-Type': 'multipart/form-data',
      'Idempotency-Key': generateUUID(),
    };
    if (donationSecret) {
      headers['X-Donation-Secret'] = donationSecret;
    }

    const params: Record<string, string> = {};
    if (disputeId) {
      params.dispute_id = disputeId;
    }

    const response = await apiClient.post(`/logistics/public/donations/${donationId}/evidence`, formData, {
      headers,
      params,
    });
    return response.data;
  },

  // Lưu biên nhận quyên góp vào tài khoản công dân đã đăng nhập (POST /logistics/public/donations/:id/claim)
  async claimDonation(donationId: string, donationSecret?: string): Promise<any> {
    const headers: Record<string, string> = {
      'Idempotency-Key': generateUUID(),
    };
    if (donationSecret) {
      headers['X-Donation-Secret'] = donationSecret;
    }

    const response = await apiClient.post(
      `/logistics/public/donations/${donationId}/claim`,
      {},
      { headers }
    );
    return response.data;
  },

  async recoverDonation(publicCode: string, recoveryCode: string, idempotencyKey = generateUUID()): Promise<{ id: string; public_code: string }> {
    const response = await apiClient.post<{ id: string; public_code: string }>(
      '/logistics/public/donations/recover',
      { public_code: publicCode.trim().toUpperCase() },
      { headers: { 'Idempotency-Key': idempotencyKey, 'X-Recovery-Code': recoveryCode.trim() } }
    );
    return response.data;
  },

  // Mở khiếu nại kiểm đếm nếu phát hiện sai sót kiểm đếm tại kho (POST /logistics/public/donations/:id/disputes)
  async openDonationDispute(donationId: string, reason: string, donationSecret?: string): Promise<any> {
    const headers: Record<string, string> = {
      'Idempotency-Key': generateUUID(),
    };
    if (donationSecret) {
      headers['X-Donation-Secret'] = donationSecret;
    }

    const response = await apiClient.post(
      `/logistics/public/donations/${donationId}/disputes`,
      { reason: reason.trim() },
      { headers }
    );
    return response.data;
  },

  // Chỉnh sửa bản khai số lượng hiện vật trước khi thủ kho kiểm đếm (POST /logistics/public/donations/:id/declarations)
  async reviseDonationDeclaration(
    donationId: string,
    payload: ReviseDonationDeclarationPayload,
    donationSecret?: string
  ): Promise<{ id: string; status: string; declaration_revision: number; version: number }> {
    const headers: Record<string, string> = {
      'Idempotency-Key': generateUUID(),
    };
    if (donationSecret) {
      headers['X-Donation-Secret'] = donationSecret;
    }

    const response = await apiClient.post(
      `/logistics/public/donations/${donationId}/declarations`,
      payload,
      { headers }
    );
    return response.data;
  },

  // Báo cáo tổng hợp quyên góp công khai (Minh bạch) (GET /logistics/public/donation-reports/summary)
  async getPublicDonationReportSummary(filter: {
    drive_id?: string;
    campaign_id?: string;
    warehouse_id?: string;
    limit?: number;
    cursor?: string;
  }): Promise<PublicDonationReportSummary> {
    const response = await apiClient.get<PublicDonationReportSummary>(
      '/logistics/public/donation-reports/summary',
      { params: filter }
    );
    return response.data;
  },

  // Lấy link tải / xem ảnh kiện hàng quyên góp đã upload (GET /logistics/evidence/:id/download)
  async getDonationEvidenceDownloadUrl(
    evidenceId: string,
    donationSecret?: string
  ): Promise<EvidenceDownload> {
    const headers: Record<string, string> = {};
    if (donationSecret) {
      headers['X-Donation-Secret'] = donationSecret;
    }

    const response = await apiClient.get<EvidenceDownload>(`/logistics/evidence/${evidenceId}/download`, {
      headers,
    });
    return response.data;
  },
};
