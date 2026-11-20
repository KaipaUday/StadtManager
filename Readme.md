# Python 3.12 virtual environment

```bash
# Create a virtual environment named .venv
python3.12 -m venv .venv

# Activate the virtual environment
source .venv/bin/activate

# Install dependencies (after adding requirements.txt)
python -m pip install --upgrade pip
python -m pip install -r requirements.txt

# Start the program, if app/main.py is the entry point
python app/main.py

# Deactivate the virtual environment
deactivate
```

## Environment variables

Set API keys and database credentials in your shell environment. Replace the
placeholder values with your own credentials; never commit real secrets to the
repository or paste them into source code.

### For the current terminal only

```bash
export OPENAI_API_KEY="your-openai-api-key"
export ANTHROPIC_API_KEY="your-anthropic-api-key"

# Set these if the application uses separate database settings
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

New terminal windows will load these settings automatically. Keep real
credentials out of this repository. The variable names above are common
conventions; use the names the application actually reads. If it expects a
single database connection string, configure that instead (for example,
`DATABASE_URL`) rather than the individual `DB_*` values.
