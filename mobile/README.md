# 📱 Hướng Dẫn Vận Hành Ứng Dụng Di Động - Cứu Trợ Thiên Tai (C48 Mobile)

Ứng dụng di động xây dựng bằng **React Native + Expo SDK 57 (TypeScript)**, kết nối trực tiếp với hệ sinh thái microservices NestJS (Identity, Response, Logistics).

---

## 🌟 1. Cấu Trúc Các Màn Hình Đã Triển Khai

| Màn hình | Mục đích & Nghiệp vụ | Đối tượng sử dụng |
|---|---|---|
| **`EmergencyHomeScreen`** | Trang chủ khẩn cấp, nút SOS lớn trung tâm, tra cứu nhanh bằng mã, hướng dẫn đường dây nóng 113/114/115 | Tất cả người dân |
| **`CreateSOSScreen`** | Gửi yêu cầu cứu nạn khẩn cấp tại chỗ (`SELF`), tự động bắt GPS, chọn số người, đánh dấu nguy cơ tính mạng tức thời | Nạn nhân tại hiện trường (Không cần đăng nhập) |
| **`ProxySOSScreen`** | Báo cứu trợ từ xa cho hộ gia đình người thân (`PROXY`), chọn tọa độ hộ gia đình trên bản đồ, ghi chú liên lạc | Người thân có tài khoản công dân |
| **`SOSTrackingScreen`** | Tra cứu tiến trình xử lý cứu hộ theo Timeline (Tiếp nhận ➔ Xác minh ➔ Phân loại ➔ Điều phối ➔ Đang cứu ➔ Hoàn thành), bổ sung thông tin | Người dân đã gửi SOS |
| **`DonationScreen`** | Xem các đợt tiếp nhận hàng cứu trợ mở, khai báo bàn giao hiện vật (mì tôm, nước suối, áo phao...), tra cứu kiểm đếm | Người hảo tâm / Quyên góp |
| **`LoginScreen`** | Đăng nhập tài khoản hệ thống (hỗ trợ cả Công dân và Đội cứu hộ/Tình nguyện viên) | Tất cả người dùng |
| **`RegisterScreen`** | Đăng ký tài khoản Công dân mới, chuẩn hóa NFC, tự động cấp quyền `CITIZEN` | Người dân tự tạo tài khoản |
| **`TeamDashboardScreen`** | Bảng điều khiển đội cứu hộ, bật/tắt trạng thái Sẵn sàng nhận lệnh, phát tín hiệu tọa độ GPS di quân của đội | Đội trưởng / Thành viên đội |
| **`MissionListScreen`** | Danh sách nhiệm vụ cứu trợ được chỉ định (Tab: Mới nhận, Đang cứu, Lịch sử) | Đội cứu hộ |
| **`MissionDetailScreen`** | Chi tiết hiện trường nạn nhân, mở bản đồ chỉ đường Google Maps, gọi điện thoại, Tiếp nhận / Bắt đầu di chuyển / Đã tiếp cận / Hoàn thành | Đội trưởng cứu nạn |

---

## 🚀 2. Hướng Dẫn Chạy Trên Visual Studio Code

### Bước 1: Mở Terminal tại thư mục `mobile`
```bash
cd e:\disaster-relief-management\mobile
```

### Bước 2: Khởi động Expo Development Server
```bash
npx expo start
```

### Bước 3: Trải nghiệm trên thiết bị
- **Cách 1 (Khuyên dùng - Điện thoại thật):**
  1. Cài đặt ứng dụng **Expo Go** từ Google Play Store (Android) hoặc App Store (iOS).
  2. Mở camera điện thoại (hoặc app Expo Go) quét mã QR hiển thị trên màn hình terminal của VS Code.
- **Cách 2 (Máy ảo Android Emulator):**
  1. Bật máy ảo Android Studio.
  2. Nhấn phím `a` trên terminal của VS Code để tự động mở ứng dụng trên máy ảo.

---

## ⚙️ 3. Cấu Hình Địa Chỉ API Backend

Địa chỉ IP máy chủ API được cấu hình tại file `src/api/client.ts`:
- **Chạy trên Android Emulator:** Dùng `http://10.0.2.2:8080/api/v1` (mặc định đã cấu hình sẵn).
- **Chạy trên Thiết bị thật (Cùng mạng Wifi LAN):** Đổi thành `http://<IP_MÁY_TÍNH>:8080/api/v1` (Ví dụ: `http://192.168.1.15:8080/api/v1`).

---

## ⚡ 4. Chế Độ Mô Phỏng Offline (Không Cần Bật Docker Backend)

Ứng dụng đã tích hợp sẵn **Mock Backend Adapter** (`src/api/mockBackend.ts`), cho phép bạn và bạn bè trải nghiệm 100% giao diện, tính năng, bắt GPS, chụp ảnh, đăng ký/đăng nhập và chuyển bước nhiệm vụ cứu hộ mà **chưa cần khởi động Docker hay bật server Backend**.

* **Bật/Tắt chế độ:** Mở file `src/api/mockBackend.ts`:
  ```typescript
  export const USE_MOCK_DATA = true; // Đang bật giả lập để code & test UI
  // Khi bạn của bạn bật Docker xong, chỉ cần đổi thành:
  export const USE_MOCK_DATA = false; // Kết nối trực tiếp vào Docker Backend thật
  ```
* **Tài khoản test sẵn có:**
  - **Đội trưởng cứu hộ:** `leader1` / `Password123!` (vào bảng điều khiển đội cứu nạn, nhận nhiệm vụ).
  - **Công dân mẫu:** `citizen1` / `Password123!` (xem tin báo, gửi cứu trợ người thân).
  - Hoặc tự đăng ký tài khoản công dân mới ngay trên app!
