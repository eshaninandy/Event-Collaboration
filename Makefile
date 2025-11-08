.PHONY: help build up down restart logs clean install test test-docker test-e2e-docker

help: ## Show this help message
	@echo 'Usage: make [target]'
	@echo ''
	@echo 'Available targets:'
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  %-15s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

build: ## Build Docker containers
	docker-compose build

up: ## Start all containers
	docker-compose up -d --build

up-deps: ## Start only PostgreSQL and Redis (for local development)
	docker-compose up -d postgres redis

down: ## Stop containers
	docker-compose down

restart: ## Restart containers
	docker-compose restart

logs: ## View container logs
	docker-compose logs -f api

logs-db: ## View database logs
	docker-compose logs -f postgres

clean: ## Stop containers and remove volumes
	docker-compose down -v

install: ## Install dependencies locally
	npm install

dev: ## Run development server locally (requires local PostgreSQL)
	npm run start:dev

test: ## Run unit and integration tests
	npm run test

test-e2e: ## Run e2e tests
	npm run test:e2e

test-docker: ## Run unit tests in Docker container
	docker-compose run --rm api npx jest test/unit

test-e2e-docker: ## Run e2e tests in Docker container
	docker-compose run --rm api npm run test:e2e

shell-api: ## Open shell in API container
	docker-compose exec api sh

shell-db: ## Open PostgreSQL shell
	docker-compose exec postgres psql -U postgres -d event_collab

audit-logs: ## View latest audit logs with AI summaries (ordered by ID, newest first)
	@docker-compose exec postgres psql -U postgres -d event_collab -c "SELECT id, \"userId\", \"newEventId\", notes FROM audit_logs ORDER BY id DESC LIMIT 5;"

audit-latest: ## View latest audit log AI summary (ordered by ID, newest first)
	@docker-compose exec postgres psql -U postgres -d event_collab -c "SELECT notes FROM audit_logs ORDER BY id DESC LIMIT 1;"

reset-db: ## Reset database (WARNING: deletes all data)
	docker-compose exec postgres psql -U postgres -c "DROP DATABASE IF EXISTS event_collab;"
	docker-compose exec postgres psql -U postgres -c "CREATE DATABASE event_collab;"
	docker-compose restart api
