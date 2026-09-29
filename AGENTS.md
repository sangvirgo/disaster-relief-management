# Hướng dẫn agent cho đồ án C48

Đây là workspace cho đề tài **Hệ thống quản lý ứng phó khẩn cấp và cứu trợ thiên tai** (*Emergency Response and Disaster Relief Management System*).

## Context cần đọc

Trước khi phân tích yêu cầu, thiết kế hoặc triển khai, hãy đọc [`docs/c48-project-context.md`](docs/c48-project-context.md). Tài liệu đó hợp nhất thông tin đề tài được giao với đề cương DOCX và là nguồn context chính của dự án.

## Phạm vi chính

- Hệ thống Web/Mobile kết nối người dân, tình nguyện viên/đội cứu hộ, điều phối viên, quản lý vận hành và quản trị viên.
- Các luồng trọng tâm: gửi SOS/yêu cầu hỗ trợ có vị trí; xác minh, ưu tiên và phân công cứu hộ; cập nhật tiến độ; quản lý chiến dịch, kho, phương tiện, điểm cứu trợ và phân phối nguồn lực; dashboard và báo cáo.
- Sản phẩm cần có tài liệu SRS, SDD, test case và hướng dẫn sử dụng.

## Quy ước khi làm việc

- Trao đổi và viết tài liệu bằng tiếng Việt, trừ tên chuẩn kỹ thuật hoặc khi người dùng yêu cầu ngôn ngữ khác.
- Chưa có công nghệ, giao thức API, nhà cung cấp bản đồ, ngưỡng hiệu năng hay chính sách lưu trữ nào được chốt. Không tự coi các lựa chọn đó là yêu cầu; hãy ghi rõ giả định hoặc đề xuất để xác nhận.
- Phân biệt yêu cầu có trong đề cương với đề xuất thiết kế mới. AI hiện là hướng nghiên cứu hỗ trợ ưu tiên/phân tích, chưa phải yêu cầu bắt buộc hay quyết định tự động.
- Khi bổ sung chi tiết nghiệp vụ, kiểm tra tài liệu context trước và giữ nhất quán giữa Web, Mobile, API và dữ liệu.
