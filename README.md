# opencode-telegram-plugin

Sends a Telegram notification when the opencode agent finishes thinking/writing and waits for user input.

## Setup

### 1. Create a Telegram bot

1. Open Telegram and search for [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow the prompts
3. Copy the bot token (looks like `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`)
4. Send `/mybots` → your bot → Bot Settings → Group Privacy → **Turn off** group privacy so the bot can read messages in groups
5. Add the bot to a chat (group or direct) and send a message
6. Visit `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` to find your `chat_id`

### 2. Credentials

Provide credentials in one of these ways (options override env vars):

**Option A — Environment variables** (recommended):

```bash
cp .env.example .env
# Edit .env with your bot token and chat ID
```

The plugin reads `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` from `process.env`.

**Option B — Plugin options in `opencode.json`:**

```json
{
  "plugin": [
    [
      "file:///path/to/opencode-telegram-plugin/dist/index.js",
      {
        "botToken": "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
        "chatId": "-1001234567890"
      }
    ]
  ]
}
```

### 3. Register the plugin

Add the plugin to your `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    [
      "file:///path/to/opencode-telegram-plugin/dist/index.js",
      {
        "message": "opencode agent is waiting for your input",
        "debug": false
      }
    ]
  ]
}
```

## Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `botToken` | `env.TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `chatId` | `env.TELEGRAM_CHAT_ID` | Target chat/group ID |
| `message` | `"opencode agent is waiting for your input"` | Custom notification text |
| `debug` | `false` | Log events to `/tmp/opencode-telegram-debug.log` |

## Development

```bash
bun install        # install dependencies
bun run build      # compile TypeScript → dist/
bun test           # run tests
```

## How it works

The plugin listens for opencode lifecycle events:

- **session.status**: busy→idle transition → sends notification (debounced 500ms)
- **session.idle**: fallback idle signal
- **permission.updated**: agent asks for permission → sends notification
- **permission.replied**: user responds → cancels pending notification
- **tool.execute.before** (ask/question/confirm): agent is about to ask a question → sends notification

Uses `curl` via opencode's shell function to call the Telegram Bot API — no extra runtime dependencies.
