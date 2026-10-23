# Prototype Web responsive C48

Đây là bản thiết kế giao diện có thể bấm chuyển màn, **chưa nối API**. Tên, số lượng, trạng thái và thời gian đều là dữ liệu minh họa. Các nút xử lý nghiệp vụ chỉ báo rằng đây là prototype; không ghi hoặc thay đổi dữ liệu backend.

Sidebar dùng nền xanh da trời nhạt `#EAF2F6`; màn đang chọn có nền xanh lam dịu `#D1E5EF` và vạch xanh ở cạnh trái. Nút chính, tab đang chọn, tiêu đề và thẻ nhấn dùng cùng hệ xanh lam trầm `#315F77`/`#244B5F`. Các biểu tượng điều hướng là ảnh SVG riêng trong `assets/icons/`, có lớp tô màu xanh, bạc hà hoặc cát rất nhạt. [Kế hoạch triển khai frontend](../IMPLEMENTATION_PLAN.md) ghi thứ tự nối API và các điều kiện nghiệm thu cho session sau.

## Mở bản thiết kế

Từ thư mục gốc dự án, chạy `node frontend/prototype/serve.cjs`, rồi mở `http://127.0.0.1:5179`. Nếu cổng 5179 đang dùng, đặt biến môi trường `C48_PROTOTYPE_PORT` thành một cổng trống trước khi chạy. Có thể mở trực tiếp `index.html`, nhưng chạy máy chủ cục bộ giúp kiểm tra giống trình duyệt Web hơn.

Chọn vai trò ở góc trên, dùng menu bên trái để chuyển màn. Khi cửa sổ hẹp, menu mở bằng nút ở góc trái. Đây là **cùng một giao diện Web responsive**, không có bộ thiết kế ứng dụng Mobile riêng.

[Xem toàn bộ canvas Superdesign](https://superdesign.dev/teams/b004acb3-e22c-4dff-b18f-a07831aef849/projects/44bcd4b9-88e7-4731-a0fb-833c655183c9)

Canvas còn một bản thử nghiệm Mobile cũ từ vòng trước; bản đó không nằm trong 38 màn Web hiện tại.

## Màn hình theo vai trò

| Vai trò | Số màn | Điều hướng trong prototype | Màn mẫu trên canvas |
|---|---:|---|---|
| Người dân | 9 | Trang trợ giúp, tài khoản, gửi SOS, xác nhận đã gửi, theo dõi SOS, chiến dịch, đợt quyên góp, khai báo vật phẩm, theo dõi đóng góp | [Gửi SOS](https://p.superdesign.dev/draft/0b44bd0c-a5ef-40b7-9419-8ac7a62068de) |
| Đội cứu hộ | 5 | Tổng quan, nhiệm vụ, cập nhật tiến độ, hồ sơ và vị trí đội, thông báo | [Tổng quan](https://p.superdesign.dev/draft/490aa10b-5406-4399-8687-fe294de10f93) |
| Điều phối viên | 8 | Hàng đợi SOS, xác minh, quyết định ưu tiên, chọn đội, bản đồ/nhiệm vụ, thông báo, chiến dịch, báo cáo | [Hàng đợi SOS](https://p.superdesign.dev/draft/947aa3ad-53a8-4682-80de-594eeefcf01c) |
| Quản lý vận hành | 10 | Tổng quan, đợt quyên góp, tiếp nhận, duyệt biên nhận, kho, điểm/phương tiện, nhu cầu/cam kết, phân phối, bàn giao, đối soát/báo cáo | [Tổng quan](https://p.superdesign.dev/draft/823263e9-5fff-4af9-a6ad-6af876e23c5a) |
| Quản trị viên | 6 | Tổng quan, người dùng, tổ chức/thành viên, phân quyền, khu vực, nhật ký kiểm toán | [Người dùng](https://p.superdesign.dev/draft/360252a5-9a38-40f1-963c-38ca739a8c19) |

## Ranh giới backend cần giữ khi triển khai

- **SOS:** API hiện nhận biểu mẫu SELF/PROXY. Báo hộ yêu cầu đăng nhập; vị trí là của người gặp nạn. Người dân không tự đặt P1–P4. Điều phối viên xác minh rồi quyết định ưu tiên và giao đội.
- **Tin nhắn nhanh/LLM và điểm gợi ý:** chưa có API trích xuất hoặc chấm điểm lúc người dân gửi; prototype chỉ nhắc đến luồng dự kiến. Trường không trích xuất được phải để trống, người dùng kiểm tra trước khi gửi. Không gọi nhà cung cấp AI trực tiếp từ trình duyệt với dữ liệu SOS.
- **Đóng góp:** chỉ có vật phẩm hiện vật, kể cả guest. Bản khai chưa tăng tồn kho; nhân viên kiểm đếm, người khác duyệt và ghi sổ rồi mới có số được chấp nhận.
- **Quyền:** năm không gian giao diện gom các vai trò nghiệp vụ chi tiết của backend. Nút, dữ liệu và lệnh thực phải dựa trên grant và phạm vi thật; Quản trị viên không tự động xem hồ sơ SOS hoặc người quyên góp.

Hệ màu dùng nền sáng, xanh trầm và xanh ngọc; đỏ san hô chỉ cho dấu hiệu khẩn hoặc chênh lệch cần chú ý. Cấu trúc Điều phối tham chiếu màn Figma `0:3` của file `0odUVYiPvYyRqvxGYgcWms`.
