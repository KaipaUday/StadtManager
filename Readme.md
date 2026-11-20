# StadtManager

## Run locally

```bash
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python -m uvicorn app:app --app-dir Site --reload
```

Open <http://127.0.0.1:8000>. Press `Ctrl+C` to stop the server. The site
supports CSV, JSON, PDF, Markdown, and text files up to 5 MB each. Files are
processed in memory and aren't saved by the app.

To use the AI assistant, set either `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`
in the server's environment. Select the matching provider in the website.
Optional `ANTHROPIC_MODEL` and `OPENAI_MODEL` variables override the default
model names. The UI checks the key and loads available chat models before
showing the model selector. Keys are never sent to or displayed by the browser.

With the server running, check a provider key and list models without printing
the key itself:

```bash
curl --fail-with-body --silent --show-error --get http://127.0.0.1:8000/api/models \
  --data-urlencode provider=anthropic
```

Use `provider=openai` to check the OpenAI key instead. A successful response
includes the available model IDs; an invalid or missing key returns an error.

## Environment variables

Replace placeholders with your own credentials. Never commit real secrets to
the repository or paste them into source code.

### For the current terminal only

```bash
export OPENAI_API_KEY="your-openai-api-key"
export ANTHROPIC_API_KEY="your-anthropic-api-key"

# Optional database settings for future database-backed features
export DB_HOST="localhost"
export DB_PORT="5432"
export DB_NAME="your-database-name"
export DB_USER="your-database-user"
export DB_PASSWORD="your-database-password"
```

### Persist on macOS (zsh)

Add the same `export` lines to `~/.zshrc` using a text editor:

```bash
nano ~/.zshrc
```

Save and close the editor, then load the settings into the current terminal:

```bash
source ~/.zshrc
```

New terminal windows will load these settings automatically. The `DB_*`
examples are placeholders for future database-backed features; the current
app does not connect to a database. The variable names above are common
conventions and must match what an application reads. If a database uses a
single connection string, configure that instead (for example, `DATABASE_URL`).
