# List recipes
default:
    @just --list

# Install Python and site dependencies
install:
    uv sync
    cd site && bun install

# Fetch posts (newest first) into data/posts.jsonl; skips posts already saved
scrape pages="100" *args:
    uv run scripts/scrape.py --pages {{pages}} {{args}}

# Build site/public/data.json from the raw posts
analyze:
    uv run scripts/analyze.py data/posts.jsonl site/public/data.json

# Start the report dev server
dev: analyze
    cd site && bun run dev

# Build the static report into site/dist
build: analyze
    cd site && bun run build

# Preview the built report
preview: build
    cd site && bun run preview

# Delete the raw sample and generated data
[confirm("Delete data/posts.jsonl and site/public/data.json?")]
clean:
    rm -f data/posts.jsonl site/public/data.json
    rm -rf site/dist
