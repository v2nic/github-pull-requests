# GitHub PR Monitor

A Next.js application for monitoring GitHub pull requests with Docker-based authentication.

This project was created because the GitHub pull request interface does not show pull requests that you subscribe to. This tool provides a better view of all PRs you're involved with, including those you subscribe to that might be hidden in the standard GitHub interface.

## Features

- Real-time GitHub pull request monitoring
- Docker containerized with GitHub CLI integration
- In-app GitHub authentication via device code flow
- Rate limiting and backoff protection
- Persistent authentication across container restarts
- Responsive dark/light mode UI

## Quick Start

You can run this application either with Docker Compose (recommended for production) or locally in development mode.

### Option 1: Docker Compose (Recommended for Production)

#### Prerequisites

- Docker and Docker Compose
- GitHub account

#### Deployment

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

### Option 2: Local Development Mode

#### Prerequisites

- Node.js 18+ and npm
- GitHub CLI installed locally
- GitHub account

#### Setup and Run

1. Clone the repository:

```bash
git clone <repository-url>
cd github-pull-requests
```

2. Install dependencies:

```bash
npm install
```

3. Create a local environment file:

```bash
cp .env.local.example .env.local
```

Edit `.env.local` to configure your settings:

- `SOURCE_BASE_PATH`: Path to your local source code directory (default: `/Users/nicolas/Source`)
- `CIRCLECI_TOKEN`: Optional CircleCI token for status checks

4. Install GitHub CLI locally (if not already installed):

```bash
# macOS
brew install gh

# Ubuntu/Debian
sudo apt install gh

# Or download from https://cli.github.com/
```

5. Start the development server:

```bash
npm run dev
```

6. Access the app at `http://localhost:4477`

> **Note**: When running locally, the worktree functionality will use your local Source directory directly, ensuring worktrees are created in the same location as when running with Docker Compose.

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
- `CIRCLECI_TOKEN` - CircleCI personal access token for status checks

CircleCI status indicators (green/orange/red) appear next to each branch and require `CIRCLECI_TOKEN` to be set in your environment (for example, in a local `.env` file or Docker Compose env block). The token must have permission to read pipelines for the referenced GitHub repositories. If the token is missing or invalid, the CircleCI status API returns `401` and the UI shows a gray dot.

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

For local development setup, see [Option 2: Local Development Mode](#option-2-local-development-mode) in the Quick Start section.

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
