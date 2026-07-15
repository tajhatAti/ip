# Ahad Co - Authentication System

A complete authentication system with beautiful glassmorphism UI, 2FA support, and database management.

## Features

✅ **User Authentication**
- Sign Up with email verification (OTP)
- Login with username or email
- Password strength indicator
- Remember me functionality
- Password reset with OTP

✅ **Dashboard**
- Profile management
- Links management
- Security settings
- Session management

✅ **Security**
- Two-Factor Authentication (2FA) with TOTP
- Backup codes for 2FA
- Session management (view/revoke sessions)
- Login history tracking
- Rate limiting
- Password hashing with bcrypt

✅ **UI/UX**
- Beautiful glassmorphism design
- Dark/Light theme toggle
- Responsive design
- Keyboard shortcuts
- Toast notifications
- Loading animations

## Quick Start

### Local Development

```bash
# Install dependencies
pip install -r requirements.txt

# Run the server
uvicorn app:app --reload
```

### Docker

```bash
# Build and run
docker-compose up

# Or with Docker directly
docker build -t ahad-co .
docker run -p 8000:8000 \
  -e BREVO_API_KEY=your_api_key \
  -e SENDER_EMAIL=your@email.com \
  ahad-co
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `BREVO_API_KEY` | Brevo/Sendinblue API key for emails | Yes |
| `SENDER_EMAIL` | Email address to send from | Yes |
| `SENDER_NAME` | Sender name (default: "Ahad Co") | No |
| `DB_PATH` | Path to SQLite database | No |
| `OTP_EXPIRY_MINUTES` | OTP expiry time (default: 10) | No |

## Deploy to Render

1. Push to GitHub
2. Go to [Render](https://render.com)
3. Connect your GitHub repo
4. Create a Web Service:
   - Build Command: `pip install -r requirements.txt`
   - Start Command: `uvicorn app:app --host 0.0.0.0 --port $PORT`
5. Add environment variables from Render Dashboard
6. Enable Persistent Disk for `/data`

## Deploy to Friendhost/FriendsHost

```bash
# SSH into your server
ssh user@your-server

# Clone your repo
git clone https://github.com/yourusername/ahad-co.git
cd ahad-co

# Install dependencies
pip install -r requirements.txt

# Run with systemd (create a service file)
sudo nano /etc/systemd/system/ahad-co.service
```

```ini
[Unit]
Description=Ahad Co Auth System
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/path/to/ahad-co
Environment="BREVO_API_KEY=your_key"
Environment="SENDER_EMAIL=your@email.com"
ExecStart=/usr/bin/python3 -m uvicorn app:app --host 0.0.0.0 --port 8000
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable ahad-co
sudo systemctl start ahad-co
```

## API Endpoints

### Authentication
- `POST /signup` - Create new account
- `POST /verify` - Verify email OTP
- `POST /resend-otp` - Resend verification code
- `POST /login` - Sign in
- `POST /logout` - Sign out

### Password Reset
- `POST /forgot-password` - Request reset code
- `POST /verify-reset-otp` - Verify reset code
- `POST /reset-password` - Set new password

### Profile
- `GET /profile` - Get profile data
- `POST /profile/update` - Update profile

### Two-Factor Authentication
- `GET /2fa/status` - Get 2FA status
- `POST /2fa/setup` - Setup 2FA
- `POST /2fa/verify-setup` - Verify and enable 2FA
- `POST /2fa/verify-login` - Verify 2FA during login

### Sessions
- `GET /sessions` - List all sessions
- `POST /sessions/revoke` - Revoke a session

### Vault
- `GET /vault` - List vault entries
- `POST /vault/add` - Add entry
- `POST /vault/update` - Update entry
- `POST /vault/delete` - Delete entry

### Utility
- `GET /health` - Health check
- `GET /login-history` - Login history
- `POST /account/delete` - Delete account

## Database Schema

The app uses SQLite with these tables:
- `users` - User accounts
- `sessions` - Active sessions
- `vault_entries` - User data vault
- `user_2fa` - 2FA settings
- `login_history` - Login tracking

## License

MIT License - Use freely for personal and commercial projects.
