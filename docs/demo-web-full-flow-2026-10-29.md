# Hướng dẫn demo đầy đủ Reliva Web — 29/10/2026

Tài liệu dành cho người trình diễn trên bản Web ở `http://localhost:8080/`. Dùng dữ liệu **giả** cho mọi SOS, số điện thoại, người nhận và vật phẩm. Ghi mã SOS/mã bản khai mới tạo để tìm đúng bản ghi giữa dữ liệu seed. Các luồng hỗ trợ như quyên góp và Logistics có thể trình diễn sau luồng ứng cứu chính.

## 1. Chuẩn bị và tài khoản

1. Khởi động Docker Desktop. Tại thư mục gốc dự án, chạy `docker compose --env-file backend/.env -f backend/infra/compose.yaml up -d --build identity-api response-api logistics-api web`. Chỉ dùng Compose chính của dự án; không reset cơ sở dữ liệu để demo.
2. Mở `http://localhost:8080/`. Nếu mở `http://127.0.0.1:8080/`, Web sẽ chuyển sang `localhost` để cookie xác thực hoạt động trong môi trường HTTP nội bộ.
3. Kiểm tra các API nếu trang không tải: `http://localhost:3001/health/ready`, `http://localhost:3002/health/ready`, `http://localhost:3003/health/ready`. Cả ba cần trả trạng thái sẵn sàng.
4. Chuẩn bị một hộp thư **do bạn sở hữu** nếu muốn hoàn thành đăng ký bằng OTP. Không dùng địa chỉ `example.com` để chờ mã. Kiểm tra cấu hình gửi email của Identity trước buổi demo. Mã OTP không nên trình chiếu.
5. Dùng các tài khoản seed đã có; lấy mật khẩu hiện hành từ người quản lý demo, không ghi mật khẩu vào tài liệu/commit. Nếu một tài khoản yêu cầu đổi mật khẩu lần đầu, thực hiện theo giao diện rồi dùng mật khẩu mới ở các bước sau. Có thể mở các vai trò trong cửa sổ riêng hoặc đăng xuất trước khi đổi tài khoản.

| Tài khoản | Vai trò dùng trong demo | Việc chính |
| --- | --- | --- |
| `citizen3` | Người dân | SOS, theo dõi, đóng góp |
| `coord_seed` | Điều phối | Xác minh, ưu tiên, chiến dịch, giao đội, kết thúc SOS |
| `vol_leader_seed` | Đội trưởng đội APP `Đội cứu hộ Bắc Demo` | Vị trí đội, nhận và cập nhật nhiệm vụ |
| `ops_seed` | Quản lý vận hành | Đợt quyên góp, nhu cầu, kho, phân phối, báo cáo |
| `intake2` | Nhân viên tiếp nhận | Biên nhận và kiểm đếm |
| `reviewer2` | Người duyệt độc lập | Duyệt kiểm đếm, ghi sổ, khiếu nại |
| `dist2`, `dist1` | Nhân viên phân phát | Xuất kho và ghi nhận bàn giao bằng hai người |
| `admin` | Quản trị | Người dùng, tổ chức, phân quyền, khu vực, nhật ký |

**Mốc tối thiểu để demo trọn luồng ứng cứu:** đăng nhập người dân → gửi SOS → theo dõi → điều phối xác minh và đặt P2/P3 → giao đội APP → đội trưởng nhận, di chuyển, đến nơi, hoàn thành → điều phối giải quyết/đóng → người dân xem lịch sử. Luồng này đã được chạy thực tế trên Web với hai SOS giả trong lần kiểm thử 29/10, gồm cả đội APP và đội do điều phối báo cáo hộ.

## 2. Đăng ký, đăng nhập và tài khoản

### 2.1. Đăng ký email và OTP

1. Từ trang đầu, bấm **Đăng nhập** → **Chưa có tài khoản? Đăng ký ngay**.
2. Thử để trống rồi bấm **Tạo tài khoản**: các trường email, họ tên, tên đăng nhập, mật khẩu phải báo lỗi tiếng Việt. Đây là phép thử giao diện, chưa tạo tài khoản.
3. Nhập email thật của bạn chưa dùng trong hệ thống, họ tên giả, tên đăng nhập mới dài 3–64 ký tự theo mẫu chữ Latin/số/`._-`, mật khẩu riêng ít nhất 10 ký tự. Tránh mật khẩu phổ biến hoặc trùng tên đăng nhập.
4. Bấm **Tạo tài khoản**. Màn hình **Xác thực email** xuất hiện khi máy chủ nhận đăng ký. Lấy OTP 6 chữ số từ hộp thư, nhập và bấm **Xác thực email**. Nếu mã hết hạn, dùng **Gửi lại mã xác thực**; nếu lần đăng ký hết hạn, bắt đầu lại bằng email/tên phù hợp.
5. Quay lại **Đăng nhập**, dùng tên đăng nhập và mật khẩu vừa tạo. Mở **Tài khoản** và kiểm tra đây là tài khoản Người dân; đăng xuất rồi đăng nhập lần nữa để xác nhận tài khoản hoạt động.

**Phạm vi đã kiểm thử:** gửi biểu mẫu đăng ký hợp lệ trên `localhost` đã đến màn OTP và báo gửi mã; lần kiểm thử trước không truy cập hộp thư nên **chưa xác nhận** bước nhập OTP và đăng nhập bằng tài khoản mới. Vì vậy buổi demo cần chuẩn bị hộp thư trước. Việc bấm tạo tài khoản với email giả có thể tạo bản ghi chờ xác thực; chỉ làm khi thực sự muốn trình diễn.

### 2.2. Đăng nhập, lỗi mật khẩu và đăng xuất

1. Nhập sai mật khẩu của một tài khoản seed: phải có thông báo không hợp lệ bằng tiếng Việt; không hiện thông tin nội bộ.
2. Đăng nhập bằng mật khẩu hiện hành, kiểm tra menu đúng vai trò. Mở **Tài khoản** nếu là Người dân.
3. Bấm **Đăng xuất**, kiểm tra các menu nội bộ biến mất. Đổi sang tài khoản kế tiếp. Nếu có màn bắt đổi mật khẩu, hoàn thành bước đó trước khi demo nghiệp vụ.
4. **Quên mật khẩu?** hiện hướng dẫn liên hệ quản trị viên để xác minh và cấp mật khẩu tạm; Web hiện chưa có luồng tự đặt lại qua email.

Trên `localhost:8080` hiện **không hiện nút Google** vì nguồn OAuth của bản demo HTTP chưa được Google cho phép. Chỉ demo Google trên miền đã đăng ký đúng origin/client ID; không giới thiệu đó là một bước khả thi của bản local hiện tại.

## 3. Gửi SOS và vị trí trên bản đồ

1. Đăng nhập `citizen3` → không gian **Người dân** → **Gửi yêu cầu SOS**. Thử gửi khi còn trống để kiểm tra lỗi bắt buộc tại trường.
2. Chọn **Tôi hoặc người trong gia đình** hoặc **Báo hộ**. Nếu báo hộ, điền đúng trường quan hệ/nguồn thông tin và vị trí **người cần cứu hộ**, không lấy mặc định vị trí người báo.
3. Chọn loại sự cố, số người, nhu cầu, tên và số liên hệ giả, mô tả ngắn. Chỉ đánh dấu trẻ em, người cần hỗ trợ đặc biệt hoặc nguy hiểm tính mạng nếu tình huống giả đã chuẩn bị tương ứng.
4. Ở phần vị trí, tìm địa chỉ thật trên thanh tìm kiếm, chọn gợi ý, sau đó kéo tâm bản đồ/ghim. **Ngay khi thả**, thanh địa chỉ cần cập nhật địa chỉ gần vị trí mới; chờ kết quả tìm địa chỉ nếu mạng chậm. Sau đó bấm xác nhận vị trí và kiểm tra kinh/vĩ độ trong biểu mẫu. Địa chỉ là mô tả gần đúng, tọa độ mới là vị trí ghim đã chọn.
5. Với luồng đội `Đội cứu hộ Bắc Demo`, đặt SOS trong vùng `DEMO_C` gần Hồ Hoàn Kiếm/Hà Nội. Nếu chọn vùng khác, phải dùng đội có phạm vi và kỹ năng tương ứng.
6. Bấm **Gửi yêu cầu SOS**, ghi mã theo dõi trên **Xác nhận tiếp nhận**. Mở **Theo dõi SOS** và xác nhận mã vừa tạo xuất hiện trong danh sách. Mở chi tiết, kiểm tra trạng thái và mốc tiếp nhận; có thể bổ sung thông tin hoặc minh chứng giả khi yêu cầu còn mở.

**Đối chiếu:** không lấy một SOS cũ có cùng khu vực làm bằng chứng. Dùng chính mã vừa ghi ở mọi vai trò. Nếu người dân không thấy mã trong danh sách, kiểm tra đã đăng nhập đúng tài khoản đã gửi.

## 4. Điều phối: từ hàng đợi đến nhiệm vụ

1. Đăng nhập `coord_seed` → **Hàng đợi SOS** hoặc **Xác minh**, tìm đúng mã mới. Mở hồ sơ, đối chiếu loại sự cố, số người, mô tả và tọa độ với bản đã gửi. Xem AI nếu có; AI chỉ hỗ trợ tham khảo, người điều phối tự quyết định.
2. Nếu muốn gắn chiến dịch, vào **Chiến dịch**: tạo hoặc chọn chiến dịch cùng khu vực/tổ chức, mở chiến dịch nếu cần; quay lại SOS và gắn đúng chiến dịch. Không đóng chiến dịch khi còn SOS/nhiệm vụ mở.
3. Bấm **Bắt đầu xác minh**. Ghi nhận lần liên hệ với người báo/người liên quan, kết quả liên hệ và ghi chú giả. Bấm **Hoàn tất xác minh SOS** với dữ kiện đã kiểm tra. Trạng thái chuyển từ `SUBMITTED`/`VERIFYING` sang `VERIFIED`.
4. Sang **Ưu tiên**, chọn mức P1–P4 theo dữ kiện và nhập lý do. Ví dụ demo một người cần sơ tán nhưng không có dấu hiệu nguy hiểm tính mạng ngay: P2 hoặc P3 theo kịch bản; không gọi gợi ý AI là ưu tiên chính thức. Trạng thái chuyển `TRIAGED`.
5. Sang **Giao đội** và đọc danh sách đội được đề xuất. Chọn đội phù hợp, kiểm tra vị trí gần đây, khoảng cách, kỹ năng, tình trạng nhận việc và nhiệm vụ đang hoạt động. Bấm giao và xác nhận. Trạng thái SOS thành `DISPATCHED`, nhiệm vụ ban đầu `OFFERED`/“Đã đề nghị”.

### Khi không thấy đội đủ điều kiện

- Đội phải cùng phạm vi tổ chức/khu vực, có kỹ năng phù hợp, đang hoạt động, bật nhận việc, không bận nhiệm vụ khác và có vị trí gần đây. Vị trí đội quá 30 phút được coi là cũ trong gợi ý giao đội.
- Đăng nhập `vol_leader_seed` → **Đội cứu hộ** → chọn đội APP → chọn lại điểm hiện tại trên bản đồ hoặc dùng vị trí thiết bị → **Cập nhật vị trí**. Có thể cập nhật cùng tọa độ sau hơn 15 giây: Backend giữ tọa độ cũ và làm mới thời gian `captured_at`, nên đội vẫn đủ điều kiện về độ mới. Quay lại điều phối và tải lại danh sách đội.
- Nếu dùng đội chế độ **điều phối báo cáo**, điều phối viên cần cập nhật vị trí và ghi tiến trình hộ qua UI; đội đó không có luồng đội trưởng tự nhận trên Web. Để demo cả hai phía, ưu tiên đội APP `Đội cứu hộ Bắc Demo`.
- Không thêm nhiều đội chỉ để ép hiện một gợi ý. Có thể tạo đội khác để minh họa phạm vi/kỹ năng nếu cần, nhưng phải có người lãnh đạo, quyền, vị trí và trạng thái hợp lệ; việc này làm demo dài và dễ gây nhầm mã nhiệm vụ.

### Hai cách ghi tiến trình nhiệm vụ

**Đội APP, ưu tiên cho demo:** đăng nhập `vol_leader_seed` → **Nhiệm vụ** → mở nhiệm vụ vừa được giao → **Tiếp nhận nhiệm vụ** → **Bắt đầu di chuyển tới hiện trường** → **Đã tới hiện trường** → **Báo cáo hoàn thành giải cứu**, nhập kết quả. Sau mỗi bước kiểm tra **Tiến độ** và lịch sử nhiệm vụ. Nút thao tác chỉ hiện khi máy chủ trả quyền `can_manage_mission`; thành viên thường không tự nhận thay đội trưởng.

**Đội điều phối báo cáo hộ:** giữ `coord_seed`, mở nhiệm vụ trong SOS và ghi các mốc **Đã nhận**, **Đang di chuyển**, **Đã tới hiện trường**, **Hoàn thành** theo thông tin báo về. Ghi rõ nguồn và lý do; không trình bày đây là thao tác do đội trưởng thực hiện.

## 5. Giải quyết, đóng và đối chiếu người dân

1. Đăng nhập lại `coord_seed`, mở đúng SOS. Nhiệm vụ phải đã hoàn thành; xem lịch sử theo thứ tự đề nghị → nhận → di chuyển → đến hiện trường → hoàn thành.
2. Dùng phần **Kết thúc xử lý yêu cầu** để ghi kết quả/lý do, chuyển sang `RESOLVING`/`RESOLVED` theo các bước UI cho phép; sau đó **Đóng yêu cầu** (`CLOSED`). Nếu nhiệm vụ chưa đạt điều kiện, hệ thống phải chặn kết thúc.
3. Đăng nhập `citizen3` → **Theo dõi SOS** hoặc **Tài khoản → Yêu cầu của tôi** → chọn cùng mã. Kiểm tra trạng thái cuối, mốc xác minh, ưu tiên/giao đội, các mốc nhiệm vụ công khai và kết thúc. Sau khi đóng, không được gửi bổ sung/tải minh chứng tiếp.
4. Với một SOS khác, có thể minh họa từ chối/báo thất bại, giao lại đội hoặc mở lại theo quyền và trạng thái; đây là nhánh phụ, nên làm trên bản ghi giả riêng để không phá luồng thành công chính.

## 6. Bản đồ nhiệt và cách giải thích số đếm

Trong **Điều phối → Bản đồ**, chọn lớp **SOS chưa xác minh** hoặc **SOS đã xác minh**. Số trong chấm/cụm là tổng số SOS mà API `/map/heatmap` trả về theo **quyền truy cập, khu vực, khoảng 7 ngày, lớp trạng thái và ô tọa độ tổng hợp**. Ở mức xa, Web tiếp tục gom các ô gần nhau thành chấm lớn. Ghim của SOS đang mở trong trang chi tiết đặt tại **tọa độ hồ sơ chính xác** và hiển thị độc lập với tổng hợp.

Vì vậy cụm ghi **3** nhưng nhìn thấy **4** đối tượng có thể xảy ra khi ghim đang chọn nằm ngoài bộ lọc hiện tại (đã đóng, khác lớp trạng thái, ngoài 7 ngày, khác khu vực), hoặc do chấm gom ô không cùng quy tắc với danh sách. **Không nói 3 là tổng của mọi ghim đang nhìn thấy.** Để kiểm tra một SOS mới trên heatmap: chọn đúng lớp, làm mới bản đồ, chắc chắn SOS còn thuộc trạng thái/lượt lọc, rồi đối chiếu khu vực ô. SOS `CLOSED` không thuộc hai lớp hiện tại của API; vẫn có thể thấy ghim hồ sơ khi mở chi tiết.

**Muốn ghép 1:1 mã SOS ↔ điểm bản đồ chính xác:** về kỹ thuật có thể dùng tọa độ từ hồ sơ SOS cho **SOS đang chọn**; Web đã làm như vậy. Để làm cho **toàn bộ** điểm và số cụm chính xác theo từng mã, Web cần API trả danh sách điểm/mã được phân quyền và phân trang hoặc API mở rộng heatmap có ID theo ô. API heatmap hiện chỉ trả tâm ô, hình ô và `count`, không trả từng ID; danh sách SOS có bộ lọc/phân trang khác, nên FE không thể tự tái dựng đầy đủ và bảo đảm số đúng bằng cách ghép hai API hiện tại. Việc gửi toàn bộ tọa độ chính xác cho trình duyệt còn phải giữ đúng quyền xem vị trí người cần cứu hộ và giới hạn tải dữ liệu. Đề xuất UX trước mắt: phân biệt rõ ghim đang chọn với chấm thống kê, và chỉ so sánh số khi cùng bộ lọc/thời điểm.

## 7. Chiến dịch và đóng góp của người dân

1. `coord_seed`: **Chiến dịch** → xem hoặc tạo chiến dịch trong khu vực demo, nhập tên/mục tiêu, mở hoạt động. `ops_seed` có thể xem chiến dịch trong **Vận hành cứu trợ**. Người dân mở **Chiến dịch cứu trợ** để xem thông tin công khai.
2. `ops_seed`: **Đợt quyên góp** → tạo đợt gắn chiến dịch/tổ chức/khu vực và chọn vật phẩm được tiếp nhận; mở đợt nếu cần. Người dân xem đợt công khai tại **Đợt quyên góp**.
3. `citizen3`: **Khai báo vật phẩm** → chọn đợt đang mở, điền người tặng giả, vật phẩm/số lượng, nơi bàn giao và gửi. Ghi mã đóng góp. **Bản khai chưa làm tăng tồn kho.** Mở **Theo dõi đóng góp** để xem trạng thái, số khai và số tiếp nhận sau này.
4. Nếu cần, dùng ảnh giả để thử minh chứng. Sau kiểm đếm, người dân có thể gửi khiếu nại về khác biệt số lượng/thông tin; người duyệt mở hồ sơ khiếu nại và ghi kết quả xử lý. Đây là luồng hỗ trợ, tách khỏi SOS chính.

## 8. Tiếp nhận vật phẩm, kho và phân phối

Chọn một bản khai mới, một loại vật phẩm và số lượng nhỏ, ví dụ **3 chai nước**. Dùng tài khoản khác nhau cho người kiểm đếm, người duyệt và người giao nhận theo quy tắc tách nhiệm vụ.

| Bước | Vai trò và nơi thao tác | Kết quả cần đối chiếu |
| --- | --- | --- |
| Biên nhận | `intake2` → **Vận hành cứu trợ → Tiếp nhận** → tìm mã bản khai, lập biên nhận | Bản khai gắn biên nhận, chưa tự tăng tồn |
| Kiểm đếm | `intake2` → ghi số thực nhận, đơn vị và ghi chú | Số khai và số kiểm đếm hiển thị riêng |
| Duyệt độc lập | `reviewer2` → **Duyệt biên nhận** → duyệt hoặc yêu cầu sửa | Người kiểm đếm không tự duyệt phần mình |
| Ghi sổ | `reviewer2` → ghi sổ tiếp nhận khi đã duyệt | Tồn kho tăng theo số được chấp nhận, kiểm tra **Tồn kho** |
| Nhu cầu | `ops_seed` → **Nhu cầu** → ghi nhu cầu gắn SOS/khu vực hợp lệ | Có số lượng và vật phẩm cần cấp |
| Cam kết | `ops_seed` → cam kết từ tồn khả dụng | Số khả dụng giảm/được giữ đúng quy tắc |
| Phiếu | `ops_seed` → **Phân phối** → tạo/duyệt phiếu và chuẩn bị từ cam kết | Kiểm tra **mọi dòng** trên phiếu trước khi xuất; thao tác chuẩn bị có thể gom nhiều cam kết phù hợp |
| Xuất kho | `dist2` → **Phân phối** → xuất kho | Tồn và trạng thái phiếu thay đổi |
| Bàn giao | `dist1` → **Bàn giao** → ghi số thực giao và thời điểm | Người xuất và người ghi bàn giao là hai tài khoản; kiểm tra mất mát nếu có |
| Đối soát | `ops_seed`/vai trò được cấp → **Đối soát** | Có thể tự chuyển sang đã đối soát khi giao đủ; chỉ thao tác duyệt nếu trạng thái còn cho phép |

Nếu không có đủ quyền hoặc dữ liệu kho phù hợp, trình diễn phần đọc: **Tổng quan**, **Tồn kho**, **Điểm và phương tiện**, **Nhu cầu**, **Phân phối**, **Bàn giao**, **Đối soát**. Lần kiểm thử Web gần nhất đã mở các màn này, **chưa chạy lại toàn bộ thao tác ghi**; không khẳng định chúng đã được xác nhận end-to-end trong bản build mới chỉ từ việc màn hình tải được. Một số trường nghiệp vụ yêu cầu mã UUID hiện có, không tự điền mã ngẫu nhiên.

## 9. Quản trị và các nhánh kiểm tra thêm

- `admin` → **Người dùng**: tìm tài khoản mới và vai trò; **Tổ chức**, **Phân quyền**, **Khu vực**, **Nhật ký kiểm toán**: xem dữ liệu, lý do thao tác và phạm vi. Tránh cấp/thu hồi quyền thật hoặc vô hiệu hóa khu vực trong buổi demo nếu không có kịch bản khôi phục.
- `vol_leader_seed` → **Đội cứu hộ**: xem trạng thái hoạt động, chế độ báo cáo, vị trí/thời gian cập nhật, thành viên. Bật/tắt nhận việc theo quyền và kiểm tra đội bận không được giao thêm nhiệm vụ đang mở.
- **Thông báo** ở Điều phối và Tình nguyện: xem thông báo sau giao nhiệm vụ và cập nhật tiến trình; nếu có nút đánh dấu đã đọc, thử trên thông báo giả.
- Thử nhánh sai: thiếu trường SOS, sai mật khẩu, OTP sai/hết hạn, đội khác khu vực hoặc vị trí cũ, thao tác nhiệm vụ bằng thành viên thường, đóng SOS khi nhiệm vụ chưa xong. Mong đợi lỗi tiếng Việt và trạng thái máy chủ giữ nguyên.
- Thử tải lại giữa các bước. Tìm lại theo mã để chắc chắn dữ liệu được lưu ở máy chủ, không chỉ là trạng thái tạm trong trang.

## 10. Phiếu đối chiếu cuối buổi

| Mã cần ghi | Trước | Sau | Đã kiểm tra? |
| --- | --- | --- | --- |
| Tài khoản OTP mới | Chờ xác thực | Đăng nhập được vai trò Người dân |  |
| SOS mới | `SUBMITTED` | `CLOSED` |  |
| Nhiệm vụ đội APP | `OFFERED` | Hoàn thành |  |
| SOS trên Theo dõi | Chưa có mã | Cùng mã, đủ mốc công khai |  |
| Chiến dịch/đợt quyên góp | Chưa chọn | Hiển thị công khai đúng khu vực |  |
| Bản khai đóng góp | Đã khai | Đã kiểm đếm/duyệt/ghi sổ nếu demo Logistics |  |
| Tồn kho/phiếu | Trước tiếp nhận/xuất | Sau tiếp nhận/xuất/bàn giao |  |

**Các giới hạn đã biết của buổi demo local:** OTP cần hộp thư và SMTP hoạt động; Google OAuth chưa có origin local; AI có thể chậm/không có gợi ý nhưng không chặn điều phối; heatmap là thống kê theo ô và không bao gồm SOS đã đóng; dữ liệu seed của đội có thể hết độ mới sau 30 phút. Mọi kết quả demo là trên dữ liệu giả, không thay thế đánh giá vận hành cứu hộ thực tế.
