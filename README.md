# 📦 Package Sync API

Free public API to sync and manage package versions and changelogs. Run locally 24/7 with Cloudflare Tunnel.

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Start Server
```bash
npm start
```

Server runs on `http://localhost:3000`

#### Development Mode (Auto-reload)
```bash
npm run dev
```

## 🔗 Setup Cloudflare Tunnel (Free Public Access)

### Prerequisites
- Free Cloudflare account (cloudflare.com)
- Cloudflare CLI installed

### Installation & Setup

#### 1. Install Cloudflare CLI
```bash
# macOS
brew install cloudflare/cloudflare/cf-cli

# Linux/Windows
# Download from: https://github.com/cloudflare/wrangler-cli/releases
```

#### 2. Login to Cloudflare
```bash
cloudflared login
```
This will open your browser to authenticate.

#### 3. Create Tunnel
```bash
cloudflared tunnel create my-package-api
```

#### 4. Route Tunnel
```bash
# Create a config file: ~/.cloudflared/config.yml
# Or use the command:
cloudflared tunnel route dns my-package-api subdomain.example.com
```

**Option A: Without Domain**
```bash
cloudflared tunnel --url http://localhost:3000
```
This generates a random `*.trycloudflare.me` URL

**Option B: With Cloudflare Domain** (recommended)
1. Add domain to Cloudflare account
2. Create config at `~/.cloudflared/config.yml`:
```yaml
tunnel: my-package-api
credentials-file: ~/.cloudflared/my-package-api.json

ingress:
  - hostname: api.yourdomain.com
    service: http://localhost:3000
  - service: http_status:404
```

3. Route the tunnel:
```bash
cloudflared tunnel route dns my-package-api api.yourdomain.com
```

#### 5. Run Tunnel
```bash
cloudflared tunnel run my-package-api
```

Or use systemd/launchd for 24/7 service:
```bash
sudo cloudflared service install
sudo systemctl start cloudflared
```

## 📚 API Endpoints

### Health Check
```bash
GET /api/health
```
Response:
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

### List All Packages
```bash
GET /api/packages
```
Response:
```json
{
  "success": true,
  "total": 2,
  "packages": [
    {
      "id": 1,
      "name": "my-package",
      "description": "My awesome package",
      "version_count": 3,
      "latest_version": "1.2.0",
      "created_at": "2024-01-15T10:00:00.000Z",
      "updated_at": "2024-01-15T10:30:00.000Z"
    }
  ]
}
```

### Get Package Details
```bash
GET /api/packages/:name
```
Example:
```bash
curl https://your-api.trycloudflare.me/api/packages/my-package
```
Response:
```json
{
  "success": true,
  "package": {
    "id": 1,
    "name": "my-package",
    "description": "My awesome package",
    "created_at": "2024-01-15T10:00:00.000Z",
    "updated_at": "2024-01-15T10:30:00.000Z",
    "versions": [
      {
        "id": 1,
        "version": "1.2.0",
        "release_date": "2024-01-15T10:30:00.000Z",
        "changelog": "- Fixed bugs\n- Added features",
        "created_at": "2024-01-15T10:30:00.000Z"
      }
    ]
  }
}
```

### Get Package Versions Only
```bash
GET /api/packages/:name/versions
```
Response:
```json
{
  "success": true,
  "package_name": "my-package",
  "total_versions": 3,
  "versions": [
    {
      "version": "1.2.0",
      "release_date": "2024-01-15T10:30:00.000Z",
      "changelog": "- Fixed bugs",
      "created_at": "2024-01-15T10:30:00.000Z"
    }
  ]
}
```

### Sync Package (Create/Update)
```bash
POST /api/packages/sync
```

Request body:
```json
{
  "name": "my-package",
  "description": "My awesome package",
  "version": "1.2.0",
  "releaseDate": "2024-01-15T10:30:00.000Z",
  "changelog": "- Fixed bugs\n- Added features"
}
```

Response:
```json
{
  "success": true,
  "message": "Package synced successfully",
  "package": {
    "name": "my-package",
    "version": "1.2.0",
    "description": "My awesome package"
  }
}
```

## 💡 Usage Examples

### Client-side (JavaScript)
```javascript
// Sync a package
const response = await fetch('https://your-api.trycloudflare.me/api/packages/sync', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'my-lib',
    version: '2.0.0',
    description: 'My library',
    changelog: 'Major release'
  })
});

const data = await response.json();
console.log(data);

// Get package info
const pkg = await fetch('https://your-api.trycloudflare.me/api/packages/my-lib')
  .then(r => r.json());
console.log(pkg.package.versions);
```

### cURL
```bash
# Sync package
curl -X POST https://your-api.trycloudflare.me/api/packages/sync \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-package",
    "version": "1.0.0",
    "description": "Test package",
    "changelog": "Initial release"
  }'

# List packages
curl https://your-api.trycloudflare.me/api/packages

# Get package details
curl https://your-api.trycloudflare.me/api/packages/my-package
```

## 📁 Project Structure
```
.
├── src/
│   ├── index.js          # Main server
│   ├── db.js             # Database setup
│   └── routes.js         # API routes
├── data/                 # SQLite database (auto-created)
├── package.json
├── .env.example
├── .gitignore
└── README.md
```

## 🗄️ Database

**SQLite** - Local file-based database at `data/packages.db`

### Tables
- **packages**: name, description, timestamps
- **versions**: package_id, version, changelog, release_date, timestamps

## 🌐 Public Access

### With Cloudflare Tunnel
```
https://your-custom-domain.com (with domain)
OR
https://xxxxxxxxxx.trycloudflare.me (without domain)
```

### Keep Running 24/7
Option 1: Keep your computer on and running
Option 2: Use a cloud VM or Docker container (still can use Cloudflare Tunnel)

## 🔧 Environment Variables

Create `.env` file:
```
PORT=3000
NODE_ENV=production
```

## 📝 Notes

- ✅ No authentication required (public API)
- ✅ CORS enabled for browser requests
- ✅ Supports up to 10MB payloads
- ✅ SQLite auto-creates data directory
- ✅ Graceful shutdown handling

## 🚀 Deployment Options

1. **Local 24/7** (Recommended for free)
   - Keep machine running
   - Use Cloudflare Tunnel
   - No server costs

2. **VPS/Cloud VM** ($5-20/month)
   - Cheap VPS with Cloudflare Tunnel
   - More reliable uptime

3. **Railway/Render** (Free tier available)
   - Direct hosting
   - Docker support
   - Limited free tier

## 📞 Troubleshooting

### Tunnel Connection Issues
```bash
# Restart tunnel
cloudflared tunnel run my-package-api

# Check status
cloudflared tunnel list
```

### Database Locked
- Restart server: `npm start`
- Check if multiple processes running

### Port Already in Use
```bash
# Kill process on port 3000
lsof -ti:3000 | xargs kill -9

# Or use different port
PORT=3001 npm start
```

## 📄 License

Free for everyone!
# be-platform
