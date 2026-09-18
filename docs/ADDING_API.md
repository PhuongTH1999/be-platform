# Hướng dẫn thêm API và deploy

Dành cho người mới tham gia hoặc AI hỗ trợ code trong repo `be-platform`.

Production base URL dùng chung cho mọi project trong repo:

```text
https://yepswakp3nxo4qoeynn74xhnt40wqlia.lambda-url.us-east-1.on.aws
```

Mỗi API giữ nguyên path đã đăng ký. Ví dụ `/api/cornerstone-package/packages`
trên local sẽ dùng cùng path đó sau production base URL trên AWS.

## 1. Hiểu cấu trúc trước khi sửa

- `src/index.js`: khởi động server, đọc `.env` ở root, kiểm tra database.
- `src/app.js`: middleware, health check, mount router của các project.
- `src/db.js`: kết nối Supabase dùng chung; lấy client bằng `getDB()`.
- `src/projects.js`: danh sách các project được chạy.
- `<project>/src/routes.js`: API và logic riêng của project.
- `<project>/src/project.js`: tên project, prefix API, router và database check nếu cần.
- `<project>/supabase-schema.sql` hoặc `<project>/migrations/`: SQL của project.
- `scripts/package-lambda.sh`: đóng gói source và dependencies để deploy AWS Lambda.

Hiện có project `cornerstone-package`. Không tạo server hoặc kết nối Supabase riêng cho mỗi project. Dependencies chạy server được cài ở root. `cornerstone-package/package.json` còn phục vụ công cụ migration SQLite cũ, không phải nơi thêm dependencies cho backend chung.

## 2. Chuẩn bị local

Dùng Node.js 22 trở lên:

```bash
cd /Users/bin/Documents/bigdata-ai-app/be-platform
npm ci
npm run dev
```

Root `.env` cần `SUPABASE_URL` và `SUPABASE_SECRET_KEY` (hoặc `SUPABASE_SERVICE_ROLE_KEY` đang dùng). Không commit `.env` hoặc đưa server key vào frontend.

Local hiện có thể trỏ cùng database production. Kiểm tra cấu hình trước khi thử API ghi; nên dùng Supabase môi trường test cho dữ liệu thử.

## 3. Thêm API vào project đã có

Ví dụ thêm `GET /api/cornerstone-package/ping`:

1. Mở `cornerstone-package/src/routes.js`.
2. Thêm trước `export default router`:

```js
router.get('/ping', (_req, res) => {
  res.json({ success: true, project: 'cornerstone-package' });
});
```

3. Không thêm lại prefix `/api/cornerstone-package` trong router. Server chung đã mount prefix.
4. Không cần sửa `src/projects.js` hoặc script đóng gói khi chỉ sửa source đã được đóng gói.
5. Chạy thử:

```bash
curl -fsS http://localhost:3000/api/cornerstone-package/ping
```

Nếu route tĩnh có thể trùng route động, khai báo route tĩnh trước. Ví dụ `/packages/search` phải đứng trước `/packages/:name` nếu có route đó.

## 4. Tạo project mới

Ví dụ project `notifications` (chỉ là ví dụ, chưa được tạo):

```text
notifications/
  src/
    routes.js
    project.js
```

### Tạo router

`notifications/src/routes.js`:

```js
import { Router } from 'express';

const router = Router();
router.get('/ping', (_req, res) => {
  res.json({ success: true, project: 'notifications' });
});
export default router;
```

### Khai báo project

`notifications/src/project.js`:

```js
import router from './routes.js';

export default {
  name: 'notifications',
  basePath: '/api/notifications',
  router
};
```

### Đăng ký ở server chung

Thêm import và giữ các project đã có trong `src/projects.js`:

```js
import cornerstonePackage from '../cornerstone-package/src/project.js';
import notifications from '../notifications/src/project.js';

export default [cornerstonePackage, notifications];
```

### Thêm vào gói deploy

Thêm dòng này trong `scripts/package-lambda.sh`, cạnh phần copy Cornerstone:

```bash
mkdir -p "$artifact_dir/notifications"
cp -R "$repo_dir/notifications/src" "$artifact_dir/notifications/src"
```

Nếu module cần file runtime ngoài `src`, phải copy các file đó nữa. Không copy `.env`, database local hay `node_modules` từ máy.

### Kiểm tra

```bash
curl -fsS http://localhost:3000/api/notifications/ping
curl -fsS http://localhost:3000/
```

Danh sách tại `/` phải có project mới. Project mới chỉ có prefix riêng; không tự tạo alias `/api/...` như Cornerstone.

## 5. API cần truy cập Supabase

Trong `<project>/src/routes.js`, dùng client chung:

```js
import { getDB } from '../../src/db.js';

router.get('/items', async (_req, res) => {
  try {
    const { data, error } = await getDB()
      .from('notifications_items')
      .select('id, title')
      .limit(100);
    if (error) throw error;
    res.json({ success: true, items: data });
  } catch (error) {
    console.error('Cannot load notification items:', error.message);
    res.status(500).json({ error: 'Không thể tải dữ liệu' });
  }
});
```

Ví dụ này yêu cầu bảng `notifications_items` với cột `id`, `title` đã tồn tại. Tên bảng nên có prefix project để tránh trùng. Hiện các project dùng chung Supabase và schema `public`; folder riêng không tự tạo database hoặc phân quyền riêng.

Nếu thêm bảng/cột:

1. Lưu SQL trong folder project, ví dụ `notifications/migrations/001_create_items.sql`.
2. Kiểm tra SQL trên database test và cập nhật chính sách RLS phù hợp.
3. Áp dụng SQL trên Supabase đích trước khi deploy code cần bảng/cột mới. Ưu tiên thay đổi tương thích với code đang chạy.
4. Không xóa/đổi tên cột đang dùng khi chưa có kế hoạch chuyển đổi dữ liệu và client.

Deploy Lambda không tự chạy SQL và không migrate dữ liệu. `checkDatabase(db)` trong khai báo project chỉ được server local gọi khi khởi động; Lambda phải tự xử lý lỗi database ở từng request. Chỉ kiểm tra điều kiện thực sự bắt buộc.

Với API ghi: validate input, xác định cơ chế authentication/authorization, và xử lý lỗi. API sync Cornerstone hiện công khai; không mặc định mọi API mới đều nên công khai. Server Supabase key có quyền cao nên không thể dựa riêng vào RLS để bảo vệ request đi qua backend.

## 6. Test trước khi deploy

Chạy trong terminal khác với server dev:

```bash
npm test
curl -fsS http://localhost:3000/api/health
curl -fsS http://localhost:3000/api/cornerstone-package/packages
```

Sau đó gọi endpoint mới và kiểm tra status/body đúng kỳ vọng. Với API nhận input, kiểm tra input hợp lệ, thiếu/sai input và trường hợp không tìm thấy dữ liệu. Thêm test trong `test/` cho logic mới có ý nghĩa; không dùng database production để chạy test ghi dữ liệu.

Nếu thêm thư viện:

```bash
npm install TEN_THU_VIEN
```

Chạy ở root và đưa cả `package.json`, `package-lock.json` vào thay đổi. Nếu đã sửa code, cần deploy để API public nhận bản mới.

## 7. Deploy lên AWS Lambda hiện có

Function đang dùng: `be-platform`, region `us-east-1`. AWS CLI phải đăng nhập đúng account trước khi deploy.

```bash
cd /Users/bin/Documents/bigdata-ai-app/be-platform
aws sts get-caller-identity
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

Gói ZIP được build từ code local; không cần push Git để AWS nhận code. Tuy nhiên nên commit thay đổi để nhóm có thể theo dõi và tái tạo bản deploy.

Nếu thêm hoặc đổi biến môi trường Lambda, giữ lại toàn bộ biến hiện tại khi cập nhật. Không đưa secret trực tiếp vào tài liệu hoặc commit. Xem cấu hình hiện tại trước:

```bash
aws lambda get-function-configuration \
  --function-name be-platform \
  --region us-east-1 \
  --query 'Environment.Variables'
```

Sửa `.env` local không cập nhật Lambda. Chỉ dùng `update-function-configuration` khi thực sự cần và phải truyền đủ các biến cần giữ lại.

## 8. Kiểm tra sau deploy

```bash
curl -fsS --max-time 60 \
  https://yepswakp3nxo4qoeynn74xhnt40wqlia.lambda-url.us-east-1.on.aws/api/health

curl -fsS --max-time 60 \
  https://yepswakp3nxo4qoeynn74xhnt40wqlia.lambda-url.us-east-1.on.aws/api/cornerstone-package/packages

# Thay bằng endpoint mới thực tế:
# curl -fsS --max-time 60 https://yepswakp3nxo4qoeynn74xhnt40wqlia.lambda-url.us-east-1.on.aws/api/notifications/ping
```

Xem lỗi Lambda gần nhất bằng CloudWatch Logs nếu cần. Health check chỉ xác nhận handler; luôn kiểm tra thêm endpoint mới.

Nếu local chạy mà Lambda lỗi:

- `Cannot find module`: kiểm tra `scripts/package-lambda.sh` có copy folder mới và dependency đã được cài ở root chưa.
- HTTP 404: kiểm tra router, prefix và đăng ký trong `src/projects.js`.
- Lỗi database: kiểm tra biến môi trường Lambda, bảng/cột và SQL đã áp dụng trên đúng Supabase chưa.
- Deploy thành công nhưng API chưa đúng: kiểm tra CloudWatch Logs và Function URL app đang gọi.

## Khi nào cần deploy?

| Thay đổi | Cần deploy? |
| --- | --- |
| Thêm/sửa API, middleware, dependencies | Có |
| Thêm folder project | Có; đăng ký project và thêm vào script đóng gói |
| Sửa handler hoặc script đóng gói Lambda | Có |
| Thêm/sửa dữ liệu qua API hoặc Supabase | Không |
| Thêm bảng/cột | Chạy SQL riêng; deploy nếu code cũng thay đổi |
| Chỉ sửa tài liệu | Không |

## Mẫu yêu cầu cho người hoặc AI thêm API

> Thêm API `[METHOD] /api/[project]/[endpoint]` trong be-platform. Input: [...]. Output/status mong muốn: [...]. Quyền truy cập: [...]. Dữ liệu/bảng: [...]. Đọc docs/ADDING_API.md, dùng Supabase client chung, giữ API hiện có, bổ sung kiểm tra phù hợp và ghi rõ SQL cần chạy. [Chỉ sửa local / sửa và deploy AWS Lambda].
