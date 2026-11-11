.PHONY: demo up wait seed reset down logs test test-backend test-web test-mobile lint lint-backend lint-web lint-mobile hooks

# Projet Compose (surcharge possible : COMPOSE_PROJECT_NAME=autre make demo).
COMPOSE ?= docker compose
API_URL ?= http://127.0.0.1:$(shell grep -E '^API_PUBLIC_PORT=' .env 2>/dev/null | cut -d= -f2 || echo 8080)
WAIT_SECS ?= 300

## Plateforme complète + données de démonstration, en une commande (voir docs/demarrage.md)
demo: up seed
	@echo "Démo prête : web http://localhost:$$(grep -E '^WEB_PORT=' .env | cut -d= -f2), API $(API_URL)"
	@echo "Comptes : seed_admin@example.test (admin), alice_test@example.test… — mot de passe Password1234!"

## Lance toute la plateforme en local (migrations comprises) et attend que l'API réponde
up: .env
	$(COMPOSE) up --build -d
	@$(MAKE) --no-print-directory wait

wait:
	@echo "Attente de l'API ($(API_URL)/health, $(WAIT_SECS) s au plus)…"
	@for i in $$(seq 1 $(WAIT_SECS)); do \
	  curl -fs $(API_URL)/health >/dev/null 2>&1 && echo "API prête." && exit 0; sleep 1; \
	done; echo "L'API ne répond pas : voir « make logs »." >&2; exit 1

## Données de démonstration (idempotent : ne fait rien si elles existent déjà)
seed:
	python3 seed_demo.py --bootstrap-admin --url $(API_URL) \
	  --postgres-container "$$($(COMPOSE) ps -q postgres)" --output .demo/seed-manifest.json

## Repart de zéro : SUPPRIME la base locale (volume Docker), puis relance la démo
reset: .env
	$(COMPOSE) down -v --remove-orphans
	@$(MAKE) --no-print-directory demo

down:
	$(COMPOSE) down

logs:
	$(COMPOSE) logs --tail=200

## Tous les tests (backend, web, mobile) ; s'arrête au premier échec, `make -k test` les lance tous
test: test-backend test-web test-mobile

test-backend:
	cd backend && cargo test --workspace

test-web: web/node_modules
	cd web && npm test

# Tests JS seulement : aucun build natif (Gradle, Xcode) n'est lancé.
test-mobile: mobile/node_modules
	cd mobile && npm test

lint: lint-backend lint-web lint-mobile

lint-backend:
	cd backend && cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings

lint-web: web/node_modules
	cd web && npm run lint && npm run typecheck

lint-mobile: mobile/node_modules
	cd mobile && npm run lint

## Installe les hooks git (gitleaks) ; nécessite pre-commit
hooks:
	pre-commit install

web/node_modules mobile/node_modules: %/node_modules: %/package-lock.json
	cd $* && npm ci --no-audit --no-fund
	@touch $@

.env:
	cp .env.example .env
