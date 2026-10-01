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
