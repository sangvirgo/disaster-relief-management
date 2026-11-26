import { apiClient } from './client';
import {
  DonationDrive,
  DonationDeclarationPayload,
  DonationTrackingDetail,
  DonationEvidenceReference,
  ReviseDonationDeclarationPayload,
  PublicDonationReportSummary,
  EvidenceDownload,
  CollectionPage,
  DonationSummary,
} from '../types/api';
import { generateUUID } from '../utils/secureStore';

/** Supply requests (2026-11-26): the team asks for goods from its mission; the warehouse hands them over against a code. */
export type SupplyStatus = 'READY' | 'HANDED_OVER' | 'CANCELLED' | 'EXPIRED';
export interface SupplyTeamRequest {
  id: string;
  mission_id: string;
  team_name: string;
  status: SupplyStatus;
  pickup_code: string | null;
  warehouse: { id: string; name: string; address_note: string | null; location: { lat: number; lng: number } | null };
  expires_at: string;
  handed_over_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  version: number;
  created_at: string;
  has_shortfall: boolean;
  lines: { item_id: string; item_name: string; unit_name: string; requested_quantity: string; reserved_quantity: string; shortfall_quantity: string }[];
}
export interface MissionSupply { items: SupplyTeamRequest[]; can_request: boolean }
export interface SupplySuggestionLine {
  item_id: string; item_name: string; unit_name: string; quantity: string; basis: 'AI_TEXT' | 'NORM' | 'CONFIRMED';
}
export interface CatalogItemOption { id: string; name: string; status: string; unit?: { display_name?: string; scale?: number } }

export const LogisticsApi = {
  async getMissionSupply(missionId: string): Promise<MissionSupply> {
    const response = await apiClient.get<MissionSupply>('/logistics/supply-requests', { params: { mission_id: missionId } });
    return response.data;
  },

  async getSupplySuggestion(missionId: string): Promise<SupplySuggestionLine[]> {
    const response = await apiClient.get<{ lines: SupplySuggestionLine[] }>('/logistics/supply-requests/suggestion', { params: { mission_id: missionId } });
    return response.data.lines;
  },

  async getCatalogItems(): Promise<CatalogItemOption[]> {
    const items: CatalogItemOption[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const response = await apiClient.get<CollectionPage<CatalogItemOption>>('/logistics/items', { params: { limit: 100, ...(cursor ? { cursor } : {}) } });
      items.push(...response.data.items);
      cursor = response.data.more ? response.data.cursor ?? undefined : undefined;
      if (!cursor) break;
    }
    return items.filter((item) => item.status === 'ACTIVE');
  },

  async createSupplyRequest(missionId: string, lines: { item_id: string; quantity: string }[], idempotencyKey: string): Promise<SupplyTeamRequest> {
    const response = await apiClient.post<SupplyTeamRequest>('/logistics/supply-requests', { mission_id: missionId, lines }, {
      headers: { 'Idempotency-Key': idempotencyKey },
    });
    return response.data;
  },

  async cancelSupplyRequest(id: string, version: number, reason: string, idempotencyKey: string): Promise<SupplyTeamRequest> {
    const response = await apiClient.post<SupplyTeamRequest>(`/logistics/supply-requests/${id}/cancel`, { expected_version: version, reason }, {
      headers: { 'Idempotency-Key': idempotencyKey },
    });
    return response.data;
  },

  // Lấy danh sách các đợt tiếp nhận quyên góp cứu trợ đang mở
  async getPublicDonationDrives(
    limit = 50,
    cursor?: string,
    position?: { lat: number; lng: number } | null,
  ): Promise<CollectionPage<DonationDrive>> {
    const response = await apiClient.get<CollectionPage<DonationDrive>>(
      '/logistics/public/donation-drives',
      { params: { limit, ...(cursor ? { cursor } : {}), ...(position ? { lat: position.lat, lng: position.lng } : {}) } }
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
  ): Promise<{ id: string; public_code: string; status: 'DECLARED'; declaration_revision: number }> {
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
  ): Promise<DonationEvidenceReference> {
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

    const response = await apiClient.post<DonationEvidenceReference>(`/logistics/public/donations/${donationId}/evidence`, formData, {
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

  // Danh sách phiếu quyên góp của tài khoản đã đăng nhập (GET /logistics/public/donations/mine)
  async getMyDonations(limit = 50, cursor?: string): Promise<CollectionPage<DonationSummary>> {
    const response = await apiClient.get<CollectionPage<DonationSummary>>('/logistics/public/donations/mine', {
      params: { limit, cursor },
    });
    return response.data;
  },

  // Tra cứu hàng loạt phiếu của khách bằng cặp (id, mã bí mật) (POST /logistics/public/donations/lookup)
  async lookupGuestDonations(items: { id: string; secret: string }[]): Promise<{ items: DonationSummary[]; unavailable: string[] }> {
    const response = await apiClient.post<{ items: DonationSummary[]; unavailable: string[] }>(
      '/logistics/public/donations/lookup',
      { items },
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
