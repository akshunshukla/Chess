# Chess

A full-stack chess application for playing live games, revisiting past matches, and reviewing moves with Stockfish. Built with React and TypeScript, with an Express backend, WebSocket gameplay, PostgreSQL, and Redis.

## Features

- **Live multiplayer:** 10 + 0 rapid games with rating-based matchmaking, legal move validation, synchronized clocks, and promotion selection.
- **Game controls:** Resignation, draw offers, automatic game outcomes, and reconnection with a 60-second disconnect grace period.
- **Accounts and ratings:** Registration, login, refresh-token sessions, Elo ratings, and win/draw/loss statistics. New accounts start at 1200.
- **Game history:** Browse previous games, replay moves, download PGN files, and copy positions as FEN.
- **Stockfish analysis:** Review completed games or import a PGN or FEN. Game reviews include move classifications, engine suggestions, and accuracy scores for each player.
- **Background processing:** Track analysis progress and manually retry failed jobs. Imported games and positions do not affect ratings.

## Technology

| Layer | Tools |
| --- | --- |
| Frontend | React, TypeScript, Vite, React Router |
| Interface | Tailwind CSS, shadcn/ui, Radix UI, Lucide |
| Chess board and rules | react-chessboard, chess.js |
| Backend | Node.js, Express, TypeScript, ws |
| Database | PostgreSQL, Prisma |
| Live state and sessions | Redis, ioredis |
| Authentication and validation | JWT, Argon2, Zod |
| Analysis | Stockfish through the UCI protocol |

The frontend uses REST for accounts, saved games, and analysis, and a WebSocket connection for matchmaking and live play. The server controls moves, clocks, results, and rating changes. Redis holds live state and sessions; PostgreSQL stores accounts, completed games, and analysis results. The analysis worker runs inside the backend process and starts Stockfish as a child process.

## Project structure

```text
chess/
├── backend/
│   ├── prisma/              # Database schema and migrations
│   ├── src/
│   │   ├── analysis/        # Stockfish integration and background jobs
│   │   ├── api/             # HTTP routes, controllers, and middleware
│   │   ├── auth/            # Accounts and session management
│   │   ├── config/          # Environment and allowed origins
│   │   ├── db/              # PostgreSQL and Redis clients
│   │   ├── game/            # Matchmaking, clocks, rules, and persistence
│   │   └── ws/              # WebSocket connections and message handling
│   ├── Dockerfile
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── api/             # REST clients and response validation
│   │   ├── components/      # Shared interface and replay components
│   │   ├── features/        # Authentication, play, history, and analysis
│   │   ├── routes/          # Navigation, layouts, and route guards
│   │   ├── stores/          # Session and live-game state
│   │   └── ws/              # Realtime client and protocol
│   └── package.json
└── README.md
```

## Local setup

### 1. Prerequisites

- Node.js **22.22.0 or newer** and npm.
- A running PostgreSQL server with an empty database for this project.
- A running Redis server dedicated to this application.
- A Stockfish executable with `UCI_ShowWDL` support for analysis. Make it available on `PATH` or set `STOCKFISH_PATH` to its absolute path.

The backend requires PostgreSQL and Redis before it can start. Stockfish is required for analysis; live games can run while the analysis engine is unavailable.

### 2. Configure the backend

Create `backend/.env`, or update your existing local configuration:

```dotenv
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://YOUR_USER:YOUR_PASSWORD@localhost:5432/chess
REDIS_URL=redis://localhost:6379
JWT_ACCESS_SECRET=replace-with-a-random-access-secret
JWT_REFRESH_SECRET=replace-with-a-different-random-refresh-secret
CORS_ORIGINS=http://localhost:5173
STOCKFISH_PATH=stockfish
```

Replace the database credentials and database name with your local values. Generate a separate value for each JWT secret by running this command twice:

```sh
openssl rand -hex 32
```

From the project root, install dependencies, generate the Prisma client, and apply the database migrations:

```sh
cd backend
npm ci
npm run prisma:generate
npm run prisma:deploy
```

The included schema-upgrade migration requires empty application tables. An existing database with data from the initial schema needs a backfill migration before that upgrade can be applied.

### 3. Configure the frontend

Create `frontend/.env.local`:

```dotenv
VITE_API_URL=/api
VITE_WS_URL=/ws
DEV_BACKEND_URL=http://localhost:3000
```

From the project root, install the frontend dependencies:

```sh
cd frontend
npm ci
```

Vite uses `DEV_BACKEND_URL` to proxy `/api`, `/health`, and `/ws` to the backend during development. Restart Vite after changing environment variables. Values prefixed with `VITE_` are exposed to the browser and must not contain secrets.

### 4. Start both services

In one terminal, from the project root:

```sh
cd backend
npm run dev
```

In a second terminal, from the project root:

```sh
cd frontend
npm run dev
```

Open **http://localhost:5173**. The backend listens on **http://localhost:3000**, with its WebSocket endpoint at `/ws`.

Check that the HTTP server is responding:

```sh
curl http://localhost:3000/health
```

### 5. Play and review a game

1. Register an account and open **Play**.
2. Join the matchmaking queue. To try a local match, sign into a second account in another browser or a private window and join the queue there too.
3. Finish a game, then open **History** to replay it or export its PGN.
4. Request a review of a completed game, or open **Analysis** to import a PGN or FEN.

A FEN review covers a single position and does not include game accuracy scores.

## Configuration reference

### Backend

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Required | PostgreSQL connection string |
| `REDIS_URL` | Required | Redis connection string |
| `JWT_ACCESS_SECRET` | Required | Access-token signing secret |
| `JWT_REFRESH_SECRET` | Required | Refresh-token signing secret |
| `PORT` | `3000` | HTTP and WebSocket server port |
| `NODE_ENV` | `development` | Runtime environment |
| `CORS_ORIGINS` | `http://localhost:5173` in development | Comma-separated allowed frontend origins; required in production |
| `DB_CONNECT_TIMEOUT_MS` | `15000` | PostgreSQL connection timeout |
| `IDLE_PENDING_CHECK_MS` | `30000` | Background check interval for pending game work |

Allowed origins must be exact HTTP or HTTPS origins, without paths, wildcards, or trailing slashes. The same list is used for browser HTTP requests and WebSocket connections.

### Analysis

| Variable | Default | Purpose |
| --- | --- | --- |
| `STOCKFISH_PATH` | `stockfish` | Engine executable name or absolute path |
| `STOCKFISH_THREADS` | `1` | Engine thread count |
| `STOCKFISH_HASH_MB` | `64`; `16` in production | Engine hash memory in MB |
| `STOCKFISH_DEPTH` | `12` | Search depth |
| `STOCKFISH_SEARCH_TIMEOUT_MS` | `15000` | Timeout for an engine search |
| `STOCKFISH_STARTUP_TIMEOUT_MS` | `10000` | Timeout for engine startup and readiness |
| `ANALYSIS_POLL_MS` | `1000` | Worker delay between jobs or after errors |
| `ANALYSIS_IDLE_POLL_MS` | `0` | Idle polling interval; `0` waits for a wake signal |
| `ANALYSIS_JOB_TIMEOUT_MS` | `300000` | Maximum duration of an analysis job |

## Development commands

Run each command from the indicated directory. The frontend and backend have separate npm packages.

| Directory | Command | Purpose |
| --- | --- | --- |
| `backend` | `npm run dev` | Start the server with automatic restarts |
| `backend` | `npm start` | Run the server through `tsx` |
| `backend` | `npm run build` | Check backend TypeScript; no files are emitted |
| `backend` | `npm run prisma:generate` | Regenerate the Prisma client |
| `backend` | `npm run prisma:deploy` | Apply committed database migrations |
| `frontend` | `npm run dev` | Start the Vite development server |
| `frontend` | `npm run typecheck` | Check frontend TypeScript |
| `frontend` | `npm run lint` | Run Oxlint |
| `frontend` | `npm run build` | Check types and build into `frontend/dist/` |
| `frontend` | `npm run preview` | Preview the frontend production build |

## API overview

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/health` | HTTP health response |
| `POST` | `/api/auth/register` | Create an account |
| `POST` | `/api/auth/login` | Sign in |
| `POST` | `/api/auth/refresh` | Refresh a session |
| `POST` | `/api/auth/logout` | Revoke a session |
| `GET` | `/api/auth/me` | Get the current account |
| `GET` | `/api/games/history` | Get paginated game history |
| `GET` | `/api/games/:id` | Get a saved game |
| `GET` | `/api/games/:id/pgn` | Export a game's PGN |
| `GET` | `/api/games/:id/fen` | Get a game's final FEN |
| `POST` | `/api/analysis/games/:gameId` | Request analysis of a completed game |
| `POST` | `/api/analysis/import` | Submit a PGN or FEN for analysis |
| `GET` | `/api/analysis/:analysisId` | Get analysis status and results |
| `POST` | `/api/analysis/:analysisId/retry` | Retry a failed analysis |

Protected HTTP endpoints use `Authorization: Bearer <accessToken>`. WebSocket clients connect to `/ws` and authenticate with an `auth` message before sending queue or game commands. Message definitions are in [the WebSocket protocol](backend/src/ws/protocol.ts) and [game protocol](backend/src/ws/game.protocol.ts).

## Deployment notes

- **Frontend:** Run `npm run build` in `frontend` and serve `frontend/dist/` with a fallback to `index.html` for client-side routes. Set `VITE_API_URL` and `VITE_WS_URL` before building, using your deployed backend's HTTPS `/api` and WSS `/ws` URLs, or configure a reverse proxy for relative paths. The Vite development proxy is not part of the build.
- **Backend:** Generate the Prisma client, run the TypeScript check, apply migrations, and start with `npm start`. Set `NODE_ENV=production` and configure `CORS_ORIGINS` for the frontend. The host must support persistent WebSocket connections and the Stockfish executable.
- **Docker:** The [backend Dockerfile](backend/Dockerfile) installs Stockfish, generates the Prisma client, and checks TypeScript. Build it from the project root with `docker build -t chess-backend ./backend`. Supply runtime environment variables and reachable PostgreSQL/Redis services separately; the image does not apply database migrations on startup.
- **Process model:** Run one backend instance per PostgreSQL/Redis pair. Connections and timers are managed within that process, and startup recovery clears transient game state, aborts unfinished games, and marks interrupted analyses as failed.

## Troubleshooting

| Problem | What to check |
| --- | --- |
| Backend fails during startup | Required environment values, PostgreSQL/Redis availability, Prisma client generation, and applied migrations |
| Browser requests or sockets fail | Frontend URLs, the development proxy target, and exact `CORS_ORIGINS` values |
| Analysis reports an unavailable engine | `STOCKFISH_PATH`, executable permissions, and support for `UCI_ShowWDL` |
| Matchmaking keeps waiting | A second signed-in player must join the same queue |
| A game ends after a disconnect | The reconnect grace period is 60 seconds; the game clock continues running |
