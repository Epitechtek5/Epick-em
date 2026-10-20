.PHONY: up down test test-db lint hooks

## Lance toute la plateforme en local
up: .env
	docker compose up --build -d

down:
	docker compose down

## Lance tous les tests (backend + migrations)
test: test-db
	cd backend && cargo test --workspace

## Tests des migrations sur une base jetable ; nécessite Docker
test-db:
	db/tests/run.sh

lint:
	cd backend && cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings

## Installe les hooks git (gitleaks) ; nécessite pre-commit
hooks:
	pre-commit install

.env:
	cp .env.example .env
