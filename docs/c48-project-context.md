# Context đồ án C48: Quản lý ứng phó khẩn cấp và cứu trợ thiên tai

> Tài liệu context dành cho AI agent và thành viên dự án. Nội dung hợp nhất yêu cầu đề tài được cung cấp trong hội thoại với đề cương DOCX. Các lỗi dính chữ và định dạng trong DOCX đã được chuẩn hóa để dễ đọc; ý nghĩa nguồn được giữ lại. Đây là mô tả đề tài, chưa phải đặc tả thiết kế kỹ thuật đã được phê duyệt.

## 1. Thông tin đề tài

- **Mã đề tài:** C48
- **Tên tiếng Việt:** Hệ thống quản lý ứng phó khẩn cấp và cứu trợ thiên tai
- **Tên tiếng Anh trong đề cương:** Emergency Response and Disaster Relief Management System
- **Định hướng sản phẩm:** Hệ thống Web/Mobile kết nối người dân vùng thiên tai, tình nguyện viên, đội cứu hộ, trung tâm điều phối và cơ quan quản lý.
- **Thời lượng dự kiến trong đề cương:** 10 tuần

### Thông tin nhóm được cung cấp

Các dòng dưới đây giữ theo chuỗi thông tin ban đầu. Nguồn chưa có tiêu đề cột rõ ràng cho từng tên/người hướng dẫn, vì vậy không suy diễn vai trò:

| Chuỗi thông tin | Lớp |
|---|---|
| Trương Thị Mỹ Ngọc · N22DCCN068 · Nguyễn Lưu Tấn Sang | D22CQCNPM01-N |
| Trương Thị Mỹ Ngọc · N22DCCN071 · Vũ Ngọc Sơn | D22CQCNPM01-N |
| Trương Thị Mỹ Ngọc · N22DCCN088 · Đỗ Xuân Trí | D22CQCNPM01-N |

## 2. Bối cảnh và vấn đề

Lũ lụt, bão, sạt lở đất và các thiên tai khác gây ảnh hưởng đến người dân, chính quyền địa phương, lực lượng cứu hộ và các tổ chức tình nguyện. Thông tin cứu trợ có thể bị phân tán qua nhiều kênh, khiến việc xác minh yêu cầu khẩn cấp, điều phối nguồn lực, phân công đội cứu hộ và theo dõi tiến độ trở nên khó khăn.

Đồ án hướng tới một hệ thống thông tin tập trung để các nhóm liên quan tiếp nhận và xử lý yêu cầu SOS, phối hợp nhiệm vụ cứu hộ, quản lý nguồn lực cứu trợ và theo dõi quá trình phân phối hỗ trợ.

## 3. Mục tiêu và phạm vi nghiệp vụ

### Mục tiêu

- Tiếp nhận cảnh báo SOS/yêu cầu cứu trợ có vị trí GPS và thông tin sự cố; đề cương cũng nêu hình ảnh/video minh chứng.
- Hỗ trợ điều phối viên tiếp nhận, xác minh, ưu tiên và phân công nhiệm vụ.
- Hỗ trợ tình nguyện viên/đội cứu hộ nhận nhiệm vụ, cập nhật trạng thái và báo cáo kết quả.
- Quản lý kho, phương tiện, điểm cứu trợ và việc phân phối vật phẩm.
- Cung cấp dashboard theo dõi chiến dịch cứu trợ và báo cáo hoạt động.
- Nghiên cứu khả năng dùng AI để gợi ý mức ưu tiên hoặc phân tích dữ liệu hỗ trợ ra quyết định.

### Nhóm người dùng

1. **Người dân (Citizen)**
   - Đăng ký/đăng nhập hoặc gửi yêu cầu khẩn cấp.
   - Gửi SOS kèm vị trí, loại sự cố và số người cần hỗ trợ.
   - Theo dõi trạng thái xử lý và cập nhật tình trạng thực tế.

2. **Tình nguyện viên/đội cứu hộ (Volunteer/Rescue Team)**
   - Quản lý hồ sơ, kỹ năng và khả năng tham gia.
   - Nhận nhiệm vụ cứu hộ/cứu trợ, cập nhật tiến độ.
   - Tải ảnh hoặc bằng chứng hoàn thành nhiệm vụ.

3. **Điều phối viên (Coordinator)**
   - Quản lý và xác minh yêu cầu cứu trợ.
   - Ưu tiên yêu cầu, phân công đội cứu hộ/tình nguyện viên.
   - Theo dõi tiến độ trên bản đồ.

4. **Quản lý vận hành (Manager)**
   - Quản lý điểm cứu trợ, kho hàng và phương tiện.
   - Điều phối nguồn lực giữa các khu vực và quản lý chiến dịch cứu trợ.

5. **Quản trị hệ thống (Admin)**
   - Quản lý tài khoản và phân quyền.
   - Theo dõi hoạt động toàn hệ thống và tạo báo cáo thống kê.

## 4. Yêu cầu và chức năng được nêu trong đề tài

Danh sách dưới đây diễn đạt lại yêu cầu nguồn để dễ chuyển thành User Requirement, Functional Requirement và Non-functional Requirement trong SRS. Chưa gán mã yêu cầu hay tiêu chí định lượng.

### Yêu cầu người dùng (User Requirements)

- Người dân cần gửi SOS/yêu cầu hỗ trợ và biết yêu cầu đang được xử lý đến đâu.
- Đội cứu hộ/tình nguyện viên cần biết nhiệm vụ được giao và báo cáo tiến độ/kết quả.
- Điều phối viên cần xác minh yêu cầu, ưu tiên xử lý, giao nhiệm vụ và theo dõi tình hình trên bản đồ.
- Quản lý vận hành cần nắm chiến dịch, kho, phương tiện, điểm cứu trợ và phân phối nguồn lực.
- Quản trị viên cần quản lý người dùng, quyền truy cập và số liệu hoạt động.

### Yêu cầu chức năng (Functional Requirements)

- Xác thực người dùng và phân quyền theo vai trò (RBAC).
- Tạo SOS/yêu cầu cứu trợ; lưu loại sự cố, số người cần hỗ trợ, vị trí GPS và tệp minh chứng khi có.
- Tiếp nhận, xác minh, ưu tiên, phân công và cập nhật trạng thái yêu cầu cứu trợ.
- Quản lý hồ sơ, kỹ năng, khả năng tham gia của tình nguyện viên/đội cứu hộ.
- Quản lý nhiệm vụ; ghi nhận đội/người được giao, tiến độ, kết quả và bằng chứng hoàn thành.
- Quản lý chiến dịch cứu trợ, kho hàng, phương tiện, điểm cứu trợ và phân phối nguồn lực.
- Hiển thị vị trí/yêu cầu/nhiệm vụ trên bản đồ để phục vụ theo dõi và điều phối.
- Cung cấp dashboard và báo cáo thống kê hoạt động cứu trợ.
- Hỗ trợ quản lý tệp và thông báo theo yêu cầu kỹ thuật trong đề cương.
- Có thể nghiên cứu AI để gợi ý ưu tiên hoặc phân tích dữ liệu; đây là khả năng được đề xuất, chưa phải chức năng bắt buộc đã chốt.

### Yêu cầu phi chức năng (Non-functional Requirements)

Đề cương nêu các mục tiêu chất lượng nhưng chưa có chỉ số nghiệm thu cụ thể:

- Giao diện Web/Mobile dễ sử dụng trong tình huống khẩn cấp.
- Hệ thống ổn định, có bảo mật và có khả năng mở rộng.
- Theo dõi được hoạt động và hỗ trợ minh bạch quá trình phân phối cứu trợ.
- Cần xác định thêm các ngưỡng đo lường cho hiệu năng, khả dụng, bảo mật, lưu trữ dữ liệu vị trí/tệp và vận hành trong điều kiện mạng yếu.

## 5. Định hướng kiến trúc và kỹ thuật từ đề cương

- Có Backend cung cấp dịch vụ quản lý dữ liệu.
- Có Web Application cho Admin, Coordinator và Manager.
- Có Mobile Application cho Citizen và Volunteer.
- Thiết kế kiến trúc hệ thống, cơ sở dữ liệu, API, giao diện Web và Mobile.
- Xử lý dữ liệu vị trí GPS, phân quyền, tài nguyên và báo cáo thống kê.
- Triển khai xác thực, RBAC, quản lý tệp và thông báo.

Đề cương chưa chốt ngôn ngữ/language, framework, cơ sở dữ liệu, giao thức API, dịch vụ bản đồ, lưu trữ tệp, nền tảng triển khai hay cách đồng bộ khi mất kết nối. Agent cần trình bày đây là các lựa chọn cần phân tích, không coi chúng là quyết định sẵn có.

## 6. Yêu cầu nghiên cứu và phân tích

1. Phân tích bài toán quản lý cứu trợ thiên tai và vấn đề trong quy trình phối hợp cứu hộ.
2. Nghiên cứu hệ thống thông tin tập trung kết nối người dân, tình nguyện viên, đội cứu hộ và cơ quan quản lý.
3. Phân tích User Requirement, Functional Requirement và Non-functional Requirement.
4. Thiết kế kiến trúc Web App và Mobile App cho quản lý cứu trợ.
5. Nghiên cứu quản lý dữ liệu GPS, phân quyền người dùng, tài nguyên và báo cáo thống kê.
6. Tìm hiểu khả năng ứng dụng AI để hỗ trợ ưu tiên xử lý tình huống khẩn cấp.

## 7. Sản phẩm cần xây dựng và bàn giao

- Hệ thống Web/Mobile quản lý cứu trợ thiên tai.
- Chức năng gửi SOS, tạo yêu cầu hỗ trợ và cập nhật trạng thái cứu hộ.
- Module quản lý tình nguyện viên, đội cứu hộ và nhiệm vụ được giao.
- Dashboard quản lý chiến dịch, kho hàng và phân phối nguồn lực.
- Thiết kế cơ sở dữ liệu, API, giao diện và kiểm thử hệ thống.
- Tài liệu SRS, SDD, test case và hướng dẫn sử dụng.
- Đề cương cũng yêu cầu phân tích nghiệp vụ, actor/use case/business rules, tài liệu kỹ thuật và chuẩn bị demo/bảo vệ.

## 8. Kế hoạch dự kiến 10 tuần

| Tuần | Công việc theo đề cương |
|---|---|
| 1 | Khảo sát nghiệp vụ, phân tích yêu cầu, xây dựng SRS, use case và thiết kế cơ sở dữ liệu. |
| 2 | Thiết kế UI/UX, kiến trúc hệ thống và chuẩn bị môi trường phát triển. |
| 3–6 | Phát triển authentication/authorization, SOS/yêu cầu cứu trợ, nhiệm vụ cứu hộ, tình nguyện viên, kho/nguồn lực/điểm cứu trợ, dashboard và bản đồ. |
| 7 | Hoàn thiện tích hợp, kiểm thử hệ thống và sửa lỗi. |
| 8 | Hoàn thiện tài liệu, báo cáo kỹ thuật và chuẩn bị demo. |
| 9 | Demo sản phẩm và bảo vệ đồ án. |
| 10 | Dự phòng. |

## 9. Tiêu chí đánh giá

- Hiểu và mô hình hóa đúng nghiệp vụ ứng phó thiên tai.
- Chất lượng phân tích và thiết kế hệ thống.
- Mức độ hoàn thiện của Web/Mobile Application.
- Tính ổn định, bảo mật và khả năng mở rộng.
- Chất lượng UI/UX và trải nghiệm người dùng.
- Chất lượng tài liệu, kiểm thử và trình bày sản phẩm.

## 10. Nguyên tắc làm rõ yêu cầu khi tiếp tục dự án

- Tách dữ kiện trong đề cương khỏi đề xuất thiết kế của nhóm.
- Làm rõ quy trình và quyền của từng vai trò trước khi thiết kế chi tiết API/database.
- Xác định trạng thái yêu cầu SOS, trạng thái nhiệm vụ, quy tắc ưu tiên, xác minh, hủy và xử lý trùng lặp.
- Làm rõ yêu cầu GPS: thời điểm lấy vị trí, độ chính xác, cập nhật vị trí, quyền riêng tư và hành vi khi không có mạng.
- Định nghĩa cách theo dõi tồn kho, điều chuyển và ghi nhận phân phối để báo cáo có thể kiểm tra lại.
- Đặt chỉ số nghiệm thu cụ thể cho các yêu cầu phi chức năng.
- Coi kết quả AI là nội dung nghiên cứu/đề xuất cho tới khi phạm vi và cách con người phê duyệt được xác định.
