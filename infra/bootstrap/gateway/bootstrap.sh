#!/usr/bin/env bash
# Cria os recursos AWS da fase 1 do gateway no Floci dele (ADR 0012 e
# arquitetura.md, seção 11). É idempotente: roda a cada `docker compose up`.
set -euo pipefail

log() { echo "[bootstrap-gateway] $*"; }

# Devolve o primeiro valor da consulta, ou vazio quando não há resultado.
first() {
  local value
  value=$("$@" --output text)
  [ "$value" = "None" ] && value=""
  echo "$value"
}

log "aguardando o Floci em $AWS_ENDPOINT_URL"
until aws sts get-caller-identity >/dev/null 2>&1; do sleep 1; done

# --- RDS PostgreSQL 18 ---------------------------------------------------------
# O Redis do gateway é um container próprio, fora do Floci (spike 0001).

if ! aws rds describe-db-instances --db-instance-identifier gateway >/dev/null 2>&1; then
  log "criando o RDS gateway (PostgreSQL 18)"
  aws rds create-db-instance \
    --db-instance-identifier gateway \
    --engine postgres \
    --engine-version 18 \
    --db-instance-class db.t4g.micro \
    --allocated-storage 20 \
    --master-username gateway \
    --master-user-password "$GATEWAY_DB_PASSWORD" \
    --db-name gateway >/dev/null
fi

aws rds wait db-instance-available --db-instance-identifier gateway
read -r DB_HOST DB_PORT < <(aws rds describe-db-instances \
  --db-instance-identifier gateway \
  --query 'DBInstances[0].Endpoint.[Address,Port]' --output text)
log "RDS disponível em $DB_HOST:$DB_PORT"

# --- Secrets Manager -----------------------------------------------------------

upsert_secret() {
  local name=$1 value=$2
  if aws secretsmanager describe-secret --secret-id "$name" >/dev/null 2>&1; then
    aws secretsmanager put-secret-value --secret-id "$name" --secret-string "$value" >/dev/null
  else
    aws secretsmanager create-secret --name "$name" --secret-string "$value" >/dev/null
  fi
}

upsert_secret gateway/rds "$(printf '{"engine":"postgres","host":"%s","port":%s,"username":"gateway","password":"%s","dbname":"gateway"}' \
  "$DB_HOST" "$DB_PORT" "$GATEWAY_DB_PASSWORD")"
log "segredo gateway/rds atualizado"

# --- SQS, com DLQ --------------------------------------------------------------

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
BUS_NAME=gateway-domain
BUS_ARN="arn:aws:events:${AWS_REGION}:${ACCOUNT_ID}:event-bus/${BUS_NAME}"

queue_arn() {
  aws sqs get-queue-attributes --queue-url "$1" --attribute-names QueueArn \
    --query Attributes.QueueArn --output text
}

# Cria a fila e a DLQ dela. Devolve o ARN da fila principal.
create_queue() {
  local name=$1 dlq_url dlq_arn url attrs
  dlq_url=$(aws sqs create-queue --queue-name "${name}-dlq" --query QueueUrl --output text)
  dlq_arn=$(queue_arn "$dlq_url")

  attrs=$(mktemp)
  printf '{"VisibilityTimeout":"60","RedrivePolicy":"{\\"deadLetterTargetArn\\":\\"%s\\",\\"maxReceiveCount\\":\\"5\\"}"}' \
    "$dlq_arn" >"$attrs"
  url=$(aws sqs create-queue --queue-name "$name" --attributes "file://$attrs" --query QueueUrl --output text)

  # Permite que o barramento de eventos do gateway envie mensagens para a fila.
  printf '{"Policy":"{\\"Version\\":\\"2012-10-17\\",\\"Statement\\":[{\\"Effect\\":\\"Allow\\",\\"Principal\\":{\\"Service\\":\\"events.amazonaws.com\\"},\\"Action\\":\\"sqs:SendMessage\\",\\"Resource\\":\\"%s\\",\\"Condition\\":{\\"ArnEquals\\":{\\"aws:SourceArn\\":\\"%s\\"}}}]}"}' \
    "$(queue_arn "$url")" "$BUS_ARN" >"$attrs"
  aws sqs set-queue-attributes --queue-url "$url" --attributes "file://$attrs"
  rm -f "$attrs"

  queue_arn "$url"
}

WEBHOOK_EVENTS_ARN=$(create_queue webhook-events)
create_queue webhook-delivery >/dev/null
log "filas webhook-events e webhook-delivery prontas"

# --- EventBridge ---------------------------------------------------------------

if ! aws events describe-event-bus --name "$BUS_NAME" >/dev/null 2>&1; then
  aws events create-event-bus --name "$BUS_NAME" >/dev/null
fi

# put-rule e put-targets são upserts.
aws events put-rule \
  --name domain-to-webhook-events \
  --event-bus-name "$BUS_NAME" \
  --event-pattern '{"source":["gateway"]}' >/dev/null
aws events put-targets \
  --rule domain-to-webhook-events \
  --event-bus-name "$BUS_NAME" \
  --targets "Id=webhook-events,Arn=${WEBHOOK_EVENTS_ARN}" >/dev/null
log "barramento $BUS_NAME roteando para webhook-events"

# --- DynamoDB: log público de eventos ------------------------------------------

if ! aws dynamodb describe-table --table-name gateway-events >/dev/null 2>&1; then
  aws dynamodb create-table \
    --table-name gateway-events \
    --attribute-definitions AttributeName=account_id,AttributeType=S AttributeName=event_id,AttributeType=S \
    --key-schema AttributeName=account_id,KeyType=HASH AttributeName=event_id,KeyType=RANGE \
    --billing-mode PAY_PER_REQUEST >/dev/null
  aws dynamodb wait table-exists --table-name gateway-events
  aws dynamodb update-time-to-live \
    --table-name gateway-events \
    --time-to-live-specification Enabled=true,AttributeName=expires_at >/dev/null
fi
log "tabela gateway-events pronta"

# --- KMS: segredos dos endpoints de webhook ------------------------------------

if ! aws kms describe-key --key-id alias/gateway-webhook-secrets >/dev/null 2>&1; then
  KEY_ID=$(aws kms create-key --description "Segredos dos endpoints de webhook" \
    --query KeyMetadata.KeyId --output text)
  aws kms create-alias --alias-name alias/gateway-webhook-secrets --target-key-id "$KEY_ID"
fi
log "chave alias/gateway-webhook-secrets pronta"

# --- AppConfig: configuração de caos (ADR 0013) --------------------------------

APP_ID=$(first aws appconfig list-applications --query "Items[?Name=='sim'].Id | [0]")
[ -n "$APP_ID" ] || APP_ID=$(aws appconfig create-application --name sim --query Id --output text)

ENV_ID=$(first aws appconfig list-environments --application-id "$APP_ID" \
  --query "Items[?Name=='scenario'].Id | [0]")
[ -n "$ENV_ID" ] || ENV_ID=$(aws appconfig create-environment --application-id "$APP_ID" \
  --name scenario --query Id --output text)

PROFILE_ID=$(first aws appconfig list-configuration-profiles --application-id "$APP_ID" \
  --query "Items[?Name=='gateway'].Id | [0]")
[ -n "$PROFILE_ID" ] || PROFILE_ID=$(aws appconfig create-configuration-profile \
  --application-id "$APP_ID" --name gateway --location-uri hosted --type AWS.Freeform \
  --query Id --output text)

STRATEGY_ID=$(first aws appconfig list-deployment-strategies \
  --query "Items[?Name=='AllAtOnceNoBake'].Id | [0]")
[ -n "$STRATEGY_ID" ] || STRATEGY_ID=$(aws appconfig create-deployment-strategy \
  --name AllAtOnceNoBake --deployment-duration-in-minutes 0 --final-bake-time-in-minutes 0 \
  --growth-factor 100 --growth-type LINEAR --replicate-to NONE --query Id --output text)

# Versão inicial, sem caos, apenas se o perfil ainda não tiver nenhuma.
VERSIONS=$(aws appconfig list-hosted-configuration-versions \
  --application-id "$APP_ID" --configuration-profile-id "$PROFILE_ID" \
  --query 'length(Items)' --output text)
if [ "$VERSIONS" = "0" ]; then
  baseline=$(mktemp)
  printf '{"scenario":"baseline","seed":0,"chaos":{},"behavior":{}}' >"$baseline"
  VERSION=$(aws appconfig create-hosted-configuration-version \
    --application-id "$APP_ID" --configuration-profile-id "$PROFILE_ID" \
    --content-type application/json --content "fileb://$baseline" \
    --query VersionNumber --output text /dev/null)
  aws appconfig start-deployment \
    --application-id "$APP_ID" --environment-id "$ENV_ID" \
    --deployment-strategy-id "$STRATEGY_ID" --configuration-profile-id "$PROFILE_ID" \
    --configuration-version "$VERSION" >/dev/null
  rm -f "$baseline"
  log "AppConfig: versão inicial $VERSION do perfil gateway aplicada"
fi

log "pronto"
