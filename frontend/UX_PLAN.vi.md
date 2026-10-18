# Kế hoạch màn hình Web C48 — bản đề xuất để duyệt

**Phạm vi:** Web responsive cho 5 nhóm người dùng. Mobile app do nhóm khác thực hiện; không thiết kế bộ màn Mobile riêng. Đây là kế hoạch UI/UX và prototype dùng dữ liệu minh họa, chưa phải frontend đã tích hợp backend hay tính năng AI.

## 1. Quy tắc phân vai

Năm nhóm giao diện là **Người dân**, **Tình nguyện viên/Đội cứu hộ**, **Điều phối viên**, **Quản lý vận hành**, **Quản trị viên**. Backend có nhiều role code chi tiết hơn (`CITIZEN`, `VOLUNTEER`, `COORDINATOR`, `CAMPAIGN_MANAGER`, `OPERATIONS_MANAGER`, `INTAKE_STAFF`, `REVIEWER`, `DISTRIBUTION_STAFF`, `ADMIN`). Web gom các quyền kho, tiếp nhận, duyệt và phân phối vào không gian **Quản lý vận hành**, nhưng từng thao tác chỉ hiện và hoạt động theo grant thật của người đăng nhập. Một người có nhiều grant có thể chuyển không gian. Guest chỉ thấy các luồng công khai hoặc dùng mã theo dõi riêng tư.

Quản trị viên không mặc nhiên được xem chi tiết SOS, nạn nhân hay người quyên góp. Ẩn nút theo quyền giúp giao diện rõ hơn; backend vẫn là nơi quyết định quyền truy cập.

## 2. Sơ đồ màn hình theo actor

| Nhóm | Màn hình chính | Hành động quan trọng | Nguồn backend hiện có |
|---|---|---|---|
| Người dân | Trang chủ trợ giúp; chọn cách gửi SOS; biểu mẫu SOS; tin nhắn nhanh và rà soát bản nháp; kết quả gửi; theo dõi SOS; chiến dịch; đợt quyên góp; khai báo vật phẩm; theo dõi đóng góp; thông báo của tôi | Gửi cho chính mình hoặc báo hộ, bổ sung tình hình/bằng chứng, xem tiến độ, khai báo và theo dõi vật phẩm | Response SELF/PROXY, tracking/supplements/evidence, public campaigns; Logistics public drives/deliveries/donation tracking |
| Tình nguyện viên/Đội cứu hộ | Tổng quan nhiệm vụ; danh sách và chi tiết nhiệm vụ; nhận/từ chối; cập nhật hành trình/kết quả; bằng chứng; hồ sơ đội, thành viên, kỹ năng, trạng thái và vị trí | Nhận việc đúng quyền trưởng đội, cập nhật tiến độ, gửi bằng chứng | Response teams, missions, evidence, notices |
| Điều phối viên | Hàng đợi SOS; chi tiết/xác minh; trùng lặp và liên hệ; quyết định ưu tiên; so sánh đội; giao nhiệm vụ; bản đồ; theo dõi nhiệm vụ; chiến dịch; báo cáo | Xác minh, chọn P1–P4 có lý do, giao đội, xử lý việc quá hạn, giải quyết yêu cầu | Response operations, teams, missions, map, campaigns, reports, resolution |
| Quản lý vận hành | Tổng quan nhu cầu/vật phẩm; đợt quyên góp; hàng chờ tiếp nhận; kiểm đếm; duyệt độc lập; kho/vật phẩm/điểm cứu trợ/xe; nhu cầu và cam kết; phiếu phân phối; bàn giao; đối soát; báo cáo | Mở đợt, đếm và duyệt theo quyền riêng, giữ sổ kho chính xác, xuất và bàn giao có chứng cứ | Logistics drives, receipts, catalog, assets, stock, needs, distributions, handoffs, reports; Response campaigns |
| Quản trị viên | Người dùng; tổ chức; thành viên/grant; khu vực; nhật ký kiểm toán | Cấp/thu hồi quyền và giám sát truy cập | Identity users, organizations, grants, regions, audit; Logistics audit theo quyền ADMIN |

## 3. Luồng SOS của Người dân

### 3.1 Màn chọn cách gửi

Hai lựa chọn ngang hàng: **Điền biểu mẫu** và **Viết tin nhắn nhanh**. Trên điện thoại mỗi lựa chọn là một thẻ lớn, chữ ngắn và nút rõ. Có lối mở ngay số khẩn cấp 113/114/115, không khiến người dùng nghĩ Web thay thế cuộc gọi cấp cứu.

### 3.2 Điền biểu mẫu

Các bước: (1) người gặp nạn và tình huống; (2) vị trí **của người gặp nạn**, dùng GPS hoặc ghim thủ công; (3) thông tin người báo và liên hệ; (4) kiểm tra và gửi. Các trường backend hiện nhận: loại sự cố, mô tả, số người bị ảnh hưởng (có thể chưa rõ), cờ người báo cho biết có nguy hiểm đến tính mạng, vị trí Point theo thứ tự kinh độ/vĩ độ, nguồn GPS/MANUAL_PIN, độ chính xác/thời điểm khi dùng GPS, tên và điện thoại người báo tùy chọn.

Nếu **báo hộ**, hỏi mối quan hệ, nguồn biết tin, thời điểm cuối nhận tin, khả năng liên hệ và số liên lạc của người gặp nạn/người liên hệ khác nếu có. Luồng này dùng `POST /requests/proxy` và hiện **bắt buộc đăng nhập**. Không lấy GPS của người báo làm vị trí người gặp nạn. Nếu người dùng không biết chính xác, cho ghim vị trí ước lượng và ghi chú mức chắc chắn; không tự đặt tọa độ giả.

### 3.3 Viết tin nhắn nhanh

Màn nhập một đoạn tiếng Việt tự nhiên, có thể thêm vị trí. Khi có dịch vụ trích xuất phù hợp, UI hiển thị từng trường đã nhận ra, nguồn câu trích và nhãn “Cần kiểm tra”; trường thiếu để trống. Người dùng sửa bản nháp ở cùng biểu mẫu của mục 3.2 rồi mới gửi. Nếu AI lỗi hoặc không dùng được, vẫn cho chuyển sang biểu mẫu và giữ nguyên tin đã gõ.

Backend **chưa có API LLM trích xuất**. Frontend không gửi thông tin SOS/PII trực tiếp đến nhà cung cấp LLM từ trình duyệt. Giai đoạn thiết kế có thể dựng trạng thái minh họa; tính năng thật cần hợp đồng API, chính sách dữ liệu và đánh giá đầu ra trước khi bật.

### 3.4 Gợi ý mức độ khẩn cấp và xác nhận

UI có thể trình bày **gợi ý hỗ trợ** dựa trên dữ kiện đã khai và nêu rõ lý do, dữ kiện còn thiếu. Đây không phải P1–P4 chính thức. Backend hiện chỉ có `POST /requests/{id}/triage` cho điều phối viên sau xác minh; không có endpoint chấm điểm khi người dân gửi SOS. Vì vậy ở bản frontend đầu tiên không được hiển thị một điểm số như quyết định cứu hộ đã được hệ thống chấp nhận. Cần chốt quy tắc/contract gợi ý trước khi nối dữ liệu thật.

Chỉ khi API gửi trả thành công mới hiện “Đã tiếp nhận” cùng mã theo dõi. Bản nháp chưa gửi, đang gửi, mất mạng, lỗi, gửi trùng và đã tiếp nhận phải là các trạng thái khác nhau.

## 4. Luồng đóng góp của Người dân

Trang **Đợt quyên góp** liệt kê đợt đang mở, vật phẩm cần, địa điểm nhận, thời hạn và lượng đã được kho duyệt. Chi tiết đợt có nút **Khai báo vật phẩm sẽ mang đến**; người dùng nhập tên, số điện thoại và số lượng từng vật phẩm. Cả guest lẫn người có tài khoản đều có thể khai báo. Sau đó họ nhận mã theo dõi, xem trạng thái kiểm đếm, số lượng được chấp nhận/giữ lại/từ chối và mở khiếu nại khi có chênh lệch. Bản khai **chưa cộng kho**; chỉ biên nhận đã được người khác duyệt và ghi sổ mới tăng lượng được chấp nhận.

Không có quyên góp tiền, thanh toán, giỏ hàng hay checkout trong phạm vi hiện tại.

## 5. Điều hướng và responsive

Desktop: Cả 5 không gian dùng sidebar xanh da trời nhạt và thanh đầu gọn; menu đang chọn có nền xanh lam dịu. Nút chính, tab đang chọn và thẻ nhấn dùng cùng hệ xanh lam trầm. Màn điều phối kế thừa cấu trúc Figma: hàng đợi → dữ kiện SOS → so sánh đội và hành động; giảm mật độ cảnh báo và không dùng nền đỏ lớn. Tablet: sidebar thu gọn, bảng chi tiết thành tab. Điện thoại: mỗi tác vụ thành một luồng một cột; danh sách và chi tiết tách trang; tác vụ chính cố định cuối màn; bộ lọc nằm trong sheet; map là màn riêng; không cần kéo ngang để đọc dữ kiện hoặc xác nhận hành động.

Mọi màn có trạng thái tải, trống, lỗi, mất kết nối, quyền bị từ chối và dữ liệu đã cũ bằng tiếng Việt. Mục tiêu tối thiểu: vùng chạm 44px, tương phản WCAG AA, nhãn rõ khi không có màu, dùng được bàn phím và trình đọc màn hình.

## 6. Khớp backend và điểm phải chốt

| Quyết định | Hiện trạng | Đề xuất cho frontend |
|---|---|
| Năm actor | Backend có 9 role code và grant theo phạm vi | Dùng 5 không gian giao diện; menu và nút theo grant thực, không giả định manager có quyền reviewer |
| SOS báo hộ | `POST /requests/proxy` yêu cầu phiên đang hoạt động | Buộc đăng nhập khi chọn báo hộ; nói rõ vị trí cần là nơi người gặp nạn |
| Hai kiểu nhập SOS | API hiện nhận dữ liệu form SELF/PROXY | Cả hai kiểu UI hội tụ về một bản nháp form được kiểm tra trước khi gửi |
| LLM trích xuất | Chưa có endpoint/provider/contract | Thiết kế UI và trạng thái; chưa nối model thật từ frontend |
| Chấm điểm | Backend chỉ có priority P1–P4 do điều phối viên ghi sau xác minh | Chỉ hiển thị gợi ý có giải thích khi đã có luật/contract; không tự gán P1–P4 hoặc đổi thứ tự hàng đợi |
| Loại sự cố | Intake yêu cầu `incident_category_code`; chưa thấy public catalog route trong controller | Cần nguồn danh mục ổn định cho dropdown, có thể tạm cấu hình theo seed trong demo và ghi rõ phiên bản |
| Quyên góp | Public drive/delivery/tracking đã có; intake/review/stock tách quyền | Thiết kế đủ luồng guest và signed-in, mã theo dõi riêng tư, đối soát chênh lệch |
| Màu sắc | Figma điều phối đang dùng đỏ dày ở menu, thẻ và nút | Sidebar xanh da trời nhạt; nút, tab và thẻ nhấn xanh lam trầm; đỏ/coral chỉ cho tình huống thật khẩn |

## 7. Thứ tự thiết kế và triển khai sau khi duyệt

1. Đã dựng 38 màn trong một prototype Web responsive cho 5 actor, gồm 9 Người dân, 5 Đội cứu hộ, 8 Điều phối viên, 10 Vận hành và 6 Quản trị viên. Xem [hướng dẫn prototype](prototype/README.vi.md).
2. Đã đưa 38 màn lên cùng canvas Superdesign và đồng bộ phiên bản hiện tại từ prototype để sidebar, màu chọn trang và ảnh SVG thống nhất. Bảy màn Người dân ban đầu vẫn giữ lịch sử phiên bản. Figma là tham chiếu bố cục điều phối; không thay đổi file Figma.
3. Sau khi duyệt thiết kế, tạo frontend sản phẩm React + TypeScript + Vite, client API từ OpenAPI, auth/route guards, trạng thái tải/lỗi và responsive components.
4. Nối API đang có trước; phần LLM/gợi ý chỉ nối khi backend có contract, dữ liệu mẫu/đánh giá và chính sách PII được chốt. Kiểm tra Web ở các kích thước trình duyệt desktop, tablet và điện thoại mà không tạo ứng dụng Mobile mới. Chi tiết triển khai cho session kế tiếp nằm trong [Implementation Plan](IMPLEMENTATION_PLAN.md).

## 8. Tài liệu đối chiếu

- `docs/c48-project-context.md`; `docs/c48-technology-and-delivery-plan.md` (đặc biệt quyền ưu tiên của con người và AI tùy chọn).
- `docs/backend/README.md`, `02-identity-api.md`, `03-response-api.md`, `04-logistics-api.md`, `05-permissions.md`, `T19-traceability.md`.
- Source: `backend/apps/{identity,response,logistics}/src` và `contracts/openapi/*.json`.
- Figma: `https://www.figma.com/design/0odUVYiPvYyRqvxGYgcWms/Untitled?node-id=0-1`; màn điều phối `0:3`.
