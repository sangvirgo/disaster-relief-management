# 📱 Hướng Dẫn Vận Hành Ứng Dụng Di Động - Cứu Trợ Thiên Tai (C48 Mobile)

Ứng dụng di động xây dựng bằng **React Native + Expo SDK 58 (TypeScript)**, kết nối trực tiếp với hệ sinh thái microservices NestJS (Identity, Response, Logistics qua API Gateway Nginx).

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
cd mobile
```

### Bước 2: Khởi động Expo Development Server
```bash
npx expo start -c
```
*(Thêm cờ `-c` để xóa cache Metro bundler khi có thay đổi cấu hình `.env`)*

### Bước 3: Trải nghiệm trên thiết bị
- **Cách 1 (Khuyên dùng - Điện thoại thật qua Expo Go):**
  1. Đảm bảo **điện thoại và máy tính kết nối chung một mạng Wi-Fi**.
  2. Cài đặt ứng dụng **Expo Go** từ Google Play Store (Android) hoặc App Store (iOS).
  3. Mở camera điện thoại (hoặc app Expo Go) quét mã QR hiển thị trên màn hình terminal.
  4. Ứng dụng đã được tích hợp cơ chế **tự động phát hiện IP máy tính host** qua Expo dev server, hoặc bạn có thể chỉnh sửa file `.env` nếu cần.
- **Cách 2 (Máy ảo Android Emulator):**
  1. Bật máy ảo Android Studio.
  2. Nhấn phím `a` trên terminal của VS Code để tự động mở ứng dụng trên máy ảo.

---

## ⚙️ 3. Cấu Hình Địa Chỉ API Backend

Địa chỉ API Backend được xử lý tự động trong file [`src/api/client.ts`](src/api/client.ts) và có thể tùy biến qua file `.env`:

- **Tự động nhận diện (Khi quét Expo Go):** Khi quét mã QR qua Expo Go trong cùng mạng Wi-Fi LAN, ứng dụng tự động trích xuất IP LAN của máy tính từ Metro bundler và kết nối tới `http://<IP_MÁY_TÍNH>:8080/api/v1`.
- **Cấu hình qua file `.env`:**
  File `mobile/.env` đã được tạo sẵn:
  ```env
  EXPO_PUBLIC_API_BASE_URL=http://192.168.1.2:8080/api/v1
  ```
  *(Nếu đổi mạng Wi-Fi, kiểm tra IPv4 của máy tính bằng lệnh `ipconfig` và cập nhật lại IP này).*
- **Các kịch bản kết nối:**
  - **Điện thoại thật (Cùng mạng Wi-Fi LAN):** `http://<IP_MÁY_TÍNH>:8080/api/v1`.
  - **Android Emulator (Máy ảo Android Studio):** `http://10.0.2.2:8080/api/v1`.
  - **iOS Simulator / Web:** `http://127.0.0.1:8080/api/v1`.
  - **Dùng mạng 4G/3G hoặc khác mạng Wi-Fi:** Mở tunnel (ngrok / Cloudflare Tunnel) trỏ tới cổng 8080 của máy tính, sau đó dán URL HTTPS vào `EXPO_PUBLIC_API_BASE_URL`.

- **Lưu ý về Tường lửa (Windows Firewall):** Nếu điện thoại vẫn báo không thể kết nối, hãy đảm bảo Windows Firewall cho phép kết nối Inbound đến cổng `8080` (hoặc tạm thời cho phép mạng Private).

- **Tài khoản test mẫu sẵn có trên hệ thống:**
  - **Đội trưởng cứu hộ:** `leader1` / `Password123!` (vào bảng điều khiển đội cứu nạn, nhận nhiệm vụ).
  - **Công dân mẫu:** `citizen1` / `Password123!` (xem tin báo, gửi cứu trợ người thân).
  - Hoặc tự đăng ký tài khoản công dân mới ngay trên app!
