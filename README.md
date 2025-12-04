# GitHub PR Monitor

A Next.js application for monitoring GitHub pull requests with Docker-based authentication.

## Features

- Real-time GitHub pull request monitoring
- Docker containerized with GitHub CLI integration
- In-app GitHub authentication via device code flow
- Rate limiting and backoff protection
- Persistent authentication across container restarts
- Responsive dark/light mode UI

## Quick Start

### Prerequisites

- Docker and Docker Compose
- GitHub account

### Deployment

1. Clone the repository:

```bash
git clone <repository-url>
cd github-pull-requests
```

2. Start the application:

```bash
docker-compose up -d
```

3. Access the app at `http://localhost:4477`

> **Why port 4477?** The port number is a mnemonic for "GHPR" (GitHub Pull Requests) using phone keypad mapping: G=4, H=4, P=7, R=7.

### Authentication

The first time you access the app, it will automatically detect that you're not authenticated and show the GitHub authentication dialog:

1. **Copy the one-time code** - Click the "Copy" button to copy the code to clipboard
2. **Open GitHub login** - Click the "Open GitHub" button to open the authentication page in a new tab
3. **Complete authentication** - Paste the code on the GitHub page and authorize the app
4. **Automatic refresh** - The app will automatically detect successful authentication and load your pull requests

Your authentication will persist across container restarts via Docker volumes.

## Configuration

### Environment Variables

- `NODE_ENV` - Set to `production` for production deployment
- `PORT` - Application port (default: 4477)

### Docker Volumes

The application uses a Docker volume `gh-config` to persist GitHub CLI authentication:

```yaml
volumes:
  gh-config:
    driver: local
```

## API Endpoints

- `GET /api/health` - Health check endpoint
- `POST /api/auth/login` - Start GitHub authentication
- `GET /api/auth/login?action=start&sessionId=...` - Stream authentication events
- `POST /api/auth/logout` - Clear GitHub authentication
- `GET /api/notifications` - Fetch pull request notifications

## Security Features

- Rate limiting: 3 authentication attempts per 5 minutes per IP
- Process timeout: 10 minutes maximum authentication time
- Orphaned process cleanup: 15 minutes
- Non-root container execution
- Proper volume permissions

## Troubleshooting

### Authentication Issues

1. **Clear existing authentication:**

```bash
docker-compose exec github-pr-app curl -X POST http://localhost:3000/api/auth/logout
```

2. **Check GitHub CLI status:**

```bash
docker-compose exec github-pr-app gh auth status
```

3. **Restart with clean volume:**

```bash
docker-compose down -v
docker-compose up -d
```

### Volume Permission Issues

If you encounter permission errors with the GitHub configuration volume:

```bash
# Check volume ownership
docker-compose exec github-pr-app ls -la /home/nextjs/.config/

# Fix permissions if needed
docker-compose exec github-pr-app chown -R nextjs:nodejs /home/nextjs/.config/
```

### Rate Limiting

If you're rate limited, wait 5 minutes before trying again, or restart the container:

```bash
docker-compose restart
```

### Health Check Failures

Check if GitHub CLI is properly installed:

```bash
docker-compose exec github-pr-app gh --version
```

If health checks fail, check the container logs:

```bash
docker-compose logs github-pr-app
```

## Development

### Local Development

1. Install dependencies:

```bash
npm install
```

2. Start development server:

```bash
npm run dev
```

3. Install GitHub CLI locally for testing:

```bash
# macOS
brew install gh

# Ubuntu/Debian
sudo apt install gh

# Or download from https://cli.github.com/
```

### Building

```bash
npm run build
npm start
```

## Architecture

- **Frontend**: Next.js with React components
- **Backend**: Next.js API routes with Server-Sent Events
- **Authentication**: GitHub CLI device code flow

## License

MIT License

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:4477](http://localhost:4477) in your browser.

## Features

- Lists all PR notifications from your GitHub account
- Filters by state: Open, Closed, or All
- Shows subscription reason (author, reviewer, mentioned, etc.)
- Links directly to PRs on GitHub

## How It Works

The backend API route (`/api/notifications`) executes `gh api notifications` to fetch your GitHub notification threads, filters for pull requests, and enriches each with PR state information.

## Tech Stack

- Next.js 16 with App Router
- TypeScript
- Tailwind CSS
