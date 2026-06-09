# OSS Hunter 🎯

Find unassigned good first issues with no competing PRs — powered by GitHub API + Claude AI.

## Features
- Fetch all `good first issue` labeled issues from any public GitHub repo
- Filter by: assigned/unassigned, PR status, sort by recency/comments
- Click any issue → Claude generates a plan of action to fix it and get a PR merged
- Dark GitHub-style UI

## Setup

```bash
npm install
npm start
```

## Deploy to Vercel

```bash
npm install -g vercel
vercel
```

## Usage
1. Enter your Anthropic API key (get one at console.anthropic.com)
2. Enter a repo like `meshery/meshery`
3. Click Fetch
4. Filter to unassigned + no PR = best targets
5. Click any issue for an AI-generated plan of action

## Notes
- GitHub API is rate limited to 60 requests/hr unauthenticated
- To increase limit, add a GitHub token via `Authorization: token YOUR_TOKEN` header in the fetch call
