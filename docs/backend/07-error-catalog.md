# 07 — Error code catalog (single source for the Vietnamese messages)

Every error the API can return has one row here. The implementation loads this table into each service's message catalog; **a CI test fails if a thrown `code` is missing from the catalog, or a catalog `message` is empty/English** (00 §5). `field_errors` codes (e.g. `PHONE_INVALID`) are listed with HTTP `400` and appear under `VALIDATION_FAILED`. Messages never contain PII, identifiers or internal terms. Owner = the service that raises the code (shared codes exist in all three).

| code | HTTP | Owner | Vietnamese message |
|---|---|---|---|
| `VALIDATION_FAILED` | 400 | shared | Dữ liệu gửi lên không hợp lệ. Vui lòng kiểm tra lại các trường được đánh dấu. |
| `CURSOR_INVALID` | 400 | shared | Dữ liệu phân trang không còn hợp lệ. Vui lòng tải lại danh sách. |
| `IDEMPOTENCY_KEY_INVALID` | 400 | shared | Mã yêu cầu không hợp lệ. |
| `TOO_MANY_LINES` | 400 | shared | Số dòng vượt quá giới hạn cho phép trong một thao tác (tối đa 50). |
| `UNAUTHENTICATED` | 401 | shared | Bạn cần đăng nhập để thực hiện thao tác này. |
| `SESSION_EXPIRED` | 401 | shared | Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại. |
| `FORBIDDEN` | 403 | shared | Bạn không có quyền thực hiện thao tác này. |
| `CSRF_INVALID` | 403 | shared | Yêu cầu không hợp lệ hoặc đã hết hạn. Vui lòng tải lại trang. |
| `NOT_FOUND` | 404 | shared | Không tìm thấy dữ liệu yêu cầu. |
| `VERSION_CONFLICT` | 409 | shared | Dữ liệu đã được cập nhật. Vui lòng tải lại trước khi tiếp tục. |
| `IDEMPOTENCY_KEY_REUSED` | 409 | shared | Mã yêu cầu đã được dùng cho nội dung khác. |
| `STATE_TRANSITION_INVALID` | 409 | shared | Trạng thái hiện tại không cho phép thao tác này. |
| `PAYLOAD_TOO_LARGE` | 413 | shared | Tệp hoặc nội dung vượt quá giới hạn cho phép. |
| `LENGTH_REQUIRED` | 411 | shared | Yêu cầu tải tệp thiếu thông tin kích thước. |
| `UNSUPPORTED_MEDIA` | 415 | shared | Định dạng tệp không được hỗ trợ. |
| `RATE_LIMITED` | 429 | shared | Bạn thao tác quá nhanh. Vui lòng thử lại sau. |
| `SOS_RATE_CEILING` | 429 | Response | Hệ thống đang quá tải yêu cầu từ địa chỉ của bạn. Nếu đang nguy hiểm, hãy gọi 113/114/115 rồi thử lại sau. |
| `INTERNAL_ERROR` | 500 | shared | Hệ thống gặp lỗi. Vui lòng thử lại sau. |
| `IDENTITY_UNAVAILABLE` | 503 | shared | Dịch vụ tài khoản tạm thời không khả dụng. Vui lòng thử lại. |
| `RESPONSE_UNAVAILABLE` | 503 | shared | Dịch vụ tiếp nhận và điều phối tạm thời không khả dụng. Vui lòng thử lại. |
| `LOGISTICS_UNAVAILABLE` | 503 | shared | Dịch vụ vật tư tạm thời không khả dụng. Vui lòng thử lại. |
| `STORAGE_UNAVAILABLE` | 503 | shared | Kho lưu trữ tệp tạm thời không khả dụng. Yêu cầu của bạn vẫn được giữ. |
| `LOCK_TIMEOUT` | 503 | shared | Hệ thống đang bận xử lý dữ liệu này. Vui lòng thử lại. |
| **Identity** | | | |
| `INVALID_CREDENTIALS` | 401 | Identity | Tên đăng nhập hoặc mật khẩu không đúng. |
| `REFRESH_REUSED` | 401 | Identity | Phiên đăng nhập không còn an toàn. Vui lòng đăng nhập lại. |
| `REFRESH_RACE` | 409 | Identity | Phiên đang được làm mới ở nơi khác. Vui lòng thử lại. |
| `PASSWORD_WEAK` | 400 | Identity | Mật khẩu chưa đủ mạnh (tối thiểu 10 ký tự, không phổ biến). |
| `SCOPE_INVALID` | 400 | Identity | Phạm vi quyền không hợp lệ. |
| `USERNAME_TAKEN` | 409 | Identity | Tên đăng nhập đã được sử dụng. |
| `EMAIL_TAKEN` | 409 | Identity | Địa chỉ email đã được sử dụng. |
| `REGISTRATION_EXPIRED` | 410 | Identity | Phiên đăng ký đã hết hạn. Vui lòng đăng ký lại. |
| `EMAIL_OTP_INVALID` | 400 | Identity | Mã xác minh email không hợp lệ hoặc đã hết hạn. |
| `EMAIL_OTP_UNAVAILABLE` | 503 | Identity | Dịch vụ xác minh email tạm thời chưa sẵn sàng. Vui lòng thử lại sau. |
| `GOOGLE_LOGIN_UNAVAILABLE` | 503 | Identity | Đăng nhập Google chưa được cấu hình. Vui lòng thử bằng tài khoản và mật khẩu. |
| `GOOGLE_TOKEN_INVALID` | 401 | Identity | Phiên xác thực Google không hợp lệ hoặc đã hết hạn. Vui lòng thử lại. |
| `GOOGLE_ACCOUNT_LINK_REQUIRED` | 409 | Identity | Email này đã có tài khoản. Hãy đăng nhập bằng tài khoản hiện có rồi liên kết Google trong phần bảo mật. |
| `GOOGLE_IDENTITY_IN_USE` | 409 | Identity | Tài khoản Google này đã được liên kết với người dùng khác. |
| `GOOGLE_ALREADY_LINKED` | 409 | Identity | Tài khoản đã có một tài khoản Google được liên kết. |
| `SESSION_REAUTH_REQUIRED` | 403 | Identity | Vui lòng đăng nhập lại trước khi liên kết Google. |
| `LAST_ADMIN` | 409 | Identity | Không thể thực hiện vì đây là quản trị viên cuối cùng. |
| `GRANT_EXISTS` | 409 | Identity | Quyền này đã được cấp cho người dùng. |
| **Response — intake / tracking** | | | |
| `COORDINATES_OUT_OF_RANGE` | 400 | Response | Tọa độ không hợp lệ. |
| `ACCURACY_REQUIRED` | 400 | Response | Vị trí GPS cần có độ chính xác và thời điểm ghi nhận. |
| `PEOPLE_AFFECTED_OUT_OF_RANGE` | 400 | Response | Số người cần hỗ trợ không hợp lệ. |
| `AT_LEAST_ONE_NEED_REQUIRED` | 400 | Response | Hãy chọn cần cứu hộ, cần hàng cứu trợ hoặc cả hai. |
| `VULNERABLE_COUNT_EXCEEDS_TOTAL` | 400 | Response | Tổng số trẻ em và người cao tuổi không được lớn hơn tổng số người cần hỗ trợ. |
| `PHONE_INVALID` | 400 | Response | Số điện thoại không hợp lệ. |
| `CATEGORY_UNKNOWN` | 400 | Response | Loại sự cố không hợp lệ. |
| `RELATIONSHIP_REQUIRED` | 400 | Response | Vui lòng cho biết mối quan hệ với người cần hỗ trợ. |
| `TRACKING_SECRET_INVALID` | 400 | Response | Mã bảo mật theo dõi không hợp lệ. |
| `TRACKING_SECRET_IN_USE` | 409 | Response | Không thể sử dụng mã bảo mật này. Vui lòng tạo mã khác. |
| `ALREADY_CLAIMED` | 409 | Response | Yêu cầu này đã được gắn với một tài khoản. |
| `EVIDENCE_LIMIT_REACHED` | 409 | Response + Logistics | Đã đạt giới hạn số lượng hoặc dung lượng tệp đính kèm. |
| **Response — verification / priority** | | | |
| `REASON_REQUIRED` | 400 | Response | Vui lòng nhập lý do. |
| `VERIFICATION_BASIS_REQUIRED` | 400 | Response | Vui lòng chọn cơ sở xác minh. |
| `NO_CONTACT_ATTEMPT` | 409 | Response | Cần một lần liên hệ người báo tin thành công do điều phối viên khác ghi nhận để cấp lại mã tra cứu. |
| `SECOND_COORDINATOR_REQUIRED` | 409 | Response | Cần một điều phối viên khác xác nhận đồng thuận. |
| `FAST_TRACK_NOT_ELIGIBLE` | 409 | Response | Yêu cầu này cần được rà soát đầy đủ, chưa thể xử lý nhanh theo gợi ý. |
| `REJECT_THRESHOLD_NOT_MET` | 409 | Response | Chưa đủ số lần liên hệ để từ chối vì không liên lạc được. |
| `REQUEST_NOT_VERIFIED` | 409 | Response | Yêu cầu chưa được xác minh. |
| `CANONICAL_INVALID` | 409 | Response | Yêu cầu gốc được chọn không hợp lệ. |
| `CANONICAL_HAS_DUPLICATES` | 409 | Response | Yêu cầu này đang là yêu cầu gốc của các yêu cầu trùng khác. |
| `DUPLICATE_SET_CHANGED` | 409 | Response | Danh sách yêu cầu trùng đã thay đổi. Vui lòng thử lại. |
| `RESOLUTION_BLOCKED` | 409 | Response | Chưa thể xác nhận hoàn tất. Vui lòng xử lý các mục còn tồn đọng. |
| **Response — teams / missions / campaigns** | | | |
| `TEAM_BUSY` | 409 | Response | Đội đang có nhiệm vụ khác. |
| `TEAM_NOT_ELIGIBLE` | 409 | Response | Đội không đủ điều kiện nhận nhiệm vụ này. |
| `TEAM_HAS_ACTIVE_MISSION` | 409 | Response | Đội đang thực hiện nhiệm vụ nên chưa thể chuyển sang không sẵn sàng. |
| `USER_IN_OTHER_TEAM` | 409 | Response | Người này đang thuộc một đội khác. |
| `LEADER_REQUIRED` | 409 | Response | Đội phải có một trưởng đội đang hoạt động. |
| `MISSION_NOT_LEADER` | 403 | Response | Chỉ trưởng đội đang hoạt động mới thực hiện được thao tác này. |
| `OVERRIDE_REASON_REQUIRED` | 400 | Response | Vui lòng nhập lý do khi chọn đội khác với gợi ý. |
| `RECORDED_BASIS_REQUIRED` | 400 | Response | Vui lòng ghi rõ nguồn thông tin khi ghi thay cho đội. |
| `CAMPAIGN_NOT_ACTIVE` | 409 | Response / Logistics | Chiến dịch hiện không hoạt động. |
| `CAMPAIGN_PAUSED` | 409 | Response / Logistics | Chiến dịch đang tạm dừng. |
| `CAMPAIGN_HAS_OPEN_REQUESTS` | 409 | Response | Còn yêu cầu chưa kết thúc thuộc chiến dịch này. |
| `ENGAGEMENT_LIMIT_REACHED` | 409 | Response | Bạn chỉ có thể điều phối tối đa 3 chiến dịch cùng lúc. |
| `TOO_MANY_CELLS` | 400 | Response | Vùng bản đồ hoặc khoảng thời gian quá lớn. Vui lòng thu hẹp bộ lọc. |
| **Logistics — catalog / stock** | | | |
| `ITEM_NAME_TAKEN` | 409 | Logistics | Tên mặt hàng đã tồn tại. |
| `ITEM_IN_USE` | 409 | Logistics | Vật phẩm đã được sử dụng nên không thể xóa; dữ liệu lịch sử được giữ nguyên. |
| `VEHICLE_IDENTIFIER_TAKEN` | 409 | Logistics | Biển số hoặc mã phương tiện đã tồn tại. |
| `POINT_INACTIVE` | 409 | Logistics | Điểm cứu trợ đã ngừng hoạt động. |
| `VEHICLE_INACTIVE` | 409 | Logistics | Phương tiện đã ngừng hoạt động. |
| `QUANTITY_SCALE_INVALID` | 400 | Logistics | Số lượng có quá nhiều chữ số thập phân so với đơn vị tính. |
| `INSUFFICIENT_STOCK` | 409 | Logistics | Không đủ hàng tồn kho khả dụng. |
| `ADJUSTMENT_VIOLATES_RESERVED` | 409 | Logistics | Điều chỉnh làm tồn kho thấp hơn lượng đã giữ chỗ. |
| **Logistics — donations** | | | |
| `DRIVE_NOT_OPEN` | 409 | Logistics | Đợt quyên góp hiện không nhận hàng. |
| `ITEM_NOT_ON_DRIVE` | 400 | Logistics | Mặt hàng không nằm trong danh sách của đợt quyên góp. |
| `DONATION_SECRET_INVALID` | 400 | Logistics | Mã bảo mật quyên góp không hợp lệ. |
| `DONATION_SECRET_IN_USE` | 409 | Logistics | Không thể sử dụng mã bảo mật này. Vui lòng tạo mã khác. |
| `DECLARATION_LOCKED` | 409 | Logistics | Phiếu khai báo đã được tiếp nhận kiểm đếm nên không thể sửa. |
| `COUNT_SPLIT_MISMATCH` | 400 | Logistics | Số đã đếm phải bằng tổng số nhận, giữ lại và từ chối. |
| `STALE_REVISION` | 409 | Logistics | Phiên bản khai báo hoặc kiểm đếm đã thay đổi. Vui lòng tải lại. |
| `SELF_REVIEW_FORBIDDEN` | 403 | Logistics | Người kiểm đếm không được tự duyệt phiếu của mình. |
| `RECEIPT_NOT_APPROVED` | 409 | Logistics | Phiếu nhận chưa được duyệt độc lập. |
| `ALREADY_POSTED` | 409 | Logistics | Phiếu nhận đã được ghi vào kho. |
| **Logistics — needs / fulfillment** | | | |
| `NEED_EXISTS` | 409 | Logistics | Nhu cầu cho mặt hàng này đã tồn tại. |
| `NEED_ESTIMATE_NOT_CONFIRMED` | 409 | Logistics | Nhu cầu ước tính cần được xác nhận trước khi giữ hàng, điều chỉnh số lượng hoặc phân bổ. |
| `NEED_NOT_ESTIMATED` | 409 | Logistics | Nhu cầu này không phải nhu cầu ước tính nên không thể xác nhận. |
| `NEED_ALREADY_DECLARED` | 409 | Logistics | Yêu cầu SOS này đã có nhu cầu khai báo hoặc đã xác nhận cho vật phẩm này, không thể tạo ước tính trùng. |
| `NEED_NORM_NOT_FOUND` | 400 | Logistics | Chưa có định mức đang hoạt động cho nhóm hàng đã chọn. |
| `NEED_ITEM_TYPE_MISMATCH` | 400 | Logistics | Vật phẩm đã chọn không thuộc nhóm hàng của định mức. |
| `NEED_ITEM_REQUIRED` | 400 | Logistics | Chưa chọn vật phẩm cho nhóm hàng này, và định mức chưa có vật phẩm mặc định. |
| `NEED_RELIEF_NOT_REQUESTED` | 409 | Logistics | Yêu cầu SOS này không cần hàng cứu trợ nên chưa thể tạo đề xuất nhu cầu. |
| `NEED_PEOPLE_MISSING` | 409 | Logistics | Yêu cầu SOS chưa có số người bị ảnh hưởng nên chưa thể ước tính nhu cầu. |
| `NEED_NORM_SHAPE_INVALID` | 400 | Logistics | Định mức không khớp với kiểu tính đã chọn. Vui lòng kiểm tra các trường theo kiểu tính. |
| `NEED_DEFAULT_ITEM_INVALID` | 400 | Logistics | Vật phẩm mặc định phải đang hoạt động và cùng nhóm hàng với định mức. |
| `NEED_OVER_COMMITTED` | 409 | Logistics | Tổng số lượng cam kết vượt quá nhu cầu. |
| `BELOW_PROTECTED_QUANTITY` | 409 | Logistics | Không thể giảm nhu cầu xuống thấp hơn lượng đã giữ chỗ hoặc đã giao. |
| `UNSETTLED_ISSUED_GOODS` | 409 | Logistics | Còn hàng đã xuất chưa được xác nhận giao, trả hoặc ghi mất. |
| `CYCLE_FROZEN` | 409 | Logistics | Yêu cầu đang bị khóa để hủy. Chỉ được hoàn tất các bước đã bắt đầu. |
| `CYCLE_SEALED` | 409 | Logistics | Chu kỳ xử lý đã được niêm phong. |
| `CYCLE_NOT_SETTLED` | 409 | Logistics | Còn nhu cầu hoặc hàng chưa hoàn tất nên chưa thể niêm phong. |
| **Logistics — distribution** | | | |
| `SELF_APPROVAL_FORBIDDEN` | 403 | Logistics | Người lập phiếu không được tự duyệt. |
| `SELF_HANDOFF_FORBIDDEN` | 403 | Logistics | Người đã điều xuất phiếu này không được ghi nhận bàn giao cho phiếu đó. |
| `APPROVAL_STALE` | 409 | Logistics | Phiếu đã thay đổi sau khi duyệt. Cần duyệt lại. |
| `ALREADY_DISPATCHED` | 409 | Logistics | Phiếu đã xuất kho. |
| `LINE_ITEM_MISMATCH` | 400 | Logistics | Mặt hàng không khớp với cam kết. |
| `HANDOFF_KIND_INVALID` | 409 | Logistics | Hình thức bàn giao không phù hợp với phiếu phân phối. |
| `HANDOFF_EXCEEDS_BALANCE` | 409 | Logistics | Số lượng bàn giao vượt quá số lượng đang có ở giai đoạn này. |
| `SETTLEMENT_EXCEEDS_ISSUED` | 409 | Logistics | Số lượng xác nhận vượt quá số lượng đã xuất. |
| **Logistics — campaign warehouse assignment** | | | |
| `WAREHOUSE_NOT_ELIGIBLE` | 409 | Logistics | Kho này không nằm trong vùng phục vụ đang hoạt động của chiến dịch. Vui lòng chọn kho khác. |
| `CAMPAIGN_AREA_MISSING` | 409 | Logistics | Chiến dịch chưa có vị trí và bán kính nên chưa thể phân công kho. |
| **Logistics — supply gap suggestions** | | | |
| `SUPPLY_GAP_NOT_OPEN` | 409 | Logistics | Đề xuất này không còn ở trạng thái chờ xử lý. Vui lòng tải lại danh sách. |
| `SUPPLY_GAP_WARNING_ONLY` | 409 | Logistics | Đây chỉ là cảnh báo sắp thiếu hàng, chưa có đề xuất quyên góp để chấp nhận. |
| **Logistics — pickup tickets** | | | |
| `PICKUP_MISSION_NOT_FOUND` | 404 | Logistics | Không tìm thấy nhiệm vụ cứu trợ này. Vui lòng kiểm tra lại. |
| `PICKUP_MISSION_NOT_ASSIGNABLE` | 409 | Logistics | Nhiệm vụ chưa được đội nhận hoặc đã kết thúc nên chưa thể lập phiếu lấy hàng. |
| `PICKUP_TICKET_EXISTS` | 409 | Logistics | Nhiệm vụ này đã có phiếu lấy hàng. |
| `PICKUP_NO_PRIMARY_WAREHOUSE` | 409 | Logistics | Chiến dịch chưa có kho chính. Vui lòng phân công kho trước khi lập phiếu lấy hàng. |
| `PICKUP_NO_NEEDS` | 409 | Logistics | Yêu cầu cứu trợ chưa có nhu cầu hàng hóa đã xác nhận hoặc khai báo để lập phiếu. |
| `PICKUP_NOTHING_RESERVABLE` | 409 | Logistics | Không có mặt hàng nào đủ tồn kho tại kho đã chọn để giữ chỗ. |
| `PICKUP_NOT_CONFIRMED` | 409 | Logistics | Phiếu lấy hàng cần được xác nhận trước khi bàn giao. |
| `PICKUP_COLLECTOR_NOT_MEMBER` | 409 | Logistics | Người nhận hàng không phải thành viên đang hoạt động của đội thực hiện nhiệm vụ. |
| **Logistics — pickup close-out (Step 6b)** | | | |
| `PICKUP_ITEM_NOT_ON_TICKET` | 400 | Logistics | Mặt hàng này không nằm trong phiếu lấy hàng. |
| `PICKUP_DELIVERY_EXCEEDS_CUSTODY` | 409 | Logistics | Số lượng giao vượt quá số lượng đội đang giữ cho mặt hàng này. |
| `PICKUP_LEDGER_MISMATCH` | 409 | Logistics | Số liệu bàn giao của phiếu không khớp với sổ kho. Cần đối soát trước khi tiếp tục. |
| `PICKUP_UNACCOUNTED_GOODS` | 409 | Logistics | Chưa thể kết thúc SOS vì phiếu lấy hàng vẫn còn hàng chưa đối soát. |
| `CLOSEOUT_LINES_INVALID` | 400 | Logistics | Phiếu đối soát cần đúng một dòng cho mỗi mặt hàng của phiếu lấy hàng. |
| `CLOSEOUT_INVARIANT_VIOLATED` | 409 | Logistics | Số lượng đã giao, trả lại và hủy phải bằng đúng số lượng đã giữ của mặt hàng. |
| `CLOSEOUT_RETIRE_REASON_REQUIRED` | 400 | Logistics | Cần chọn lý do khi hủy hàng. |
| `ITEM_NOT_RETURNABLE` | 409 | Logistics | Mặt hàng này không được nhập lại kho. Vui lòng ghi nhận là hủy kèm lý do. |
| `CLOSEOUT_STALE` | 409 | Logistics | Số liệu đã thay đổi sau khi gửi duyệt. Vui lòng lập lại phiếu đối soát. |

Notes: `REQUEST_STATE_INVALID` and `IDEMPOTENCY_IN_PROGRESS` from earlier drafts are **removed** (use `STATE_TRANSITION_INVALID`; in-flight duplicates simply wait for the first command, see 00 §3). A revoked or expired session is always `SESSION_EXPIRED`; a missing credential is `UNAUTHENTICATED`.

## Focused logic-review code

| code | HTTP | Owner | Vietnamese message |
|---|---|---|---|
| `ATTRIBUTION_LOCKED` | 409 | Response | Phạm vi xử lý đã được cố định cho chu kỳ này. |
| `REQUEST_ALREADY_CLAIMED` | 409 | Response | Hồ sơ đang do người khác xử lý. Vui lòng chờ hết thời gian giữ hoặc liên hệ người đang xử lý. |

## Round-2 codes (plan §28)

| code | HTTP | Owner | Vietnamese message |
|---|---|---|---|
| `ATTRIBUTION_LOCK_IN_USE` | 409 | Response | Chưa thể gỡ khóa vì chu kỳ đã có nhiệm vụ hoặc nhu cầu vật tư. |
| `PENDING_SUPPLEMENT_REVIEW` | 409 | Response | Còn thông tin bổ sung chưa được xem xét. |
| `RESOLUTION_BASIS_INVALID` | 409 | Response | Cơ sở xác nhận hoàn tất không phù hợp với tình trạng hiện tại. |
| `DELIVERY_ALREADY_CLAIMED` | 409 | Response / Logistics | Đợt giao hàng này đã có đội nhận. |
| `NOT_CARRIER` | 403 | Logistics | Bạn không phải đội được giao vận chuyển phiếu này. |
| `LOSS_REVIEW_REQUIRED` | 409 | Logistics | Khoản mất mát cần được duyệt độc lập trước khi ghi nhận. |
| `DRIVE_WINDOW_CLOSED` | 409 | Logistics | Đợt quyên góp chưa mở hoặc đã hết thời gian nhận hàng. |
