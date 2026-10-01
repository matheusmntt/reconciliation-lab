# Ponto de entrada único do monorepo.
# Todo serviço tem um Makefile próprio com o mesmo contrato de alvos.

# Registro de serviços: nome curto -> diretório
dir_gateway := services/third-parties/gateway

SERVICES := gateway
TASKS    := install build test lint typecheck clean

# s=<serviço> restringe a um serviço; sem s, roda em todos
ifneq ($(s),)
ifeq ($(dir_$(s)),)
$(error serviço desconhecido: '$(s)'. Opções: $(SERVICES))
endif
endif

targets = $(if $(s),$(dir_$(s)),$(foreach x,$(SERVICES),$(dir_$(x))))

.DEFAULT_GOAL := help
.PHONY: help dev $(TASKS)

help: ## Lista os comandos
	@grep -E '^[a-zA-Z_-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "} {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

dev: ## Sobe um serviço em watch (exige s=<serviço>)
	@test -n "$(s)" || { echo "uso: make dev s=<serviço>"; exit 1; }
	@$(MAKE) --no-print-directory -C $(dir_$(s)) dev

install:   ## Instala dependências
build:     ## Gera o build
test:      ## Roda os testes
lint:      ## Roda o linter
typecheck: ## Checa os tipos
clean:     ## Remove artefatos de build

$(TASKS):
	@for d in $(targets); do \
		echo "→ $$d: $@"; \
		$(MAKE) --no-print-directory -C $$d $@ || exit 1; \
	done

# --- Ambiente local (infra/docker-compose.yml) --------------------------------
# Usa o perfil reconlab do Colima, a menos que DOCKER_CONTEXT já esteja definido.
export DOCKER_CONTEXT ?= colima-reconlab
COMPOSE := docker compose -f infra/docker-compose.yml

.PHONY: up watch down ps logs reset

up:    ## Sobe o ambiente local
	$(COMPOSE) up -d --build

watch: ## Sobe o ambiente e sincroniza o código dos serviços
	$(COMPOSE) watch

down:  ## Para o ambiente, mantendo os dados
	$(COMPOSE) down

ps:    ## Mostra o estado dos containers
	$(COMPOSE) ps -a

logs:  ## Acompanha os logs (c=<serviço do compose> para filtrar)
	$(COMPOSE) logs -f $(c)

# O down -v não apaga os volumes que o Floci cria para o RDS (spike 0001).
reset: ## Para o ambiente e apaga todos os dados, inclusive os volumes do Floci
	$(COMPOSE) down -v
	@vols=$$(docker volume ls -q --filter name=floci-); \
	if [ -n "$$vols" ]; then docker volume rm $$vols; fi
