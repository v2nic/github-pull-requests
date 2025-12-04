# Test Scenarios

Manual test scenarios for the GitHub PR Monitor application. These scenarios should be verified when making changes to ensure no regressions.

## Authentication Flow

### First-time Authentication

- [ ] Visit app when GitHub CLI is not authenticated
- [ ] Auth dialog appears automatically
- [ ] One-time code is displayed
- [ ] Copy button copies code to clipboard
- [ ] "Open GitHub" button opens device login page
- [ ] After completing GitHub auth, dialog closes automatically
- [ ] Pull requests load after successful authentication

### Authentication Retry

- [ ] Close browser tab while auth dialog is open
- [ ] Reopen app in new tab
- [ ] New auth dialog appears with fresh code (no backoff)
- [ ] Can complete authentication successfully

### Authentication Persistence

- [ ] After successful auth, restart container with `docker-compose restart`
- [ ] App loads PRs without requiring re-authentication
- [ ] Volume mount preserves GitHub CLI credentials

### Rate Limiting

- [ ] Trigger rate limit by rapid auth attempts (3+ in 5 minutes)
- [ ] Rate limit error is shown
- [ ] After rate limit, backoff prevents further attempts
- [ ] Backoff clears after timeout

## Pull Request Display

### Data Loading

- [ ] PRs load on initial page visit
- [ ] Loading spinner shows during fetch
- [ ] "From cache" indicator shows when serving cached data
- [ ] Auto-refresh updates data periodically

### Filtering

- [ ] "All" filter shows all PRs
- [ ] "Open" filter shows only open PRs
- [ ] "Closed" filter shows only closed/merged PRs
- [ ] Filter counts update correctly

### PR Information

- [ ] PR title displays correctly
- [ ] Repository name shows
- [ ] PR state badge (open/closed/merged) displays
- [ ] Reason label (author/reviewer/commenter) shows
- [ ] Clicking PR opens GitHub in new tab

## Docker Container

### Container Startup

- [ ] `docker-compose up -d` starts container successfully
- [ ] No TypeScript errors on startup (next.config.js not .ts)
- [ ] Health check passes at `/api/health`
- [ ] App accessible at port 4477

### Container Restart

- [ ] `docker-compose restart` preserves auth state
- [ ] `docker-compose down && docker-compose up -d` preserves auth state
- [ ] Volume mount works correctly

### Error Handling

- [ ] Graceful handling when GitHub CLI not available
- [ ] Graceful handling when GitHub API is down
- [ ] SSE connection cleanup on browser disconnect (no controller errors)

## API Endpoints

### /api/health

- [ ] Returns 200 when healthy
- [ ] Includes GitHub CLI version in response
- [ ] Returns 503 when unhealthy

### /api/notifications

- [ ] Returns PR data when authenticated
- [ ] Returns auth error when not authenticated
- [ ] Caching works (returns cached data within TTL)
- [ ] Rate limit backoff only triggers for actual rate limits

### /api/auth/login

- [ ] POST validates session ID
- [ ] GET with action=start streams SSE events
- [ ] Code and URL events sent correctly
- [ ] Success event sent on completion
- [ ] Error event sent on failure
- [ ] Cleanup happens on browser disconnect

### /api/auth/logout

- [ ] Clears GitHub CLI authentication
- [ ] Returns success response

## Edge Cases

### Network Issues

- [ ] App handles network timeout gracefully
- [ ] Reconnection after network restore

### Browser Compatibility

- [ ] Works in Chrome
- [ ] Works in Firefox
- [ ] Works in Safari
- [ ] SSE (EventSource) functions correctly

### Multiple Sessions

- [ ] Multiple browser tabs don't interfere
- [ ] Each tab gets its own session ID for auth
