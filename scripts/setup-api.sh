#!/usr/bin/env bash
set -euo pipefail

# Uso: scripts/setup-api.sh <diretório-do-serviço>
TARGET_DIR="${1:?uso: $0 <diretório-do-serviço>}"
PROJECT_NAME="$(basename "$TARGET_DIR")"
PNPM_VERSION="$(pnpm --version)"

mkdir -p "$TARGET_DIR/src"
cd "$TARGET_DIR"

echo "📝 Criando package.json..."
cat > package.json << EOF
{
  "name": "$PROJECT_NAME",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@$PNPM_VERSION",
  "engines": {
    "node": ">=26"
  },
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsup src/server.ts --format esm --target node26 --clean",
    "start": "node dist/server.js",
    "typecheck": "tsc --noEmit",
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "format": "biome format --write ."
  }
}
EOF

echo "📝 Criando pnpm-workspace.yaml..."
cat > pnpm-workspace.yaml << 'EOF'
# Configurações do pnpm deste serviço. Não declara pacotes, então não é um
# workspace entre serviços (ver ADR 0004).

# Dependências autorizadas a rodar scripts de instalação.
allowBuilds:
  esbuild: true
EOF

echo "📥 Instalando dependências..."
pnpm add fastify zod fastify-type-provider-zod
pnpm add -D typescript tsup tsx @types/node@26
pnpm add -D -E @biomejs/biome

echo "📝 Criando tsconfig.json..."
cat > tsconfig.json << 'EOF'
{
  "compilerOptions": {
    "target": "ES2025",
    "lib": ["ES2025", "ESNext.Temporal"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "types": ["node"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true
  },
  "include": ["src"]
}
EOF

echo "📝 Criando biome.json..."
BIOME_VERSION=$(node -p "require('@biomejs/biome/package.json').version")
cat > biome.json << EOF
{
  "\$schema": "https://biomejs.dev/schemas/${BIOME_VERSION}/schema.json",
  "files": {
    "includes": ["**", "!**/dist"]
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 80
  },
  "linter": {
    "enabled": true,
    "rules": {
      "preset": "recommended"
    }
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "single",
      "semicolons": "asNeeded",
      "trailingCommas": "all",
      "arrowParentheses": "always"
    }
  },
  "assist": {
    "enabled": true,
    "actions": {
      "source": {
        "organizeImports": "on"
      }
    }
  }
}
EOF

echo "📝 Criando src/server.ts..."
cat > src/server.ts << 'EOF'
import fastify from 'fastify'
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import { z } from 'zod'

const app = fastify().withTypeProvider<ZodTypeProvider>()

app.setValidatorCompiler(validatorCompiler)
app.setSerializerCompiler(serializerCompiler)

app.get(
  '/ping',
  {
    schema: {
      response: {
        200: z.object({ message: z.string() }),
      },
    },
  },
  async () => {
    return { message: 'pong' }
  },
)

const port = Number(process.env.PORT) || 3333

app.listen({ port, host: '0.0.0.0' }).then(() => {
  console.log(`🚀 HTTP server running on http://localhost:${port}`)
})
EOF

echo "🧹 Aplicando Biome..."
pnpm exec biome check --write . > /dev/null

echo ""
echo "✅ Pronto! Para começar:"
echo "   cd $TARGET_DIR && pnpm dev"
