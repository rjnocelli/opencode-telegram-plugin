# opencode Plugin Blueprint

Template for creating a new opencode plugin. Use this alongside the sound plugin as reference.

---

## 1. Repository Structure

```
opencode-<name>-plugin/
├── .gitignore
├── package.json
├── tsconfig.json
├── README.md
├── opencode.json.example
└── src/
    ├── index.ts          # plugin entry
    └── index.test.ts     # tests
```

## 2. Boilerplate Files

### `package.json`

```json
{
  "name": "opencode-telegram-plugin",
  "version": "0.1.0",
  "description": "Sends a Telegram message when the opencode agent finishes and waits for input",
  "type": "module",
  "main": "./dist/index.js",
  "exports": {
    ".": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "test": "bun test"
  },
  "license": "MIT",
  "peerDependencies": {
    "@opencode-ai/plugin": "*"
  },
  "devDependencies": {
    "@opencode-ai/plugin": "latest",
    "@types/node": "^25.6.0",
    "typescript": "^5.0.0"
  }
}
```

### `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "declaration": true,
    "skipLibCheck": true
  },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts", "src/**/*.spec.ts"]
}
```

### `.gitignore`

```
node_modules/
dist/
*.log
opencode.json
```

### `opencode.json.example`

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    [
      "file:///path/to/opencode-telegram-plugin/dist/index.js",
      {
        "botToken": "YOUR_BOT_TOKEN",
        "chatId": "YOUR_CHAT_ID",
        "debug": false
      }
    ]
  ]
}
```

---

## 3. Plugin Architecture (from sound plugin)

### Entry Point Signature

```typescript
import type { Plugin, PluginOptions } from "@opencode-ai/plugin"

type MyPluginOptions = PluginOptions & {
  // your config fields
}

const myPlugin: Plugin = async ({ $ }, options?: MyPluginOptions) => {
  // setup: state variables, init

  return {
    event: async ({ event }) => {
      // handle lifecycle events
    },
    "tool.execute.before": async (input, _output) => {
      // react to specific tools being called
    },
  }
}

export default myPlugin
```

### PluginInput (what `{ $ }` destructures from)

| Field | Type | Description |
|-------|------|-------------|
| `$` | `BunShell` | Shell function — run OS commands (typed as `any` in practice) |
| `client` | opencode client | Make API calls if needed |
| `project` | object | Current project info |
| `directory` | string | Project root path |
| `worktree` | string | Worktree path |
| `serverUrl` | string | URL of the opencode server |

### Hooks (what the plugin returns)

Sound plugin uses these hooks:

| Hook | When it fires | Handler signature |
|------|---------------|-------------------|
| `event` | Any lifecycle event | `(params: { event: OpenCodeEvent }) => Promise<void>` |
| `tool.execute.before` | Before any tool runs | `(input, output) => Promise<void>` |

### Events to handle (from sound plugin)

| Event type | `event.properties` shape | When |
|------------|------------------------|------|
| `session.status` | `{ status: { type: "busy" \| "idle" \| "retry" } }` | Agent state changes |
| `session.idle` | `{ sessionID: string }` | Fallback idle signal |
| `permission.updated` | (various) | Agent asks for permission |
| `permission.replied` | `{ sessionID, permissionID, response }` | User responds |

### Internal State Pattern

```typescript
let wasBusy = false            // track busy→idle transitions
let playTimer: ReturnType<typeof setTimeout> | null = null  // debounce timer
let logEvents = false          // debug mode flag

const log = async (msg: string) => {
  if (!logEvents) return
  const { appendFile } = await import("node:fs/promises")
  await appendFile("/tmp/opencode-plugin-debug.log", `${Date.now()} ${msg}\n`).catch(() => {})
}
```

### Debounce Pattern

```typescript
const cancel = () => {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
}

const schedule = () => {
  if (!timer) {
    timer = setTimeout(async () => {
      timer = null
      // do the thing (send telegram, play sound, etc.)
    }, 500)
  }
}
```

### Core Event Handling Logic

```typescript
event: async ({ event }) => {
  if (event.type === "session.status") {
    const status = event.properties.status.type
    if (status === "busy" || status === "retry") {
      wasBusy = true
      cancel()
    } else if (status === "idle" && wasBusy) {
      wasBusy = false
      schedule()
    }
  } else if (event.type === "session.idle") {
    if (wasBusy) {
      wasBusy = false
      schedule()
    }
  } else if (event.type === "permission.updated") {
    schedule()
  } else if (event.type === "permission.replied") {
    cancel()
  }
},
"tool.execute.before": async (input) => {
  if (ASK_TOOLS.has(input.tool)) {
    schedule()
  }
},
```

---

## 4. How to Bootstrap the Telegram Plugin

### Step 1: Copy the template files

```
cp -r opencode-sound-plugin opencode-telegram-plugin
```

Then gut `src/index.ts` and `src/index.test.ts` — keep the structure, replace the sound logic.

### Step 2: Define Telegram-specific config

```typescript
type TelegramPluginOptions = PluginOptions & {
  botToken?: string     // Telegram bot token
  chatId?: string       // Target chat ID
  message?: string      // Custom message template
  debug?: boolean
}
```

### Step 3: Replace `play()` with `sendTelegram()`

Use the `$` shell function to call `curl`:

```typescript
const sendTelegram = async () => {
  const token = options?.botToken
  const chat = options?.chatId
  if (!token || !chat) {
    // optionally log a warning
    return
  }

  const text = options?.message || "opencode agent is waiting for your input"
  const url = `https://api.telegram.org/bot${token}/sendMessage`

  try {
    await ($ as any)`curl -s -X POST ${url} -d chat_id=${chat} -d text=${text}`.quiet()
  } catch { /* silent fail */ }
}
```

### Step 4: Adapt tests

Replace sound-related assertions with checks that the captured shell command includes `api.telegram.org`:

```typescript
expect(captured.some((c: string) => c.includes("api.telegram.org"))).toBe(true)
```

### Step 5: Register in opencode config

```json
{
  "plugin": [
    ["opencode-telegram-plugin", {
      "botToken": "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
      "chatId": "-1001234567890",
      "debug": true
    }]
  ]
}
```

---

## 5. Key Differences: Sound Plugin → Telegram Plugin

| Aspect | Sound Plugin | Telegram Plugin |
|--------|-------------|-----------------|
| Action | Play audio file | Send HTTP POST to Telegram API |
| Runtime deps | None (uses OS audio players) | None (uses `curl` via `$`) |
| Config | `sound` (file path) | `botToken`, `chatId`, `message` |
| Platform concerns | Different per OS | Same everywhere (just HTTPS) |
| Failure mode | Silent (try/catch) | Silent (try/catch) |
| Debounce | 500ms | 500ms (or longer — Telegram is async) |

Since there's no platform-specific audio logic, the Telegram plugin is actually **simpler** than the sound plugin.

---

## 6. Development Workflow

```bash
bun install           # install deps
bun run build         # tsc → dist/
bun test              # run tests with bun
```

### To test manually

Create a test script `test-telegram.ts`:

```typescript
import opencodeTelegramPlugin from "./src/index"

const mock$ = ((strings: TemplateStringsArray, ...values: any[]) => ({
  then: (resolve: any) => resolve({ stdout: "", stderr: "", exitCode: 0 }),
  quiet: () => ({
    then: (resolve: any) => resolve({ stdout: "", stderr: "", exitCode: 0 }),
  }),
})) as any

const hooks = await opencodeTelegramPlugin(
  { $: mock$ } as any,
  { botToken: "YOUR_TOKEN", chatId: "YOUR_CHAT_ID" }
)

await hooks.event!({
  event: { type: "session.status", properties: { sessionID: "s1", status: { type: "busy" } } }
} as any)
await hooks.event!({
  event: { type: "session.status", properties: { sessionID: "s1", status: { type: "idle" } } }
} as any)
await Bun.sleep(600)
console.log("done")
```

---

## 7. Useful `@opencode-ai/plugin` Types

These come from the peer dependency. Import from `@opencode-ai/plugin`:

```typescript
import type { Plugin, PluginOptions, PluginInput, Hooks } from "@opencode-ai/plugin"
```

- **`Plugin`**: `(input: PluginInput, options?: PluginOptions) => Promise<Hooks>`
- **`PluginOptions`**: Base options type (empty by default, extend it)
- **`PluginInput`**: `{ $: BunShell, client, project, directory, worktree, serverUrl }`
- **`Hooks`**: `{ event?, "tool.execute.before"?, ... }` — return this from the plugin
