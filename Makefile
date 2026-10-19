.PHONY: up down test lint hooks

## Lance toute la plateforme en local
up: .env
	docker compose up --build -d

down:
	docker compose down

## Lance tous les tests
test:
	cd backend && cargo test --workspace

lint:
	cd backend && cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings

## Installe les hooks git (gitleaks) ; nécessite pre-commit
hooks:
	pre-commit install

.env:
	cp .env.example .env
