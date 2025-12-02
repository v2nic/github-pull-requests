# GitHub PR Subscriptions Viewer

A Next.js application that displays pull requests you're subscribed to or involved with on GitHub.

## Prerequisites

- Node.js 18+
- [GitHub CLI](https://cli.github.com/) (`gh`) installed and authenticated

```bash
gh auth login
```

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

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
