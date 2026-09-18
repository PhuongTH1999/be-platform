# SDUI template API

Base URL: `https://yepswakp3nxo4qoeynn74xhnt40wqlia.lambda-url.us-east-1.on.aws/api/cornerstone-package/sdui`

Lưu nội dung JSON SDUI (không phải tài liệu chuẩn JSON Schema) trong cột JSONB của bảng `public.cornerstone_sdui_templates`. Mỗi template có UUID, tên, `schema`, `created_at`, `updated_at`. Tên có thể trùng; UUID là định danh để get/update/delete.

## Khởi tạo Supabase

Chạy `migrations/001_create_sdui_templates.sql` trong SQL Editor của Supabase đang dùng. Migration không thay đổi bảng package/version. Không cần chạy lại cho mỗi lần deploy. Chưa tạo bảng thì API SDUI trả 503; API package và health vẫn hoạt động.

## Endpoints

| Method | Path | Response |
| --- | --- | --- |
| POST | `/templates` | 201: `{ success: true, template: {...} }` |
| GET | `/templates?limit=50&offset=0` | 200: `{ success, total, limit, offset, templates }`; danh sách metadata, không chứa schema |
| GET | `/templates/:id` | 200: metadata và schema trong `template` |
| GET | `/templates/:id/json` | 200: nguyên JSON SDUI, không có wrapper |
| PUT | `/templates/:id` | 200: thay toàn bộ name/schema, giữ UUID và created_at |
| DELETE | `/templates/:id` | 204: body rỗng, xóa vĩnh viễn |

400: input/UUID/phân trang không hợp lệ. 404: UUID không tồn tại. 500: lỗi database. 503: chưa tạo bảng SDUI. `limit` từ 1–100, `offset` từ 0–1000000.

POST và PUT yêu cầu cả `name` (1–200 ký tự sau trim) và `schema`. Chỉ nhận hai trường này; UUID/timestamps được tạo bởi database. Không merge từng phần; để sửa một widget, lấy JSON hiện tại, chỉnh widget rồi PUT toàn bộ schema.

Envelope được kiểm tra: `type = template_widget`, `templateType = SDUI_WIDGET`, `data` là array. Các field/widget bổ sung được giữ nguyên; API không kiểm tra toàn bộ khả năng render của từng widget. JSON tối đa theo server là 10 MB, độ sâu tối đa 64. Mọi response SDUI dùng `Cache-Control: no-store`.

## Ví dụ

Chạy từ root repo. File `examples/highlands-template.json` chứa mẫu Highlands Coffee của bạn, bọc trong `{ name, schema }`.

```bash
# Tạo template; lưu UUID trong response để dùng ở các bước sau.
curl -fsS --max-time 60 -X POST \
  'https://yepswakp3nxo4qoeynn74xhnt40wqlia.lambda-url.us-east-1.on.aws/api/cornerstone-package/sdui/templates' \
  -H 'Content-Type: application/json' \
  --data-binary @cornerstone-package/examples/highlands-template.json

# Danh sách template
curl -fsS --max-time 60 \
  'https://yepswakp3nxo4qoeynn74xhnt40wqlia.lambda-url.us-east-1.on.aws/api/cornerstone-package/sdui/templates?limit=50&offset=0'

# Thay TEMPLATE_UUID bằng UUID thực tế.
curl -fsS --max-time 60 \
  'https://yepswakp3nxo4qoeynn74xhnt40wqlia.lambda-url.us-east-1.on.aws/api/cornerstone-package/sdui/templates/TEMPLATE_UUID/json'

# Sửa file JSON trước khi PUT.
curl -fsS --max-time 60 -X PUT \
  'https://yepswakp3nxo4qoeynn74xhnt40wqlia.lambda-url.us-east-1.on.aws/api/cornerstone-package/sdui/templates/TEMPLATE_UUID' \
  -H 'Content-Type: application/json' \
  --data-binary @cornerstone-package/examples/highlands-template.json

# Xóa template đã chọn; thao tác này không có chức năng undo.
curl -i --max-time 60 -X DELETE \
  'https://yepswakp3nxo4qoeynn74xhnt40wqlia.lambda-url.us-east-1.on.aws/api/cornerstone-package/sdui/templates/TEMPLATE_UUID'
```

API hiện theo mô hình công khai của Cornerstone: ai có URL cũng có thể tạo, sửa và xóa template. RLS ngăn truy cập trực tiếp bằng anon/authenticated; backend dùng server key nên các endpoint HTTP vẫn công khai. Không đưa server key vào client. Nếu dùng cho template production cần kiểm soát quyền chỉnh sửa, bổ sung auth trước khi chia sẻ quyền quản trị.

## Kiểm tra và deploy

```bash
npm test
npm run package:lambda
aws lambda update-function-code \
  --function-name be-platform \
  --region us-east-1 \
  --zip-file fileb://dist/be-platform-lambda.zip
aws lambda wait function-updated \
  --function-name be-platform \
  --region us-east-1
```

Các test HTTP dùng store trong bộ nhớ, không ghi Supabase thật. Sau khi tạo bảng, kiểm tra vòng đời create/get/raw/update/delete bằng template test riêng. Script đóng gói hiện đã copy toàn bộ `cornerstone-package/src`, không cần sửa thêm cho SDUI.
