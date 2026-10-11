# Developer shortcuts. Everything runs inside the Docker Compose dev stack.
# Run `make help` for the list.

COMPOSE ?= docker compose
PNPM    ?= pnpm
API     := $(COMPOSE) exec api
WEB     := $(COMPOSE) exec web
s       ?= api

.DEFAULT_GOAL := help
.PHONY: help env up down build restart ps logs migrate migrations shell dbshell createsuperuser \
        test test-be test-fe e2e lint lint-be lint-fe fmt gen-api check reset-db

help: ## Show this help
	@awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z_-]+:.*##/ {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

env: ## Create .env from .env.example (won't overwrite)
	@test -f .env && echo ".env already exists" || (cp .env.example .env && echo "created .env")

up: env ## Start the dev stack in the background
	$(COMPOSE) up -d --build

down: ## Stop the dev stack
	$(COMPOSE) down

build: ## Rebuild dev images
	$(COMPOSE) build

restart: ## Restart one service (s=api)
	$(COMPOSE) restart $(s)

ps: ## Show service status
	$(COMPOSE) ps

logs: ## Tail logs for one service (s=api)
	$(COMPOSE) logs -f --tail=200 $(s)

migrate: ## Apply migrations
	$(API) python manage.py migrate

migrations: ## Create migrations
	$(API) python manage.py makemigrations

shell: ## Django shell
	$(API) python manage.py shell

dbshell: ## psql into the database
	$(COMPOSE) exec db sh -c 'psql -U "$$POSTGRES_USER" "$$POSTGRES_DB"'

createsuperuser: ## Create a Django superuser
	$(API) python manage.py createsuperuser

test: test-be test-fe ## Run backend and frontend unit tests

test-be: ## Backend tests with coverage
	$(API) pytest --cov

test-fe: ## Frontend unit tests
	$(WEB) pnpm test

e2e: ## Playwright E2E against the running stack (host needs pnpm + `pnpm exec playwright install chromium`)
	cd frontend && $(PNPM) e2e

lint: lint-be lint-fe ## All linters and type checks

lint-be:
	$(API) sh -c "ruff check . && ruff format --check . && mypy ."

lint-fe:
	$(WEB) sh -c "pnpm lint && pnpm format:check && pnpm typecheck"

fmt: ## Auto-format backend and frontend
	$(API) sh -c "ruff check --fix . && ruff format ."
	$(WEB) pnpm format

gen-api: ## Regenerate backend/schema.yaml, frontend API types and permission constants
	$(API) python manage.py spectacular --validate --fail-on-warn --file schema.yaml
	$(API) python manage.py export_permissions /tmp/permissions.ts
	$(COMPOSE) cp api:/tmp/permissions.ts frontend/src/types/permissions.ts
	$(WEB) pnpm gen:api

check: lint test ## Everything CI runs (except E2E)
	$(API) python manage.py makemigrations --check --dry-run

reset-db: ## DESTROYS local data: drop the database volume and recreate it
	@read -p "Drop the local database volume? [y/N] " ans && [ "$$ans" = y ]
	$(COMPOSE) down
	docker volume rm $$(basename $$(pwd))_pgdata
	$(COMPOSE) up -d
