import { apiClient } from './client';
import {
  CreateSOSPayload,
  CreateProxySOSPayload,
  CreateSOSResponse,
  RequestTrackingDetail,
  MyRequestItem,
  Mission,
  MissionStatus,
  RescueTeam,
  RescueTeamDetail,
  GeoLocation,
  ReporterEventPage,
  EvidenceDownload,
  CollectionPage,
  PublicCampaign,
} from '../types/api';
import { generateUUID } from '../utils/secureStore';

export const ResponseApi = {
  // === GỬI YÊU CẦU CỨU NẠN (INTAKE) ===

  // 1. Gửi SOS cho bản thân / tại chỗ (Hỗ trợ Khách hoặc Đã đăng nhập)
  async createSelfSOS(
    payload: CreateSOSPayload,
    trackingSecret: string,
    idempotencyKey: string
  ): Promise<CreateSOSResponse> {
    const response = await apiClient.post<CreateSOSResponse>('/response/requests', payload, {
      headers: {
        'Idempotency-Key': idempotencyKey,
        'X-Tracking-Secret': trackingSecret,
      },
    });
    return response.data;
  },

  // 2. Báo cứu hộ cho người thân từ xa (Yêu cầu đăng nhập tài khoản)
  async createProxySOS(payload: CreateProxySOSPayload, idempotencyKey?: string): Promise<CreateSOSResponse> {
    const response = await apiClient.post<CreateSOSResponse>('/response/requests/proxy', payload, {
      headers: {
        'Idempotency-Key': idempotencyKey || generateUUID(),
      },
    });
    return response.data;
  },

  // === TRA CỨU TIẾN ĐỘ & BỔ SUNG THÔNG TIN ===

  // Tra cứu chi tiết yêu cầu bằng mã và chuỗi bí mật
  async trackRequest(trackingCode: string, trackingSecret?: string): Promise<RequestTrackingDetail> {
    const headers: Record<string, string> = {
      'X-Tracking-Code': trackingCode,
    };
    if (trackingSecret) {
      headers['X-Tracking-Secret'] = trackingSecret;
    }

    const response = await apiClient.get<RequestTrackingDetail>('/response/requests/track', {
      headers,
    });
    return response.data;
  },

  // Bổ sung thông tin cho yêu cầu cứu hộ đang xử lý
  async supplementRequest(
    requestId: string,
    payload: {
      expected_version: number;
      description?: string;
      household_reference_note?: string;
      people_affected?: number | null;
      location?: GeoLocation;
      reporter_declared_danger?: boolean;
    },
    trackingCode?: string,
    trackingSecret?: string,
    idempotencyKey?: string
  ): Promise<any> {
    const headers: Record<string, string> = {
      'Idempotency-Key': idempotencyKey || generateUUID(),
    };
    if (trackingCode) {
      headers['X-Tracking-Code'] = trackingCode;
    }
    if (trackingSecret) {
      headers['X-Tracking-Secret'] = trackingSecret;
    }

    const response = await apiClient.post(`/response/requests/${requestId}/supplements`, payload, {
      headers,
    });
    return response.data;
  },

  // Replace editable SOS facts before verification (PUT /requests/:id/report).
  async updateReport(
    requestId: string,
    payload: {
      expected_version: number;
      description?: string | null;
      household_reference_note?: string | null;
      people_affected?: number | null;
      children_count?: number | null;
      elderly_count?: number | null;
      location?: GeoLocation;
      reporter_declared_danger?: boolean;
      needs_rescue?: boolean;
      needs_relief_supplies?: boolean;
    },
    trackingCode?: string,
    trackingSecret?: string,
    idempotencyKey?: string,
  ): Promise<{ id: string; version: number }> {
    const headers: Record<string, string> = {
      'Idempotency-Key': idempotencyKey || generateUUID(),
    };
    if (trackingCode) headers['X-Tracking-Code'] = trackingCode;
    if (trackingSecret) headers['X-Tracking-Secret'] = trackingSecret;
    const response = await apiClient.put<{ id: string; version: number }>(
      `/response/requests/${requestId}/report`,
      payload,
      { headers },
    );
    return response.data;
  },

  // Danh sách các yêu cầu cứu trợ của tài khoản đã đăng nhập (GET /response/requests/mine)
  async getMyRequests(limit = 50, cursor?: string): Promise<{ items: MyRequestItem[]; more: boolean; cursor?: string }> {
    const params: Record<string, any> = { limit };
    if (cursor) params.cursor = cursor;
    const response = await apiClient.get<{ items: MyRequestItem[]; more: boolean; cursor?: string }>('/response/requests/mine', {
      params,
    });
    return response.data;
  },

  // Gắn yêu cầu cứu trợ ẩn danh vào tài khoản công dân đã đăng nhập (POST /response/requests/claim)
  async claimRequest(
    trackingCode: string,
    trackingSecret: string,
    idempotencyKey?: string
  ): Promise<{ id: string; tracking_code: string }> {
    const response = await apiClient.post<{ id: string; tracking_code: string }>(
      '/response/requests/claim',
      {
        tracking_code: trackingCode,
      },
      {
        headers: {
          'Idempotency-Key': idempotencyKey || generateUUID(),
          'X-Tracking-Secret': trackingSecret,
        },
      }
    );
    return response.data;
  },

  // Tải lên ảnh / video bằng chứng hiện trường của người dân (POST /response/requests/:id/evidence)
  async uploadEvidence(
    requestId: string,
    file: { uri: string; name: string; type: string },
    trackingCode?: string,
    trackingSecret?: string,
    idempotencyKey?: string
  ): Promise<any> {
    const formData = new FormData();
    formData.append('file', file as any);

    const headers: Record<string, string> = {
      'Content-Type': 'multipart/form-data',
      'Idempotency-Key': idempotencyKey || generateUUID(),
    };
    if (trackingCode) headers['X-Tracking-Code'] = trackingCode;
    if (trackingSecret) headers['X-Tracking-Secret'] = trackingSecret;

    const response = await apiClient.post(`/response/requests/${requestId}/evidence`, formData, {
      headers,
      timeout: 60000,
    });
    return response.data;
  },

  // === NHIỆM VỤ ĐỘI CỨU HỘ (MISSIONS) ===

  // Lấy danh sách nhiệm vụ phân công cho đội của tôi
  async getMyMissions(limit = 50, cursor?: string): Promise<CollectionPage<Mission>> {
    const params: Record<string, any> = { limit };
    if (cursor) params.cursor = cursor;
    const response = await apiClient.get<CollectionPage<Mission>>('/response/missions/mine', { params });
    return response.data;
  },

  // Chi tiết nhiệm vụ cứu nạn
  async getMissionDetail(missionId: string): Promise<Mission> {
    const response = await apiClient.get<Mission>(`/response/missions/${missionId}`);
    return response.data;
  },

  // Đội trưởng tiếp nhận nhiệm vụ (POST /response/missions/:id/accept)
  async acceptMission(missionId: string, expectedVersion: number, idempotencyKey?: string): Promise<void> {
    await apiClient.post(
      `/response/missions/${missionId}/accept`,
      {
        expected_version: expectedVersion,
      },
      {
        headers: {
          'Idempotency-Key': idempotencyKey || generateUUID(),
        },
      }
    );
  },

  // Đội trưởng từ chối nhiệm vụ (POST /response/missions/:id/decline)
  async declineMission(
    missionId: string,
    expectedVersion: number,
    reason: string,
    idempotencyKey?: string
  ): Promise<void> {
    await apiClient.post(
      `/response/missions/${missionId}/decline`,
      {
        expected_version: expectedVersion,
        reason,
      },
      {
        headers: {
          'Idempotency-Key': idempotencyKey || generateUUID(),
        },
      }
    );
  },

  // Cập nhật bước tiến độ nhiệm vụ (POST /response/missions/:id/transition)
  async transitionMission(
    missionId: string,
    expectedVersion: number,
    toStatus: MissionStatus,
    note?: string,
    outcomeNote?: string,
    idempotencyKey?: string
  ): Promise<void> {
    const payload: any = {
      expected_version: expectedVersion,
      to: toStatus,
      note,
    };
    if (outcomeNote) {
      payload.result = { outcome_note: outcomeNote };
    }

    await apiClient.post(`/response/missions/${missionId}/transition`, payload, {
      headers: {
        'Idempotency-Key': idempotencyKey || generateUUID(),
      },
    });
  },

  // Tải lên ảnh / video bằng chứng cứu nạn của Đội cứu hộ (POST /response/missions/:id/evidence)
  async uploadMissionEvidence(
    missionId: string,
    file: { uri: string; name: string; type: string },
    idempotencyKey?: string
  ): Promise<any> {
    const formData = new FormData();
    formData.append('file', file as any);

    const headers: Record<string, string> = {
      'Content-Type': 'multipart/form-data',
      'Idempotency-Key': idempotencyKey || generateUUID(),
    };

    const response = await apiClient.post(`/response/missions/${missionId}/evidence`, formData, {
      headers,
    });
    return response.data;
  },

  // === ĐỘI CỨU HỘ & TỌA ĐỘ GPS (TEAMS) ===

  // Lấy thông tin đội của tôi
  async getMyTeams(limit = 50, cursor?: string): Promise<CollectionPage<RescueTeam>> {
    const response = await apiClient.get<CollectionPage<RescueTeam>>('/response/teams', {
      params: { limit, ...(cursor ? { cursor } : {}) },
    });
    return response.data;
  },

  // Cập nhật vị trí di quân hiện tại của Đội cứu hộ (PUT /response/teams/:id/position)
  async updateTeamPosition(teamId: string, location: GeoLocation, note?: string): Promise<void> {
    await apiClient.put(`/response/teams/${teamId}/position`, {
      location: {
        type: 'Point',
        coordinates: location.coordinates,
        source: location.source || 'GPS',
      },
      accuracy_m: location.accuracy_m,
      captured_at: location.captured_at || new Date().toISOString(),
      note,
    });
  },

  // Cập nhật trạng thái sẵn sàng của Đội cứu hộ (PATCH /response/teams/:id)
  async updateTeamAvailability(
    teamId: string,
    expectedVersion: number,
    availability: 'AVAILABLE' | 'UNAVAILABLE',
    idempotencyKey?: string
  ): Promise<void> {
    await apiClient.patch(
      `/response/teams/${teamId}`,
      {
        expected_version: expectedVersion,
        availability,
      },
      {
        headers: {
          'Idempotency-Key': idempotencyKey || generateUUID(),
        },
      }
    );
  },

  async confirmTeamReadiness(
    teamId: string,
    expectedVersion: number,
    confirmationBasis: 'RADIO' | 'PHONE' | 'IN_PERSON' | 'OTHER',
    reportedBy?: string,
    idempotencyKey = generateUUID()
  ): Promise<void> {
    await apiClient.post(`/response/teams/${teamId}/ready`, {
      expected_version: expectedVersion,
      confirmation_basis: confirmationBasis,
      ...(reportedBy?.trim() ? { reported_by: reportedBy.trim() } : {}),
      occurred_at: new Date().toISOString(),
    }, { headers: { 'Idempotency-Key': idempotencyKey } });
  },

  // === THÔNG BÁO ĐIỀU PHỐI (NOTICES) & CHIẾN DỊCH (CAMPAIGNS) ===

  // Lấy danh sách thông báo điều phối khẩn cho tài khoản đã đăng nhập (GET /response/notices)
  async getNotices(
    unread?: boolean,
    limit = 50,
    cursor?: string
  ): Promise<{ items: any[]; more: boolean; cursor?: string }> {
    const params: Record<string, any> = { limit };
    if (unread !== undefined) params.unread = unread ? 'true' : 'false';
    if (cursor) params.cursor = cursor;
    const response = await apiClient.get<{ items: any[]; more: boolean; cursor?: string }>(
      '/response/notices',
      { params }
    );
    return response.data;
  },

  // Đánh dấu đã đọc thông báo (POST /response/notices/:id/read)
  async markNoticeRead(noticeId: string): Promise<{ id: string; read_at: string }> {
    const response = await apiClient.post<{ id: string; read_at: string }>(`/response/notices/${noticeId}/read`);
    return response.data;
  },

  // Lấy danh sách chiến dịch cứu trợ mở công khai (GET /response/public/campaigns)
  async getPublicCampaigns(limit = 50, cursor?: string): Promise<CollectionPage<PublicCampaign>> {
    const params: Record<string, any> = { limit };
    if (cursor) params.cursor = cursor;
    const response = await apiClient.get<CollectionPage<PublicCampaign>>('/response/public/campaigns', {
      params,
    });
    return response.data;
  },

  async recoverRequest(trackingCode: string, recoveryCode: string, idempotencyKey = generateUUID()): Promise<{ id: string; tracking_code: string }> {
    const response = await apiClient.post<{ id: string; tracking_code: string }>(
      '/response/requests/recover',
      { tracking_code: trackingCode.trim().toUpperCase() },
      { headers: { 'Idempotency-Key': idempotencyKey, 'X-Recovery-Code': recoveryCode.trim() } }
    );
    return response.data;
  },

  // Lấy danh sách sự kiện chi tiết của Yêu cầu cứu hộ (GET /response/requests/:id/events)
  async getRequestEvents(
    requestId: string,
    trackingCode?: string,
    trackingSecret?: string,
    cursor?: string,
    limit = 50
  ): Promise<ReporterEventPage> {
    const headers: Record<string, string> = {};
    if (trackingCode) headers['X-Tracking-Code'] = trackingCode;
    if (trackingSecret) headers['X-Tracking-Secret'] = trackingSecret;

    const params: Record<string, any> = { limit };
    if (cursor) params.cursor = cursor;

    const response = await apiClient.get<ReporterEventPage>(`/response/requests/${requestId}/events`, {
      headers,
      params,
    });
    return response.data;
  },

  // Lấy link tải / xem ảnh bằng chứng cứu hộ an toàn 60s (GET /response/evidence/:id/download)
  async getEvidenceDownloadUrl(
    evidenceId: string,
    trackingCode?: string,
    trackingSecret?: string
  ): Promise<EvidenceDownload> {
    const headers: Record<string, string> = {};
    if (trackingCode) headers['X-Tracking-Code'] = trackingCode;
    if (trackingSecret) headers['X-Tracking-Secret'] = trackingSecret;

    const response = await apiClient.get<EvidenceDownload>(`/response/evidence/${evidenceId}/download`, {
      headers,
    });
    return response.data;
  },

  // Lấy thông tin chi tiết đầy đủ của Đội cứu hộ (GET /response/teams/:id)
  async getTeamDetail(teamId: string): Promise<RescueTeamDetail> {
    const response = await apiClient.get<RescueTeamDetail>(`/response/teams/${teamId}`);
    return response.data;
  },
};
